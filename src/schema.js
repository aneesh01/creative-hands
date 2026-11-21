// Builds schema.org Event data for upcoming events, so Google can understand
// (and may list) the studio's events. Mirrors the calendar logic in public/index.html:
// weekly and monthly events repeat until their "until" date; times are studio (America/Chicago) time.

const TZ = 'America/Chicago';
const SITE = 'https://www.creativehandsceramics.com';
const DAY = 86400000;
const DATE = /^\d{4}-\d{2}-\d{2}$/;

const PLACE = {
  '@type': 'Place',
  name: 'Creative Hands',
  address: {
    '@type': 'PostalAddress',
    streetAddress: '2225 W Park Row, Suite G',
    addressLocality: 'Pantego',
    addressRegion: 'TX',
    postalCode: '76013',
    addressCountry: 'US',
  },
};
const ORGANIZER = { '@type': 'Organization', name: 'Creative Hands', url: `${SITE}/` };

const pad = n => String(n).padStart(2, '0');
const toUTC = s => Date.UTC(+s.slice(0, 4), +s.slice(5, 7) - 1, +s.slice(8, 10));
const fromUTC = ms => { const d = new Date(ms); return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`; };

function chicagoParts(ms) {
  const o = {};
  new Intl.DateTimeFormat('en-US', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false })
    .formatToParts(new Date(ms)).forEach(p => { o[p.type] = p.value; });
  return o;
}

// Today's date in studio time, e.g. "2026-11-18".
export function studioToday(nowMs = Date.now()) {
  const o = chicagoParts(nowMs);
  return `${o.year}-${o.month}-${o.day}`;
}

// UTC offset in Chicago at a local date+time, e.g. "-06:00" (CST) or "-05:00" (CDT).
export function chicagoOffset(date, time) {
  const [h, m] = (time || '12:00').split(':').map(Number);
  const guess = Date.UTC(+date.slice(0, 4), +date.slice(5, 7) - 1, +date.slice(8, 10), h, m);
  const o = chicagoParts(guess);
  const local = Date.UTC(+o.year, +o.month - 1, +o.day, +o.hour % 24, +o.minute);
  const mins = Math.round((local - guess) / 60000);
  const sign = mins < 0 ? '-' : '+', abs = Math.abs(mins);
  return `${sign}${pad(Math.floor(abs / 60))}:${pad(abs % 60)}`;
}

const stamp = (date, time) => (time ? `${date}T${time}:00${chicagoOffset(date, time)}` : date);

// The day (UTC ms) a monthly event falls on in month m (0-based, may overflow) of year y,
// or null when that month has no such day (e.g. the 31st in a 30-day month).
function monthlyDay(repeat, s, y, m) {
  const first = new Date(s), day = first.getUTCDate(), w = first.getUTCDay();
  const len = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
  let k;
  if (repeat === 'monthly-date') k = day;
  else if (repeat === 'monthly-last') k = len - ((new Date(Date.UTC(y, m, len)).getUTCDay() - w + 7) % 7);
  else k = 1 + ((w - new Date(Date.UTC(y, m, 1)).getUTCDay() + 7) % 7) + (Math.ceil(day / 7) - 1) * 7;
  return k <= len ? Date.UTC(y, m, k) : null;
}

// Every occurrence between two dates (inclusive), sorted - same rules as the site calendar.
export function occurrences(events, from, to) {
  const out = [], a = toUTC(from), b = toUTC(to), W = 7 * DAY;
  for (const ev of Array.isArray(events) ? events : []) {
    if (!ev || !DATE.test(ev.date || '')) continue;
    const s = toUTC(ev.date);
    const end = DATE.test(ev.until || '') ? Math.min(b, toUTC(ev.until)) : b;
    if (ev.repeat === 'weekly') {
      let t = s;
      if (t < a) t += Math.ceil((a - t) / W) * W;
      for (; t <= end; t += W) out.push({ ev, date: fromUTC(t) });
    } else if (/^monthly-(date|nth|last)$/.test(ev.repeat)) {
      const f = new Date(Math.max(s, a));
      for (let y = f.getUTCFullYear(), m = f.getUTCMonth(); Date.UTC(y, m, 1) <= end; m++) {
        const t = monthlyDay(ev.repeat, s, y, m);
        if (t !== null && t >= s && t >= a && t <= end) out.push({ ev, date: fromUTC(t) });
      }
    } else if (s >= a && s <= b) out.push({ ev, date: ev.date });
  }
  return out.sort((x, y) => (x.date + (x.ev.start || '')).localeCompare(y.date + (y.ev.start || '')));
}

// schema.org Event objects for the next `days` days (at most `max`).
export function eventsJsonLd(events, nowMs = Date.now(), { days = 60, max = 20 } = {}) {
  const today = studioToday(nowMs);
  const until = fromUTC(toUTC(today) + days * DAY);
  return occurrences(events, today, until).slice(0, max).map(({ ev, date }) => {
    const item = {
      '@context': 'https://schema.org',
      '@type': 'Event',
      name: ev.title,
      description: ev.desc || `${ev.title} at Creative Hands, a paint-your-own ceramics and plaster studio in Pantego, Texas.`,
      startDate: stamp(date, ev.start),
      eventStatus: 'https://schema.org/EventScheduled',
      eventAttendanceMode: 'https://schema.org/OfflineEventAttendanceMode',
      location: PLACE,
      image: [`${SITE}/img/hero.webp`],
      organizer: ORGANIZER,
      url: `${SITE}/#events`,
    };
    if (ev.start && ev.end) item.endDate = stamp(date, ev.end);
    else if (!ev.start) item.endDate = date;
    return item;
  });
}

// Safe to place inside <script type="application/ld+json">.
export const ldScript = data => `<script type="application/ld+json">${JSON.stringify(data).replace(/</g, '\\u003c')}</script>`;
