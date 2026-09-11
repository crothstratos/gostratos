/**
 * Records the founder of every existing company in the people directory.
 *
 * From now on this happens on save, but companies created before that change
 * have a founderName on the record and no contact to match it. This walks the
 * backlog once.
 *
 * The document id is a SHA-1 of the lower-cased name truncated to 20 hex
 * characters — the same derivation scripts/import-contacts.cjs and
 * src/peopleDirectory.ts use, which is what makes this idempotent and what
 * stops a founder becoming a duplicate at the next CSV import.
 *
 * Additive only. A person already in the directory keeps their name, emails
 * and location; a new email is appended and a missing affiliation filled.
 * Nothing curated is overwritten.
 *
 * DRY RUN BY DEFAULT. Reads staging. Writes nothing unless told to.
 *
 *   node scripts/backfill-founders.cjs                        survey staging
 *   node scripts/backfill-founders.cjs --apply                write to staging
 *   node scripts/backfill-founders.cjs --production           survey production
 *   node scripts/backfill-founders.cjs --production --apply   write to production
 *
 *   --sourcing   also record founders found on sourcing rows
 */

const crypto = require('crypto');
const { initializeApp, applicationDefault } = require('firebase-admin/app');
const { getFirestore, FieldValue } = require('firebase-admin/firestore');

const PROJECT_ID = 'gen-lang-client-0128987745';
const STAGING_DB = 'staging';
const PRODUCTION_DB = 'ai-studio-e212f446-e1ec-4969-b746-7a8ec637da86';

const APPLY = process.argv.includes('--apply');
const PRODUCTION = process.argv.includes('--production');
const INCLUDE_SOURCING = process.argv.includes('--sourcing');
const DB = PRODUCTION ? PRODUCTION_DB : STAGING_DB;

const normalise = s => (s || '').replace(/\s+/g, ' ').trim();
const key = s => normalise(s).toLowerCase();
const idFor = name => crypto.createHash('sha1').update(key(name)).digest('hex').slice(0, 20);

// Kept in step with NOT_A_PERSON in src/peopleDirectory.ts.
const NOT_A_PERSON = new Set([
  'unknown', 'n/a', 'na', 'none', 'tbd', 'tba', 'undisclosed', 'not disclosed',
  'founder', 'founders', 'the founders', 'ceo', 'team', 'management',
  'various', 'multiple', 'no founder listed', '-', '—', '?',
]);

function looksLikeAPerson(name, companyName) {
  const n = normalise(name);
  if (n.length < 3 || n.length > 80) return false;
  if (NOT_A_PERSON.has(n.toLowerCase())) return false;
  if (!/\s/.test(n)) return false;
  if (!/^[\p{L}][\p{L}\p{M}'’.\-\s]+$/u.test(n)) return false;
  if (companyName && key(n) === key(companyName)) return false;
  return true;
}

function splitFounders(raw) {
  return String(raw || '')
    .split(/\s*(?:,|&|\band\b)\s*/i)
    .map(n => n.trim())
    .filter(Boolean);
}

(async () => {
  console.log(`\nDatabase : ${DB}${PRODUCTION ? '   *** PRODUCTION ***' : ''}`);
  console.log(`Mode     : ${APPLY ? 'APPLY — the directory will be written' : 'DRY RUN — nothing will be written'}\n`);

  const app = initializeApp({ credential: applicationDefault(), projectId: PROJECT_ID });
  const db = getFirestore(app, DB);
  db.settings({ ignoreUndefinedProperties: true });

  const sources = [{ collection: 'companies', label: 'companies', source: 'company-founder' }];
  if (INCLUDE_SOURCING) sources.push({ collection: 'sourcing', label: 'sourcing rows', source: 'sourcing' });

  // Collected across both collections first, so the same founder appearing
  // twice is one decision rather than two competing writes.
  const wanted = new Map();
  let scanned = 0, noFounder = 0, rejected = 0;
  const rejectedExamples = [];

  for (const src of sources) {
    const snap = await db.collection(src.collection).get();
    console.log(`Scanning ${snap.size} ${src.label}...`);
    snap.forEach(docSnap => {
      const v = docSnap.data();
      scanned++;
      const companyName = normalise(v.name);
      const raw = v.founderName;
      if (!normalise(raw)) { noFounder++; return; }

      const names = splitFounders(raw);
      const single = names.length === 1;
      for (const name of names) {
        if (!looksLikeAPerson(name, companyName)) {
          rejected++;
          if (rejectedExamples.length < 12) rejectedExamples.push(`${name}  (from ${companyName || docSnap.id})`);
          continue;
        }
        const id = idFor(name);
        const existing = wanted.get(id);
        // Only attach an email when one founder was named: with two names and
        // one address there is no way to know whose it is.
        const email = single ? normalise(v.founderEmail).toLowerCase() : '';
        if (existing) {
          if (email && !existing.emails.includes(email)) existing.emails.push(email);
          if (!existing.affiliation && companyName) existing.affiliation = companyName;
        } else {
          wanted.set(id, {
            id, name: normalise(name), emails: email ? [email] : [],
            affiliation: companyName, source: src.source,
          });
        }
      }
    });
  }

  console.log('');
  console.log('Records');
  console.log('-------');
  console.log(`  scanned                       ${String(scanned).padStart(6)}`);
  console.log(`  with no founder recorded      ${String(noFounder).padStart(6)}`);
  console.log(`  distinct founders found       ${String(wanted.size).padStart(6)}`);
  console.log(`  names rejected as placeholders${String(rejected).padStart(6)}`);
  if (rejectedExamples.length) {
    console.log('\n  Rejected, for example:');
    rejectedExamples.forEach(e => console.log('    ' + e));
  }

  // Which of them the directory already knows about.
  const ids = [...wanted.keys()];
  let already = 0;
  const toCreate = [], toUpdate = [];
  for (let i = 0; i < ids.length; i += 200) {
    const refs = ids.slice(i, i + 200).map(id => db.collection('contacts').doc(id));
    const docs = await db.getAll(...refs);
    for (const d of docs) {
      const plan = wanted.get(d.id);
      if (!d.exists) { toCreate.push(plan); continue; }
      already++;
      const data = d.data();
      const have = Array.isArray(data.emails) ? data.emails : [];
      const newEmails = plan.emails.filter(e => !have.includes(e));
      const needsAffiliation = plan.affiliation && !normalise(data.affiliation);
      if (newEmails.length || needsAffiliation) {
        toUpdate.push({ ...plan, newEmails, needsAffiliation });
      }
    }
    process.stdout.write(`  checked ${Math.min(i + 200, ids.length)}/${ids.length}\r`);
  }

  console.log('\n\nDirectory');
  console.log('---------');
  console.log(`  already in the directory      ${String(already).padStart(6)}`);
  console.log(`  to be added                   ${String(toCreate.length).padStart(6)}`);
  console.log(`  to gain an email or employer  ${String(toUpdate.length).padStart(6)}`);

  if (toCreate.length) {
    console.log('\n  New contacts, for example:');
    toCreate.slice(0, 10).forEach(p =>
      console.log(`    ${p.name.slice(0, 30).padEnd(32)} ${(p.emails[0] || '').padEnd(32)} ${p.affiliation || ''}`));
  }

  if (!toCreate.length && !toUpdate.length) { console.log('\nNothing to do.\n'); return; }
  if (!APPLY) { console.log('\nDry run. Re-run with --apply to write these.\n'); return; }

  if (PRODUCTION) {
    console.log('\nWriting to production in 5 seconds. Ctrl+C to abort.\n');
    await new Promise(r => setTimeout(r, 5000));
  }

  let written = 0;
  const all = [...toCreate.map(p => ({ p, create: true })), ...toUpdate.map(p => ({ p, create: false }))];
  for (let i = 0; i < all.length; i += 300) {
    const batch = db.batch();
    for (const { p, create } of all.slice(i, i + 300)) {
      const ref = db.collection('contacts').doc(p.id);
      if (create) {
        const parts = p.name.split(' ');
        batch.set(ref, {
          name: p.name,
          nameLower: key(p.name),
          firstName: parts[0],
          ...(parts.length > 1 ? { lastName: parts[parts.length - 1] } : {}),
          emails: p.emails,
          ...(p.affiliation ? { affiliation: p.affiliation } : {}),
          source: p.source,
          importedAt: new Date().toISOString(),
        });
      } else {
        const patch = {};
        if (p.newEmails.length) patch.emails = FieldValue.arrayUnion(...p.newEmails);
        if (p.needsAffiliation) patch.affiliation = p.affiliation;
        batch.update(ref, patch);
      }
    }
    await batch.commit();
    written += Math.min(300, all.length - i);
    process.stdout.write(`  written ${written}/${all.length}\r`);
  }
  console.log(`\n\nDone. ${toCreate.length} added, ${toUpdate.length} updated.\n`);
})().catch(err => {
  console.error('\nFailed:', err.message);
  process.exit(1);
});
