// Tests for the AI import pipeline (server/importer.js), focused on how fetch
// failures are classified: a slow site and an unreachable one must not give the
// admin the same message, and the log line must name the URL that failed.
// Run with: npm test
const test = require('node:test');
const assert = require('node:assert');

process.env.GEMINI_API_KEY = 'test-key';
const { importFromUrl } = require('../server/importer');

// A public IP literal: the SSRF guard accepts it without touching DNS.
const PAGE_URL = 'http://93.184.216.34/sism-2026/';

const PAGE_HTML = `<html><body><h1>SDG Innovation Summit Malaysia 2026</h1>
<p>${'Rejoignez 100 jeunes leaders à Kuala Lumpur du 19 au 22 novembre 2026. '.repeat(6)}</p>
</body></html>`;

const GEMINI_BODY = {
  candidates: [{ content: { parts: [{ text: JSON.stringify({
    title: 'SDG Innovation Summit Malaysia 2026',
    country: 'Malaisie',
    type: 'Études',
    funding: 'partial',
    tags: ['leadership', 'jeunesse'],
  }) }] } }],
};

function htmlResponse(status, body) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: () => null },
    text: async () => body,
    json: async () => ({}),
  };
}

function jsonResponse(body) {
  return { ok: true, status: 200, headers: { get: () => null }, json: async () => body };
}

// Routes the page fetch and the Gemini call apart; `onPage` may throw.
function stubFetch(onPage) {
  globalThis.fetch = async (url) => {
    if (String(url).includes('generativelanguage')) return jsonResponse(GEMINI_BODY);
    return onPage();
  };
}

const originalFetch = globalThis.fetch;
test.afterEach(() => { globalThis.fetch = originalFetch; });

test('rejects a URL that is not http(s) before any network call', async () => {
  let called = false;
  globalThis.fetch = async () => { called = true; };
  await assert.rejects(() => importFromUrl('ftp://example.com/x'), (err) => err.code === 'INVALID_URL');
  assert.strictEqual(called, false);
});

test('extracts and normalizes a readable page', async () => {
  stubFetch(() => htmlResponse(200, PAGE_HTML));
  const data = await importFromUrl(PAGE_URL);
  assert.strictEqual(data.title, 'SDG Innovation Summit Malaysia 2026');
  assert.strictEqual(data.country, 'Malaisie');
  assert.strictEqual(data.funding, 'partial');
  assert.deepStrictEqual(data.tags, ['leadership', 'jeunesse']);
  assert.strictEqual(data.link, PAGE_URL, 'the source URL becomes the apply link');
});

test('a slow site is reported as FETCH_TIMEOUT, not as unreachable', async () => {
  stubFetch(() => { throw Object.assign(new Error('The operation was aborted due to timeout'), { name: 'TimeoutError' }); });
  await assert.rejects(() => importFromUrl(PAGE_URL), (err) => {
    assert.strictEqual(err.code, 'FETCH_TIMEOUT');
    return true;
  });
});

test('an unreachable site stays FETCH_FAILED', async () => {
  stubFetch(() => { throw new Error('getaddrinfo ENOTFOUND'); });
  await assert.rejects(() => importFromUrl(PAGE_URL), (err) => err.code === 'FETCH_FAILED');
});

test('an HTTP error page is FETCH_FAILED and keeps the status', async () => {
  stubFetch(() => htmlResponse(403, 'forbidden'));
  await assert.rejects(() => importFromUrl(PAGE_URL), (err) => {
    assert.strictEqual(err.code, 'FETCH_FAILED');
    assert.match(err.message, /HTTP 403/);
    return true;
  });
});

test('a JS-rendered shell is FETCH_FAILED with the thin-content reason', async () => {
  stubFetch(() => htmlResponse(200, '<html><body><div id="root"></div></body></html>'));
  await assert.rejects(() => importFromUrl(PAGE_URL), (err) => {
    assert.strictEqual(err.code, 'FETCH_FAILED');
    assert.match(err.message, /too thin/);
    return true;
  });
});

test('the failure message names the URL and the elapsed time', async () => {
  stubFetch(() => { throw new Error('boom'); });
  await assert.rejects(() => importFromUrl(PAGE_URL), (err) => {
    assert.match(err.message, /93\.184\.216\.34/, 'the URL must be in the log line');
    assert.match(err.message, /after \d+ms/, 'the elapsed time must be in the log line');
    return true;
  });
});
