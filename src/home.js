// Home page post-processing. The Worker runs before the static home page (see
// "run_worker_first" in wrangler.jsonc) and adds to <head>:
//   - Google Analytics 4, only when GA_MEASUREMENT_ID is set (production only)
//   - schema.org Event data for the upcoming published events
//   - the published events themselves (#events-data), so the calendar needs no extra request
// If anything goes wrong, the unmodified page is served.

import { currentEventsText } from './events.js';
import { eventsJsonLd, ldScript } from './schema.js';

const GA_ID = /^G-[A-Z0-9]{4,20}$/;

export function gaSnippet(id) {
  if (!GA_ID.test(id || '')) return '';
  return `<script async src="https://www.googletagmanager.com/gtag/js?id=${id}"></script>`
    + `<script>window.dataLayer=window.dataLayer||[];function gtag(){dataLayer.push(arguments)}`
    + `gtag('js',new Date());gtag('config','${id}',{allow_google_signals:false,allow_ad_personalization_signals:false});</script>`;
}

// Safe inside <script type="application/json"> ("<" escaped so nothing can close the tag).
const eventsData = events =>
  `<script type="application/json" id="events-data">${JSON.stringify(events).replace(/</g, '\\u003c')}</script>`;

export async function homePage(request, env) {
  // Ask for the plain file (no If-None-Match), since what we add changes as events change.
  const page = await env.ASSETS.fetch(new Request(new URL('/', request.url), { method: 'GET' }));
  if (!page.ok || !(page.headers.get('content-type') || '').includes('text/html')) return page;

  let extra = '';
  try {
    extra += gaSnippet(env.GA_MEASUREMENT_ID);
    const events = JSON.parse(await currentEventsText(env, request));
    // The published list, so the page can draw the banner and calendar without fetching it.
    if (Array.isArray(events)) extra += eventsData(events);
    const items = eventsJsonLd(events);
    if (items.length) extra += ldScript(items);
  } catch (err) {
    console.error('home page additions skipped:', err);
  }
  if (!extra) return page;

  const headers = new Headers(page.headers);
  headers.delete('etag');
  headers.delete('content-length');
  headers.set('cache-control', 'no-cache');
  const res = new Response(page.body, { status: page.status, headers });
  const out = new HTMLRewriter().on('head', { element(el) { el.append(extra, { html: true }); } }).transform(res);
  return request.method === 'HEAD' ? new Response(null, { status: out.status, headers: out.headers }) : out;
}
