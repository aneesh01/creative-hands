// Public events feed: GET /api/events
// Returns the published list from KV, or the starter list in public/events.json
// until something has been published.
//
// Needs a KV namespace bound as EVENTS (see wrangler.jsonc).

const MAX_EVENTS = 300;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;

export const json = (body, status = 200, extra = {}) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', 'x-events-api': '1', ...extra },
  });

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

// The current list as a JSON string (KV first, then the starter file).
export async function currentEventsText(env, request) {
  let body = env.EVENTS ? await env.EVENTS.get('events') : null;
  if (!body && env.ASSETS) {
    const res = await env.ASSETS.fetch(new URL('/events.json', request.url));
    if (res.ok) body = await res.text();
  }
  return body || '[]';
}

export async function onRequestGet({ env, request }) {
  return new Response(await currentEventsText(env, request), {
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', 'x-events-api': '1' },
  });
}
