// Regression tests for the SSRF guard (server/safeFetch.js).
// Run with: npm test
const test = require('node:test');
const assert = require('node:assert');

const { isSafePublicUrl, isPublicIp, fetchPublicUrl } = require('../server/safeFetch');

test('isPublicIp accepts routable addresses', () => {
  for (const ip of ['8.8.8.8', '1.1.1.1', '37.27.187.110', '2606:4700::1111']) {
    assert.strictEqual(isPublicIp(ip), true, ip);
  }
});

test('isPublicIp rejects loopback, private, link-local and multicast ranges', () => {
  const blocked = [
    '127.0.0.1',
    '10.0.0.5',
    '172.16.0.1',
    '172.31.255.255',
    '192.168.1.1',
    '169.254.169.254', // cloud metadata
    '100.64.0.1', // CGNAT
    '0.0.0.0',
    '224.0.0.1',
    '255.255.255.255',
    '::1',
    'fd00::1', // unique local
    'fe80::1', // link-local
    '::ffff:127.0.0.1', // IPv4-mapped loopback
  ];
  for (const ip of blocked) {
    assert.strictEqual(isPublicIp(ip), false, ip);
  }
});

test('isSafePublicUrl rejects non-http(s) schemes', () => {
  for (const url of ['ftp://example.com', 'file:///etc/passwd', 'gopher://example.com', 'not a url']) {
    assert.strictEqual(isSafePublicUrl(url), false, url);
  }
});

test('isSafePublicUrl rejects internal host names and private literals', () => {
  const blocked = [
    'http://localhost/',
    'http://app.localhost/',
    'http://db.internal/',
    'http://printer.local/',
    'http://127.0.0.1:2019/config', // the Caddy admin API on the host
    'http://169.254.169.254/latest/meta-data/',
    'http://[::1]:3000/',
    'http://192.168.0.10/',
  ];
  for (const url of blocked) {
    assert.strictEqual(isSafePublicUrl(url), false, url);
  }
});

test('isSafePublicUrl rejects alternative encodings of 127.0.0.1', () => {
  // WHATWG URL parsing normalises these to 127.0.0.1 before the IP check runs.
  for (const url of ['http://2130706433/', 'http://0x7f000001/', 'http://017700000001/']) {
    assert.strictEqual(isSafePublicUrl(url), false, url);
  }
});

test('isSafePublicUrl accepts ordinary public pages', () => {
  for (const url of ['https://example.com/opportunity', 'http://example.org:8080/a?b=c']) {
    assert.strictEqual(isSafePublicUrl(url), true, url);
  }
});

test('fetchPublicUrl refuses to reach a loopback target', async () => {
  await assert.rejects(() => fetchPublicUrl('http://127.0.0.1:9/', { timeoutMs: 2000 }), /blocked non-public URL/);
});

test('fetchPublicUrl re-validates every redirect hop', async () => {
  // A public IP literal as the entry point (no DNS needed), whose response redirects to
  // the Caddy admin API on loopback — the exact bypass that redirect:'follow' allowed.
  const originalFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => {
    calls += 1;
    return new Response(null, { status: 302, headers: { location: 'http://127.0.0.1:2019/config' } });
  };
  try {
    await assert.rejects(
      () => fetchPublicUrl('http://93.184.216.34/page', { timeoutMs: 2000 }),
      /blocked non-public URL/
    );
    assert.strictEqual(calls, 1, 'the redirect target must never be requested');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('fetchPublicUrl follows a redirect that stays on a public host', async () => {
  const originalFetch = globalThis.fetch;
  const requested = [];
  globalThis.fetch = async (url) => {
    requested.push(url);
    if (requested.length === 1) {
      return new Response(null, { status: 301, headers: { location: 'http://93.184.216.35/final' } });
    }
    return new Response('ok', { status: 200 });
  };
  try {
    const response = await fetchPublicUrl('http://93.184.216.34/page', { timeoutMs: 2000 });
    assert.strictEqual(response.status, 200);
    assert.deepStrictEqual(requested, ['http://93.184.216.34/page', 'http://93.184.216.35/final']);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
