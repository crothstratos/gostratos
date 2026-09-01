/**
 * Copy every document from the production Firestore database into the
 * staging database, in the same project.
 *
 * Why this exists rather than `gcloud firestore import`: the export contains
 * at least one field larger than Firestore's 1500-byte index limit, and the
 * import path enforces that limit strictly. The same data writes fine through
 * the SDK, because that is how it was written in the first place.
 *
 * Safe to run repeatedly. Documents are written by id, so a second run
 * refreshes staging rather than duplicating anything.
 *
 * Usage:
 *   gcloud auth application-default login
 *   node scripts/copy-to-staging.cjs
 *
 *   node scripts/copy-to-staging.cjs --dry-run    (count only, writes nothing)
 *   node scripts/copy-to-staging.cjs --verify     (compare both sides, writes nothing)
 *   node scripts/copy-to-staging.cjs --discover   (list what is REALLY in each database)
 */

const { initializeApp, applicationDefault } = require('firebase-admin/app');
const { getFirestore } = require('firebase-admin/firestore');

const PROJECT_ID = 'gen-lang-client-0128987745';
const SOURCE_DB = 'ai-studio-e212f446-e1ec-4969-b746-7a8ec637da86';
const TARGET_DB = 'staging';

const COLLECTIONS = [
  'companies',
  'investors',
  'investor_repository',
  'events',
  'attachments',
  'company_data_pool',
  'audit',
];

const DRY_RUN = process.argv.includes('--dry-run');
const VERIFY = process.argv.includes('--verify');
const DISCOVER = process.argv.includes('--discover');
const BATCH_SIZE = 400; // Firestore caps a batch at 500 writes.

// Guard rail: never let this write into production, whatever gets edited above.
if (TARGET_DB === SOURCE_DB || TARGET_DB === '(default)') {
  console.error('Refusing to run: TARGET_DB must be a separate, non-production database.');
  process.exit(1);
}

async function copyCollection(source, target, name) {
  const snapshot = await source.collection(name).get();
  if (snapshot.empty) {
    console.log(`  ${name.padEnd(22)} 0 documents (nothing to copy)`);
    return { name, count: 0, failed: 0 };
  }

  if (DRY_RUN) {
    console.log(`  ${name.padEnd(22)} ${String(snapshot.size).padStart(5)} documents (dry run, not written)`);
    return { name, count: snapshot.size, failed: 0 };
  }

  let written = 0;
  let failed = 0;
  let batch = target.batch();
  let inBatch = 0;

  for (const doc of snapshot.docs) {
    batch.set(target.collection(name).doc(doc.id), doc.data());
    inBatch++;

    if (inBatch >= BATCH_SIZE) {
      try {
        await batch.commit();
        written += inBatch;
      } catch (err) {
        failed += inBatch;
        console.error(`  ! batch failed in ${name}: ${err.message}`);
      }
      batch = target.batch();
      inBatch = 0;
      process.stdout.write(`  ${name}: ${written}/${snapshot.size}\r`);
    }
  }

  if (inBatch > 0) {
    try {
      await batch.commit();
      written += inBatch;
    } catch (err) {
      failed += inBatch;
      console.error(`  ! final batch failed in ${name}: ${err.message}`);
    }
  }

  console.log(`  ${name.padEnd(22)} ${String(written).padStart(5)} copied${failed ? `, ${failed} FAILED` : ''}`);
  return { name, count: written, failed };
}

(async () => {
  console.log(`\nProject : ${PROJECT_ID}`);
  console.log(`From    : ${SOURCE_DB}`);
  console.log(`To      : ${TARGET_DB}${DRY_RUN ? '   (DRY RUN — nothing will be written)' : ''}\n`);

  const app = initializeApp({ credential: applicationDefault(), projectId: PROJECT_ID });
  const source = getFirestore(app, SOURCE_DB);
  const target = getFirestore(app, TARGET_DB);

  // Asks the databases what they contain rather than trusting the list above.
  // The list was originally derived by reading the application code, which
  // missed a collection the app no longer references but that still exists.
  if (DISCOVER) {
    for (const [label, database] of [['PRODUCTION', source], ['STAGING', target]]) {
      const found = await database.listCollections();
      console.log(`\n  ${label}`);
      if (!found.length) { console.log('    (no collections)'); continue; }
      for (const ref of found) {
        const c = await ref.count().get();
        const known = COLLECTIONS.includes(ref.id);
        console.log(
          `    ${ref.id.padEnd(24)} ${String(c.data().count).padStart(7)}` +
          (known ? '' : '   <-- NOT in this script\'s collection list')
        );
      }
    }
    console.log('');
    process.exit(0);
  }

  if (VERIFY) {
    console.log('  collection            production    staging   match');
    let allMatch = true;
    for (const name of COLLECTIONS) {
      const [a, b] = await Promise.all([
        source.collection(name).count().get(),
        target.collection(name).count().get(),
      ]);
      const from = a.data().count;
      const to = b.data().count;
      const ok = from === to;
      if (!ok) allMatch = false;
      console.log(
        `  ${name.padEnd(22)}${String(from).padStart(9)}${String(to).padStart(11)}   ${ok ? 'yes' : 'NO'}`
      );
    }
    console.log(allMatch ? '\nStaging matches production.\n' : '\nCounts differ — staging is not a faithful copy.\n');
    process.exit(allMatch ? 0 : 1);
  }

  const results = [];
  for (const name of COLLECTIONS) {
    try {
      results.push(await copyCollection(source, target, name));
    } catch (err) {
      console.error(`  ${name.padEnd(22)} ERROR: ${err.message}`);
      results.push({ name, count: 0, failed: -1 });
    }
  }

  const total = results.reduce((n, r) => n + r.count, 0);
  const broken = results.filter(r => r.failed);
  console.log(`\n${DRY_RUN ? 'Would copy' : 'Copied'} ${total} documents.`);
  if (broken.length) {
    console.log(`Problems in: ${broken.map(r => r.name).join(', ')}`);
    process.exit(1);
  }
  console.log('Done.\n');
})().catch(err => {
  console.error('\nFailed:', err.message);
  process.exit(1);
});
