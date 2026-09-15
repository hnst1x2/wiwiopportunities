// SSRF guard for server-side fetches of admin-supplied URLs (AI import).
// The server must never be turned into a proxy to the loopback interface or the
// private network: on this host that would reach the Caddy admin API and the other
// containers. Three layers: syntactic check, DNS resolution check, and per-hop
// re-validation of every redirect.
const net = require('net');
const { lookup } = require('dns').promises;

const MAX_REDIRECTS = 5;
const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);

// Fails closed: anything unparsable counts as private.
function isPrivateIPv4(ip) {
  const parts = ip.split('.').map(Number);
  if (parts.length !== 4 || parts.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return true;
  const [a, b, c] = parts;
  if (a === 0 || a === 10 || a === 127) return true; // this-network, private, loopback
  if (a === 169 && b === 254) return true; // link-local (cloud metadata)
  if (a === 172 && b >= 16 && b <= 31) return true; // private
  if (a === 192 && b === 168) return true; // private
  if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT
  if (a === 192 && b === 0 && c === 0) return true; // IETF protocol assignments
  if (a === 198 && (b === 18 || b === 19)) return true; // benchmarking
  if (a >= 224) return true; // multicast, reserved, broadcast
  return false;
}

function isPrivateIPv6(ip) {
  const address = ip.toLowerCase().replace(/^\[|\]$/g, '');
  // IPv4-mapped (::ffff:127.0.0.1) — judge the embedded IPv4.
  const mapped = address.match(/^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/);
  if (mapped) return isPrivateIPv4(mapped[1]);
  if (address.startsWith('::')) return true; // ::, ::1 and the rest of ::/16
  const firstHextet = parseInt(address.split(':')[0], 16);
  if (!Number.isInteger(firstHextet)) return true;
  if ((firstHextet & 0xfe00) === 0xfc00) return true; // unique local fc00::/7
  if (firstHextet >= 0xfe80 && firstHextet <= 0xfebf) return true; // link-local
  if ((firstHextet & 0xff00) === 0xff00) return true; // multicast
  return false;
}

function isPublicIp(ip) {
  if (net.isIPv4(ip)) return !isPrivateIPv4(ip);
  if (net.isIPv6(ip)) return !isPrivateIPv6(ip);
  return false;
}

// Syntactic gate — cheap, and the only check that can run synchronously.
// Decimal/hex/octal IP forms (http://2130706433/) are NOT caught here; they are
// caught by assertPublicHost below, because getaddrinfo normalizes them.
function isSafePublicUrl(rawUrl) {
  let url;
  try {
    url = new URL(rawUrl);
  } catch {
    return false;
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return false;
  const host = url.hostname.toLowerCase();
  if (!host) return false;
  if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local') || host.endsWith('.internal')) {
    return false;
  }
  const literal = host.replace(/^\[|\]$/g, '');
  if (net.isIP(literal)) return isPublicIp(literal);
  return true;
}

// Resolve the hostname and require EVERY answer to be a public address.
// Residual risk: fetch() resolves again, so a DNS-rebinding attacker could still flip
// the answer between this check and the connection (pinning needs a custom undici
// dispatcher). Acceptable here: the URL comes from an authenticated admin.
async function assertPublicHost(hostname) {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, '');
  if (net.isIP(host)) {
    if (!isPublicIp(host)) throw new Error(`blocked non-public address ${host}`);
    return;
  }
  let addresses;
  try {
    addresses = await lookup(host, { all: true, verbatim: true });
  } catch {
    throw new Error(`could not resolve ${host}`);
  }
  if (!addresses.length) throw new Error(`could not resolve ${host}`);
  for (const entry of addresses) {
    if (!isPublicIp(entry.address)) throw new Error(`blocked non-public address for ${host}`);
  }
}

/**
 * fetch() restricted to public hosts, following redirects manually so that every
 * hop is re-validated (a public URL 302-ing to 127.0.0.1 is what makes
 * redirect:'follow' unsafe).
 */
async function fetchPublicUrl(rawUrl, { headers, timeoutMs, maxRedirects = MAX_REDIRECTS } = {}) {
  let current = String(rawUrl);
  for (let hop = 0; hop <= maxRedirects; hop += 1) {
    if (!isSafePublicUrl(current)) throw new Error('blocked non-public URL');
    await assertPublicHost(new URL(current).hostname);

    const response = await fetch(current, {
      redirect: 'manual',
      signal: AbortSignal.timeout(timeoutMs),
      headers,
    });
    if (!REDIRECT_STATUSES.has(response.status)) return response;

    const location = response.headers.get('location');
    if (!location) return response;
    current = new URL(location, current).toString();
  }
  throw new Error('too many redirects');
}

module.exports = { fetchPublicUrl, isSafePublicUrl, isPublicIp };
