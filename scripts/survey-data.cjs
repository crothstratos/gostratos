/**
 * READ ONLY. Surveys the staging database and reports what the money and date
 * fields actually contain, so the Phase 1 migrations can be scoped honestly
 * before anything is converted.
 *
 * Writes nothing, anywhere. Reads staging, never production.
 *
 * Usage:
 *   node scripts/survey-data.cjs
 *   node scripts/survey-data.cjs --examples 12
 */

const { initializeApp, applicationDefault } = require('firebase-admin/app');
const { getFirestore } = require('firebase-admin/firestore');

const PROJECT_ID = 'gen-lang-client-0128987745';
const READ_DB = 'staging';

const n = process.argv.indexOf('--examples');
const MAX_EXAMPLES = n > -1 ? Number(process.argv[n + 1]) || 8 : 8;

// ---- money classification -------------------------------------------------
// Returns { bucket, cents } — cents only when we are confident.
function classifyMoney(raw) {
  if (raw === undefined || raw === null) return { bucket: 'absent' };
  if (typeof raw === 'number') {
    return Number.isFinite(raw) ? { bucket: 'already numeric', cents: Math.round(raw * 100) } : { bucket: 'unparseable' };
  }
  if (typeof raw !== 'string') return { bucket: 'unexpected type' };

  const s = raw.trim();
  if (s === '') return { bucket: 'empty string' };

  const lower = s.toLowerCase();

  // Explicitly "no revenue" statements — meaningful, not missing.
  if (/^(n\/?a|none|nil|tbd|unknown|pre[- ]?revenue|no revenue|\?+|-+)$/i.test(s)) {
    return { bucket: 'stated as none' };
  }

  const hasRange = /\d\s*(-|–|to)\s*\$?\d/i.test(s);
  const hasPeriod = /(arr|mrr|annual|monthly|per year|\/yr|\/mo)/i.test(lower);

  // Pull every number-with-optional-suffix out of the string.
  const matches = [...s.matchAll(/([\d][\d,]*\.?\d*)\s*([kmb])?/gi)];
  const numeric = matches
    .map(m => {
      const value = parseFloat(m[1].replace(/,/g, ''));
      if (!Number.isFinite(value)) return null;
      const unit = (m[2] || '').toLowerCase();
      if (unit === 'k') return value * 1e3;
      if (unit === 'm') return value * 1e6;
      if (unit === 'b') return value * 1e9;
      return value;
    })
    .filter(v => v !== null);

  if (numeric.length === 0) return { bucket: 'text, no number' };
  if (hasRange || numeric.length > 1) return { bucket: 'range or multiple numbers' };
  if (hasPeriod) return { bucket: 'has a period qualifier', cents: Math.round(numeric[0] * 100) };

  // A single clean number. Confident.
  const bare = /^[\s$]*[\d,]+\.?\d*\s*[kmb]?\s*$/i.test(s);
  return bare
    ? { bucket: 'clean', cents: Math.round(numeric[0] * 100) }
    : { bucket: 'number with extra words', cents: Math.round(numeric[0] * 100) };
}

function classifyDate(raw) {
  if (raw === undefined || raw === null) return 'absent';
  if (typeof raw === 'object' && typeof raw.toDate === 'function') return 'already a Timestamp';
  if (typeof raw === 'number') return 'epoch number';
  if (typeof raw !== 'string') return 'unexpected type';
  if (raw.trim() === '') return 'empty string';
  const t = new Date(raw).getTime();
  if (!Number.isFinite(t)) return 'UNPARSEABLE';
  const year = new Date(t).getFullYear();
  if (year < 1990 || year > 2100) return `implausible year (${year})`;
  return 'parses cleanly';
}

function tally(map, key, example) {
  if (!map.has(key)) map.set(key, { count: 0, examples: [] });
  const e = map.get(key);
  e.count++;
  if (example !== undefined && e.examples.length < MAX_EXAMPLES && !e.examples.includes(example)) {
    e.examples.push(example);
  }
}

function report(title, map, total) {
  console.log(`\n${title}`);
  console.log('-'.repeat(title.length));
  const rows = [...map.entries()].sort((a, b) => b[1].count - a[1].count);
  for (const [bucket, e] of rows) {
    const pct = total ? ((e.count / total) * 100).toFixed(1) : '0.0';
    console.log(`  ${bucket.padEnd(28)} ${String(e.count).padStart(6)}  ${pct.padStart(5)}%`);
    if (e.examples.length && bucket !== 'absent' && bucket !== 'empty string' && bucket !== 'parses cleanly') {
      for (const ex of e.examples) console.log(`      ${JSON.stringify(ex)}`);
    }
  }
}

(async () => {
  console.log(`\nReading ${READ_DB} (read only — nothing is written)\n`);

  const app = initializeApp({ credential: applicationDefault(), projectId: PROJECT_ID });
  const db = getFirestore(app, READ_DB);

  const companyRevenue = new Map();
  const historyRevenue = new Map();
  const dateBuckets = new Map();

  let companies = 0;
  let historyEntries = 0;
  let dateValues = 0;
  let confidentCompany = 0;

  const snap = await db.collection('companies').get();
  for (const doc of snap.docs) {
    companies++;
    const c = doc.data();

    const r = classifyMoney(c.revenue);
    tally(companyRevenue, r.bucket, typeof c.revenue === 'string' ? c.revenue : undefined);
    if (r.cents !== undefined && (r.bucket === 'clean' || r.bucket === 'already numeric')) confidentCompany++;

    for (const entry of c.revenueHistory || []) {
      historyEntries++;
      const h = classifyMoney(entry.revenue);
      tally(historyRevenue, h.bucket, typeof entry.revenue === 'string' ? entry.revenue : undefined);
    }

    for (const i of c.interactions || []) {
      dateValues++;
      tally(dateBuckets, classifyDate(i.date), typeof i.date === 'string' ? i.date : undefined);
    }
    for (const h of c.stageHistory || []) {
      dateValues++;
      tally(dateBuckets, classifyDate(h.date), typeof h.date === 'string' ? h.date : undefined);
    }
    dateValues++;
    tally(dateBuckets, classifyDate(c.lastModified), typeof c.lastModified === 'string' ? c.lastModified : undefined);
  }

  console.log(`companies scanned      ${companies}`);
  console.log(`revenueHistory entries ${historyEntries}`);
  console.log(`date values inspected  ${dateValues}`);

  report(`Company.revenue  (${companies} values)`, companyRevenue, companies);
  report(`revenueHistory[].revenue  (${historyEntries} values)`, historyRevenue, historyEntries);
  report(`All date fields  (${dateValues} values)`, dateBuckets, dateValues);

  const needsReview = companies - confidentCompany -
    (companyRevenue.get('absent')?.count || 0) -
    (companyRevenue.get('empty string')?.count || 0) -
    (companyRevenue.get('stated as none')?.count || 0);

  console.log(`\nCompany.revenue: ${confidentCompany} convert automatically, ~${Math.max(0, needsReview)} need a human decision.\n`);
})().catch(err => {
  console.error('\nFailed:', err.message);
  process.exit(1);
});
