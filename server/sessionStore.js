// SQLite-backed express-session store (same DB file as the app data), replacing
// the default MemoryStore: sessions now survive container restarts/redeploys and
// no longer grow the process heap.
const session = require('express-session');
const db = require('./db');
const sql = db.handle;

const DEFAULT_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days
const CLEANUP_INTERVAL_MS = 15 * 60 * 1000;

sql.exec(`
  CREATE TABLE IF NOT EXISTS sessions (
    sid    TEXT PRIMARY KEY,
    sess   TEXT NOT NULL,
    expire INTEGER NOT NULL
  );
`);

const stmtGet = sql.prepare('SELECT sess, expire FROM sessions WHERE sid = ?');
const stmtSet = sql.prepare(
  'INSERT INTO sessions (sid, sess, expire) VALUES (?, ?, ?) ON CONFLICT(sid) DO UPDATE SET sess=excluded.sess, expire=excluded.expire'
);
const stmtTouch = sql.prepare('UPDATE sessions SET expire = ? WHERE sid = ?');
const stmtDestroy = sql.prepare('DELETE FROM sessions WHERE sid = ?');
const stmtCleanup = sql.prepare('DELETE FROM sessions WHERE expire < ?');

function expiryFor(sess) {
  const maxAge = sess && sess.cookie && typeof sess.cookie.maxAge === 'number' ? sess.cookie.maxAge : DEFAULT_TTL_MS;
  return Date.now() + maxAge;
}

class SQLiteSessionStore extends session.Store {
  constructor() {
    super();
    setInterval(() => {
      try {
        stmtCleanup.run(Date.now());
      } catch (err) {
        console.error(`[sessions] cleanup failed: ${err.message}`);
      }
    }, CLEANUP_INTERVAL_MS).unref();
  }

  get(sid, callback) {
    try {
      const row = stmtGet.get(String(sid));
      if (!row || row.expire < Date.now()) return callback(null, null);
      callback(null, JSON.parse(row.sess));
    } catch (err) {
      callback(err);
    }
  }

  set(sid, sess, callback) {
    try {
      stmtSet.run(String(sid), JSON.stringify(sess), expiryFor(sess));
      if (callback) callback(null);
    } catch (err) {
      if (callback) callback(err);
    }
  }

  touch(sid, sess, callback) {
    try {
      stmtTouch.run(expiryFor(sess), String(sid));
      if (callback) callback(null);
    } catch (err) {
      if (callback) callback(err);
    }
  }

  destroy(sid, callback) {
    try {
      stmtDestroy.run(String(sid));
      if (callback) callback(null);
    } catch (err) {
      if (callback) callback(err);
    }
  }
}

module.exports = SQLiteSessionStore;
