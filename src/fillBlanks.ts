/**
 * Filling in what is missing, and only what is missing.
 *
 * Every auto-populate path in this app -- notes pasted into the Add Company
 * form, a pitch deck dropped on an existing company -- used to merge its
 * result with a plain spread:
 *
 *   const updated = { ...prev, ...extractedData };
 *
 * That is wrong in two directions at once. The extraction prompt asks for
 * null where a fact is not in the source, so every field the deck did not
 * mention was overwritten with null; and every field it did mention
 * overwrote what a person had already typed or checked. Uploading a deck to
 * a company that was already filled in could empty most of its record and
 * silently replace the rest.
 *
 * The rule here is the same one the Granola ingest uses on the server: a
 * value that is already there stays. An extraction is a source of facts we
 * do not have, never a correction of facts we do -- a model reading a deck
 * has no way to know that the revenue figure on the record came off a signed
 * term sheet, and it is not entitled to overwrite it either way.
 *
 * Correcting something is a person's job, in the field, where the change is
 * deliberate and attributable.
 */

/**
 * Whether a field currently holds nothing.
 *
 * `false` and `0` count as filled. They are real answers -- a 0% probability
 * of close is a judgement somebody made, not an empty box -- and treating
 * them as blank would let every extraction overwrite them.
 */
export function isBlank(value: unknown): boolean {
  if (value === null || value === undefined) return true;
  if (typeof value === 'string') return value.trim() === '';
  if (Array.isArray(value)) return value.length === 0;
  // location is `string | { formatted_address?: string, ... }`. An object with
  // no address in it is an empty location, however many other keys it carries.
  if (typeof value === 'object') {
    const address = (value as { formatted_address?: string }).formatted_address;
    if (typeof address === 'string') return address.trim() === '';
    return Object.keys(value as object).length === 0;
  }
  return false;
}

/** Answers a model gives when it means "not stated". Never written to a field. */
const NON_ANSWER = /^(n\/?a|none|null|unknown|not found|not specified|not mentioned|not provided|not available|tbd|-{1,3})$/i;

/**
 * Returns `prev` with the extracted fields written into its blanks only.
 *
 * Fields already holding a value are left exactly as they are, and so is
 * anything the extraction answered with null, an empty string, or a
 * not-stated placeholder.
 */
export function fillBlanks<T extends Record<string, any>>(
  prev: T,
  extracted: Record<string, any> | null | undefined,
): T {
  if (!extracted) return prev;
  const merged: any = { ...prev };

  for (const [field, value] of Object.entries(extracted)) {
    if (value === null || value === undefined) continue;
    if (typeof value === 'string') {
      const trimmed = value.trim();
      if (trimmed === '' || NON_ANSWER.test(trimmed)) continue;
    }
    // The whole point: what is already there wins.
    if (!isBlank(merged[field])) continue;
    merged[field] = value;
  }

  return merged as T;
}
