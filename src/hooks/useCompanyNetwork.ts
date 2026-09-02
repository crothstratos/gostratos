import { useMemo } from 'react';
import { Company, InvestorRepositoryEntry, Referrer } from '../types';
import { isSameCompany } from '../companyMatch';

/**
 * Everyone connected to one company, and how.
 *
 * Four questions a partner actually asks about a deal, answered off data the
 * CRM already holds rather than anything new anyone has to type:
 *
 *   Who already backs this company?   -> investors
 *   How do we get introduced?         -> introPaths
 *   Who else should see this deal?    -> see useInvestorFit
 *
 * All of it is derived, never stored. A stored answer goes stale the moment
 * someone edits a portfolio list; a derived one cannot.
 */

export interface CompanyInvestor {
  firm: InvestorRepositoryEntry;
  /** People at the firm, if any are recorded. */
  people: { name: string; role?: string; email?: string }[];
}

export type IntroPathKind = 'referrer' | 'investorContact' | 'investorFirm' | 'coInvestor';

export interface IntroPath {
  kind: IntroPathKind;
  /** Who to ask. */
  via: string;
  /** What makes them a route in. */
  because: string;
  /** Lower is a shorter path. Used for ordering. */
  strength: number;
  email?: string;
  firmId?: string;
}

export interface CompanyNetwork {
  investors: CompanyInvestor[];
  introPaths: IntroPath[];
  /** Companies in the CRM that share at least one investor with this one. */
  coPortfolio: { company: Company; sharedFirms: string[] }[];
}

export function useCompanyNetwork(
  company: Company | null,
  investorFirms: InvestorRepositoryEntry[],
  companies: Company[]
): CompanyNetwork {
  return useMemo(() => {
    const empty: CompanyNetwork = { investors: [], introPaths: [], coPortfolio: [] };
    if (!company) return empty;

    // --- which firms list this company in their portfolio
    const investors: CompanyInvestor[] = [];
    for (const firm of investorFirms) {
      const holds = (firm.portfolioCompanies || []).some(n => isSameCompany(n, company.name));
      if (!holds) continue;
      investors.push({
        firm,
        people: (firm.contacts || []).map(c => ({ name: c.name, role: c.role, email: c.email })),
      });
    }

    // --- routes in, most direct first
    const paths: IntroPath[] = [];

    // 1. Someone already told us about this company. Shortest path there is.
    for (const r of (company.referrers || []) as Referrer[]) {
      paths.push({
        kind: 'referrer',
        via: r.name,
        because: 'Referred this company to us',
        strength: 0,
        email: r.email,
      });
    }

    // 2. A named person at a firm that already backs them.
    for (const { firm, people } of investors) {
      for (const person of people) {
        if (!person.name) continue;
        paths.push({
          kind: 'investorContact',
          via: person.name,
          because: `${person.role ? person.role + ' at ' : 'At '}${firm.firmName}, which is an investor`,
          strength: 1,
          email: person.email || undefined,
          firmId: firm.id,
        });
      }
      // 3. The firm itself, when we have no named contact there.
      if (people.length === 0) {
        paths.push({
          kind: 'investorFirm',
          via: firm.firmName,
          because: 'Backs this company; no named contact on file yet',
          strength: 2,
          firmId: firm.id,
        });
      }
    }

    // 4. A firm we know that backs a company in the same space. Weakest, but
    //    it is the path people forget they have.
    const backerIds = new Set(investors.map(i => i.firm.id));
    if (company.vertical) {
      for (const firm of investorFirms) {
        if (backerIds.has(firm.id)) continue;
        const overlap = (firm.portfolioCompanies || []).filter(name => {
          const match = companies.find(c => isSameCompany(c.name, name));
          return match && match.id !== company.id && match.vertical === company.vertical;
        });
        if (overlap.length === 0) continue;
        paths.push({
          kind: 'coInvestor',
          via: firm.firmName,
          because: `Invests in ${company.vertical} — holds ${overlap.slice(0, 3).join(', ')}${overlap.length > 3 ? ` +${overlap.length - 3}` : ''}`,
          strength: 3,
          firmId: firm.id,
        });
      }
    }

    // --- companies we track that share a backer with this one
    const coPortfolio: { company: Company; sharedFirms: string[] }[] = [];
    if (investors.length > 0) {
      const byCompanyId = new Map<string, { company: Company; sharedFirms: string[] }>();
      for (const { firm } of investors) {
        for (const name of firm.portfolioCompanies || []) {
          if (isSameCompany(name, company.name)) continue;
          const match = companies.find(c => isSameCompany(c.name, name));
          if (!match) continue;
          const existing = byCompanyId.get(match.id);
          if (existing) existing.sharedFirms.push(firm.firmName);
          else byCompanyId.set(match.id, { company: match, sharedFirms: [firm.firmName] });
        }
      }
      coPortfolio.push(...byCompanyId.values());
      coPortfolio.sort((a, b) => b.sharedFirms.length - a.sharedFirms.length);
    }

    paths.sort((a, b) => a.strength - b.strength || a.via.localeCompare(b.via));

    return { investors, introPaths: paths, coPortfolio };
  }, [company, investorFirms, companies]);
}
