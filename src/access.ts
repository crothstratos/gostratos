/**
 * Who can sign in, and what they can see.
 *
 * These lists used to be typed out by hand in nine places across six files.
 * Changing who has access meant finding every copy, and missing one meant an
 * account kept privileges nobody thought it still had. Everything now reads
 * from here.
 *
 * This module is imported by both the browser bundle and server.ts, so it
 * must stay dependency-free — plain data and pure functions only.
 *
 * IMPORTANT: the browser copy of these checks is for user experience only.
 * The real boundary is firestore.rules and storage.rules, which Firebase
 * enforces and a browser cannot bypass. Those two files carry their own
 * copies of the revoked list because Firestore rules cannot import from
 * TypeScript — when you change REVOKED_EMAILS below, change them too, then
 * run: firebase deploy --only firestore:rules,storage
 */

/** Everyone with a verified address at this domain may sign in. */
export const ALLOWED_DOMAIN = 'gostratos.vc';

/** Individually approved outside collaborators. Mirror in the .rules files. */
export const EXTRA_ALLOWED: readonly string[] = [];

/**
 * Accounts that may not sign in at all.
 *
 * Revoking here blocks the app and the API. It does not sign the account out
 * of Google or invalidate an already-issued session token, so for an urgent
 * removal also disable the account in the Firebase console.
 *
 * Mirrored in firestore.rules revoked() and storage.rules revoked().
 */
export const REVOKED_EMAILS: readonly string[] = [
  'dwhite@gostratos.vc',
  'cjrothai@gmail.com',
  'joe@highwayventures.com',
  'arkansas1@gostratos.vc',
  'arkansas2@gostratos.vc',
];

/**
 * Accounts limited to the Arkansas fund.
 *
 * These sign in normally but see only Arkansas companies, investors and
 * events. The filtering is applied in the hooks that read those collections.
 *
 * NOTE: this restriction is client-side. Firestore rules still grant these
 * accounts read access to every document, so a determined user could query
 * around it. Tightening that requires per-document ownership in the rules —
 * known, not done.
 */
export const RESTRICTED_EMAILS: readonly string[] = [
  'jcomizio@gostratos.vc',
  'lpatterson@gostratos.vc',
];

const normalise = (email: string | null | undefined) => (email || '').trim().toLowerCase();

/** True if this address has been revoked. */
export const isRevoked = (email: string | null | undefined): boolean =>
  REVOKED_EMAILS.includes(normalise(email));

/** True if this address is limited to the Arkansas fund. */
export const isRestricted = (email: string | null | undefined): boolean =>
  RESTRICTED_EMAILS.includes(normalise(email));

/** True if this address may sign in at all. */
export const isAllowed = (email: string | null | undefined): boolean => {
  const addr = normalise(email);
  if (!addr || isRevoked(addr)) return false;
  return addr.endsWith('@' + ALLOWED_DOMAIN) || EXTRA_ALLOWED.includes(addr);
};
