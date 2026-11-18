// Addresses from the studio's earlier websites (Squarespace, and a 2011 site) that Google,
// bookmarks and old listings may still send people to. Each forwards permanently (301)
// to the matching section of the new single-page site.
//
// Matching ignores capital letters and a trailing slash, so /Birthdays/ and /birthdays both work.

const OLD_TO_NEW = {
  // Squarespace site (from its 2023 sitemap)
  '/home': '/',
  '/birthdays': '/#birthdays',
  '/parties': '/#groups',
  '/contact-us': '/#visit',
  '/about-us': '/#how',
  '/summer': '/#events',
  '/events': '/#events',
  '/search': '/',
  // 2011 site
  '/home_page.html': '/',
  '/birthday_parties.html': '/#birthdays',
  '/groups.html': '/#groups',
  '/contact___directions.html': '/#visit',
  '/how_it_works.html': '/#how',
  '/ladies__night.html': '/#thursdays',
};

// Returns the new address for an old path, or null.
export function legacyTarget(pathname) {
  let p = pathname.toLowerCase();
  if (p.length > 1) p = p.replace(/\/+$/, '');
  return Object.prototype.hasOwnProperty.call(OLD_TO_NEW, p) ? OLD_TO_NEW[p] : null;
}
