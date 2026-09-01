/**
 * Reports the SHAPE of a collection — field names, types, and whether a value
 * looks like a credential — without ever printing the values themselves.
 *
 *   node scripts/inspect-collection.cjs users
 *   node scripts/inspect-collection.cjs users --production
 */

const { initializeApp, applicationDefault } = require('firebase-admin/app');
const { getFirestore } = require('firebase-admin/firestore');

const PROJECT_ID = 'gen-lang-client-0128987745';
const STAGING_DB = 'staging';
const PRODUCTION_DB = 'ai-studio-e212f446-e1ec-4969-b746-7a8ec637da86';

const NAME = process.argv[2];
const PRODUCTION = process.argv.includes('--production');
const DB = PRODUCTION ? PRODUCTION_DB : STAGING_DB;

if (!NAME || NAME.startsWith('--')) {
  console.error('Usage: node scripts/inspect-collection.cjs <collection> [--production]');
  process.exit(1);
}

// Field names that would hold something you would not want sitting around.
const SENSITIVE = /token|secret|password|credential|api[_-]?key|refresh|access/i;

function describe(v) {
  if (v === null) return 'null';
  if (Array.isArray(v)) return `array(${v.length})`;
  const t = typeof v;
  if (t === 'string') return `string(${v.length})`;
  if (t === 'object' && typeof v.toDate === 'function') return 'timestamp';
  if (t === 'object') return `object(${Object.keys(v).length} keys)`;
  return t;
}

(async () => {
  console.log(`\nCollection : ${NAME}`);
  console.log(`Database   : ${DB}${PRODUCTION ? '   *** PRODUCTION ***' : ''}`);
  console.log('Values are never printed — field names and types only.\n');

  const app = initializeApp({ credential: applicationDefault(), projectId: PROJECT_ID });
  const db = getFirestore(app, DB);
  const snap = await db.collection(NAME).get();

  if (snap.empty) { console.log('  Collection is empty or does not exist.\n'); return; }
  console.log(`  ${snap.size} document(s)\n`);

  const fields = new Map();
  for (const doc of snap.docs) {
    for (const [k, v] of Object.entries(doc.data())) {
      if (!fields.has(k)) fields.set(k, { count: 0, types: new Set(), sensitive: SENSITIVE.test(k), nonEmpty: 0 });
      const f = fields.get(k);
      f.count++;
      f.types.add(describe(v).replace(/\(\d+[^)]*\)/, ''));
      if (v !== null && v !== '' && v !== undefined) f.nonEmpty++;
    }
  }

  console.log('  field                        docs  non-empty  type');
  console.log('  ' + '-'.repeat(62));
  for (const [name, f] of [...fields.entries()].sort((a, b) => b[1].count - a[1].count)) {
    const flag = f.sensitive && f.nonEmpty > 0 ? '  <-- LOOKS LIKE A CREDENTIAL' : '';
    console.log(
      `  ${name.padEnd(28)}${String(f.count).padStart(4)}${String(f.nonEmpty).padStart(11)}  ${[...f.types].join('/')}${flag}`
    );
  }

  const risky = [...fields.entries()].filter(([, f]) => f.sensitive && f.nonEmpty > 0);
  if (risky.length) {
    console.log(`\n  ${risky.length} field(s) appear to hold credentials, with values present.`);
  } else {
    console.log('\n  No credential-shaped fields hold values.');
  }
  console.log('');
})().catch(err => { console.error('\nFailed:', err.message); process.exit(1); });
