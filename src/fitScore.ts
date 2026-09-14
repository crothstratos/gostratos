import { MANDATE, Mandate } from './mandate';
import { parseMoney, parseCheckSize } from './money';
import { normaliseCompanyName } from './companyMatch';
import type { Company, InvestorRepositoryEntry, SourcingCandidate } from './types';

/**
 * How well a company or a firm fits what Stratos invests in.
 *
 * Deliberately arithmetic. Not one model call, for three reasons that all
 * matter here: it is free, and the month's grounded-search allowance is
 * already spoken for; it is instant, so a list of four hundred companies
 * re-sorts as you type; and it is explainable, so a 78 can be opened up and
 * argued with rather than believed. A score nobody can interrogate is a score
 * nobody should act on.
 *
 * Every component reports the points it awarded and why, and the card shows
 * that breakdown. If the model is wrong about what a good company looks like,
 * that is visible and fixable in src/mandate.ts — which is the point.
 */

export interface ScoreReason {
  label: string;
  points: number;
  max: number;
  detail: string;
  /** False when there was no evidence either way. Drives the coverage figure. */
  assessed: boolean;
}

export interface FitScore {
  /** 0-100. */
  score: number;
  reasons: ScoreReason[];
  /**
   * How much of the rubric had any evidence behind it, 0-1.
   *
   * The number that stops this being misleading. A company with no
   * description scores low on nearly everything, and a bare "18" reads as
   * "we looked and it is a poor fit" when the truth is "we know almost
   * nothing". Low coverage is shown on the dial as provisional rather than
   * being hidden inside the score.
   */
  coverage: number;
}

const lower = (s: unknown) => String(s ?? '').toLowerCase();

/** Whole-word-ish containment, so "ai" does not match "chair" or "retail". */
function mentions(haystack: string, term: string): boolean {
  const t = term.toLowerCase().trim();
  if (!t) return false;
  // Multi-word terms are matched plainly; single short words get boundaries,
  // which is the difference between finding "AI" and finding it inside
  // "certain", "email" and "retail" — all of which happen constantly.
  if (/\s|-/.test(t)) return haystack.includes(t);
  const escaped = t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`\\b${escaped}\\b`).test(haystack);
}

function anyMention(haystack: string, terms: string[]): string[] {
  return terms.filter((t) => mentions(haystack, t));
}

const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, n));

function finish(reasons: ScoreReason[], sectorWeight = 1): FitScore {
  const raw = reasons.reduce((sum, r) => sum + r.points, 0);
  const score = clamp(Math.round(raw * sectorWeight), 0, 100);
  const assessable = reasons.reduce((sum, r) => sum + r.max, 0) || 1;
  const assessed = reasons.filter((r) => r.assessed).reduce((sum, r) => sum + r.max, 0);
  return { score, reasons, coverage: clamp(assessed / assessable, 0, 1) };
}

/**
 * Sector is a gate, not a column.
 *
 * The fund invests in FinTech, InsurTech and RegTech. Three verticals, and
 * nothing else — so a company outside them is not a weaker version of a good
 * fit, it is the wrong answer to the question.
 *
 * Scoring sector as one component among six did not express that. A
 * direct-to-consumer coffee roaster at seed stage collected twenty points for
 * being at our stage and seven for having a subscription, and landed at 33 —
 * a third of the way to a strong fit, for a company we would never look at.
 * The multiplier fixes it: everything the company has going for it still
 * counts, but it is scaled by whether any of it is in our sectors.
 */
function sectorWeightFor(kind: 'core' | 'adjacent' | 'generic' | 'none' | 'unknown'): number {
  switch (kind) {
    case 'core': return 1;
    case 'adjacent': return 0.85;
    case 'generic': return 0.45;
    case 'none': return 0.22;
    // No description to judge by. Not penalised here, because low coverage
    // already says "we do not know" and doing both would say it twice.
    case 'unknown': return 1;
  }
}

// ───────────────────────────────────────────────────────────────────────────
// Companies
// ───────────────────────────────────────────────────────────────────────────

export interface CompanyLike {
  name?: string;
  description?: string;
  vertical?: string;
  lastRound?: string;
  location?: string;
  /** How many firms in our repository have backed this. The network signal. */
  backerCount?: number;
  revenue?: string;
}

/**
 * "AI" is in the mandate and in roughly half of all company descriptions
 * written since 2023, so on its own it means very little. Two or more of the
 * named technologies is a thesis; one is a keyword.
 */
function technologyPoints(text: string, m: Mandate, max: number) {
  const hits = anyMention(text, m.technologies);
  if (hits.length >= 2) return { points: max, detail: `Built on ${hits.slice(0, 3).join(', ')}` };
  if (hits.length === 1) return { points: Math.round(max * 0.6), detail: `Mentions ${hits[0]}` };
  return { points: 0, detail: 'No advanced technology named' };
}

export function scoreCompany(input: CompanyLike, m: Mandate = MANDATE): FitScore {
  const text = lower([input.name, input.description, input.vertical, input.lastRound, input.revenue].filter(Boolean).join(' . '));
  const hasText = text.replace(/[^a-z0-9]/g, '').length > 20;
  const reasons: ScoreReason[] = [];

  // --- Sector, 30. The single thing the firm names about itself.
  const core = anyMention(text, m.coreVerticals);
  const adjacent = anyMention(text, m.adjacentVerticals);
  const generic = anyMention(text, m.genericSoftware);
  let sectorKind: 'core' | 'adjacent' | 'generic' | 'none' | 'unknown';
  if (core.length) {
    sectorKind = 'core';
    reasons.push({ label: 'Sector', points: 30, max: 30, assessed: true, detail: `${core[0]} — a named vertical` });
  } else if (adjacent.length) {
    sectorKind = 'adjacent';
    reasons.push({ label: 'Sector', points: 20, max: 30, assessed: true, detail: `${adjacent.slice(0, 2).join(', ')} — adjacent to the mandate` });
  } else if (generic.length) {
    sectorKind = 'generic';
    reasons.push({ label: 'Sector', points: 8, max: 30, assessed: true, detail: 'Software, but not obviously in our sectors' });
  } else if (hasText) {
    sectorKind = 'none';
    reasons.push({ label: 'Sector', points: 0, max: 30, assessed: true, detail: 'Outside FinTech, InsurTech and RegTech' });
  } else {
    sectorKind = 'unknown';
    reasons.push({ label: 'Sector', points: 0, max: 30, assessed: false, detail: 'Not researched yet' });
  }

  // --- Stage, 20. Seed and Series A, in the fund's own words.
  const preferred = anyMention(text, m.preferredStages);
  const adjacentStage = anyMention(text, m.adjacentStages);
  const late = anyMention(text, m.lateStages);
  // Checked in this order on purpose: "Series B" contains no Seed, but a
  // description mentioning a seed round AND a Series C is describing history,
  // and the latest round is the one that decides whether we can invest.
  if (late.length) {
    reasons.push({ label: 'Stage', points: 2, max: 20, assessed: true, detail: `${late[0]} — past our stage` });
  } else if (preferred.length) {
    reasons.push({ label: 'Stage', points: 20, max: 20, assessed: true, detail: `${preferred[0]} — our stage` });
  } else if (adjacentStage.length) {
    reasons.push({ label: 'Stage', points: 11, max: 20, assessed: true, detail: `${adjacentStage[0]} — either side of our stage` });
  } else {
    reasons.push({ label: 'Stage', points: 0, max: 20, assessed: false, detail: 'No round information' });
  }

  // --- Business model, 12. B2B SaaS, per the Prosperity Fund.
  const b2b = anyMention(text, m.b2bSignals);
  const consumer = anyMention(text, m.consumerSignals);
  if (b2b.length && !consumer.length) {
    reasons.push({ label: 'Model', points: 12, max: 12, assessed: true, detail: `B2B signals: ${b2b.slice(0, 3).join(', ')}` });
  } else if (b2b.length && consumer.length) {
    reasons.push({ label: 'Model', points: 7, max: 12, assessed: true, detail: 'Sells to both businesses and consumers' });
  } else if (consumer.length) {
    reasons.push({ label: 'Model', points: 2, max: 12, assessed: true, detail: 'Consumer-facing' });
  } else {
    reasons.push({ label: 'Model', points: 0, max: 12, assessed: false, detail: 'Business model unclear' });
  }

  // --- Technology, 12.
  const tech = technologyPoints(text, m, 12);
  reasons.push({ label: 'Technology', points: tech.points, max: 12, assessed: hasText, detail: tech.detail });

  // --- Traction, 11. "close to $1M in revenue, supported by referenceable clients"
  const revenue = parseMoney(input.revenue) ?? revenueFromText(text);
  const strong = anyMention(text, m.tractionSignals);
  const weak = anyMention(text, m.weakTractionSignals);
  if (revenue !== null && revenue >= m.revenueTargetUsd) {
    reasons.push({ label: 'Traction', points: 11, max: 11, assessed: true, detail: `Revenue at or above the $1M bar` });
  } else if (revenue !== null && revenue > 0) {
    reasons.push({ label: 'Traction', points: 6, max: 11, assessed: true, detail: 'Revenue reported, below the $1M bar' });
  } else if (strong.length) {
    reasons.push({ label: 'Traction', points: 8, max: 11, assessed: true, detail: strong.slice(0, 2).join(', ') });
  } else if (weak.length) {
    reasons.push({ label: 'Traction', points: 4, max: 11, assessed: true, detail: 'Customers mentioned, nothing quantified' });
  } else {
    reasons.push({ label: 'Traction', points: 0, max: 11, assessed: false, detail: 'No traction stated' });
  }

  // --- Network proximity, 15.
  //
  // The only component grounded in fact rather than in reading prose, and the
  // reason the sourcing tab is worth having: two firms we already track
  // arriving at the same company independently is evidence of a kind no
  // description provides.
  const backers = Math.max(0, input.backerCount ?? 0);
  if (backers >= 3) {
    reasons.push({ label: 'Network', points: 15, max: 15, assessed: true, detail: `${backers} investors we track have backed it` });
  } else if (backers === 2) {
    reasons.push({ label: 'Network', points: 11, max: 15, assessed: true, detail: 'Two investors we track have backed it' });
  } else if (backers === 1) {
    reasons.push({ label: 'Network', points: 6, max: 15, assessed: true, detail: 'One investor we track has backed it' });
  } else {
    reasons.push({ label: 'Network', points: 0, max: 15, assessed: false, detail: 'No investor we track has backed it' });
  }

  return finish(reasons, sectorWeightFor(sectorKind));
}

/**
 * Pulls a revenue figure out of prose.
 *
 * Only from a phrase that actually says revenue or ARR. A description
 * containing "$4M seed round" is not a company with $4M of revenue, and
 * reading it as one would rank fundraising announcements above real
 * businesses.
 */
function revenueFromText(text: string): number | null {
  const patterns = [
    /(?:arr|annual recurring revenue|revenue|run[- ]rate)[^.$]{0,40}(\$[\d.,]+\s*(?:k|m|mm|b|million|billion|thousand)?)/i,
    /(\$[\d.,]+\s*(?:k|m|mm|b|million|billion|thousand)?)[^.$]{0,30}(?:in\s+)?(?:arr|annual recurring revenue|revenue|run[- ]rate)/i,
  ];
  for (const re of patterns) {
    const match = text.match(re);
    if (match && match[1]) {
      const value = parseMoney(match[1]);
      if (value !== null && value > 0) return value;
    }
  }
  return null;
}

/** Adapts a sourcing row, which is where most scoring happens. */
export function scoreSourcingCandidate(c: SourcingCandidate, m: Mandate = MANDATE): FitScore {
  return scoreCompany(
    {
      name: c.name,
      description: c.description,
      vertical: c.vertical,
      lastRound: c.lastRound,
      location: c.location,
      backerCount: c.sourceFirms?.length || 0,
    },
    m,
  );
}

// ───────────────────────────────────────────────────────────────────────────
// Investors
// ───────────────────────────────────────────────────────────────────────────

const asText = (v: unknown): string =>
  Array.isArray(v) ? v.join(', ') : String(v ?? '');

/**
 * How much a firm looks like us.
 *
 * Not how good they are — how *similar*. A top-tier growth fund scores low
 * here and should: the question this answers is "would we be in the same
 * rooms", which is what makes a firm worth a coffee, a co-investment or a
 * warm intro.
 *
 * The overlap component measures their portfolio against the CRM's own
 * companies — which today is the pipeline, not a portfolio, because the fund
 * is still raising. That makes it a live signal rather than a historical one:
 * a firm that has already written a cheque into a company we are currently
 * evaluating is a firm to call this week.
 *
 * Matched with the same whole-name comparison the rest of the app uses, so
 * "Ramp" does not match "Rampart" and inflate the number.
 */
export function scoreInvestor(
  firm: Partial<InvestorRepositoryEntry>,
  ourCompanyNames: Set<string>,
  m: Mandate = MANDATE,
): FitScore {
  const text = lower(
    [
      firm.firmName,
      asText(firm.verticals),
      asText(firm.investmentStage),
      firm.fundDetails,
      firm.notes,
      firm.checkSize,
    ]
      .filter(Boolean)
      .join(' . '),
  );
  const hasText = text.replace(/[^a-z0-9]/g, '').length > 20;
  const reasons: ScoreReason[] = [];

  // --- Vertical overlap, 30.
  const core = anyMention(text, m.coreVerticals);
  const adjacent = anyMention(text, m.adjacentVerticals);
  let sectorKind: 'core' | 'adjacent' | 'generic' | 'none' | 'unknown';
  if (core.length >= 2) {
    sectorKind = 'core';
    reasons.push({ label: 'Sectors', points: 30, max: 30, assessed: true, detail: `${core.slice(0, 3).join(', ')} — the same verticals` });
  } else if (core.length === 1) {
    sectorKind = 'core';
    reasons.push({ label: 'Sectors', points: 24, max: 30, assessed: true, detail: `${core[0]} — one of our verticals` });
  } else if (adjacent.length) {
    sectorKind = 'adjacent';
    reasons.push({ label: 'Sectors', points: 15, max: 30, assessed: true, detail: `${adjacent.slice(0, 2).join(', ')} — adjacent` });
  } else if (hasText) {
    sectorKind = 'none';
    reasons.push({ label: 'Sectors', points: 0, max: 30, assessed: true, detail: 'Invests outside our three verticals' });
  } else {
    sectorKind = 'unknown';
    reasons.push({ label: 'Sectors', points: 0, max: 30, assessed: false, detail: 'No sectors recorded' });
  }

  // --- Stage overlap, 25.
  const preferred = anyMention(text, m.preferredStages);
  const adjacentStage = anyMention(text, m.adjacentStages);
  const late = anyMention(text, m.lateStages);
  if (preferred.length) {
    reasons.push({ label: 'Stage', points: 25, max: 25, assessed: true, detail: `${preferred[0]} — the same stage we write at` });
  } else if (adjacentStage.length) {
    reasons.push({ label: 'Stage', points: 14, max: 25, assessed: true, detail: `${adjacentStage[0]} — one step either side` });
  } else if (late.length) {
    reasons.push({ label: 'Stage', points: 4, max: 25, assessed: true, detail: `${late[0]} — they come in after us` });
  } else {
    reasons.push({ label: 'Stage', points: 0, max: 25, assessed: false, detail: 'No stage recorded' });
  }

  // --- Portfolio overlap, 25. Fact, not prose.
  const theirs = Array.isArray(firm.portfolioCompanies) ? firm.portfolioCompanies : [];
  const shared = theirs.filter((n) => ourCompanyNames.has(normaliseCompanyName(String(n))));
  if (shared.length >= 3) {
    reasons.push({ label: 'Pipeline overlap', points: 25, max: 25, assessed: true, detail: `Backed ${shared.length} companies we are looking at` });
  } else if (shared.length === 2) {
    reasons.push({ label: 'Pipeline overlap', points: 18, max: 25, assessed: true, detail: `Backed ${shared.slice(0, 2).join(' and ')}` });
  } else if (shared.length === 1) {
    reasons.push({ label: 'Pipeline overlap', points: 11, max: 25, assessed: true, detail: `Backed ${shared[0]}, which is in our pipeline` });
  } else {
    reasons.push({
      label: 'Pipeline overlap',
      points: 0,
      max: 25,
      assessed: theirs.length > 0,
      detail: theirs.length ? 'Nothing in common with our pipeline' : 'No portfolio recorded',
    });
  }

  // --- Technology thesis, 10.
  const tech = technologyPoints(text, m, 10);
  reasons.push({ label: 'Technology', points: tech.points, max: 10, assessed: hasText, detail: tech.detail });

  // --- Check size, 10.
  //
  // A fund writing $25M cheques is not a co-investor at seed however well the
  // sectors line up, and one writing $25K is an angel. The window is generous
  // because check size is reported loosely and is usually a range.
  //
  // parseCheckSize, not parseMoney. This read parseMoney until today, which
  // takes a bare number as dollars — correct for a revenue field and wrong
  // here, because "1-5" in a check-size box means one to five million. Every
  // firm whose check size was written without units scored 3 out of 10 for
  // "cheque size far from ours" while writing exactly our size of cheque.
  //
  // A range is scored on its overlap with ours rather than on one end, so a
  // firm writing $500K-$5M counts as a match on the strength of the part that
  // fits, not the part that does not.
  const range = parseCheckSize(firm.checkSize);
  const OUR_MIN = 250_000;
  const OUR_MAX = 10_000_000;
  if (range === null) {
    reasons.push({ label: 'Check size', points: 0, max: 10, assessed: false, detail: 'No check size recorded' });
  } else if (range.max >= OUR_MIN && range.min <= OUR_MAX) {
    reasons.push({ label: 'Check size', points: 10, max: 10, assessed: true, detail: 'Writes cheques the size of ours' });
  } else if (range.max < OUR_MIN) {
    reasons.push({ label: 'Check size', points: 5, max: 10, assessed: true, detail: 'Smaller cheques than ours' });
  } else {
    reasons.push({ label: 'Check size', points: 3, max: 10, assessed: true, detail: 'Writes much larger cheques than ours' });
  }

  return finish(reasons, sectorWeightFor(sectorKind));
}

/**
 * The fit to show for a company on the board.
 *
 * Prefers the score stored when it arrived from Sourcing. That one knew how
 * many of our investors had backed the company — fifteen points that a Company
 * record has nowhere to keep — so it is the better answer and it is the one
 * the person saw when they moved it.
 *
 * Falls back to scoring the company's own text, so a company somebody typed in
 * by hand still gets a verdict. That score cannot earn the network points and
 * will read a little lower; it is marked as coming from the company record
 * rather than from sourcing so the difference is visible rather than silent.
 *
 * Returns null when there is nothing to judge. The board shows no dot at all
 * in that case, because an unassessed company and a poor one must not look
 * alike on a board being used to decide what to drop.
 */
export function companyFit(company: Company, m: Mandate = MANDATE): FitScore | null {
  const stored = (company as any).fitScore as
    | { score: number; coverage: number; reasons: ScoreReason[] }
    | undefined;
  if (stored && typeof stored.score === 'number') {
    return {
      score: stored.score,
      coverage: typeof stored.coverage === 'number' ? stored.coverage : 1,
      reasons: Array.isArray(stored.reasons) ? stored.reasons : [],
    };
  }

  const fit = scoreCompany(
    {
      name: company.name,
      // Everything a person might have written about what the company does.
      description: [company.slogan, company.basics, company.marketProblem, company.companySolution]
        .filter(Boolean)
        .join(' . '),
      vertical: company.vertical,
      lastRound: company.pastFinancing,
      revenue: company.revenue,
      // No sourceFirms on a Company, so the network component scores zero and
      // is reported as unassessed rather than as "nobody backed it".
      backerCount: 0,
    },
    m,
  );
  return fit.coverage < 0.35 ? null : fit;
}

/** The company-name index the investor score matches against. */
export function ourCompanyNameSet(companies: Company[]): Set<string> {
  const set = new Set<string>();
  for (const c of companies) {
    const key = normaliseCompanyName(c.name || '');
    if (key) set.add(key);
  }
  return set;
}

// ───────────────────────────────────────────────────────────────────────────
// Presentation
// ───────────────────────────────────────────────────────────────────────────

/**
 * Three verdicts, for the pipeline.
 *
 * The five-band scale is right in Sourcing, where the job is to rank several
 * hundred companies against each other. It is wrong on a pipeline card, where
 * the job is a decision with three answers: keep it in Initial Review, reach
 * out and find out more, or move it to Watchlist or Passed.
 *
 * So the same number drives both, read at different resolutions. The
 * boundaries are the existing band edges rather than new ones, which is what
 * keeps a company that read as a "Good fit" in Sourcing from arriving in the
 * pipeline as an amber.
 */
export type Verdict = 'keep' | 'reach-out' | 'pass';

export function verdictFor(score: number): Verdict {
  if (score >= 65) return 'keep';        // 'good' and 'strong'
  if (score >= 45) return 'reach-out';   // 'fair'
  return 'pass';                          // 'weak' and 'poor'
}

export const VERDICT_LABEL: Record<Verdict, string> = {
  'keep': 'Good fit — worth keeping in Initial Review',
  'reach-out': 'Worth reaching out to find out more',
  'pass': 'Below the bar — consider Watchlist or Passed',
};

/**
 * One colour per verdict, in each theme.
 *
 * Taken from the dial's own ramp rather than picked fresh, so a company does
 * not change colour on the way from Sourcing to the pipeline. Read at 15, 55
 * and 88 — inside the red, amber and green thirds rather than at their edges,
 * so each dot is unambiguously its own colour.
 *
 * A function, not a constant object. colorFor is a const arrow function
 * declared below this point, so an object literal calling it here would run
 * during module evaluation and hit the temporal dead zone — a ReferenceError
 * at import time, which takes the whole app down rather than one card.
 */
export function verdictColor(v: Verdict): { light: string; dark: string } {
  const at = v === 'keep' ? 88 : v === 'reach-out' ? 55 : 15;
  return { light: colorFor(at), dark: colorForDark(at) };
}

export type Band = 'strong' | 'good' | 'fair' | 'weak' | 'poor';

export function bandFor(score: number): Band {
  if (score >= 80) return 'strong';
  if (score >= 65) return 'good';
  if (score >= 45) return 'fair';
  if (score >= 25) return 'weak';
  return 'poor';
}

export const BAND_LABEL: Record<Band, string> = {
  strong: 'Strong fit',
  good: 'Good fit',
  fair: 'Worth a look',
  weak: 'Weak fit',
  poor: 'Off-mandate',
};

/**
 * Red through amber to green — with the brightness doing the work as well.
 *
 * Red-to-green is the one ramp that fails hardest for colour-blind readers:
 * to roughly one man in twelve, the two ends are the same colour. Three things
 * are done about that.
 *
 * The value is never carried by colour alone. The number is always on the
 * dial, the band is always in its label, and the needle's angle encodes the
 * score geometrically — any one of those reads the score with no colour
 * vision at all.
 *
 * The ramp's LIGHTNESS is monotonic, not just its hue. Amber is intrinsically
 * brighter than either red or green at the same nominal lightness, so a naive
 * sweep humps in the middle and 30 looks the same weight as 80. These stops
 * were solved so that perceptual lightness moves in one direction across the
 * whole range, which leaves a legible gradient even when the hue is gone.
 *
 * And dark mode has its own stops rather than an inverted copy. In both
 * themes a higher score means more contrast against the surface: darker on
 * white, brighter on near-black. Every stop below clears 3:1 against its own
 * surface — the first draft of this ramp had four of five stops below that,
 * which the palette validator caught and no amount of looking at it would
 * have.
 */
const RAMP_LIGHT: [number, string][] = [
  [0, '#e05c4d'], [12, '#dd5228'], [25, '#c55c1c'], [35, '#b16217'],
  [50, '#966711'], [55, '#8d6810'], [65, '#677115'], [72, '#50731c'],
  [80, '#397224'], [90, '#1f6f29'], [100, '#1a6841'],
];

const RAMP_DARK: [number, string][] = [
  [0, '#db4332'], [12, '#dd572d'], [25, '#df6a22'], [35, '#dd7a1d'],
  [50, '#d59219'], [55, '#d29a17'], [65, '#a7b822'], [72, '#8ac630'],
  [80, '#80ce63'], [90, '#73d87f'], [100, '#75dda9'],
];

function mixHex(a: string, b: string, u: number): string {
  const parse = (h: string) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
  const [ar, ag, ab] = parse(a);
  const [br, bg, bb] = parse(b);
  const to = (x: number) => Math.round(x).toString(16).padStart(2, '0');
  return `#${to(ar + (br - ar) * u)}${to(ag + (bg - ag) * u)}${to(ab + (bb - ab) * u)}`;
}

function rampAt(stops: [number, string][], score: number): string {
  const s = clamp(score, 0, 100);
  for (let i = 0; i < stops.length - 1; i++) {
    const [lo, loHex] = stops[i];
    const [hi, hiHex] = stops[i + 1];
    if (s >= lo && s <= hi) return mixHex(loHex, hiHex, hi === lo ? 0 : (s - lo) / (hi - lo));
  }
  return stops[stops.length - 1][1];
}

/** The arc colour for a score on a light surface. */
export const colorFor = (score: number): string => rampAt(RAMP_LIGHT, score);

/** The arc colour for a score on a dark surface. Chosen, not flipped. */
export const colorForDark = (score: number): string => rampAt(RAMP_DARK, score);
