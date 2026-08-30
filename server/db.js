// SQLite data layer (Node's built-in node:sqlite — no native deps).
// Requires running Node with --experimental-sqlite on Node 22 (see package.json scripts / Dockerfile).
//
// The store lives at DATA_DIR/wiwiopportunity.db (DATA_DIR = a mounted volume in production so data
// survives image rebuilds; defaults to server/ in local/dev). A fresh DB is seeded once from the
// bundled opportunities.json / newsletter.json. All read helpers return the SAME object shapes the
// app used with JSON files (tags: string[], featured: boolean) so views, client JS and the API are
// unchanged.

const path = require('path');
const fs = require('fs');
const { DatabaseSync } = require('node:sqlite');

const DATA_DIR = process.env.DATA_DIR || __dirname;
const DB_PATH = path.join(DATA_DIR, 'wiwiopportunity.db');

fs.mkdirSync(DATA_DIR, { recursive: true });

const db = new DatabaseSync(DB_PATH);
db.exec('PRAGMA journal_mode = WAL');
db.exec('PRAGMA foreign_keys = ON');
db.exec('PRAGMA busy_timeout = 5000');

db.exec(`
  CREATE TABLE IF NOT EXISTS opportunities (
    id           INTEGER PRIMARY KEY,
    title        TEXT NOT NULL,
    organization TEXT NOT NULL DEFAULT '',
    country      TEXT NOT NULL DEFAULT '',
    city         TEXT NOT NULL DEFAULT '',
    type         TEXT NOT NULL DEFAULT '',
    funding      TEXT NOT NULL DEFAULT '',
    domain       TEXT NOT NULL DEFAULT '',
    deadline     TEXT NOT NULL DEFAULT '',
    duration     TEXT NOT NULL DEFAULT '',
    link         TEXT NOT NULL DEFAULT '',
    description  TEXT NOT NULL DEFAULT '',
    extra        TEXT NOT NULL DEFAULT '',
    tags         TEXT NOT NULL DEFAULT '[]',
    featured     INTEGER NOT NULL DEFAULT 0
  );
  CREATE TABLE IF NOT EXISTS newsletter (
    email      TEXT PRIMARY KEY,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
`);

// --- statements ---------------------------------------------------------------

const stmtInsert = db.prepare(
  `INSERT INTO opportunities
     (id, title, organization, country, city, type, funding, domain, deadline, duration, link, description, extra, tags, featured)
   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
);
const stmtUpdate = db.prepare(
  `UPDATE opportunities SET
     title=?, organization=?, country=?, city=?, type=?, funding=?, domain=?, deadline=?, duration=?, link=?, description=?, extra=?, tags=?, featured=?
   WHERE id=?`
);
const stmtGet = db.prepare('SELECT * FROM opportunities WHERE id = ?');
const stmtList = db.prepare('SELECT * FROM opportunities ORDER BY id');
const stmtDelete = db.prepare('DELETE FROM opportunities WHERE id = ?');
const stmtCount = db.prepare('SELECT COUNT(*) AS c FROM opportunities');
const stmtAddNewsletter = db.prepare('INSERT OR IGNORE INTO newsletter (email) VALUES (?)');
const stmtListNewsletter = db.prepare('SELECT email FROM newsletter ORDER BY created_at, email');

// --- mapping helpers ----------------------------------------------------------

const str = (v) => (v == null ? '' : String(v));

function parseTags(raw) {
  if (Array.isArray(raw)) return raw.map((t) => String(t).trim()).filter(Boolean);
  try {
    const parsed = JSON.parse(raw || '[]');
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function rowToObj(row) {
  if (!row) return null;
  return {
    id: row.id,
    title: row.title,
    organization: row.organization,
    country: row.country,
    city: row.city,
    type: row.type,
    funding: row.funding,
    domain: row.domain,
    deadline: row.deadline,
    duration: row.duration,
    link: row.link,
    description: row.description,
    extra: row.extra,
    tags: parseTags(row.tags),
    featured: !!row.featured,
  };
}

function insertValues(o) {
  return [
    Number(o.id),
    str(o.title),
    str(o.organization),
    str(o.country),
    str(o.city),
    str(o.type),
    str(o.funding),
    str(o.domain),
    str(o.deadline),
    str(o.duration),
    str(o.link),
    str(o.description),
    str(o.extra),
    JSON.stringify(Array.isArray(o.tags) ? o.tags : []),
    o.featured ? 1 : 0,
  ];
}

// --- seeding ------------------------------------------------------------------

function readSeed(name) {
  try {
    const parsed = JSON.parse(fs.readFileSync(path.join(__dirname, name), 'utf-8') || '[]');
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function seedIfEmpty() {
  if (stmtCount.get().c > 0) return;
  const opps = readSeed('opportunities.json');
  const emails = readSeed('newsletter.json');
  db.exec('BEGIN');
  try {
    for (const o of opps) stmtInsert.run(...insertValues({ ...o, id: o.id != null ? o.id : Date.now() }));
    for (const email of emails) if (typeof email === 'string' && email.trim()) stmtAddNewsletter.run(email.trim().toLowerCase());
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}

seedIfEmpty();

process.on('exit', () => {
  try {
    db.close();
  } catch {
    /* already closed */
  }
});

// --- public API ---------------------------------------------------------------

module.exports = {
  dbPath: DB_PATH,
  listOpportunities() {
    return stmtList.all().map(rowToObj);
  },
  getOpportunity(id) {
    return rowToObj(stmtGet.get(Number(id)));
  },
  insertOpportunity(obj) {
    stmtInsert.run(...insertValues(obj));
    return this.getOpportunity(obj.id);
  },
  updateOpportunity(id, obj) {
    const info = stmtUpdate.run(
      str(obj.title),
      str(obj.organization),
      str(obj.country),
      str(obj.city),
      str(obj.type),
      str(obj.funding),
      str(obj.domain),
      str(obj.deadline),
      str(obj.duration),
      str(obj.link),
      str(obj.description),
      str(obj.extra),
      JSON.stringify(Array.isArray(obj.tags) ? obj.tags : []),
      obj.featured ? 1 : 0,
      Number(id)
    );
    return info.changes > 0;
  },
  deleteOpportunity(id) {
    return stmtDelete.run(Number(id)).changes > 0;
  },
  addNewsletter(email) {
    return stmtAddNewsletter.run(String(email)).changes > 0;
  },
  listNewsletter() {
    return stmtListNewsletter.all().map((r) => r.email);
  },
};
