// Consistent SQLite snapshot via VACUUM INTO — safe while the app is running (even in WAL mode).
// Usage: DATA_DIR=/data node --experimental-sqlite scripts/backup.js [outPath]
//        npm run backup -- /data/backup.db

const path = require('path');
const { DatabaseSync } = require('node:sqlite');

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, '../server');
const src = path.join(DATA_DIR, 'wiwiopportunity.db');
const out = process.argv[2] || path.join(DATA_DIR, `backup-${new Date().toISOString().replace(/[:.]/g, '-')}.db`);

const db = new DatabaseSync(src);
db.exec(`VACUUM INTO '${out.replace(/'/g, "''")}'`);
db.close();

console.log('Backup écrit :', out);
