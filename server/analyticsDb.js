// First-party usage analytics for the back-office: who views what, who logs in,
// which opportunities get starred, and who is connected right now.
// Lives in the same SQLite file as everything else (see db.js). Nothing here is
// exposed publicly; only the admin pages read it.
//
// Events are deliberately minimal: a kind, an optional member, an optional
// opportunity and an opaque visitor key (member id, or a salted hash of the IP
// for anonymous traffic — the raw IP is never stored).
const crypto = require('crypto');
const db = require('./db');
// Creates the users/favorites tables this module reads and alters.
require('./usersDb');

const sql = db.handle;

const EVENT_KINDS = ['view', 'login', 'register', 'assistant'];
const LAST_SEEN_THROTTLE_MINUTES = 5;
// A repeat view of the same opportunity by the same visitor inside this window
// is not a new view: refreshes and bot loops cannot inflate "most viewed".
const VIEW_DEDUPE_MINUTES = 30;
// Raw events are only needed for the rolling rankings; older rows are purged.
const RETENTION_DAYS = 180;
const PURGE_INTERVAL_MS = 60 * 60 * 1000;
const BOT_USER_AGENT = /bot|crawl|spider|slurp|fetch|preview|headless|monitor|curl\/|wget\//i;
const DEFAULT_TOP_LIMIT = 10;
const MAX_TOP_LIMIT = 50;
const RECENT_VIEWS_LIMIT = 20;
const DEFAULT_SERIES_DAYS = 14;
const MAX_SERIES_DAYS = 90;

sql.exec(`
  CREATE TABLE IF NOT EXISTS events (
    id             INTEGER PRIMARY KEY AUTOINCREMENT,
    kind           TEXT NOT NULL,
    user_id        INTEGER,
    opportunity_id INTEGER,
    visitor        TEXT NOT NULL DEFAULT '',
    created_at     TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE INDEX IF NOT EXISTS idx_events_kind_created ON events (kind, created_at);
  CREATE INDEX IF NOT EXISTS idx_events_opportunity ON events (opportunity_id);
  CREATE INDEX IF NOT EXISTS idx_events_user ON events (user_id);
  CREATE INDEX IF NOT EXISTS idx_events_visitor_opp ON events (kind, visitor, opportunity_id, created_at);
  -- The session store creates this table too; declared here so the stats
  -- queries below work even when this module is loaded first (tests).
  CREATE TABLE IF NOT EXISTS sessions (
    sid    TEXT PRIMARY KEY,
    sess   TEXT NOT NULL,
    expire INTEGER NOT NULL
  );
`);

// Older databases predate the column: add it in place (same pattern as db.js).
// Two processes booting at once can race here; the duplicate-column error is benign.
const hasLastSeen = sql
  .prepare('PRAGMA table_info(users)')
  .all()
  .some((col) => col.name === 'last_seen_at');
if (!hasLastSeen) {
  try {
    sql.exec('ALTER TABLE users ADD COLUMN last_seen_at TEXT');
  } catch (err) {
    if (!/duplicate column/i.test(err.message)) throw err;
  }
}

// --- statements ---------------------------------------------------------------

const stmtInsertEvent = sql.prepare('INSERT INTO events (kind, user_id, opportunity_id, visitor) VALUES (?, ?, ?, ?)');
const stmtRecentView = sql.prepare(
  `SELECT 1 AS x FROM events
   WHERE kind = 'view' AND visitor = ? AND opportunity_id = ? AND created_at > datetime('now', ?)
   LIMIT 1`
);
const stmtPurgeOld = sql.prepare(`DELETE FROM events WHERE created_at < datetime('now', ?)`);
// Detaches history from the member AND scrubs the per-member visitor key, so a
// deleted account cannot be re-grouped afterwards (ids are never reused).
const stmtAnonymize = sql.prepare(
  `UPDATE events SET user_id = NULL, visitor = 'x:' || substr(hex(randomblob(8)), 1, 16) WHERE user_id = ? OR visitor = ?`
);
const stmtTouchLastSeen = sql.prepare(
  `UPDATE users SET last_seen_at = datetime('now')
   WHERE id = ? AND (last_seen_at IS NULL OR last_seen_at < datetime('now', ?))`
);

const stmtTopViewed = sql.prepare(
  `SELECT e.opportunity_id AS id, COUNT(*) AS views, COUNT(DISTINCT e.visitor) AS unique_visitors
   FROM events e
   JOIN opportunities o ON o.id = e.opportunity_id
   WHERE e.kind = 'view' AND e.created_at >= datetime('now', ?)
   GROUP BY e.opportunity_id
   ORDER BY views DESC, unique_visitors DESC, o.title
   LIMIT ?`
);
const stmtTopStarred = sql.prepare(
  `SELECT f.opportunity_id AS id, COUNT(*) AS stars
   FROM favorites f
   JOIN opportunities o ON o.id = f.opportunity_id
   GROUP BY f.opportunity_id
   ORDER BY stars DESC, o.title
   LIMIT ?`
);

const stmtUsersWithUsage = sql.prepare(
  `SELECT u.id, u.email, u.name, u.created_at, u.last_seen_at,
          (SELECT COUNT(*) FROM favorites f WHERE f.user_id = u.id) AS favorites_count,
          (SELECT COUNT(*) FROM events e WHERE e.user_id = u.id AND e.kind = 'view') AS views_count,
          (SELECT COUNT(*) FROM events e WHERE e.user_id = u.id AND e.kind = 'login') AS logins_count,
          (SELECT COUNT(*) FROM events e WHERE e.user_id = u.id AND e.kind = 'assistant') AS assistant_count
   FROM users u
   ORDER BY u.last_seen_at DESC NULLS LAST, u.created_at DESC`
);
const stmtUserCounts = sql.prepare(
  `SELECT
     SUM(kind = 'view') AS views_count,
     SUM(kind = 'login') AS logins_count,
     SUM(kind = 'assistant') AS assistant_count,
     MAX(CASE WHEN kind = 'login' THEN created_at END) AS last_login_at
   FROM events WHERE user_id = ?`
);
const stmtUserRecentViews = sql.prepare(
  `SELECT e.opportunity_id AS id, e.created_at
   FROM events e JOIN opportunities o ON o.id = e.opportunity_id
   WHERE e.user_id = ? AND e.kind = 'view'
   ORDER BY e.created_at DESC, e.id DESC
   LIMIT ?`
);

// Member sessions: the express-session payload is JSON with a userId for members
// (admin sessions carry isAdmin instead and are not counted).
const stmtLiveSessions = sql.prepare(
  `SELECT COUNT(*) AS sessions, COUNT(DISTINCT json_extract(sess, '$.userId')) AS members
   FROM sessions
   WHERE expire > ? AND json_valid(sess) AND json_extract(sess, '$.userId') IS NOT NULL`
);
const stmtConnectedUsers = sql.prepare(
  `SELECT u.id, u.email, u.name, u.last_seen_at, COUNT(s.sid) AS sessions
   FROM sessions s
   JOIN users u ON u.id = json_extract(s.sess, '$.userId')
   WHERE s.expire > ? AND json_valid(s.sess)
   GROUP BY u.id
   ORDER BY u.last_seen_at DESC NULLS LAST, u.email`
);
const stmtUserLiveSessions = sql.prepare(
  `SELECT COUNT(*) AS c FROM sessions WHERE expire > ? AND json_valid(sess) AND json_extract(sess, '$.userId') = ?`
);
const stmtDestroyUserSessions = sql.prepare(`DELETE FROM sessions WHERE json_valid(sess) AND json_extract(sess, '$.userId') = ?`);
const stmtDeleteUser = sql.prepare('DELETE FROM users WHERE id = ?');

const stmtUserTotals = sql.prepare(
  `SELECT COUNT(*) AS total,
          SUM(last_seen_at >= datetime('now', '-1 day')) AS active_today,
          SUM(last_seen_at >= datetime('now', '-7 days')) AS active_7d,
          SUM(last_seen_at >= datetime('now', '-30 days')) AS active_30d,
          SUM(created_at >= datetime('now', '-7 days')) AS new_7d,
          SUM(created_at >= datetime('now', '-30 days')) AS new_30d
   FROM users`
);
const stmtNewsletterCount = sql.prepare('SELECT COUNT(*) AS c FROM newsletter');
const stmtViewTotals = sql.prepare(
  `SELECT COUNT(*) AS total, SUM(created_at >= datetime('now', '-7 days')) AS last_7d FROM events WHERE kind = 'view'`
);
const stmtDailySeries = sql.prepare(
  `SELECT date(created_at) AS day,
          SUM(kind = 'register') AS registrations,
          SUM(kind = 'login') AS logins,
          SUM(kind = 'view') AS views
   FROM events
   WHERE created_at >= date('now', ?)
   GROUP BY day`
);

// --- helpers ------------------------------------------------------------------

// Anonymous visitors are keyed by an HMAC of their IP. A dedicated secret keeps
// the analytics table unlinkable even if the session secret leaks; without any
// secret the key is only pseudonymous, hence the warning.
const IP_SECRET = process.env.ANALYTICS_SALT || process.env.SESSION_SECRET || '';
if (!IP_SECRET && process.env.NODE_ENV === 'production') {
  console.warn('[analytics] ANALYTICS_SALT / SESSION_SECRET is not set: visitor keys are not properly salted.');
}

function visitorKey(userId, ip) {
  if (userId) return `u:${Number(userId)}`;
  const digest = crypto.createHmac('sha256', IP_SECRET || 'wiwiopportunity-analytics').update(String(ip || '')).digest('hex');
  return `a:${digest.slice(0, 16)}`;
}

function isBot(userAgent) {
  return BOT_USER_AGENT.test(String(userAgent || ''));
}

// Analytics must never break a member-facing request: writes fail open and log.
function failOpen(label, fn, fallback) {
  try {
    return fn();
  } catch (err) {
    console.error(`[analytics] ${label} failed: ${err.message}`);
    return fallback;
  }
}

function recordEvent(kind, { userId, opportunityId, ip } = {}) {
  if (!EVENT_KINDS.includes(kind)) return false;
  return failOpen(
    kind,
    () => {
      stmtInsertEvent.run(kind, userId ? Number(userId) : null, opportunityId ? Number(opportunityId) : null, visitorKey(userId, ip));
      return true;
    },
    false
  );
}

setInterval(() => failOpen('purge', () => stmtPurgeOld.run(`-${RETENTION_DAYS} days`)), PURGE_INTERVAL_MS).unref();

function clampLimit(limit) {
  const n = Number(limit) || DEFAULT_TOP_LIMIT;
  return Math.min(Math.max(1, n), MAX_TOP_LIMIT);
}

function clampDays(days, fallback, max) {
  const n = Number(days) || fallback;
  return Math.min(Math.max(1, n), max);
}

function num(value) {
  return Number(value) || 0;
}

function rowToUsageUser(row) {
  return {
    id: row.id,
    email: row.email,
    name: row.name,
    createdAt: row.created_at,
    lastSeenAt: row.last_seen_at || null,
    favoritesCount: num(row.favorites_count),
    viewsCount: num(row.views_count),
    loginsCount: num(row.logins_count),
    assistantCount: num(row.assistant_count),
  };
}

function isoDay(date) {
  return date.toISOString().slice(0, 10);
}

// --- public API ---------------------------------------------------------------

module.exports = {
  EVENT_KINDS,
  VIEW_DEDUPE_MINUTES,
  RETENTION_DAYS,

  // Generic event; unknown kinds are dropped rather than polluting the table.
  recordEvent,

  // One view per visitor per opportunity per dedupe window; crawlers are ignored.
  // Returns true only when a row was written.
  recordView({ opportunityId, userId, ip, userAgent }) {
    if (isBot(userAgent)) return false;
    const visitor = visitorKey(userId, ip);
    return failOpen(
      'view',
      () => {
        if (stmtRecentView.get(visitor, Number(opportunityId), `-${VIEW_DEDUPE_MINUTES} minutes`)) return false;
        stmtInsertEvent.run('view', userId ? Number(userId) : null, Number(opportunityId), visitor);
        return true;
      },
      false
    );
  },

  // Stamps users.last_seen_at at most once per throttle window. Returns true
  // when the row was actually updated.
  touchLastSeen(userId) {
    return failOpen('touch', () => stmtTouchLastSeen.run(Number(userId), `-${LAST_SEEN_THROTTLE_MINUTES} minutes`).changes > 0, false);
  },

  // Keeps aggregate history (most viewed) but no longer attributable to a member.
  anonymizeUser(userId) {
    const uid = Number(userId);
    return stmtAnonymize.run(uid, `u:${uid}`).changes;
  },

  // Full account removal in one transaction: history detached, every device
  // logged out, account + favorites gone (favorites cascade). Used by the admin
  // delete and the member's own "delete my account".
  purgeUser(userId) {
    const uid = Number(userId);
    sql.exec('BEGIN');
    try {
      this.anonymizeUser(uid);
      stmtDestroyUserSessions.run(uid);
      const removed = stmtDeleteUser.run(uid).changes > 0;
      sql.exec('COMMIT');
      return removed;
    } catch (err) {
      sql.exec('ROLLBACK');
      throw err;
    }
  },

  // Removes raw events past the retention window. Returns the number of rows deleted.
  purgeOldEvents() {
    return stmtPurgeOld.run(`-${RETENTION_DAYS} days`).changes;
  },

  topViewed({ limit, sinceDays } = {}) {
    const days = sinceDays ? clampDays(sinceDays, 30, 3650) : 3650;
    return stmtTopViewed
      .all(`-${days} days`, clampLimit(limit))
      .map((row) => ({ opportunity: db.getOpportunity(row.id), views: num(row.views), uniqueVisitors: num(row.unique_visitors) }))
      .filter((r) => r.opportunity);
  },

  topStarred({ limit } = {}) {
    return stmtTopStarred
      .all(clampLimit(limit))
      .map((row) => ({ opportunity: db.getOpportunity(row.id), stars: num(row.stars) }))
      .filter((r) => r.opportunity);
  },

  listUsersWithUsage() {
    return stmtUsersWithUsage.all().map(rowToUsageUser);
  },

  getUserUsage(userId) {
    const uid = Number(userId);
    const counts = stmtUserCounts.get(uid) || {};
    const favorites = sql
      .prepare('SELECT opportunity_id FROM favorites WHERE user_id = ? ORDER BY created_at DESC')
      .all(uid)
      .map((r) => db.getOpportunity(r.opportunity_id))
      .filter(Boolean);
    const recentViews = stmtUserRecentViews
      .all(uid, RECENT_VIEWS_LIMIT)
      .map((r) => ({ opportunity: db.getOpportunity(r.id), at: r.created_at }))
      .filter((v) => v.opportunity);
    return {
      viewsCount: num(counts.views_count),
      loginsCount: num(counts.logins_count),
      assistantCount: num(counts.assistant_count),
      lastLoginAt: counts.last_login_at || null,
      liveSessions: num(stmtUserLiveSessions.get(Date.now(), uid).c),
      favorites,
      recentViews,
    };
  },

  connectedStats() {
    const live = stmtLiveSessions.get(Date.now());
    const users = stmtUserTotals.get();
    const views = stmtViewTotals.get();
    return {
      connectedNow: num(live.members),
      liveSessions: num(live.sessions),
      totalUsers: num(users.total),
      activeToday: num(users.active_today),
      active7d: num(users.active_7d),
      active30d: num(users.active_30d),
      newUsers7d: num(users.new_7d),
      newUsers30d: num(users.new_30d),
      newsletterCount: num(stmtNewsletterCount.get().c),
      viewsTotal: num(views.total),
      views7d: num(views.last_7d),
    };
  },

  listConnectedUsers() {
    return stmtConnectedUsers.all(Date.now()).map((row) => ({
      id: row.id,
      email: row.email,
      name: row.name,
      lastSeenAt: row.last_seen_at || null,
      sessions: num(row.sessions),
    }));
  },

  // Logs a member out on every device. Returns the number of sessions removed.
  destroyUserSessions(userId) {
    return stmtDestroyUserSessions.run(Number(userId)).changes;
  },

  // One bucket per calendar day (UTC), oldest first, missing days filled with zeros.
  dailySeries(days) {
    const span = clampDays(days, DEFAULT_SERIES_DAYS, MAX_SERIES_DAYS);
    const byDay = new Map(stmtDailySeries.all(`-${span - 1} days`).map((r) => [r.day, r]));
    const today = new Date();
    return Array.from({ length: span }, (_, i) => {
      const date = new Date(today.getTime() - (span - 1 - i) * 24 * 60 * 60 * 1000);
      const day = isoDay(date);
      const row = byDay.get(day) || {};
      return { day, registrations: num(row.registrations), logins: num(row.logins), views: num(row.views) };
    });
  },
};
