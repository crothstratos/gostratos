import { parseCheckSize } from '../money';
import { useMemo } from 'react';
import { Company, InvestorRepositoryEntry } from '../types';
import { isSameCompany } from '../companyMatch';

/**
 * Which investors to show a deal to, and which relationships are going cold.
 *
 * Both answers come out of fields the team already fills in — nobody has to
 * maintain a separate matching table for this to work.
 *
 * Fit is scored, not filtered. A hard filter on free-text fields quietly drops
 * good matches whenever someone wrote "Seed/Series A" instead of "Seed", so
 * every firm is ranked and the reasons are shown. A score with its reasoning
 * on display can be argued with; a filtered-out firm cannot.
 */

export interface InvestorFit {
  firm: InvestorRepositoryEntry;
  score: number;
  reasons: string[];
  /** Set when the firm already holds this company — they are not a prospect. */
  alreadyInvested: boolean;
}

const asList = (v: string | string[] | undefined): string[] => {
  if (!v) return [];
  if (Array.isArray(v)) return v.filter(Boolean).map(x => String(x).toLowerCase().trim());
  return String(v).split(/[,/|;]+/).map(x => x.toLowerCase().trim()).filter(Boolean);
};


/** Normalises the many spellings of a funding round to a comparable token. */
export function normaliseStage(raw: string): string[] {
  const t = raw.toLowerCase();
  const out: string[] = [];
  if (/pre[\s-]?seed/.test(t)) out.push('pre-seed');
  if (/\bseed\b/.test(t) && !/pre[\s-]?seed/.test(t)) out.push('seed');
  if (/series\s*a|\ba\b(?!\w)/.test(t)) out.push('a');
  if (/series\s*b/.test(t)) out.push('b');
  if (/series\s*c|series\s*d|growth|late/.test(t)) out.push('growth');
  return out;
}

export function useInvestorFit(
  company: Company | null,
  firms: InvestorRepositoryEntry[]
): InvestorFit[] {
  return useMemo(() => {
    if (!company) return [];

    // The company's round, read from wherever it was written down.
    const roundText = [company.dealTerms, company.pastFinancing].filter(Boolean).join(' ');
    const companyStages = normaliseStage(roundText);
    const vertical = (company.vertical || '').toLowerCase().trim();

    const scored = firms.map<InvestorFit>(firm => {
      const reasons: string[] = [];
      let score = 0;

      const alreadyInvested = (firm.portfolioCompanies || []).some(n => isSameCompany(n, company.name));

      // Vertical
      const firmVerticals = asList(firm.verticals);
      if (vertical && firmVerticals.some(v => v.includes(vertical) || vertical.includes(v))) {
        score += 40;
        reasons.push(`Invests in ${company.vertical}`);
      }

      // Stage
      const firmStages = asList(firm.investmentStage).flatMap(normaliseStage);
      const stageOverlap = companyStages.filter(s => firmStages.includes(s));
      if (stageOverlap.length > 0) {
        score += 35;
        reasons.push(`Writes at ${stageOverlap.join(', ')}`);
      }

      // Check size — only when both sides said something parseable.
      const firmCheck = parseCheckSize(firm.checkSize);
      const raiseCheck = parseCheckSize(roundText);
      if (firmCheck && raiseCheck && firmCheck.min <= raiseCheck.max) {
        score += 15;
        reasons.push(`Check size fits (${firm.checkSize})`);
      }

      // A firm already in an adjacent company knows the space.
      if (!alreadyInvested && vertical) {
        const adjacency = (firm.portfolioCompanies || []).length;
        if (adjacency > 0) score += Math.min(10, adjacency / 5);
      }

      if (alreadyInvested) reasons.unshift('Already an investor in this company');

      return { firm, score, reasons, alreadyInvested };
    });

    return scored
      .filter(f => f.score > 0 || f.alreadyInvested)
      .sort((a, b) => b.score - a.score);
  }, [company, firms]);
}

// ---------------------------------------------------------------------------

export interface StaleFirm {
  firm: InvestorRepositoryEntry;
  lastTouch: string | null;
  daysSince: number | null;
  /** 'note' is a real logged touch; 'edit' is only when the record was changed. */
  basis: 'note' | 'edit' | null;
}

/**
 * Best available "when did we last engage with this firm".
 *
 * Repository entries carry no interaction log, so this reads the two things
 * that do move when someone engages: dated profile notes, and lastModified.
 * lastModified is a weak proxy — editing a phone number bumps it — so a note
 * always wins when there is one, and the caller is told which was used.
 */
const latestTouch = (firm: InvestorRepositoryEntry): { at: string | null; from: 'note' | 'edit' | null } => {
  let newestNote: number | null = null;
  for (const note of firm.profileNotes || []) {
    const t = new Date(note.timestamp || '').getTime();
    // Excel-serial corruption put a lot of dates on 1970; those are not a
    // real last-touch and must not make a cold relationship look warm.
    if (!Number.isFinite(t) || new Date(t).getUTCFullYear() <= 1970) continue;
    if (newestNote === null || t > newestNote) newestNote = t;
  }
  if (newestNote !== null) return { at: new Date(newestNote).toISOString(), from: 'note' };

  const edited = new Date(firm.lastModified || '').getTime();
  if (Number.isFinite(edited) && new Date(edited).getUTCFullYear() > 1970) {
    return { at: new Date(edited).toISOString(), from: 'edit' };
  }
  return { at: null, from: null };
};

/**
 * Firms nobody has logged a conversation with lately, oldest first.
 *
 * Firms with no interaction history at all are included and sorted last,
 * flagged with a null date rather than pretended to be infinitely stale —
 * "we have never logged anything" is a different problem from "we have gone
 * quiet", and they need different follow-up.
 */
export function useStaleInvestors(
  firms: InvestorRepositoryEntry[],
  thresholdDays = 90
): StaleFirm[] {
  return useMemo(() => {
    const now = Date.now();
    const out: StaleFirm[] = [];

    for (const firm of firms) {
      const { at, from } = latestTouch(firm);
      if (!at) {
        out.push({ firm, lastTouch: null, daysSince: null, basis: null });
        continue;
      }
      const daysSince = Math.floor((now - new Date(at).getTime()) / 86400000);
      if (daysSince >= thresholdDays) out.push({ firm, lastTouch: at, daysSince, basis: from });
    }

    return out.sort((a, b) => {
      if (a.daysSince === null) return 1;
      if (b.daysSince === null) return -1;
      return b.daysSince - a.daysSince;
    });
  }, [firms, thresholdDays]);
}

// Re-exported so the many importers of this module keep working. The
// implementation lives in money.ts, next to parseMoney, because two money
// parsers in different files is how they came to disagree.
export { parseCheckSize };
