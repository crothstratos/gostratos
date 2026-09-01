/**
 * Backfills Company.referrerIds from Company.referrers[].
 *
 * referrers[] holds objects. Firestore's array-contains matches whole array
 * elements, so it cannot look inside them — which means "which companies did
 * this person refer?" is unanswerable from referrers[] alone. referrerIds is a
 * flat mirror of referrers[].id that makes that reverse lookup a single query.
 *
 * useCompanies now writes referrerIds on every save, but companies saved before
 * that change have referrers[] and no mirror, so the person profile shows them
 * nothing. This script writes the mirror for those.
 *
 * It is idempotent: a company whose mirror already matches is skipped, so it is
 * safe to re-run. It also repairs a stale mirror (referrers edited by an older
 * build) rather than only filling in missing ones.
 *
 * DRY RUN BY DEFAULT. Reads staging. Writes nothing unless told to.
 *
 *   node scripts/backfill-referrer-ids.cjs                      survey staging
 *   node scripts/backfill-referrer-ids.cjs --apply              backfill staging
 *   node scripts/backfill-referrer-ids.cjs --production         survey production
 *   node scripts/backfill-referrer-ids.cjs --production --apply backfill production
 */

const { initializeApp, applicationDefault } = require('firebase-admin/app');
const { getFirestore } = require('firebase-admin/firestore');

const PROJECT_ID = 'gen-lang-client-0128987745';
const STAGING_DB = 'staging';
const PRODUCTION_DB = 'ai-studio-e212f446-e1ec-4969-b746-7a8ec637da86';

const APPLY = process.argv.includes('--apply');
const PRODUCTION = process.argv.includes('--production');
const DB = PRODUCTION ? PRODUCTION_DB : STAGING_DB;

const MAX_EXAMPLES = 10;
const BATCH_SIZE = 300;

/** Same derivation useCompanies performs on save, kept deliberately identical. */
function idsFrom(company) {
  return (Array.isArray(company.referrers) ? company.referrers : [])
    .map(r => r && r.id)
    .filter(id => typeof id === 'string' && id !== '');
}

function sameArray(a, b) {
  if (!Array.isArray(a) || a.length !== b.length) return false;
  return a.every((v, i) => v === b[i]);
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
  const samples = [];
  const byKind = new Map();
  let withReferrers = 0;
  let alreadyCorrect = 0;
  let stale = 0;
  let droppedBlankIds = 0;

  for (const doc of snap.docs) {
    const data = doc.data();
    const referrers = Array.isArray(data.referrers) ? data.referrers : [];
    if (referrers.length === 0) continue;
    withReferrers++;

    const ids = idsFrom(data);
    droppedBlankIds += referrers.length - ids.length;

    for (const id of ids) {
      const kind = id.split(':')[0];
      byKind.set(kind, (byKind.get(kind) || 0) + 1);
    }

    const existing = data.referrerIds;
    if (sameArray(existing, ids)) { alreadyCorrect++; continue; }
    if (Array.isArray(existing) && existing.length) stale++;

    plans.push({ id: doc.id, ids });
    if (samples.length < MAX_EXAMPLES) {
      samples.push(`${(data.name || doc.id).slice(0, 30).padEnd(32)} ${ids.join(', ').slice(0, 70)}`);
    }
  }

  console.log('Companies');
  console.log('---------');
  console.log(`  with referrers[]              ${String(withReferrers).padStart(6)}`);
  console.log(`  mirror already correct        ${String(alreadyCorrect).padStart(6)}`);
  console.log(`  mirror missing or stale       ${String(plans.length).padStart(6)}   (${stale} stale, ${plans.length - stale} missing)`);
  if (droppedBlankIds) {
    console.log(`\n  ${droppedBlankIds} referrer entr(ies) had no usable id and were skipped.`);
  }

  if (byKind.size) {
    console.log('\nReferrer ids by kind');
    console.log('--------------------');
    for (const [kind, count] of [...byKind.entries()].sort((a, b) => b[1] - a[1])) {
      console.log(`  ${kind.padEnd(16)} ${String(count).padStart(6)}`);
    }
  }

  if (samples.length) {
    console.log('\nSample companies to be written');
    console.log('------------------------------');
    samples.forEach(s => console.log('  ' + s));
  }

  if (!plans.length) {
    console.log('\nNothing to do — every mirror is already in step.\n');
    return;
  }

  if (!APPLY) {
    console.log('\nDry run. Re-run with --apply to write these changes.\n');
    return;
  }

  let written = 0;
  let batch = db.batch();
  let inBatch = 0;
  for (const { id, ids } of plans) {
    batch.update(db.collection('companies').doc(id), { referrerIds: ids });
    if (++inBatch >= BATCH_SIZE) {
      await batch.commit(); written += inBatch; batch = db.batch(); inBatch = 0;
      process.stdout.write(`  written ${written}/${plans.length}\r`);
    }
  }
  if (inBatch) { await batch.commit(); written += inBatch; }
  console.log(`\nBackfilled ${written} companies.\n`);
})().catch(err => {
  console.error('\nFailed:', err.message);
  process.exit(1);
});
