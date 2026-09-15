// Tests for the shared in-memory rate limiter (server/rateLimit.js).
// Run with: npm test
const test = require('node:test');
const assert = require('node:assert');

const { createRateLimiter } = require('../server/rateLimit');

function fakeRequest(ip, path = '/login') {
  return { ip, path };
}

function fakeResponse() {
  return { headers: {}, setHeader(name, value) { this.headers[name] = value; } };
}

test('lets requests through until the limit is reached', () => {
  const limiter = createRateLimiter({ max: 3, windowMs: 60000, onLimit: () => 'blocked' });
  const req = fakeRequest('1.2.3.4');
  let allowed = 0;
  for (let i = 0; i < 3; i += 1) {
    limiter(req, fakeResponse(), () => { allowed += 1; });
  }
  assert.strictEqual(allowed, 3);
});

test('calls onLimit past the limit and never calls next', () => {
  const limiter = createRateLimiter({ max: 2, windowMs: 60000, onLimit: () => 'blocked' });
  const req = fakeRequest('1.2.3.4');
  for (let i = 0; i < 2; i += 1) limiter(req, fakeResponse(), () => {});

  let nextCalled = false;
  const result = limiter(req, fakeResponse(), () => { nextCalled = true; });
  assert.strictEqual(result, 'blocked');
  assert.strictEqual(nextCalled, false);
});

test('sets a Retry-After header when blocking', () => {
  const limiter = createRateLimiter({ max: 1, windowMs: 60000, onLimit: () => null });
  const req = fakeRequest('1.2.3.4');
  limiter(req, fakeResponse(), () => {});
  const res = fakeResponse();
  limiter(req, res, () => {});
  assert.strictEqual(res.headers['Retry-After'], '60');
});

test('buckets are per IP and per path', () => {
  const limiter = createRateLimiter({ max: 1, windowMs: 60000, onLimit: () => 'blocked' });
  let allowed = 0;
  const next = () => { allowed += 1; };
  limiter(fakeRequest('1.1.1.1', '/login'), fakeResponse(), next);
  limiter(fakeRequest('2.2.2.2', '/login'), fakeResponse(), next);
  limiter(fakeRequest('1.1.1.1', '/register'), fakeResponse(), next);
  assert.strictEqual(allowed, 3);
});

test('the window expires and the bucket resets', async () => {
  const limiter = createRateLimiter({ max: 1, windowMs: 20, onLimit: () => 'blocked' });
  const req = fakeRequest('1.2.3.4');
  let allowed = 0;
  const next = () => { allowed += 1; };
  limiter(req, fakeResponse(), next);
  assert.strictEqual(limiter(req, fakeResponse(), next), 'blocked');
  await new Promise((resolve) => setTimeout(resolve, 30));
  limiter(req, fakeResponse(), next);
  assert.strictEqual(allowed, 2);
});

test('evicts the oldest live buckets once the key cap is exceeded', () => {
  // Every bucket is live (long window), so only the oldest-first eviction can cap memory.
  const limiter = createRateLimiter({ max: 1, windowMs: 60000, maxTrackedKeys: 3, onLimit: () => 'blocked' });
  const first = fakeRequest('10.0.0.1');
  limiter(first, fakeResponse(), () => {});
  assert.strictEqual(limiter(first, fakeResponse(), () => {}), 'blocked');

  for (let i = 2; i <= 8; i += 1) limiter(fakeRequest(`10.0.0.${i}`), fakeResponse(), () => {});

  // The first IP's bucket was evicted, so it starts over instead of growing the map.
  let nextCalled = false;
  limiter(first, fakeResponse(), () => { nextCalled = true; });
  assert.strictEqual(nextCalled, true);
});

test('a custom key function overrides the default bucketing', () => {
  const limiter = createRateLimiter({
    max: 1,
    windowMs: 60000,
    keyFn: () => 'global',
    onLimit: () => 'blocked',
  });
  limiter(fakeRequest('1.1.1.1'), fakeResponse(), () => {});
  assert.strictEqual(limiter(fakeRequest('9.9.9.9'), fakeResponse(), () => {}), 'blocked');
});
