// One-off import of legacy JSON data into the SQLite store — used to bring live data
// (e.g. the current Render opportunities.json / newsletter.json) onto the new box.
//
// Usage (run with the same DATA_DIR as the app so it targets the live DB):
//   DATA_DIR=/data node --experimental-sqlite scripts/import-json.js [opportunities.json] [newsletter.json]
//   npm run import -- ./opportunities.json ./newsletter.json
//
// Opportunities are upserted by id (existing rows updated, new rows inserted); newsletter
// emails are added if absent. Safe to re-run.

const path = require('path');
const fs = require('fs');
const db = require('./../server/db');

function readJson(file) {
  try {
    const parsed = JSON.parse(fs.readFileSync(file, 'utf-8') || '[]');
    return Array.isArray(parsed) ? parsed : [];
  } catch (err) {
    console.error(`Cannot read ${file}: ${err.message}`);
    return [];
  }
}

const oppsPath = process.argv[2] || path.join(__dirname, '../server/opportunities.json');
const nlPath = process.argv[3] || path.join(__dirname, '../server/newsletter.json');

const opportunities = readJson(oppsPath);
const emails = readJson(nlPath);

let inserted = 0;
let updated = 0;
for (const o of opportunities) {
  if (o.id != null && db.getOpportunity(o.id)) {
    db.updateOpportunity(o.id, o);
    updated += 1;
  } else {
    db.insertOpportunity({ ...o, id: o.id != null ? o.id : Date.now() });
    inserted += 1;
  }
}

let newEmails = 0;
for (const email of emails) {
  if (typeof email === 'string' && email.trim() && db.addNewsletter(email.trim().toLowerCase())) {
    newEmails += 1;
  }
}

console.log(`Import terminé — opportunités : ${inserted} ajoutées, ${updated} mises à jour ; newsletter : ${newEmails} nouveaux emails.`);
console.log(`Base : ${db.dbPath}`);
