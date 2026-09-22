// Tests for the Gemini client retry policy (server/gemini.js).
// Gemini answers overload with a transient 503 ("experiencing high demand"),
// which used to surface to the admin as a hard import failure.
// Run with: npm test
const test = require('node:test');
const assert = require('node:assert');

process.env.GEMINI_API_KEY = 'test-key';
const { callGemini, isConfigured } = require('../server/gemini');

const OK_BODY = { candidates: [{ content: { parts: [{ text: '{"title":"Sommet"}' }] } }] };

function jsonResponse(status, body) {
  return { ok: status >= 200 && status < 300, status, json: async () => body };
}

// Queue of canned answers; each entry is a response or an Error to throw.
function stubFetch(answers) {
  const calls = [];
  globalThis.fetch = async (url, init) => {
    calls.push({ url, init });
    const answer = answers[Math.min(calls.length - 1, answers.length - 1)];
    if (answer instanceof Error) throw answer;
    return answer;
  };
  return calls;
}

const originalFetch = globalThis.fetch;
const originalWarn = console.warn;
test.beforeEach(() => { console.warn = () => {}; });
test.afterEach(() => { globalThis.fetch = originalFetch; console.warn = originalWarn; });

// No retries needed: one call, parsed payload.
const fast = { baseDelayMs: 0 };

test('reports configured when the API key is present', () => {
  assert.strictEqual(isConfigured(), true);
});

test('returns the parsed JSON payload on first success', async () => {
  const calls = stubFetch([jsonResponse(200, OK_BODY)]);
  const result = await callGemini([{ text: 'hi' }], { type: 'OBJECT' }, fast);
  assert.deepStrictEqual(result, { title: 'Sommet' });
  assert.strictEqual(calls.length, 1);
});

test('retries an overloaded model (503) and returns the retry result', async () => {
  const overloaded = jsonResponse(503, { error: { message: 'This model is currently experiencing high demand.' } });
  const calls = stubFetch([overloaded, jsonResponse(200, OK_BODY)]);
  const result = await callGemini([{ text: 'hi' }], {}, fast);
  assert.deepStrictEqual(result, { title: 'Sommet' });
  assert.strictEqual(calls.length, 2);
});

test('retries a rate-limited call (429)', async () => {
  const calls = stubFetch([jsonResponse(429, { error: { message: 'Quota' } }), jsonResponse(200, OK_BODY)]);
  await callGemini([{ text: 'hi' }], {}, fast);
  assert.strictEqual(calls.length, 2);
});

test('gives up after maxAttempts and surfaces the upstream message', async () => {
  const calls = stubFetch([jsonResponse(503, { error: { message: 'high demand' } })]);
  await assert.rejects(
    () => callGemini([{ text: 'hi' }], {}, { baseDelayMs: 0, maxAttempts: 3 }),
    /Gemini API error: high demand/
  );
  assert.strictEqual(calls.length, 3);
});

test('does not retry a client error (400): the request itself is wrong', async () => {
  const calls = stubFetch([jsonResponse(400, { error: { message: 'Invalid schema' } })]);
  await assert.rejects(() => callGemini([{ text: 'hi' }], {}, fast), /Invalid schema/);
  assert.strictEqual(calls.length, 1);
});

test('does not retry an auth error (403)', async () => {
  const calls = stubFetch([jsonResponse(403, { error: { message: 'API key not valid' } })]);
  await assert.rejects(() => callGemini([{ text: 'hi' }], {}, fast), /API key not valid/);
  assert.strictEqual(calls.length, 1);
});

test('retries a network failure or timeout', async () => {
  const calls = stubFetch([new Error('The operation was aborted due to timeout'), jsonResponse(200, OK_BODY)]);
  await callGemini([{ text: 'hi' }], {}, fast);
  assert.strictEqual(calls.length, 2);
});

test('retries an empty candidate list', async () => {
  const calls = stubFetch([jsonResponse(200, { candidates: [] }), jsonResponse(200, OK_BODY)]);
  await callGemini([{ text: 'hi' }], {}, fast);
  assert.strictEqual(calls.length, 2);
});

test('keeps retrying past the old 3-attempt ceiling while budget remains', async () => {
  // 503s return fast, so the attempt count must not be what gives up first.
  const answers = [
    jsonResponse(503, { error: { message: 'high demand' } }),
    jsonResponse(503, { error: { message: 'high demand' } }),
    jsonResponse(503, { error: { message: 'high demand' } }),
    jsonResponse(200, OK_BODY),
  ];
  const calls = stubFetch(answers);
  const result = await callGemini([{ text: 'hi' }], {}, fast);
  assert.deepStrictEqual(result, { title: 'Sommet' });
  assert.strictEqual(calls.length, 4);
});

test('does not retry once the time budget is spent', async () => {
  const calls = stubFetch([jsonResponse(503, { error: { message: 'high demand' } })]);
  await assert.rejects(() => callGemini([{ text: 'hi' }], {}, { baseDelayMs: 10, budgetMs: 1 }), /high demand/);
  assert.strictEqual(calls.length, 1);
});

test('does not retry malformed JSON from the model', async () => {
  const body = { candidates: [{ content: { parts: [{ text: 'not json' }] } }] };
  const calls = stubFetch([jsonResponse(200, body)]);
  await assert.rejects(() => callGemini([{ text: 'hi' }], {}, fast), SyntaxError);
  assert.strictEqual(calls.length, 1);
});
