import { Company } from './types';

/**
 * Resolving a free-text company name to a company in the CRM.
 *
 * Investor portfolio lists are typed by hand or filled in by a model, so the
 * same company shows up as "Acme", "Acme, Inc." and "acme inc". Matching has
 * to survive that without ever linking the wrong company: a click that opens
 * someone else's profile is worse than a name that stays plain text.
 *
 * The previous approach was a substring test in both directions:
 *
 *   a.includes(b) || b.includes(a)
 *
 * which links "AI" to "OpenAI", "Ramp" to "Rampart", and "Notion" to
 * "Notional". Substring matching is abandoned here. Names are normalised, then
 * compared whole.
 */

/** Legal suffixes that carry no identity. Order matters: longest first. */
const SUFFIXES = [
  'incorporated', 'corporation', 'limited', 'holdings', 'holding',
  'company', 'group', 'labs', 'inc', 'llc', 'lld', 'ltd', 'plc',
  'corp', 'co', 'gmbh', 'bv', 'nv', 'sa', 'ag', 'ab', 'oy', 'as', 'pte',
];

/**
 * Reduces a name to its identifying core.
 *
 *   "Acme, Inc."      -> "acme"
 *   "The Acme Group"  -> "acme"
 *   "Acme Technologies Inc" -> "acme technologies"
 */
export function normaliseCompanyName(raw: string): string {
  let s = (raw || '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')   // strip accents
    .replace(/&/g, ' and ')
    .replace(/[.,''`"()\[\]]/g, ' ')   // punctuation that is never meaningful
    .replace(/[^a-z0-9\s-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  if (s.startsWith('the ')) s = s.slice(4);

  // Strip trailing legal suffixes, repeatedly: "acme inc llc" -> "acme".
  let changed = true;
  while (changed) {
    changed = false;
    for (const suffix of SUFFIXES) {
      if (s.endsWith(' ' + suffix)) {
        s = s.slice(0, -(suffix.length + 1)).trim();
        changed = true;
        break;
      }
    }
  }

  return s;
}

/** True when two names refer to the same company. Whole-name, never substring. */
export function isSameCompany(a: string, b: string): boolean {
  const na = normaliseCompanyName(a);
  const nb = normaliseCompanyName(b);
  return na !== '' && na === nb;
}

/**
 * Finds the CRM company a name refers to, or null.
 *
 * Returns null on ambiguity — if two companies in the CRM normalise to the
 * same name, there is no way to know which was meant, and guessing would
 * silently send someone to the wrong record.
 */
export function findCompanyByName(name: string, companies: Company[]): Company | null {
  const target = normaliseCompanyName(name);
  if (!target) return null;

  const hits = companies.filter(c => normaliseCompanyName(c.name) === target);
  return hits.length === 1 ? hits[0] : null;
}

/**
 * Builds a lookup once for repeated matching, so a list of 50 portfolio names
 * against 6,000 companies is not 300,000 comparisons.
 *
 * Names that collide are dropped rather than resolved arbitrarily, matching
 * findCompanyByName's refusal to guess.
 */
export function buildCompanyIndex(companies: Company[]): Map<string, Company> {
  const index = new Map<string, Company>();
  const collided = new Set<string>();

  for (const c of companies) {
    const key = normaliseCompanyName(c.name);
    if (!key) continue;
    if (index.has(key)) { collided.add(key); continue; }
    index.set(key, c);
  }
  for (const key of collided) index.delete(key);

  return index;
}

/** Looks a name up in an index built by buildCompanyIndex. */
export function lookupCompany(name: string, index: Map<string, Company>): Company | null {
  return index.get(normaliseCompanyName(name)) || null;
}
