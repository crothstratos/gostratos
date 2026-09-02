/**
 * Reading dollar amounts out of the free text people actually type.
 *
 * Cash balance and burn are stored as text so "$1.2M" and "~180k/mo net" both
 * survive being written down. Runway is worth computing anyway, so this makes
 * a best effort at a number and returns null rather than a wrong figure when
 * the text does not clearly contain one.
 */

/** Dollars, or null when the text does not contain a single clear amount. */
export function parseMoney(raw: string | undefined | null): number | null {
  if (!raw) return null;
  const text = String(raw).toLowerCase().replace(/,/g, '');

  const match = text.match(/\$?\s*(\d+(?:\.\d+)?)\s*(k|m|mm|bn|b|thousand|million|billion)?/);
  if (!match) return null;

  const n = parseFloat(match[1]);
  if (!Number.isFinite(n)) return null;

  const unit = match[2] || '';
  if (unit === 'k' || unit === 'thousand') return n * 1e3;
  if (unit === 'm' || unit === 'mm' || unit === 'million') return n * 1e6;
  if (unit === 'b' || unit === 'bn' || unit === 'billion') return n * 1e9;

  // No unit given. A bare number here is dollars as written — guessing at
  // thousands or millions would silently move the decimal point three or six
  // places on a figure someone is about to put in front of an investor.
  return n;
}

/**
 * Months of runway, or null when either side is unparseable.
 *
 * Returns null rather than Infinity for zero burn: "profitable" is a real
 * answer but it is not a runway figure, and printing an infinity symbol on a
 * memo helps nobody.
 */
export function runwayMonths(cash: string | undefined, burn: string | undefined): number | null {
  const c = parseMoney(cash);
  const b = parseMoney(burn);
  if (c === null || b === null || b <= 0) return null;
  const months = c / b;
  if (!Number.isFinite(months) || months <= 0 || months > 600) return null;
  return months;
}

/** "14 months", or "1.5 years" once it stops reading naturally in months. */
export function formatRunway(months: number): string {
  if (months < 24) return `${months.toFixed(months < 10 ? 1 : 0)} months`;
  return `${(months / 12).toFixed(1)} years`;
}
