import React, { useMemo, useState } from 'react';
import {
  Sparkles, Loader2, Globe, Mail, MapPin, Building2, ArrowRight, X,
  RotateCcw, Search, Compass, AlertTriangle, Trash2,
} from 'lucide-react';
import { Company, InvestorRepositoryEntry, SourcingCandidate, Stage } from '../types';
import { useSourcing } from '../hooks/useSourcing';
import { useInvestors } from '../hooks/useInvestors';
import { cn } from '../utils';
import { v4 as uuidv4 } from 'uuid';

/**
 * Deal flow we already have and were not looking at.
 *
 * Every company an investor in the repository has backed but that the CRM does
 * not track. Discovery is arithmetic — portfolio lists minus our companies —
 * so this list is right by construction and gets better as investor portfolios
 * are filled in. The research on each row is softer and is labelled as such.
 */

type Filter = 'active' | 'dismissed';

export function SourcingTab({
  companies,
  onAddCompany,
}: {
  companies: Company[];
  onAddCompany: (company: Company) => void | Promise<void>;
}) {
  // Subscribed here rather than in App: this is the only consumer, the tab is
  // lazy-loaded, and most sessions never open it.
  const { investors } = useInvestors();
  const {
    candidates, isLoading, isDiscovering, researchingId, pendingCount,
    error, setError, discover, research, dismiss, restore, removeRow,
  } = useSourcing(investors, companies, true);

  const [filter, setFilter] = useState<Filter>('active');
  const [query, setQuery] = useState('');
  const [movingId, setMovingId] = useState<string | null>(null);

  // Reconcile whenever the inputs change. Free, and it means a company added
  // to the CRM by hand disappears from here without anyone pressing anything.
  const signature = useMemo(
    () => `${investors.length}:${investors.map(i => (i.portfolioCompanies || []).length).join(',')}:${companies.length}`,
    [investors, companies]
  );
  React.useEffect(() => {
    if (investors.length) discover();
    // Keyed on the shape of the inputs rather than their identity, which
    // changes on every Firestore snapshot and would loop.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [signature]);

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return candidates
      .filter(c => (filter === 'active' ? c.status !== 'dismissed' : c.status === 'dismissed'))
      .filter(c => !q
        || c.name.toLowerCase().includes(q)
        || (c.description || '').toLowerCase().includes(q)
        || (c.sourceFirms || []).some(f => f.firmName.toLowerCase().includes(q)))
      .sort((a, b) => {
        // Companies more than one of our investors backed come first: two
        // firms independently is a stronger signal than one.
        const firms = (b.sourceFirms?.length || 0) - (a.sourceFirms?.length || 0);
        if (firms !== 0) return firms;
        return a.name.localeCompare(b.name);
      });
  }, [candidates, filter, query]);

  const activeCount = candidates.filter(c => c.status !== 'dismissed').length;
  const dismissedCount = candidates.filter(c => c.status === 'dismissed').length;

  /** Creates the company in Initial Review and drops the sourcing row. */
  const moveToReview = async (c: SourcingCandidate) => {
    setMovingId(c.id);
    try {
      const now = new Date().toISOString();
      const company: Company = {
        id: uuidv4(),
        name: c.name,
        stage: 'Initial Review' as Stage,
        website: c.website || '',
        basics: [
          c.description,
          c.lastRound ? `Last reported round: ${c.lastRound}.` : '',
          `Sourced from the portfolio of ${(c.sourceFirms || []).map(f => f.firmName).join(', ')}.`,
          // Carried as a note rather than into founderEmail, which would
          // assert that info@ belongs to the founder.
          c.alternateEmail ? `Alternate email found on their site: ${c.alternateEmail}.` : '',
        ].filter(Boolean).join(' '),
        founderName: c.founderName || '',
        founderEmail: c.founderEmail || '',
        yearFounded: c.yearFounded || '',
        source: '',
        externalSource: (c.sourceFirms || []).map(f => f.firmName).join(', '),
        marketProblem: '',
        companySolution: '',
        competition: '',
        pricing: '',
        gtm: '',
        revenue: '',
        dealTerms: '',
        pastFinancing: c.lastRound || '',
        lastModified: now,
        stageHistory: [{ stage: 'Initial Review', date: now } as any],
      } as Company;

      await onAddCompany(company);
      // Removed rather than flagged: the company now exists in the CRM, so
      // discovery would exclude it anyway, and a promoted row left behind is
      // one more thing to scroll past.
      await removeRow(c.id);
    } finally {
      setMovingId(null);
    }
  };

  const firmChips = (c: SourcingCandidate) => (
    <div className="flex flex-wrap gap-1">
      {(c.sourceFirms || []).map(f => (
        <span
          key={f.id}
          className="inline-flex items-center gap-1 rounded bg-indigo-50 px-1.5 py-0.5 text-[10.5px] font-medium text-indigo-700 dark:bg-indigo-500/10 dark:text-indigo-300"
        >
          <Building2 className="h-2.5 w-2.5" />
          {f.firmName}
        </span>
      ))}
    </div>
  );

  return (
    <div className="flex h-full flex-col bg-slate-50 dark:bg-slate-950">
      <div className="border-b border-slate-200 bg-white px-8 py-6 dark:border-slate-800 dark:bg-slate-900">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold text-slate-900 dark:text-white">Sourcing</h1>
            <p className="mt-1 max-w-2xl text-sm text-slate-500 dark:text-slate-400">
              Companies your investors have backed that aren't in the CRM. Found by comparing every
              portfolio list against your pipeline, then researched automatically.
            </p>
          </div>

          <div className="flex items-center gap-3">
            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
              <input
                value={query}
                onChange={e => setQuery(e.target.value)}
                placeholder="Search companies or firms..."
                className="w-64 rounded-lg border border-slate-200 bg-slate-50 py-2 pl-9 pr-3 text-sm outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 dark:border-slate-700 dark:bg-slate-800 dark:text-white"
              />
            </div>
            <button
              type="button"
              onClick={discover}
              disabled={isDiscovering}
              className="flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-600 hover:bg-slate-50 disabled:opacity-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300"
            >
              {isDiscovering ? <Loader2 className="h-4 w-4 animate-spin" /> : <RotateCcw size={15} />}
              Refresh
            </button>
          </div>
        </div>

        <div className="mt-4 flex flex-wrap items-center gap-2">
          {(['active', 'dismissed'] as Filter[]).map(f => (
            <button
              key={f}
              type="button"
              onClick={() => setFilter(f)}
              className={cn(
                'rounded-lg px-3 py-1.5 text-[13px] font-medium transition-colors',
                filter === f
                  ? 'bg-indigo-600 text-white'
                  : 'text-slate-500 hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-800'
              )}
            >
              {f === 'active' ? `To review (${activeCount})` : `Dismissed (${dismissedCount})`}
            </button>
          ))}

          {pendingCount > 0 && (
            <span className="ml-auto flex items-center gap-2 text-[12.5px] text-slate-500 dark:text-slate-400">
              <Loader2 className="h-3.5 w-3.5 animate-spin text-indigo-500" />
              Researching — {pendingCount} to go. Stays running while this tab is open.
            </span>
          )}
        </div>

        {error && (
          <div className="mt-3 flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 dark:border-amber-800/40 dark:bg-amber-900/15">
            <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-600" />
            <p className="flex-1 text-[12.5px] text-amber-800 dark:text-amber-400">{error}</p>
            <button onClick={() => setError(null)} className="text-amber-600 hover:text-amber-800">
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        )}
      </div>

      <div className="flex-1 overflow-auto p-8">
        {isLoading ? (
          <div className="flex h-64 items-center justify-center">
            <Loader2 className="h-6 w-6 animate-spin text-slate-400" />
          </div>
        ) : visible.length === 0 ? (
          <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-slate-300 bg-white px-6 py-20 text-center dark:border-slate-700 dark:bg-slate-900/50">
            <Compass className="mb-3 h-8 w-8 text-slate-300 dark:text-slate-700" />
            <h3 className="text-[15px] font-medium text-slate-900 dark:text-white">
              {filter === 'dismissed' ? 'Nothing dismissed' : 'Nothing to review'}
            </h3>
            <p className="mt-1 max-w-md text-[13px] text-slate-500 dark:text-slate-400">
              {filter === 'dismissed'
                ? 'Companies you dismiss are kept here so they are not offered again.'
                : investors.length === 0
                  ? 'No investors in the repository yet — this list is built from their portfolios.'
                  : 'Every company in your investors’ portfolios is already in the CRM. Recording more portfolio companies on a firm will surface more here.'}
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-3 xl:grid-cols-2">
            {visible.map(c => {
              const isResearching = researchingId === c.id;
              const isMoving = movingId === c.id;
              return (
                <div
                  key={c.id}
                  className="flex flex-col rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900"
                >
                  <div className="mb-2 flex items-start gap-3">
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <h3 className="text-[15px] font-semibold text-slate-900 dark:text-white">{c.name}</h3>
                        {(c.sourceFirms?.length || 0) > 1 && (
                          <span className="rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-bold uppercase text-amber-700 dark:bg-amber-500/20 dark:text-amber-400">
                            {c.sourceFirms.length} investors
                          </span>
                        )}
                      </div>
                      <div className="mt-1.5">{firmChips(c)}</div>
                    </div>
                  </div>

                  {isResearching ? (
                    <p className="flex items-center gap-2 py-2 text-[12.5px] text-slate-400">
                      <Loader2 className="h-3.5 w-3.5 animate-spin" /> Researching…
                    </p>
                  ) : c.description ? (
                    <p className="mb-3 text-[12.5px] leading-relaxed text-slate-600 dark:text-slate-300">
                      {c.description}
                    </p>
                  ) : c.researchState === 'pending' ? (
                    <p className="mb-3 text-[12.5px] italic text-slate-400">Queued for research.</p>
                  ) : (
                    <p className="mb-3 text-[12.5px] italic text-slate-400">
                      {c.researchNote || 'No description found.'}
                    </p>
                  )}

                  <div className="mb-3 flex flex-col gap-1.5 text-[12px]">
                    {c.website && (
                      <a
                        href={c.website.startsWith('http') ? c.website : `https://${c.website}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="flex items-center gap-2 text-indigo-600 hover:underline dark:text-indigo-400"
                      >
                        <Globe className="h-3.5 w-3.5 shrink-0 text-slate-400" />
                        <span className="truncate">{c.website.replace(/^https?:\/\//, '')}</span>
                      </a>
                    )}

                    {/*
                      Two separate claims, shown separately. The founder badge
                      says an address names them; the alternate says only that
                      it was printed on their site. Collapsing the two would
                      turn info@ into someone's personal address on sight.
                    */}
                    {c.founderEmail && (
                      <div className="flex items-center gap-2 text-slate-600 dark:text-slate-300">
                        <Mail className="h-3.5 w-3.5 shrink-0 text-slate-400" />
                        <a href={`mailto:${c.founderEmail}`} className="truncate hover:text-indigo-600">
                          {c.founderEmail}
                        </a>
                        <span
                          title={c.emailSourceUrl ? `Printed on ${c.emailSourceUrl}` : 'Found on the company site'}
                          className="shrink-0 rounded bg-emerald-100 px-1.5 py-0.5 text-[9.5px] font-bold uppercase text-emerald-700 dark:bg-emerald-500/20 dark:text-emerald-400"
                        >
                          Founder
                        </span>
                      </div>
                    )}

                    {c.alternateEmail && (
                      <div className="flex items-center gap-2 text-slate-600 dark:text-slate-300">
                        <Mail className="h-3.5 w-3.5 shrink-0 text-slate-400" />
                        <a href={`mailto:${c.alternateEmail}`} className="truncate hover:text-indigo-600">
                          {c.alternateEmail}
                        </a>
                        <span
                          title={
                            c.alternateEmailSourceUrl
                              ? `Printed on ${c.alternateEmailSourceUrl}. An address for the company, not attributed to a person.`
                              : 'An address for the company, not attributed to a person.'
                          }
                          className="shrink-0 rounded bg-slate-100 px-1.5 py-0.5 text-[9.5px] font-bold uppercase text-slate-500 dark:bg-slate-800 dark:text-slate-400"
                        >
                          Alternate
                        </span>
                        {(c.contactEmails?.length || 0) > (c.founderEmail ? 2 : 1) && (
                          <span
                            title={c.contactEmails!.join('\n')}
                            className="shrink-0 cursor-help text-[10.5px] text-slate-400"
                          >
                            +{c.contactEmails!.length - (c.founderEmail ? 2 : 1)} more
                          </span>
                        )}
                      </div>
                    )}

                    {(c.founderName || c.location || c.vertical || c.yearFounded) && (
                      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-slate-500 dark:text-slate-400">
                        {c.founderName && <span>{c.founderName}</span>}
                        {c.location && (
                          <span className="flex items-center gap-1">
                            <MapPin className="h-3 w-3" />{c.location}
                          </span>
                        )}
                        {c.vertical && <span>{c.vertical}</span>}
                        {c.yearFounded && <span>Founded {c.yearFounded}</span>}
                      </div>
                    )}
                  </div>

                  <div className="mt-auto flex items-center gap-2 border-t border-slate-100 pt-3 dark:border-slate-800">
                    {c.status === 'dismissed' ? (
                      <>
                        <button
                          type="button"
                          onClick={() => restore(c.id)}
                          className="flex items-center gap-1.5 rounded-md bg-slate-100 px-2.5 py-1.5 text-[12px] font-medium text-slate-700 hover:bg-slate-200 dark:bg-slate-800 dark:text-slate-300"
                        >
                          <RotateCcw size={13} /> Restore
                        </button>
                        <button
                          type="button"
                          onClick={() => removeRow(c.id)}
                          title="Delete permanently. Discovery may find it again."
                          className="ml-auto rounded-md p-1.5 text-slate-400 hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-900/20"
                        >
                          <Trash2 size={14} />
                        </button>
                      </>
                    ) : (
                      <>
                        <button
                          type="button"
                          onClick={() => moveToReview(c)}
                          disabled={isMoving}
                          className="flex items-center gap-1.5 rounded-md bg-indigo-600 px-2.5 py-1.5 text-[12px] font-semibold text-white hover:bg-indigo-700 disabled:opacity-60"
                        >
                          {isMoving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <ArrowRight size={13} />}
                          Move to Initial Review
                        </button>
                        <button
                          type="button"
                          onClick={() => dismiss(c.id)}
                          className="rounded-md px-2.5 py-1.5 text-[12px] font-medium text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800"
                        >
                          Dismiss
                        </button>
                        {c.researchState !== 'pending' && (
                          <button
                            type="button"
                            onClick={() => research(c)}
                            disabled={isResearching}
                            title="Research this company again"
                            className="ml-auto rounded-md p-1.5 text-slate-400 hover:bg-slate-100 hover:text-indigo-600 disabled:opacity-50 dark:hover:bg-slate-800"
                          >
                            <Sparkles size={14} />
                          </button>
                        )}
                      </>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
