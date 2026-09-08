const { initializeApp, applicationDefault } = require('firebase-admin/app');
const { getFirestore } = require('firebase-admin/firestore');
const app = initializeApp({ credential: applicationDefault(), projectId: 'gen-lang-client-0128987745' });
const db = getFirestore(app, 'ai-studio-e212f446-e1ec-4969-b746-7a8ec637da86');
const FIELDS = ['yearFounded','entityInfo','fte','customerCount','tam','cashBalance','monthlyBurn','useOfFunds','foundersBackground'];
(async () => {
  const snap = await db.collection('companies').get();
  const counts = Object.fromEntries(FIELDS.map(f => [f, 0]));
  let anyCount = 0; const examples = [];
  for (const d of snap.docs) {
    const x = d.data(); let any = false;
    for (const f of FIELDS) if (String(x[f] ?? '').trim() !== '') { counts[f]++; any = true; }
    if (any) { anyCount++; if (examples.length < 5) examples.push(x.name); }
  }
  console.log(`\ncompanies scanned: ${snap.size}`);
  console.log(`with at least one new field filled: ${anyCount}\n`);
  for (const f of FIELDS) console.log(`  ${f.padEnd(20)} ${counts[f]}`);
  if (examples.length) console.log('\nexamples: ' + examples.join(', '));
})().catch(e => { console.error('FAILED:', e.message); process.exit(1); });
