/**
 * Removes stored Gmail OAuth tokens from the `users` collection.
 *
 * These were written by the server-side Gmail sync, which has since been
 * deleted. Nothing in the application reads this collection. Until the
 * security rules were replaced, it was governed by `allow read: if true`.
 *
 * IMPORTANT: this deletes YOUR COPY of the credential. It does not invalidate
 * the token at Google. Revoke the app's access separately.
 *
 * DRY RUN BY DEFAULT. Staging by default.
 *
 *   node scripts/purge-gmail-tokens.cjs --production
 *   node scripts/purge-gmail-tokens.cjs --production --apply
 */

const { initializeApp, applicationDefault } = require('firebase-admin/app');
const { getFirestore, FieldValue } = require('firebase-admin/firestore');

const PROJECT_ID = 'gen-lang-client-0128987745';
const STAGING_DB = 'staging';
const PRODUCTION_DB = 'ai-studio-e212f446-e1ec-4969-b746-7a8ec637da86';

const APPLY = process.argv.includes('--apply');
const PRODUCTION = process.argv.includes('--production');
const DB = PRODUCTION ? PRODUCTION_DB : STAGING_DB;

/** Fields known to have been written by the deleted Gmail sync. */
const KNOWN_TOKEN_FIELDS = ['gmail_refresh_token', 'gmail_access_token', 'is_gmail_connected'];

/**
 * Anything shaped like a credential, whatever it happens to be called.
 *
 * A fixed list of three field names only cleans what somebody remembered. The
 * code that wrote this collection has been deleted, so nobody can now say with
 * certainty what it stored — and a credential left behind because it was named
 * something unexpected is exactly the failure this script exists to prevent.
 * Anything matching is removed; everything else is printed so it can be seen
 * rather than assumed harmless.
 */
const CREDENTIAL_PATTERN =
  /(token|secret|credential|refresh|password|passwd|apikey|api_key|bearer|oauth|private_key|client_secret)/i;

const isCredentialField = (name) =>
  KNOWN_TOKEN_FIELDS.includes(name) || CREDENTIAL_PATTERN.test(name);

/** Redacted preview, so the log can be pasted around without leaking anything. */
const preview = (value) => {
  if (typeof value !== 'string') return `<${typeof value}>`;
  if (value.length <= 8) return `<${value.length} chars>`;
  return `${value.slice(0, 4)}…${value.slice(-2)}  <${value.length} chars>`;
};

(async () => {
  console.log(`\nDatabase : ${DB}${PRODUCTION ? '   *** PRODUCTION ***' : ''}`);
  console.log(`Mode     : ${APPLY ? 'APPLY — fields will be deleted' : 'DRY RUN'}\n`);

  const app = initializeApp({ credential: applicationDefault(), projectId: PROJECT_ID });
  const db = getFirestore(app, DB);
  const snap = await db.collection('users').get();

  if (snap.empty) { console.log('  users is empty or absent. Nothing to do.\n'); return; }

  let affected = 0;
  const plans = [];
  const leftBehind = new Set();

  for (const doc of snap.docs) {
    const data = doc.data();
    const all = Object.keys(data).sort();
    const toRemove = all.filter(isCredentialField);
    const keeping = all.filter(f => !isCredentialField(f));
    keeping.forEach(f => leftBehind.add(f));

    // The document id is a Firebase Auth uid, not an email — safe to show.
    console.log(`  ${doc.id}`);
    if (toRemove.length === 0 && keeping.length === 0) {
      console.log('      (empty document)');
    }
    for (const f of toRemove) console.log(`    - ${f.padEnd(26)} ${preview(data[f])}`);
    for (const f of keeping) console.log(`      ${f.padEnd(26)} kept`);
    console.log('');

    if (toRemove.length === 0) continue;
    affected++;
    plans.push({ id: doc.id, fields: toRemove, willBeEmpty: keeping.length === 0 });
  }

  if (leftBehind.size) {
    console.log(`  Fields being kept across all documents: ${[...leftBehind].sort().join(', ')}`);
    console.log('  Check that list. Nothing reads this collection, so anything surprising');
    console.log('  in it is worth understanding before it is left in place.\n');
  }

  if (!affected) { console.log('  No credential-shaped fields found.\n'); return; }

  if (!APPLY) {
    console.log(`\n  ${affected} document(s) would be cleaned. Re-run with --apply.\n`);
    return;
  }

  const batch = db.batch();
  let emptied = 0;
  for (const { id, fields, willBeEmpty } of plans) {
    const update = {};
    for (const f of fields) update[f] = FieldValue.delete();
    batch.update(db.collection('users').doc(id), update);
    // A document that held nothing but a credential has no reason to exist.
    // Left in place it is an empty row that looks like a record of something.
    if (willBeEmpty) { batch.delete(db.collection('users').doc(id)); emptied++; }
  }
  await batch.commit();

  console.log(`\n  Cleaned ${affected} document(s).`);
  if (emptied) console.log(`  ${emptied} held nothing else and were removed entirely.`);
  console.log('');
  console.log('  NOT DONE YET. This deleted our copy. The tokens remain valid at Google');
  console.log('  until the app\'s access is revoked, which has to be done per account at');
  console.log('  https://myaccount.google.com/permissions');
  console.log('');
})().catch(err => { console.error('\nFailed:', err.message); process.exit(1); });
