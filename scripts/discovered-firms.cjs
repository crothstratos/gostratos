/**
 * Inspects — and if you want, removes — the investor records the overnight
 * research job created.
 *
 * Every firm that job adds carries sourceKind: 'co-investor-discovery' and the
 * firm it was found alongside. That marker is the whole reason it is safe to
 * let a scheduled job write records: this script is the undo.
 *
 * Deletions go through a copy into `audit` first, exactly as deleting a company
 * from the app does. A record removed here is recoverable; a record removed in
 * the Firestore console is not.
 *
 * DRY RUN BY DEFAULT. Reads staging. Writes nothing unless told to.
 *
 *   node scripts/discovered-firms.cjs                              survey staging
 *   node scripts/discovered-firms.cjs --production                 survey production
 *   node scripts/discovered-firms.cjs --production --delete --apply  remove them
 *
 * Narrowing, so you can keep the good ones:
 *   --min-deals=2   only firms with at least this many shared deals
 *   --unenriched    only firms whose profile was never filled in
 *   --since=2026-09-01   only firms discovered on or after this date
 */

const { initializeApp, applicationDefault } = require('firebase-admin/app');
const { getFirestore } = require('firebase-admin/firestore');

const PROJECT_ID = 'gen-lang-client-0128987745';
const STAGING_DB = 'staging';
const PRODUCTION_DB = 'ai-studio-e212f446-e1ec-4969-b746-7a8ec637da86';

const argv = process.argv.slice(2);
const has = (f) => argv.includes(f);
const val = (name) => {
  const hit = argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.split('=').slice(1).join('=') : undefined;
};

const APPLY = has('--apply');
const DELETE = has('--delete');
const PRODUCTION = has('--production');
const DB = PRODUCTION ? PRODUCTION_DB : STAGING_DB;

const MIN_DEALS = Number(val('min-deals') || 0);
const UNENRICHED_ONLY = has('--unenriched');
const SINCE = val('since');

const BATCH_SIZE = 200;

(async () => {
  console.log(`\nDatabase : ${DB}${PRODUCTION ? '   *** PRODUCTION ***' : ''}`);
  console.log(`Mode     : ${DELETE ? (APPLY ? 'DELETE — records will be removed' : 'DELETE (dry run)') : 'SURVEY'}\n`);

  const app = initializeApp({ credential: applicationDefault(), projectId: PROJECT_ID });
  const db = getFirestore(app, DB);
  db.settings({ ignoreUndefinedProperties: true });

  const snap = await db.collection('investor_repository').get();

  let total = 0;
  const discovered = [];
  const byParent = new Map();
  let enriched = 0, pending = 0, failed = 0, withMandate = 0;

  snap.forEach((doc) => {
    total++;
    const v = doc.data();
    if (v.sourceKind !== 'co-investor-discovery') return;

    const deals = (v.discoveredVia && Array.isArray(v.discoveredVia.sharedDeals))
      ? v.discoveredVia.sharedDeals.length : 0;
    const foundAt = (v.discoveredVia && v.discoveredVia.foundAt) || '';

    if (v.enrichmentState === 'done') enriched++;
    else if (v.enrichmentState === 'failed') failed++;
    else pending++;
    if (String(v.checkSize || '').trim() || String(v.investmentStage || '').trim()) withMandate++;

    const parent = (v.discoveredVia && v.discoveredVia.firmName) || '(unknown)';
    byParent.set(parent, (byParent.get(parent) || 0) + 1);

    if (MIN_DEALS && deals < MIN_DEALS) return;
    if (UNENRICHED_ONLY && v.enrichmentState === 'done') return;
    if (SINCE && (!foundAt || foundAt < SINCE)) return;

    discovered.push({ id: doc.id, name: v.firmName || doc.id, deals, parent, data: v });
  });

  const allDiscovered = enriched + pending + failed;
  console.log('Investor repository');
  console.log('-------------------');
  console.log(`  records in total              ${String(total).padStart(6)}`);
  console.log(`  created by the research job   ${String(allDiscovered).padStart(6)}`);
  console.log(`  created by a person           ${String(total - allDiscovered).padStart(6)}`);
  console.log('');
  console.log(`  profile filled in             ${String(enriched).padStart(6)}`);
  console.log(`  profile still pending         ${String(pending).padStart(6)}`);
  console.log(`  profile failed                ${String(failed).padStart(6)}`);
  console.log(`  with a stage or check size    ${String(withMandate).padStart(6)}`);

  if (byParent.size) {
    console.log('\nDiscovered alongside');
    console.log('--------------------');
    for (const [parent, count] of [...byParent.entries()].sort((a, b) => b[1] - a[1]).slice(0, 15)) {
      console.log(`  ${parent.slice(0, 40).padEnd(42)} ${String(count).padStart(4)}`);
    }
  }

  if (!DELETE) {
    console.log(`\nSurvey only. Add --delete to remove them (still a dry run without --apply).\n`);
    return;
  }

  console.log(`\nMatching this filter: ${discovered.length} record(s)`);
  discovered.slice(0, 20).forEach((d) =>
    console.log(`  ${d.name.slice(0, 38).padEnd(40)} ${d.deals} shared deal(s), via ${d.parent.slice(0, 25)}`)
  );
  if (discovered.length > 20) console.log(`  ... and ${discovered.length - 20} more`);

  if (!discovered.length) { console.log('\nNothing to delete.\n'); return; }

  if (!APPLY) {
    console.log('\nDry run. Re-run with --apply to delete these.\n');
    return;
  }

  if (PRODUCTION) {
    console.log('\nDeleting from production in 5 seconds. Ctrl+C to abort.\n');
    await new Promise((r) => setTimeout(r, 5000));
  }

  let removed = 0;
  for (let i = 0; i < discovered.length; i += BATCH_SIZE) {
    const chunk = discovered.slice(i, i + BATCH_SIZE);
    const batch = db.batch();
    for (const d of chunk) {
      // The copy goes in first. A delete whose audit write failed is a delete
      // that never should have happened.
      let body = JSON.stringify(d.data);
      let truncated = false;
      if (body.length > 900000) { body = body.slice(0, 900000); truncated = true; }
      batch.set(db.collection('audit').doc(), {
        action: 'delete',
        collectionName: 'investor_repository',
        investorId: d.id,
        investorName: d.name,
        changedBy: 'scripts/discovered-firms.cjs',
        changedAt: new Date().toISOString(),
        changedFields: ['(deleted)'],
        deletedRecord: body,
        deletedRecordTruncated: truncated,
      });
      batch.delete(db.collection('investor_repository').doc(d.id));
    }
    await batch.commit();
    removed += chunk.length;
    process.stdout.write(`  removed ${removed}/${discovered.length}\r`);
  }
  console.log(`\nRemoved ${removed} discovered firm(s). Copies are in the audit collection.\n`);
})().catch((err) => {
  console.error('\nFailed:', err.message);
  process.exit(1);
});
