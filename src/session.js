// Admin sign-in for the Creative Hands Worker (routed from src/index.js): /api/session
//   GET    -> 200 if signed in, 401 if not
//   POST   -> { "passphrase": "..." } ; sets a 12-hour HttpOnly session cookie
//   DELETE -> signs out

import {
  json, isConfigured, sameOrigin, sameSecret, makeSession, hasSession, sessionCookie,
  isLockedOut, noteFailure, clearFailures, SESSION_HOURS,
} from './events.js';

export async function onRequestGet({ env, request }) {
  if (!isConfigured(env)) return json({ signedIn: false, configured: false }, 503);
  const signedIn = await hasSession(env, request);
  return json({ signedIn, configured: true }, signedIn ? 200 : 401);
}

export async function onRequestPost({ env, request }) {
  if (!isConfigured(env)) return json({ error: 'Event storage is not set up on this site yet.' }, 503);
  if (!sameOrigin(request)) return json({ error: 'Not allowed.' }, 403);
  if (await isLockedOut(env, request)) return json({ error: 'Too many wrong attempts. Try again in 15 minutes.' }, 429);

  let passphrase = '';
  try {
    const body = await request.json();
    passphrase = typeof body.passphrase === 'string' ? body.passphrase : '';
  } catch {}

  if (!passphrase || !(await sameSecret(passphrase, env.ADMIN_KEY))) {
    await noteFailure(env, request);
    return json({ error: 'That passphrase is not correct.' }, 401);
  }
  await clearFailures(env, request);
  return json({ signedIn: true }, 200, { 'set-cookie': sessionCookie(await makeSession(env), SESSION_HOURS * 3600) });
}

export async function onRequestDelete({ request }) {
  if (!sameOrigin(request)) return json({ error: 'Not allowed.' }, 403);
  return json({ signedIn: false }, 200, { 'set-cookie': sessionCookie('', 0) });
}
