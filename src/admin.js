// Admin API, all under /admin/api/ and only for users who passed Cloudflare Access.
//   GET  /admin/api/events   -> { events, version, user }
//   PUT  /admin/api/events   -> body { events, baseVersion } ; publishes and records history
//   GET  /admin/api/history  -> { versions: [{ id, at, by, count, note }], version }
//   POST /admin/api/restore  -> body { id, baseVersion } ; republishes an earlier version
//
// "version" is the id of the newest history entry. Saving with an out-of-date baseVersion
// is refused (409), so two people editing at once can't silently overwrite each other.

import { json, cleanEvents, currentEventsText } from './events.js';
import { accessUser } from './access.js';

const HISTORY_KEY = 'history';
const HISTORY_MAX = 30;

const readHistory = async env => {
  try { const h = JSON.parse((await env.EVENTS.get(HISTORY_KEY)) || '[]'); return Array.isArray(h) ? h : []; }
  catch { return []; }
};
const headVersion = history => (history[0] && history[0].id) || 'initial';
const newId = () => `${Date.now().toString(36)}-${crypto.getRandomValues(new Uint32Array(1))[0].toString(36)}`;
const summary = ({ id, at, by, count, note }) => ({ id, at, by, count, note: note || '' });

function sameOrigin(request) {
  const origin = request.headers.get('origin');
  return !origin || origin === new URL(request.url).origin;
}

async function readBody(request) {
  if (!/^application\/json\b/i.test(request.headers.get('content-type') || '')) throw new Error('Expected JSON.');
  try { return await request.json(); } catch { throw new Error('The request was not valid JSON.'); }
}

// Save `events` as the live list and add it to history. Returns the new version id.
async function publish(env, request, events, by, note) {
  let history = await readHistory(env);
  if (!history.length) {
    // First save since history began: keep what was live before, so it can be restored.
    let before = [];
    try { before = cleanEvents(JSON.parse(await currentEventsText(env, request))); } catch {}
    history = [{ id: 'initial', at: new Date().toISOString(), by: '', count: before.length, note: 'Before history began', events: before }];
  }
  const entry = { id: newId(), at: new Date().toISOString(), by, count: events.length, note, events };
  history = [entry, ...history].slice(0, HISTORY_MAX);
  await env.EVENTS.put('events', JSON.stringify(events));
  await env.EVENTS.put(HISTORY_KEY, JSON.stringify(history));
  return entry.id;
}

export async function handleAdmin(request, env, pathname) {
  if (!env.EVENTS) return json({ error: 'Event storage is not set up on this site.' }, 503);
  const user = await accessUser(env, request);
  if (!user) return json({ error: 'You are not signed in. Reload the page to sign in.' }, 401);

  const route = `${request.method} ${pathname}`;
  if (request.method !== 'GET' && !sameOrigin(request)) return json({ error: 'Not allowed.' }, 403);

  if (route === 'GET /admin/api/events') {
    const history = await readHistory(env);
    return json({ events: JSON.parse(await currentEventsText(env, request)), version: headVersion(history), user: user.email });
  }

  if (route === 'GET /admin/api/history') {
    const history = await readHistory(env);
    return json({ versions: history.map(summary), version: headVersion(history) });
  }

  if (route === 'PUT /admin/api/events') {
    let body, events;
    try { body = await readBody(request); events = cleanEvents(body && body.events); }
    catch (err) { return json({ error: err.message }, 400); }
    const history = await readHistory(env);
    if (body.baseVersion !== headVersion(history)) {
      return json({ error: 'Someone else published changes while you were editing. Reload to see the latest list, then make your changes again.' }, 409);
    }
    const version = await publish(env, request, events, user.email, 'Published');
    return json({ ok: true, count: events.length, version });
  }

  if (route === 'POST /admin/api/restore') {
    let body;
    try { body = await readBody(request); } catch (err) { return json({ error: err.message }, 400); }
    const history = await readHistory(env);
    if (body.baseVersion !== headVersion(history)) {
      return json({ error: 'The list changed since you opened this page. Reload and try again.' }, 409);
    }
    const target = history.find(h => h.id === body.id);
    if (!target) return json({ error: 'That version is no longer in the history.' }, 404);
    const when = new Date(target.at).toLocaleString('en-US', { timeZone: 'America/Chicago', dateStyle: 'medium', timeStyle: 'short' });
    const version = await publish(env, request, cleanEvents(target.events), user.email, `Restored the version from ${when}`);
    return json({ ok: true, count: target.events.length, version });
  }

  return json({ error: 'Not found.' }, 404);
}
