// Tests for the admin analytics layer (server/analyticsDb.js): usage events,
// per-user usage, most viewed / most starred opportunities and connected-user stats.
// Runs against a throwaway SQLite file so the dev database is never touched.
// Run with: npm test
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'wiwi-analytics-'));
process.env.SESSION_SECRET = 'test-secret';

const db = require('../server/db');
const usersDb = require('../server/usersDb');
const analytics = require('../server/analyticsDb');

const sql = db.handle;

function makeOpportunity(id, title) {
  return db.insertOpportunity({ id, title, country: 'Italie', type: 'Stage', deadline: '2099-01-01' });
}

function makeUser(email) {
  return usersDb.createUser({ email, passwordHash: 'x', name: email.split('@')[0] });
}

function insertSession(sid, sess, expire) {
  sql.prepare('INSERT INTO sessions (sid, sess, expire) VALUES (?, ?, ?)').run(sid, JSON.stringify(sess), expire);
}

test.beforeEach(() => {
  sql.exec('DELETE FROM events; DELETE FROM favorites; DELETE FROM sessions; DELETE FROM users; DELETE FROM opportunities;');
});

test('topViewed ranks opportunities by view count and counts distinct visitors', () => {
  makeOpportunity(1, 'Alpha');
  makeOpportunity(2, 'Beta');
  const alice = makeUser('alice@example.com');

  analytics.recordView({ opportunityId: 1, userId: alice, ip: '1.1.1.1' });
  analytics.recordView({ opportunityId: 1, userId: alice, ip: '1.1.1.1' }); // deduped refresh
  analytics.recordView({ opportunityId: 1, ip: '2.2.2.2' });
  analytics.recordView({ opportunityId: 1, ip: '3.3.3.3' });
  analytics.recordView({ opportunityId: 2, ip: '2.2.2.2' });

  const top = analytics.topViewed({ limit: 5, sinceDays: 30 });
  assert.deepStrictEqual(
    top.map((r) => [r.opportunity.id, r.views, r.uniqueVisitors]),
    [
      [1, 3, 3],
      [2, 1, 1],
    ]
  );
});

test('recordView counts one view per visitor per opportunity inside the dedupe window', () => {
  makeOpportunity(1, 'Alpha');
  makeOpportunity(2, 'Beta');

  assert.strictEqual(analytics.recordView({ opportunityId: 1, ip: '1.1.1.1' }), true);
  assert.strictEqual(analytics.recordView({ opportunityId: 1, ip: '1.1.1.1' }), false); // refresh
  assert.strictEqual(analytics.recordView({ opportunityId: 2, ip: '1.1.1.1' }), true); // other opp
  assert.strictEqual(analytics.recordView({ opportunityId: 1, ip: '2.2.2.2' }), true); // other visitor

  // Once the window has elapsed the same visitor counts again.
  sql.prepare(`UPDATE events SET created_at = datetime('now', ?) WHERE visitor = ? AND opportunity_id = 1`).run(
    `-${analytics.VIEW_DEDUPE_MINUTES + 1} minutes`,
    sql.prepare(`SELECT visitor FROM events WHERE opportunity_id = 1 LIMIT 1`).get().visitor
  );
  assert.strictEqual(analytics.recordView({ opportunityId: 1, ip: '1.1.1.1' }), true);
  assert.strictEqual(sql.prepare(`SELECT COUNT(*) AS c FROM events WHERE kind = 'view'`).get().c, 4);
});

test('recordView ignores crawlers and unknown event kinds are dropped', () => {
  makeOpportunity(1, 'Alpha');
  assert.strictEqual(analytics.recordView({ opportunityId: 1, ip: '1.1.1.1', userAgent: 'Mozilla/5.0 (compatible; Googlebot/2.1)' }), false);
  assert.strictEqual(analytics.recordView({ opportunityId: 1, ip: '1.1.1.1', userAgent: 'curl/8.4.0' }), false);
  assert.strictEqual(analytics.recordEvent('bogus', { ip: '1.1.1.1' }), false);
  assert.strictEqual(sql.prepare('SELECT COUNT(*) AS c FROM events').get().c, 0);
});

test('purgeOldEvents removes rows past the retention window only', () => {
  makeOpportunity(1, 'Alpha');
  analytics.recordView({ opportunityId: 1, ip: '1.1.1.1' });
  analytics.recordView({ opportunityId: 1, ip: '2.2.2.2' });
  sql.prepare(`UPDATE events SET created_at = datetime('now', ?) WHERE id = (SELECT MIN(id) FROM events)`).run(
    `-${analytics.RETENTION_DAYS + 1} days`
  );
  assert.strictEqual(analytics.purgeOldEvents(), 1);
  assert.strictEqual(sql.prepare('SELECT COUNT(*) AS c FROM events').get().c, 1);
});

test('purgeUser removes the account, its favorites and sessions, and scrubs its visitor key', () => {
  makeOpportunity(1, 'Alpha');
  const alice = makeUser('alice@example.com');
  usersDb.toggleFavorite(alice, 1);
  insertSession('s1', { cookie: {}, userId: alice }, Date.now() + 60_000);
  analytics.recordView({ opportunityId: 1, userId: alice, ip: '1.1.1.1' });

  assert.strictEqual(analytics.purgeUser(alice), true);
  assert.strictEqual(usersDb.getUserById(alice), null);
  assert.strictEqual(sql.prepare('SELECT COUNT(*) AS c FROM favorites').get().c, 0);
  assert.strictEqual(sql.prepare('SELECT COUNT(*) AS c FROM sessions').get().c, 0);
  const event = sql.prepare('SELECT user_id, visitor FROM events').get();
  assert.strictEqual(event.user_id, null);
  assert.notStrictEqual(event.visitor, `u:${alice}`);
  assert.strictEqual(analytics.topViewed({ limit: 1 })[0].views, 1);
  assert.strictEqual(analytics.purgeUser(alice), false); // already gone
});

test('topViewed skips opportunities deleted since they were viewed', () => {
  makeOpportunity(1, 'Alpha');
  analytics.recordView({ opportunityId: 1, ip: '1.1.1.1' });
  analytics.recordView({ opportunityId: 999, ip: '1.1.1.1' });

  const top = analytics.topViewed({ limit: 5 });
  assert.deepStrictEqual(top.map((r) => r.opportunity.id), [1]);
});

test('topStarred ranks opportunities by favorites count', () => {
  makeOpportunity(1, 'Alpha');
  makeOpportunity(2, 'Beta');
  const alice = makeUser('alice@example.com');
  const bob = makeUser('bob@example.com');
  usersDb.toggleFavorite(alice, 2);
  usersDb.toggleFavorite(bob, 2);
  usersDb.toggleFavorite(bob, 1);

  const top = analytics.topStarred({ limit: 5 });
  assert.deepStrictEqual(
    top.map((r) => [r.opportunity.id, r.stars]),
    [
      [2, 2],
      [1, 1],
    ]
  );
});

test('listUsersWithUsage returns one row per member with their counters', () => {
  makeOpportunity(1, 'Alpha');
  const alice = makeUser('alice@example.com');
  makeUser('bob@example.com');
  usersDb.toggleFavorite(alice, 1);
  analytics.recordEvent('login', { userId: alice });
  analytics.recordEvent('login', { userId: alice });
  analytics.recordView({ opportunityId: 1, userId: alice, ip: '1.1.1.1' });
  analytics.recordEvent('assistant', { userId: alice });

  const rows = analytics.listUsersWithUsage();
  assert.strictEqual(rows.length, 2);
  const a = rows.find((r) => r.email === 'alice@example.com');
  assert.strictEqual(a.favoritesCount, 1);
  assert.strictEqual(a.loginsCount, 2);
  assert.strictEqual(a.viewsCount, 1);
  assert.strictEqual(a.assistantCount, 1);
  const b = rows.find((r) => r.email === 'bob@example.com');
  assert.strictEqual(b.favoritesCount, 0);
  assert.strictEqual(b.loginsCount, 0);
  assert.strictEqual(a.password_hash, undefined);
});

test('getUserUsage returns counters, favorites and the most recent views', () => {
  makeOpportunity(1, 'Alpha');
  makeOpportunity(2, 'Beta');
  const alice = makeUser('alice@example.com');
  usersDb.toggleFavorite(alice, 2);
  analytics.recordEvent('login', { userId: alice });
  analytics.recordView({ opportunityId: 1, userId: alice, ip: '1.1.1.1' });
  analytics.recordView({ opportunityId: 2, userId: alice, ip: '1.1.1.1' });

  const usage = analytics.getUserUsage(alice);
  assert.strictEqual(usage.loginsCount, 1);
  assert.strictEqual(usage.viewsCount, 2);
  assert.strictEqual(usage.assistantCount, 0);
  assert.deepStrictEqual(usage.favorites.map((o) => o.id), [2]);
  assert.deepStrictEqual(usage.recentViews.map((v) => v.opportunity.id), [2, 1]);
  assert.ok(usage.lastLoginAt);
});

test('touchLastSeen stamps the member once and then throttles', () => {
  const alice = makeUser('alice@example.com');
  assert.strictEqual(analytics.touchLastSeen(alice), true);
  assert.strictEqual(analytics.touchLastSeen(alice), false);
  const row = sql.prepare('SELECT last_seen_at FROM users WHERE id = ?').get(alice);
  assert.ok(row.last_seen_at);
});

test('connectedStats counts live member sessions and recently active members', () => {
  const alice = makeUser('alice@example.com');
  const bob = makeUser('bob@example.com');
  const future = Date.now() + 60_000;
  insertSession('s1', { cookie: {}, userId: alice }, future);
  insertSession('s2', { cookie: {}, userId: alice }, future); // two devices, one member
  insertSession('s3', { cookie: {}, userId: bob }, Date.now() - 1000); // expired
  insertSession('s4', { cookie: {}, isAdmin: true }, future); // admin, not a member
  analytics.touchLastSeen(alice);

  const stats = analytics.connectedStats();
  assert.strictEqual(stats.connectedNow, 1);
  assert.strictEqual(stats.liveSessions, 2);
  assert.strictEqual(stats.totalUsers, 2);
  assert.strictEqual(stats.activeToday, 1);
  assert.strictEqual(stats.newUsers7d, 2);

  const connected = analytics.listConnectedUsers();
  assert.deepStrictEqual(connected.map((u) => [u.email, u.sessions]), [['alice@example.com', 2]]);
});

test('destroyUserSessions logs a member out everywhere and leaves others alone', () => {
  const alice = makeUser('alice@example.com');
  const bob = makeUser('bob@example.com');
  const future = Date.now() + 60_000;
  insertSession('s1', { cookie: {}, userId: alice }, future);
  insertSession('s2', { cookie: {}, userId: alice }, future);
  insertSession('s3', { cookie: {}, userId: bob }, future);

  assert.strictEqual(analytics.destroyUserSessions(alice), 2);
  const left = sql.prepare('SELECT sid FROM sessions ORDER BY sid').all().map((r) => r.sid);
  assert.deepStrictEqual(left, ['s3']);
});

test('anonymizeUser keeps view history but detaches it from the member', () => {
  makeOpportunity(1, 'Alpha');
  const alice = makeUser('alice@example.com');
  analytics.recordView({ opportunityId: 1, userId: alice, ip: '1.1.1.1' });
  analytics.recordEvent('login', { userId: alice });

  analytics.anonymizeUser(alice);
  const linked = sql.prepare('SELECT COUNT(*) AS c FROM events WHERE user_id = ? OR visitor = ?').get(alice, `u:${alice}`).c;
  assert.strictEqual(linked, 0);
  assert.strictEqual(analytics.topViewed({ limit: 1 })[0].views, 1);
});

test('dailySeries returns one bucket per day, oldest first, zero-filled', () => {
  makeOpportunity(1, 'Alpha');
  const alice = makeUser('alice@example.com');
  analytics.recordEvent('register', { userId: alice });
  analytics.recordEvent('login', { userId: alice });
  analytics.recordView({ opportunityId: 1, userId: alice, ip: '1.1.1.1' });

  const series = analytics.dailySeries(7);
  assert.strictEqual(series.length, 7);
  const today = series[series.length - 1];
  assert.deepStrictEqual([today.registrations, today.logins, today.views], [1, 1, 1]);
  assert.deepStrictEqual([series[0].registrations, series[0].logins, series[0].views], [0, 0, 0]);
  assert.ok(series[0].day < today.day);
});
