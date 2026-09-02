import React from 'react';
import { Building2, Users, Share2, Handshake, ArrowUpRight, Target } from 'lucide-react';
import { Company, InvestorRepositoryEntry } from '../types';
import { useCompanyNetwork, IntroPathKind } from '../hooks/useCompanyNetwork';
import { useInvestorFit } from '../hooks/useInvestorFit';
import { cn } from '../utils';

/**
 * The company's side of the graph: who backs it, how we reach it, who else we
 * track that shares a backer, and which of our firms should see the deal.
 *
 * Everything here is derived from the investor repository and the company
 * list. Nothing on this panel is a field anyone fills in, which is what makes
 * it worth having — it stays true as the underlying records change.
 */

const PATH_STYLE: Record<IntroPathKind, { label: string; icon: React.ReactNode; tone: string }> = {
  referrer: {
    label: 'Referred us',
    icon: <Handshake className="h-3.5 w-3.5" />,
    tone: 'bg-emerald-50 text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-400',
  },
  investorContact: {
    label: 'Investor contact',
    icon: <Users className="h-3.5 w-3.5" />,
    tone: 'bg-indigo-50 text-indigo-700 dark:bg-indigo-500/10 dark:text-indigo-400',
  },
  investorFirm: {
    label: 'Investor firm',
    icon: <Building2 className="h-3.5 w-3.5" />,
    tone: 'bg-indigo-50 text-indigo-700 dark:bg-indigo-500/10 dark:text-indigo-400',
  },
  coInvestor: {
    label: 'Same space',
    icon: <Share2 className="h-3.5 w-3.5" />,
    tone: 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300',
  },
};

function Section({
  icon, title, count, hint, children,
}: {
  icon: React.ReactNode;
  title: string;
  count: number;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <div className="mb-2 flex items-center gap-2">
        {icon}
        <h4 className="text-[12.5px] font-semibold tracking-tight text-slate-800 dark:text-slate-100">{title}</h4>
        <span className="font-mono text-[11.5px] tabular-nums text-slate-400">{count}</span>
      </div>
      {hint && <p className="mb-2 text-[11.5px] text-slate-400">{hint}</p>}
      <div className="flex flex-col gap-1.5">{children}</div>
    </div>
  );
}

export function CompanyNetworkPanel({
  company,
  investorFirms,
  companies,
  onCompanyClick,
}: {
  company: Company;
  investorFirms: InvestorRepositoryEntry[];
  companies: Company[];
  onCompanyClick?: (company: Company) => void;
}) {
  const { investors, introPaths, coPortfolio } = useCompanyNetwork(company, investorFirms, companies);
  const fit = useInvestorFit(company, investorFirms);
  const prospects = fit.filter(f => !f.alreadyInvested).slice(0, 6);

  const nothing =
    investors.length === 0 && introPaths.length === 0 && coPortfolio.length === 0 && prospects.length === 0;

  if (nothing) {
    return (
      <div className="rounded-xl border border-dashed border-slate-200 px-4 py-10 text-center dark:border-slate-800">
        <Share2 className="mx-auto h-5 w-5 text-slate-300 dark:text-slate-700" />
        <p className="mt-2.5 text-[13px] text-slate-500 dark:text-slate-400">
          No connections found yet for {company.name}.
        </p>
        <p className="mt-1 text-[11.5px] text-slate-400">
          This fills in as investor portfolios and referrers are recorded — nothing to enter here directly.
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      {investors.length > 0 && (
        <Section
          icon={<Building2 className="h-4 w-4 text-indigo-500" />}
          title="Investors in this company"
          count={investors.length}
          hint="Firms in your repository that list this company in their portfolio."
        >
          {investors.map(({ firm, people }) => (
            <div
              key={firm.id}
              className="rounded-lg border border-slate-200 bg-white px-3 py-2.5 dark:border-slate-800 dark:bg-slate-900"
            >
              <div className="flex items-center gap-2">
                <span className="text-[13.5px] font-medium text-slate-900 dark:text-white">{firm.firmName}</span>
                {firm.isLead && (
                  <span className="rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-bold uppercase text-amber-700 dark:bg-amber-500/20 dark:text-amber-400">
                    Lead
                  </span>
                )}
              </div>
              {people.length > 0 && (
                <p className="mt-0.5 truncate text-[11.5px] text-slate-400">
                  {people.map(p => (p.role ? `${p.name} (${p.role})` : p.name)).join(' · ')}
                </p>
              )}
            </div>
          ))}
        </Section>
      )}

      {introPaths.length > 0 && (
        <Section
          icon={<Handshake className="h-4 w-4 text-emerald-500" />}
          title="Ways in"
          count={introPaths.length}
          hint="Ordered by how direct the route is. The top one is your best ask."
        >
          {introPaths.slice(0, 12).map((path, i) => {
            const style = PATH_STYLE[path.kind];
            return (
              <div
                key={`${path.kind}-${path.via}-${i}`}
                className="flex items-center gap-3 rounded-lg border border-slate-200 bg-white px-3 py-2 dark:border-slate-800 dark:bg-slate-900"
              >
                <span className={cn('flex shrink-0 items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-semibold', style.tone)}>
                  {style.icon}
                  {style.label}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[13px] font-medium text-slate-900 dark:text-white">{path.via}</span>
                  <span className="block truncate text-[11.5px] text-slate-400">{path.because}</span>
                </span>
                {path.email && (
                  <a
                    href={`mailto:${path.email}`}
                    className="shrink-0 text-[11.5px] font-medium text-indigo-600 hover:underline dark:text-indigo-400"
                  >
                    Email
                  </a>
                )}
              </div>
            );
          })}
        </Section>
      )}

      {prospects.length > 0 && (
        <Section
          icon={<Target className="h-4 w-4 text-violet-500" />}
          title="Investors who may fit this deal"
          count={prospects.length}
          hint="Ranked on stage, check size and vertical from your repository. Reasons shown so you can disagree."
        >
          {prospects.map(({ firm, reasons, score }) => (
            <div
              key={firm.id}
              className="flex items-center gap-3 rounded-lg border border-slate-200 bg-white px-3 py-2 dark:border-slate-800 dark:bg-slate-900"
            >
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[13px] font-medium text-slate-900 dark:text-white">{firm.firmName}</span>
                <span className="block truncate text-[11.5px] text-slate-400">
                  {reasons.length ? reasons.join(' · ') : 'Adjacent portfolio'}
                </span>
              </span>
              <span className="shrink-0 font-mono text-[11.5px] tabular-nums text-slate-400">{Math.round(score)}</span>
            </div>
          ))}
        </Section>
      )}

      {coPortfolio.length > 0 && (
        <Section
          icon={<Share2 className="h-4 w-4 text-slate-400" />}
          title="Shares an investor with"
          count={coPortfolio.length}
          hint="Other companies you track that have a backer in common."
        >
          {coPortfolio.slice(0, 10).map(({ company: other, sharedFirms }) => (
            <button
              key={other.id}
              type="button"
              onClick={() => onCompanyClick && onCompanyClick(other)}
              disabled={!onCompanyClick}
              className={cn(
                'flex w-full items-center gap-3 rounded-lg border border-slate-200 bg-white px-3 py-2 text-left dark:border-slate-800 dark:bg-slate-900',
                onCompanyClick && 'transition-colors hover:border-indigo-300 hover:bg-indigo-50/40 dark:hover:border-indigo-500/40'
              )}
            >
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[13px] font-medium text-slate-900 dark:text-white">{other.name}</span>
                <span className="block truncate text-[11.5px] text-slate-400">via {sharedFirms.join(', ')}</span>
              </span>
              {onCompanyClick && <ArrowUpRight className="h-3.5 w-3.5 shrink-0 text-slate-300" />}
            </button>
          ))}
        </Section>
      )}
    </div>
  );
}
