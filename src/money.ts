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

/**
 * A check size, where a bare number means millions.
 *
 * The opposite convention to parseMoney above, and deliberately so. These are
 * two different questions about two different fields:
 *
 *   Company.revenue  "5"  is five dollars. Reading it as five million would
 *                         put a made-up figure in front of an investor.
 *   checkSize        "5"  is five million. Nobody writes a five-dollar cheque,
 *                         and "1-5" in a check-size field means 1 to 5 million
 *                         every time.
 *
 * They lived in separate files and drifted into a real bug: scoreInvestor
 * called parseMoney on checkSize, read "1-5" as one dollar, and scored a firm
 * writing exactly our size of cheque as "cheque size far from ours" — 3 points
 * out of 10 instead of 10. Both now live here, next to each other, where the
 * difference is visible and has to be chosen rather than stumbled into.
 */
/**
 * Pulls a dollar range out of free text like "$500K–$2M" or "1-5 million".
 * Returns null when nothing parseable is there, which is common and fine.
 */
export function parseCheckSize(raw: string | undefined): { min: number; max: number } | null {
  if (!raw) return null;
  const text = String(raw).toLowerCase().replace(/,/g, '');
  const matches = [...text.matchAll(/(\d+(?:\.\d+)?)\s*(k|m|mm|b|thousand|million|billion)?/g)];
  const values: number[] = [];

  for (const m of matches) {
    const n = parseFloat(m[1]);
    if (!Number.isFinite(n)) continue;
    const unit = m[2] || '';
    let scale = 1;
    if (unit === 'k' || unit === 'thousand') scale = 1e3;
    else if (unit === 'm' || unit === 'mm' || unit === 'million') scale = 1e6;
    else if (unit === 'b' || unit === 'billion') scale = 1e9;
    // A bare number in a check-size field means millions far more often than
    // dollars: "1-5" is 1 to 5 million, not one dollar to five.
    else if (n < 1000) scale = 1e6;
    values.push(n * scale);
  }

  if (values.length === 0) return null;
  return { min: Math.min(...values), max: Math.max(...values) };
}
