/**
 * Imports Contacts.csv into a `contacts` collection.
 *
 * Records are merged by normalised full name, keeping every email address
 * found across the duplicates. 8,827 rows collapse to roughly 8,383 people.
 *
 * Document ids are a hash of the normalised name, so re-running updates the
 * same records rather than creating duplicates.
 *
 * DRY RUN BY DEFAULT. Staging by default.
 *
 *   node scripts/import-contacts.cjs --file "C:\path\to\Contacts.csv"
 *   node scripts/import-contacts.cjs --file "..." --apply
 *   node scripts/import-contacts.cjs --file "..." --production --apply
 */

const fs = require('fs');
const crypto = require('crypto');
const { initializeApp, applicationDefault } = require('firebase-admin/app');
const { getFirestore } = require('firebase-admin/firestore');

const PROJECT_ID = 'gen-lang-client-0128987745';
const STAGING_DB = 'staging';
const PRODUCTION_DB = 'ai-studio-e212f446-e1ec-4969-b746-7a8ec637da86';

const argv = process.argv;
const APPLY = argv.includes('--apply');
const PRODUCTION = argv.includes('--production');
const DB = PRODUCTION ? PRODUCTION_DB : STAGING_DB;
const fileIdx = argv.indexOf('--file');
const FILE = fileIdx > -1 ? argv[fileIdx + 1] : null;

if (!FILE) {
  console.error('Missing --file "path\\to\\Contacts.csv"');
  process.exit(1);
}

/** RFC 4180 parser — the file contains quoted fields, so splitting on commas is wrong. */
function parseCsv(text) {
  const rows = [];
  let row = [], field = '', inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; }
        else inQuotes = false;
      } else field += c;
    } else if (c === '"') inQuotes = true;
    else if (c === ',') { row.push(field); field = ''; }
    else if (c === '\n') { row.push(field); rows.push(row); row = []; field = ''; }
    else if (c !== '\r') field += c;
  }
  if (field !== '' || row.length) { row.push(field); rows.push(row); }
  return rows;
}

const normalise = s => (s || '').replace(/\s+/g, ' ').trim();
const key = s => normalise(s).toLowerCase();
const idFor = name => crypto.createHash('sha1').update(key(name)).digest('hex').slice(0, 20);

(async () => {
  console.log(`\nFile     : ${FILE}`);
  console.log(`Database : ${DB}${PRODUCTION ? '   *** PRODUCTION ***' : ''}`);
  console.log(`Mode     : ${APPLY ? 'APPLY' : 'DRY RUN — nothing will be written'}\n`);

  const raw = fs.readFileSync(FILE, 'utf8').replace(/^\uFEFF/, '');
  const rows = parseCsv(raw).filter(r => r.some(c => c.trim() !== ''));
  const header = rows.shift().map(h => normalise(h));
  const col = name => header.indexOf(name);

  const iName = col('Full Name'), iFirst = col('First Name'), iLast = col('Last Name');
  const iEmail = col('Email Addresses'), iCity = col('Location (City)'), iState = col('Location (State)');
  if (iName < 0 || iEmail < 0) {
    console.error('Unexpected columns:', header);
    process.exit(1);
  }

  const merged = new Map();
  let skipped = 0;

  for (const r of rows) {
    const name = normalise(r[iName]);
    if (!name) { skipped++; continue; }
    const k = key(name);

    if (!merged.has(k)) {
      merged.set(k, {
        name,
        nameLower: k,
        firstName: normalise(r[iFirst]),
        lastName: normalise(r[iLast]),
        emails: [],
        city: normalise(r[iCity]),
        state: normalise(r[iState]),
      });
    }
    const c = merged.get(k);

    for (const e of (r[iEmail] || '').split(/[;,]/)) {
      const email = e.trim().toLowerCase();
      if (email && !c.emails.includes(email)) c.emails.push(email);
    }
    if (!c.city) c.city = normalise(r[iCity]);
    if (!c.state) c.state = normalise(r[iState]);
  }

  const contacts = [...merged.values()];
  console.log(`${rows.length} rows -> ${contacts.length} unique contacts` + (skipped ? `  (${skipped} skipped, no name)` : ''));
  console.log(`  with multiple emails : ${contacts.filter(c => c.emails.length > 1).length}`);
  console.log(`  with no email        : ${contacts.filter(c => !c.emails.length).length}`);
  console.log(`  with a location      : ${contacts.filter(c => c.city || c.state).length}`);

  console.log('\nSample of merged records');
  console.log('------------------------');
  for (const c of contacts.filter(c => c.emails.length > 1).slice(0, 5)) {
    console.log(`  ${c.name.padEnd(24)} ${c.emails.join(', ')}`);
  }

  if (!APPLY) {
    console.log('\nDry run. Re-run with --apply to write.\n');
    return;
  }

  const app = initializeApp({ credential: applicationDefault(), projectId: PROJECT_ID });
  const db = getFirestore(app, DB);

  let written = 0, batch = db.batch(), inBatch = 0;
  for (const c of contacts) {
    batch.set(db.collection('contacts').doc(idFor(c.name)), {
      ...c,
      source: 'contacts-csv',
      importedAt: new Date().toISOString(),
    });
    if (++inBatch >= 400) {
      await batch.commit(); written += inBatch; batch = db.batch(); inBatch = 0;
      process.stdout.write(`  written ${written}/${contacts.length}\r`);
    }
  }
  if (inBatch) { await batch.commit(); written += inBatch; }
  console.log(`\nWrote ${written} contacts.\n`);
})().catch(err => {
  console.error('\nFailed:', err.message);
  process.exit(1);
});
