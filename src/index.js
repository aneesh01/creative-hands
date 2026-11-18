// Creative Hands Worker entry point.
// Static files in public/ are served by Cloudflare directly. This code runs for the paths
// listed in wrangler.jsonc "run_worker_first", and for any address that has no file
// (where it handles old-site redirects, then shows the 404 page).

import * as events from './events.js';
import { handleAdmin } from './admin.js';
import { homePage } from './home.js';
import { legacyTarget } from './legacy.js';

// The site's own "not found" page, with a real 404 status.
async function notFound(request, env) {
  const page = await env.ASSETS.fetch(new Request(new URL('/404.html', request.url)));
  const body = page.ok ? page.body : 'Not found';
  return new Response(request.method === 'HEAD' ? null : body, {
    status: 404,
    headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-cache' },
  });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const { pathname } = url;
    const reading = request.method === 'GET' || request.method === 'HEAD';

    // The home page passes through here first (wrangler.jsonc "run_worker_first").
    if ((pathname === '/' || pathname === '/index.html') && reading) {
      if (pathname === '/index.html') return Response.redirect(new URL('/', url), 301);
      try { return await homePage(request, env); }
      catch (err) { console.error(err); return env.ASSETS.fetch(request); }
    }

    try {
      if (pathname === '/api/events') {
        if (reading) return await events.onRequestGet({ env, request });
        return new Response('Method not allowed', { status: 405, headers: { allow: 'GET' } });
      }
      if (pathname.startsWith('/admin/api/')) return await handleAdmin(request, env, pathname);

      // The admin page used to live at /admin.html.
      if (pathname === '/admin.html' || pathname === '/admin') return Response.redirect(new URL('/admin/', url), 301);

      // Old website addresses -> the matching section of the new page (keeps ?query, e.g. tracking tags).
      const target = reading && legacyTarget(pathname);
      if (target) {
        const to = new URL(target, url);
        to.search = url.search;
        return Response.redirect(to.toString(), 301);
      }
    } catch (err) {
      console.error(err);
      return events.json({ error: 'Something went wrong on the server. Try again.' }, 500);
    }

    // Anything else: a static file if there is one, otherwise the 404 page.
    const asset = await env.ASSETS.fetch(request);
    return asset.status === 404 ? notFound(request, env) : asset;
  },
};
