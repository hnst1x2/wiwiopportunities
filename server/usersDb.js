// Member accounts data layer: users (with preferences) + favorites.
// Lives in the same SQLite file as the opportunities (see db.js).
const db = require('./db');
const sql = db.handle;

sql.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id             INTEGER PRIMARY KEY AUTOINCREMENT,
    email          TEXT NOT NULL UNIQUE,
    password_hash  TEXT NOT NULL,
    name           TEXT NOT NULL DEFAULT '',
    pref_countries TEXT NOT NULL DEFAULT '[]',
    pref_domains   TEXT NOT NULL DEFAULT '[]',
    pref_types     TEXT NOT NULL DEFAULT '[]',
    created_at     TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE TABLE IF NOT EXISTS favorites (
    user_id        INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    opportunity_id INTEGER NOT NULL,
    created_at     TEXT NOT NULL DEFAULT (datetime('now')),
    PRIMARY KEY (user_id, opportunity_id)
  );
`);

const stmtCreate = sql.prepare('INSERT INTO users (email, password_hash, name) VALUES (?, ?, ?)');
const stmtByEmail = sql.prepare('SELECT * FROM users WHERE email = ?');
const stmtById = sql.prepare('SELECT * FROM users WHERE id = ?');
const stmtUpdateProfile = sql.prepare('UPDATE users SET name=?, pref_countries=?, pref_domains=?, pref_types=? WHERE id=?');
const stmtUpdatePassword = sql.prepare('UPDATE users SET password_hash=? WHERE id=?');
const stmtDeleteUser = sql.prepare('DELETE FROM users WHERE id = ?');
const stmtFavAdd = sql.prepare('INSERT OR IGNORE INTO favorites (user_id, opportunity_id) VALUES (?, ?)');
const stmtFavRemove = sql.prepare('DELETE FROM favorites WHERE user_id = ? AND opportunity_id = ?');
const stmtFavHas = sql.prepare('SELECT 1 AS x FROM favorites WHERE user_id = ? AND opportunity_id = ?');
const stmtFavIds = sql.prepare('SELECT opportunity_id FROM favorites WHERE user_id = ? ORDER BY created_at DESC');

function parseJsonArray(raw) {
  try {
    const parsed = JSON.parse(raw || '[]');
    return Array.isArray(parsed) ? parsed.map((v) => String(v)).filter(Boolean) : [];
  } catch {
    return [];
  }
}

// Public shape: never exposes password_hash.
function rowToUser(row) {
  if (!row) return null;
  return {
    id: row.id,
    email: row.email,
    name: row.name,
    prefCountries: parseJsonArray(row.pref_countries),
    prefDomains: parseJsonArray(row.pref_domains),
    prefTypes: parseJsonArray(row.pref_types),
    createdAt: row.created_at,
  };
}

function toJsonArray(value) {
  return JSON.stringify(Array.isArray(value) ? value.map((v) => String(v).trim()).filter(Boolean) : []);
}

module.exports = {
  createUser({ email, passwordHash, name }) {
    const info = stmtCreate.run(String(email), String(passwordHash), String(name || ''));
    return Number(info.lastInsertRowid);
  },
  // For login only: includes password_hash.
  getAuthByEmail(email) {
    return stmtByEmail.get(String(email)) || null;
  },
  getUserById(id) {
    return rowToUser(stmtById.get(Number(id)));
  },
  emailExists(email) {
    return Boolean(stmtByEmail.get(String(email)));
  },
  updateProfile(id, { name, prefCountries, prefDomains, prefTypes }) {
    return (
      stmtUpdateProfile.run(String(name || ''), toJsonArray(prefCountries), toJsonArray(prefDomains), toJsonArray(prefTypes), Number(id))
        .changes > 0
    );
  },
  getPasswordHash(id) {
    const row = stmtById.get(Number(id));
    return row ? row.password_hash : null;
  },
  updatePassword(id, passwordHash) {
    return stmtUpdatePassword.run(String(passwordHash), Number(id)).changes > 0;
  },
  // Favorites are removed by the ON DELETE CASCADE foreign key.
  deleteUser(id) {
    return stmtDeleteUser.run(Number(id)).changes > 0;
  },
  toggleFavorite(userId, opportunityId) {
    const uid = Number(userId);
    const oid = Number(opportunityId);
    if (stmtFavHas.get(uid, oid)) {
      stmtFavRemove.run(uid, oid);
      return false;
    }
    stmtFavAdd.run(uid, oid);
    return true;
  },
  listFavoriteIds(userId) {
    return stmtFavIds.all(Number(userId)).map((r) => r.opportunity_id);
  },
  // Full opportunity objects, most recently favorited first; skips records
  // that were deleted from the catalog since being favorited.
  listFavoriteOpportunities(userId) {
    return this.listFavoriteIds(userId)
      .map((id) => db.getOpportunity(id))
      .filter(Boolean);
  },
};
