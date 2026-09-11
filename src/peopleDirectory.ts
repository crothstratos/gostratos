import { doc, getDoc, setDoc, updateDoc, arrayUnion } from 'firebase/firestore';
import { db, handleFirestoreError, OperationType } from './firebase';

/**
 * Putting a person into the people directory, once.
 *
 * The id is a SHA-1 of the lower-cased name, truncated to 20 hex characters —
 * byte for byte what scripts/import-contacts.cjs derives. That is not a
 * coincidence and must not drift: it is the only thing stopping a founder
 * recorded here from becoming a second Sarah Chen the next time a contacts
 * CSV is imported. Both sides land on the same document and merge.
 *
 * Everything here is additive. A person already in the directory keeps the
 * name, emails and location the import gave them; a new email is appended and
 * a missing affiliation is filled, and nothing is ever overwritten. The
 * directory has 8,000-odd records that people have curated, and an automatic
 * writer that can damage them is one that has to be switched off.
 */

const normalise = (s: string) => (s || '').replace(/\s+/g, ' ').trim();
const key = (s: string) => normalise(s).toLowerCase();

/** Matches crypto.createHash('sha1').update(key(name)).digest('hex').slice(0, 20). */
export async function contactIdFor(name: string): Promise<string> {
  const bytes = new TextEncoder().encode(key(name));
  const digest = await crypto.subtle.digest('SHA-1', bytes);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
    .slice(0, 20);
}

/**
 * Names that are not people.
 *
 * founderName is a free-text field and collects things like "Unknown", "TBD",
 * "Founders", "N/A" and the company's own name. Every one of those would
 * become a person in the directory, and a directory with a contact called
 * "Unknown" in it is one people stop trusting.
 */
const NOT_A_PERSON = new Set([
  'unknown', 'n/a', 'na', 'none', 'tbd', 'tba', 'undisclosed', 'not disclosed',
  'founder', 'founders', 'the founders', 'ceo', 'team', 'management',
  'various', 'multiple', 'no founder listed', '-', '—', '?',
]);

export function looksLikeAPerson(name: string, companyName?: string): boolean {
  const n = normalise(name);
  if (n.length < 3 || n.length > 80) return false;
  if (NOT_A_PERSON.has(n.toLowerCase())) return false;
  // A single token is usually a placeholder or a company; a real founder
  // record almost always carries at least a first and last name.
  if (!/\s/.test(n)) return false;
  // Must read as a name rather than a sentence or a URL.
  if (!/^[\p{L}][\p{L}\p{M}'’.\-\s]+$/u.test(n)) return false;
  // "Acme Health" as the founder of Acme Health is the company, not a person.
  if (companyName && key(n) === key(companyName)) return false;
  return true;
}

export interface RecordPersonInput {
  name: string;
  email?: string;
  /** Who they are with — the company or firm. */
  affiliation?: string;
  /** Where this came from, so an automatic write is distinguishable. */
  source?: string;
}

export type RecordResult = 'created' | 'updated' | 'unchanged' | 'skipped' | 'failed';

/**
 * Ensures this person exists in the directory, and returns what it did.
 *
 * Safe to call repeatedly with the same person: the second call finds the
 * document and changes nothing.
 */
export async function recordPerson(input: RecordPersonInput, companyName?: string): Promise<RecordResult> {
  const name = normalise(input.name);
  if (!looksLikeAPerson(name, companyName)) return 'skipped';

  const email = (input.email || '').trim().toLowerCase();
  const affiliation = normalise(input.affiliation || '');

  try {
    const id = await contactIdFor(name);
    const ref = doc(db, 'contacts', id);
    const existing = await getDoc(ref);

    if (existing.exists()) {
      const data = existing.data() as any;
      const patch: Record<string, unknown> = {};
      // arrayUnion rather than a read-modify-write: two tabs recording the
      // same person at once would otherwise each write the list they read.
      if (email && !(Array.isArray(data.emails) ? data.emails : []).includes(email)) {
        patch.emails = arrayUnion(email);
      }
      if (affiliation && !normalise(data.affiliation || '')) {
        patch.affiliation = affiliation;
      }
      if (Object.keys(patch).length === 0) return 'unchanged';
      await updateDoc(ref, patch);
      return 'updated';
    }

    const parts = name.split(' ');
    await setDoc(ref, {
      name,
      nameLower: key(name),
      firstName: parts[0],
      ...(parts.length > 1 ? { lastName: parts[parts.length - 1] } : {}),
      emails: email ? [email] : [],
      ...(affiliation ? { affiliation } : {}),
      source: input.source || 'crm',
      importedAt: new Date().toISOString(),
    });
    return 'created';
  } catch (err) {
    // Never allowed to fail the thing that triggered it. Recording a founder
    // is a side effect of saving a company, and a company must still save if
    // the directory write is refused.
    handleFirestoreError(err, OperationType.CREATE, 'contacts');
    return 'failed';
  }
}

/**
 * Records everyone a company knows about.
 *
 * Called on every company save. Cheap when there is nothing new — one read
 * per person, and no write at all once they are in.
 */
export async function recordCompanyPeople(company: {
  name?: string;
  founderName?: string;
  founderEmail?: string;
}): Promise<RecordResult[]> {
  const results: RecordResult[] = [];
  const companyName = company.name;

  if (company.founderName) {
    // founderName sometimes holds two people — "Jane Doe and John Smith",
    // "Jane Doe & John Smith", "Jane Doe, John Smith". Each becomes a record.
    //
    // The email is only attached when there is exactly one name. With two
    // founders and one address there is no way to tell whose it is, and
    // guessing would put one founder's address on the other's contact card.
    const names = String(company.founderName)
      .split(/\s*(?:,|&|\band\b)\s*/i)
      .map((n) => n.trim())
      .filter(Boolean);
    const single = names.length === 1;
    for (const name of names) {
      results.push(
        await recordPerson(
          {
            name,
            email: single ? company.founderEmail : undefined,
            affiliation: companyName,
            source: 'company-founder',
          },
          companyName,
        ),
      );
    }
  }

  return results;
}
