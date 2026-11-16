// Events API for the Creative Hands Worker (routed from src/index.js): /api/events
//   GET -> public list of events (from KV, falling back to the static events.json)
//   PUT -> replace the list; requires a signed-in admin session (see session.js)
//
// Needs (see wrangler.jsonc and the Worker settings):
//   - a KV namespace bound as EVENTS
//   - a secret named ADMIN_KEY (the admin passphrase)

const MAX_EVENTS = 300;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;

export const SESSION_COOKIE = '__Host-ch_admin';
export const SESSION_HOURS = 12;
const MAX_FAILS = 8;           // wrong passphrases allowed per address...
const FAIL_WINDOW = 15 * 60;   // ...in this many seconds

export const json = (body, status = 200, extra = {}) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', 'x-events-api': '1', ...extra },
  });

export const isConfigured = env => Boolean(env.EVENTS && env.ADMIN_KEY);

const enc = new TextEncoder();
const b64url = buf => btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

function sameBytes(x, y) {
  const u = new Uint8Array(x), v = new Uint8Array(y);
  if (u.length !== v.length) return false;
  let diff = 0;
  for (let i = 0; i < u.length; i++) diff |= u[i] ^ v[i];
  return diff === 0;
}

// Constant-time comparison of two strings (hash first so lengths always match).
export async function sameSecret(a, b) {
  const [x, y] = await Promise.all([crypto.subtle.digest('SHA-256', enc.encode(a)), crypto.subtle.digest('SHA-256', enc.encode(b))]);
  return sameBytes(x, y);
}

async function sign(secret, message) {
  const key = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return crypto.subtle.sign('HMAC', key, enc.encode(message));
}

// Session token = "<expiry seconds>.<HMAC of expiry keyed by ADMIN_KEY>".
// Changing ADMIN_KEY signs everyone out.
export async function makeSession(env, now = Date.now()) {
  const exp = Math.floor(now / 1000) + SESSION_HOURS * 3600;
  return `${exp}.${b64url(await sign(env.ADMIN_KEY, `admin:${exp}`))}`;
}

function readCookie(request, name) {
  const raw = request.headers.get('cookie') || '';
  for (const part of raw.split(';')) {
    const i = part.indexOf('=');
    if (i > 0 && part.slice(0, i).trim() === name) return part.slice(i + 1).trim();
  }
  return '';
}

export async function hasSession(env, request, now = Date.now()) {
  if (!env.ADMIN_KEY) return false;
  const token = readCookie(request, SESSION_COOKIE);
  const m = /^(\d{1,12})\.([A-Za-z0-9_-]{20,})$/.exec(token);
  if (!m || Number(m[1]) * 1000 < now) return false;
  const expected = b64url(await sign(env.ADMIN_KEY, `admin:${m[1]}`));
  return sameBytes(enc.encode(expected), enc.encode(m[2]));
}

export const sessionCookie = (token, maxAge) =>
  `${SESSION_COOKIE}=${token}; Path=/; Max-Age=${maxAge}; HttpOnly; Secure; SameSite=Strict`;

// --- wrong-passphrase limiter (stored in the same KV namespace) ---
const failKey = request => `fail:${request.headers.get('cf-connecting-ip') || 'unknown'}`;
export async function isLockedOut(env, request) {
  return Number((await env.EVENTS.get(failKey(request))) || 0) >= MAX_FAILS;
}
export async function noteFailure(env, request) {
  const k = failKey(request);
  const n = Number((await env.EVENTS.get(k)) || 0) + 1;
  await env.EVENTS.put(k, String(n), { expirationTtl: FAIL_WINDOW });
}
export async function clearFailures(env, request) {
  await env.EVENTS.delete(failKey(request));
}

// Blocks cross-site writes: browsers always send Origin on PUT/POST/DELETE.
export function sameOrigin(request) {
  const origin = request.headers.get('origin');
  return !origin || origin === new URL(request.url).origin;
}

const text = (v, max) => (typeof v === 'string' ? v.trim().slice(0, max) : '');

// Returns a cleaned list, or throws an Error with a message safe to show the admin.
export function cleanEvents(input) {
  if (!Array.isArray(input)) throw new Error('Expected a list of events.');
  if (input.length > MAX_EVENTS) throw new Error(`Too many events (limit ${MAX_EVENTS}).`);
  const seen = new Set();
  return input.map((raw, i) => {
    const n = i + 1;
    if (!raw || typeof raw !== 'object') throw new Error(`Event ${n} is not valid.`);
    const title = text(raw.title, 120);
    if (!title) throw new Error(`Event ${n} needs a title.`);
    if (!DATE.test(raw.date || '')) throw new Error(`"${title}" needs a valid date.`);
    const start = text(raw.start, 5), end = text(raw.end, 5), until = text(raw.until, 10);
    if (start && !TIME.test(start)) throw new Error(`"${title}" has an invalid start time.`);
    if (end && !TIME.test(end)) throw new Error(`"${title}" has an invalid end time.`);
    if (until && !DATE.test(until)) throw new Error(`"${title}" has an invalid repeat-until date.`);
    let id = text(raw.id, 80).replace(/[^a-zA-Z0-9_-]/g, '') || `event-${n}`;
    while (seen.has(id)) id += '-x';
    seen.add(id);
    return { id, title, date: raw.date, start, end, repeat: raw.repeat === 'weekly' ? 'weekly' : 'none', until, desc: text(raw.desc, 600) };
  });
}

export async function onRequestGet({ env, request }) {
  let body = env.EVENTS ? await env.EVENTS.get('events') : null;
  if (!body && env.ASSETS) {
    const res = await env.ASSETS.fetch(new URL('/events.json', request.url));
    if (res.ok) body = await res.text();
  }
  return new Response(body || '[]', {
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
      'x-events-api': '1',
      'x-events-writable': isConfigured(env) ? '1' : '0',
    },
  });
}

export async function onRequestPut({ env, request }) {
  if (!isConfigured(env)) return json({ error: 'Event storage is not set up on this site yet.' }, 503);
  if (!sameOrigin(request)) return json({ error: 'Not allowed.' }, 403);
  if (!(await hasSession(env, request))) return json({ error: 'You have been signed out. Sign in again to publish.' }, 401);
  let events;
  try {
    events = cleanEvents(await request.json());
  } catch (err) {
    return json({ error: err instanceof SyntaxError ? 'The request was not valid JSON.' : err.message }, 400);
  }
  await env.EVENTS.put('events', JSON.stringify(events));
  return json({ ok: true, count: events.length });
}
