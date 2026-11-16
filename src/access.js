// Checks that a request really passed Cloudflare Access.
//
// Cloudflare Access sits in front of /admin and adds a signed token (a JWT) to every request
// it lets through. We verify that token ourselves, so the admin API stays locked even if the
// Access rule were ever removed or mis-set.
//
// Settings (wrangler.jsonc "vars"):
//   ACCESS_TEAM_DOMAIN  e.g. https://yourteam.cloudflareaccess.com
//   ACCESS_AUD          the Access application's "Application Audience (AUD) Tag"
//                       (several allowed, separated by commas)
//
// Local development only: put DEV_ADMIN_EMAIL in .dev.vars. It is honoured only for
// requests to localhost / 127.0.0.1, never on a real domain.

const CERT_TTL_MS = 60 * 60 * 1000;
let certCache = { url: '', at: 0, keys: [] };

const b64urlToBytes = s => {
  const b = atob(s.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((s.length + 3) % 4));
  return Uint8Array.from(b, c => c.charCodeAt(0));
};
const decodePart = s => JSON.parse(new TextDecoder().decode(b64urlToBytes(s)));

async function signingKeys(certsUrl, forceRefresh = false) {
  if (!forceRefresh && certCache.url === certsUrl && Date.now() - certCache.at < CERT_TTL_MS) return certCache.keys;
  const res = await fetch(certsUrl);
  if (!res.ok) throw new Error(`Could not load Access keys (${res.status})`);
  const { keys = [] } = await res.json();
  certCache = { url: certsUrl, at: Date.now(), keys };
  return keys;
}

function tokenFrom(request) {
  const header = request.headers.get('cf-access-jwt-assertion');
  if (header) return header;
  const m = /(?:^|;\s*)CF_Authorization=([^;]+)/.exec(request.headers.get('cookie') || '');
  return m ? m[1] : '';
}

const isLocal = request => ['localhost', '127.0.0.1', '[::1]'].includes(new URL(request.url).hostname);

// Returns { email } for a verified Access user, otherwise null.
export async function accessUser(env, request, now = Date.now()) {
  if (env.DEV_ADMIN_EMAIL && isLocal(request)) return { email: String(env.DEV_ADMIN_EMAIL), dev: true };

  const team = String(env.ACCESS_TEAM_DOMAIN || '').replace(/\/+$/, '');
  const auds = String(env.ACCESS_AUD || '').split(',').map(s => s.trim()).filter(Boolean);
  if (!/^https:\/\/[a-z0-9-]+\.cloudflareaccess\.com$/.test(team) || !auds.length) return null;

  const token = tokenFrom(request);
  const parts = token.split('.');
  if (parts.length !== 3) return null;

  let header, claims;
  try { header = decodePart(parts[0]); claims = decodePart(parts[1]); } catch { return null; }
  if (header.alg !== 'RS256' || !header.kid) return null;

  // Find the signing key (refresh once if Cloudflare has rotated its keys).
  const certsUrl = `${team}/cdn-cgi/access/certs`;
  let jwk = (await signingKeys(certsUrl)).find(k => k.kid === header.kid);
  if (!jwk) jwk = (await signingKeys(certsUrl, true)).find(k => k.kid === header.kid);
  if (!jwk) return null;

  const key = await crypto.subtle.importKey('jwk', jwk, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['verify']);
  const signed = new TextEncoder().encode(`${parts[0]}.${parts[1]}`);
  const ok = await crypto.subtle.verify('RSASSA-PKCS1-v1_5', key, b64urlToBytes(parts[2]), signed);
  if (!ok) return null;

  const seconds = Math.floor(now / 1000);
  const aud = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
  if (claims.iss !== team) return null;
  if (!aud.some(a => auds.includes(a))) return null;
  if (typeof claims.exp !== 'number' || claims.exp < seconds) return null;
  if (typeof claims.nbf === 'number' && claims.nbf > seconds + 60) return null;
  if (typeof claims.email !== 'string' || !claims.email) return null;
  return { email: claims.email };
}

// For tests only.
export const _resetAccessCache = () => { certCache = { url: '', at: 0, keys: [] }; };
