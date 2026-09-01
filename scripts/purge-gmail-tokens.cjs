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

const TOKEN_FIELDS = ['gmail_refresh_token', 'gmail_access_token', 'is_gmail_connected'];

(async () => {
  console.log(`\nDatabase : ${DB}${PRODUCTION ? '   *** PRODUCTION ***' : ''}`);
  console.log(`Mode     : ${APPLY ? 'APPLY — fields will be deleted' : 'DRY RUN'}\n`);

  const app = initializeApp({ credential: applicationDefault(), projectId: PROJECT_ID });
  const db = getFirestore(app, DB);
  const snap = await db.collection('users').get();

  if (snap.empty) { console.log('  users is empty or absent. Nothing to do.\n'); return; }

  let affected = 0;
  const plans = [];
  for (const doc of snap.docs) {
    const data = doc.data();
    const present = TOKEN_FIELDS.filter(f => data[f] !== undefined);
    if (!present.length) continue;
    affected++;
    plans.push({ id: doc.id, fields: present });
    // The document id is a Firebase Auth uid, not an email — safe to show.
    console.log(`  ${doc.id}   removing: ${present.join(', ')}`);
  }

  if (!affected) { console.log('  No token fields found.\n'); return; }

  if (!APPLY) {
    console.log(`\n  ${affected} document(s) would be cleaned. Re-run with --apply.\n`);
    return;
  }

  const batch = db.batch();
  for (const { id, fields } of plans) {
    const update = {};
    for (const f of fields) update[f] = FieldValue.delete();
    batch.update(db.collection('users').doc(id), update);
  }
  await batch.commit();
  console.log(`\n  Cleaned ${affected} document(s).`);
  console.log('  REMINDER: the tokens are still valid at Google until access is revoked.\n');
})().catch(err => { console.error('\nFailed:', err.message); process.exit(1); });
