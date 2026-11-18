// Creative Hands Worker entry point.
// Static files in public/ are served by Cloudflare before this code runs;
// only requests that don't match a file reach here.

import * as events from './events.js';
import { handleAdmin } from './admin.js';
import { homePage } from './home.js';

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const { pathname } = url;

    // The home page passes through here first (wrangler.jsonc "run_worker_first").
    if ((pathname === '/' || pathname === '/index.html') && (request.method === 'GET' || request.method === 'HEAD')) {
      if (pathname === '/index.html') return Response.redirect(new URL('/', url), 301);
      try { return await homePage(request, env); }
      catch (err) { console.error(err); return env.ASSETS.fetch(request); }
    }

    try {
      if (pathname === '/api/events') {
        if (request.method === 'GET' || request.method === 'HEAD') return await events.onRequestGet({ env, request });
        return new Response('Method not allowed', { status: 405, headers: { allow: 'GET' } });
      }
      if (pathname.startsWith('/admin/api/')) return await handleAdmin(request, env, pathname);

      // The admin page used to live at /admin.html.
      if (pathname === '/admin.html' || pathname === '/admin') return Response.redirect(new URL('/admin/', url), 301);
    } catch (err) {
      console.error(err);
      return events.json({ error: 'Something went wrong on the server. Try again.' }, 500);
    }
    return env.ASSETS.fetch(request); // falls through to 404.html
  },
};
