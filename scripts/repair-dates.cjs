/**
 * Repairs Excel serial numbers that were stored as millisecond timestamps,
 * which is why 22% of the date values in the database sit on 1970-01-01.
 *
 * "1970-01-01T00:00:44.830Z"  ->  getTime() is 44830  ->  Excel serial 44830
 *                             ->  (44830 - 25569) days after the Unix epoch
 *                             ->  2022-09-26
 *
 * 25569 is the number of days between Excel's epoch (1899-12-30) and the Unix
 * epoch. This is the same conversion the app already performs at display time
 * in useCompanies — it has simply never written the corrected value back.
 *
 * DRY RUN BY DEFAULT. Reads staging. Writes nothing unless told to.
 *
 *   node scripts/repair-dates.cjs                      survey staging
 *   node scripts/repair-dates.cjs --apply              repair staging
 *   node scripts/repair-dates.cjs --production         survey production
 *   node scripts/repair-dates.cjs --production --apply repair production
 */

const { initializeApp, applicationDefault } = require('firebase-admin/app');
const { getFirestore } = require('firebase-admin/firestore');

const PROJECT_ID = 'gen-lang-client-0128987745';
const STAGING_DB = 'staging';
const PRODUCTION_DB = 'ai-studio-e212f446-e1ec-4969-b746-7a8ec637da86';

const APPLY = process.argv.includes('--apply');
const PRODUCTION = process.argv.includes('--production');
const DB = PRODUCTION ? PRODUCTION_DB : STAGING_DB;

const EXCEL_EPOCH_OFFSET_DAYS = 25569;
const MS_PER_DAY = 86400 * 1000;

// A serial in this range lands between roughly 1954 and 2064. Anything outside
// it is reported rather than converted — a wrong repair is worse than none.
const MIN_SERIAL = 20000;
const MAX_SERIAL = 60000;

const MAX_EXAMPLES = 10;
const BATCH_SIZE = 300;

/** Returns a corrected ISO string, or null if the value should be left alone. */
function repair(value) {
  if (typeof value !== 'string' || value === '') return null;
  const ms = new Date(value).getTime();
  if (!Number.isFinite(ms)) return null;
  if (new Date(ms).getUTCFullYear() > 1970) return null;   // already a real date

  const serial = ms;
  if (serial < MIN_SERIAL || serial > MAX_SERIAL) return null;

  const repaired = new Date((serial - EXCEL_EPOCH_OFFSET_DAYS) * MS_PER_DAY);
  const year = repaired.getUTCFullYear();
  if (year < 1990 || year > 2100) return null;             // implausible, leave it
  return repaired.toISOString();
}

const stats = new Map();
const samples = [];
let outOfRange = 0;

function note(field, before, after) {
  stats.set(field, (stats.get(field) || 0) + 1);
  if (samples.length < MAX_EXAMPLES) {
    samples.push(`${field.padEnd(22)} ${before}  ->  ${after.slice(0, 10)}`);
  }
}

/** Returns the fields to update for this document, or null if nothing to do. */
function planFor(company) {
  const update = {};

  const lm = repair(company.lastModified);
  if (lm) { update.lastModified = lm; note('lastModified', company.lastModified, lm); }

  for (const [field, arr] of [
    ['interactions', company.interactions],
    ['stageHistory', company.stageHistory],
    ['revenueHistory', company.revenueHistory],
    ['dealTermsHistory', company.dealTermsHistory],
  ]) {
    if (!Array.isArray(arr)) continue;
    let changed = false;
    const next = arr.map(item => {
      if (!item || typeof item !== 'object') return item;
      const fixed = repair(item.date);
      if (!fixed) return item;
      changed = true;
      note(`${field}[].date`, item.date, fixed);
      return { ...item, date: fixed };
    });
    if (changed) update[field] = next;
  }

  return Object.keys(update).length ? update : null;
}

(async () => {
  console.log(`\nDatabase : ${DB}${PRODUCTION ? '   *** PRODUCTION ***' : ''}`);
  console.log(`Mode     : ${APPLY ? 'APPLY — documents will be written' : 'DRY RUN — nothing will be written'}\n`);

  if (PRODUCTION && APPLY) {
    console.log('Writing to production in 5 seconds. Ctrl+C to abort.\n');
    await new Promise(r => setTimeout(r, 5000));
  }

  const app = initializeApp({ credential: applicationDefault(), projectId: PROJECT_ID });
  const db = getFirestore(app, DB);

  const snap = await db.collection('companies').get();
  console.log(`Scanning ${snap.size} companies...\n`);

  const plans = [];
  for (const doc of snap.docs) {
    const data = doc.data();
    // Count 1970 values we are deliberately not touching.
    const all = [data.lastModified, ...(data.interactions || []).map(i => i && i.date), ...(data.stageHistory || []).map(h => h && h.date)];
    for (const v of all) {
      if (typeof v === 'string' && v) {
        const ms = new Date(v).getTime();
        if (Number.isFinite(ms) && new Date(ms).getUTCFullYear() <= 1970 && (ms < MIN_SERIAL || ms > MAX_SERIAL)) outOfRange++;
      }
    }
    const plan = planFor(data);
    if (plan) plans.push({ id: doc.id, update: plan });
  }

  const totalValues = [...stats.values()].reduce((a, b) => a + b, 0);

  console.log('Values that would be repaired, by field');
  console.log('--------------------------------------');
  for (const [field, count] of [...stats.entries()].sort((a, b) => b[1] - a[1])) {
    console.log(`  ${field.padEnd(24)} ${String(count).padStart(6)}`);
  }
  console.log(`  ${'TOTAL'.padEnd(24)} ${String(totalValues).padStart(6)}   across ${plans.length} companies`);
  if (outOfRange) console.log(`\n  ${outOfRange} value(s) sit on 1970 but are not a plausible Excel serial — left untouched.`);

  console.log('\nSample conversions');
  console.log('------------------');
  samples.forEach(s => console.log('  ' + s));

  if (!APPLY) {
    console.log('\nDry run. Re-run with --apply to write these changes.\n');
    return;
  }

  let written = 0;
  let batch = db.batch();
  let inBatch = 0;
  for (const { id, update } of plans) {
    batch.update(db.collection('companies').doc(id), update);
    if (++inBatch >= BATCH_SIZE) {
      await batch.commit(); written += inBatch; batch = db.batch(); inBatch = 0;
      process.stdout.write(`  written ${written}/${plans.length}\r`);
    }
  }
  if (inBatch) { await batch.commit(); written += inBatch; }
  console.log(`\nRepaired ${written} companies.\n`);
})().catch(err => {
  console.error('\nFailed:', err.message);
  process.exit(1);
});
