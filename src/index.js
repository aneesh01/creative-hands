// Creative Hands Worker entry point.
// Static files in public/ are served by Cloudflare before this code runs;
// only requests that don't match a file reach here.

import * as events from './events.js';
import * as session from './session.js';

const routes = { '/api/events': events, '/api/session': session };

export default {
  async fetch(request, env) {
    const { pathname } = new URL(request.url);
    const mod = routes[pathname];
    if (!mod) return env.ASSETS.fetch(request); // falls through to 404.html

    const name = 'onRequest' + request.method[0] + request.method.slice(1).toLowerCase();
    const handler = mod[name];
    if (!handler) return new Response('Method not allowed', { status: 405 });
    try {
      return await handler({ env, request });
    } catch (err) {
      console.error(err);
      return events.json({ error: 'Something went wrong on the server. Try again.' }, 500);
    }
  },
};
