import React from 'react';
import { Users, Loader2, Plus, Check, Globe, Sparkles, Mail } from 'lucide-react';
import { InvestorRepositoryEntry, CoInvestorSuggestion } from '../types';
import { useFirmCoInvestors } from '../hooks/useFirmCoInvestors';

/**
 * Firms this one has actually invested alongside, each as a card you can judge
 * without leaving the page.
 *
 * Every card names the deals both firms were in. That is the point: a
 * recommendation with its evidence attached can be checked in ten seconds,
 * and one without it is just a name someone has to go research from scratch.
 */
export function CoInvestorPanel({
  firm,
  allFirms,
  onAdd,
}: {
  firm: Partial<InvestorRepositoryEntry>;
  allFirms: InvestorRepositoryEntry[];
  /** Adds a recommended firm to the repository as a new entry. */
  onAdd?: (suggestion: CoInvestorSuggestion) => void;
}) {
  const { results, discover, isSearching, error, hasRun, diagnostics } = useFirmCoInvestors();
  const [added, setAdded] = React.useState<Set<string>>(new Set());

  const run = () =>
    discover({
      firmName: firm.firmName || '',
      website: firm.website,
      portfolioCompanies: firm.portfolioCompanies || [],
      knownFirms: allFirms.map(f => f.firmName),
    });

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <h3 className="text-lg font-medium text-slate-900 dark:text-white">Who they invest alongside</h3>
        <button
          type="button"
          onClick={run}
          disabled={!firm.firmName || isSearching}
          className="ml-auto flex items-center gap-2 rounded-lg bg-indigo-50 px-3 py-2 text-sm font-medium text-indigo-600 transition-colors hover:bg-indigo-100 disabled:opacity-50 dark:bg-indigo-900/30 dark:text-indigo-400 dark:hover:bg-indigo-900/50"
        >
          {isSearching ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles size={16} />}
          {isSearching ? 'Researching…' : hasRun ? 'Research again' : 'Find co-investors'}
        </button>
      </div>

      <p className="text-[12.5px] text-slate-500 dark:text-slate-400">
        Looks at the rounds {firm.firmName || 'this firm'} has participated in and reports who else was on
        those cap tables. Every suggestion names the shared deals, so you can check it.
      </p>

      {error && (
        <p className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-700 dark:border-amber-800/50 dark:bg-amber-900/20 dark:text-amber-400">
          {error}
        </p>
      )}

      {isSearching && results.length === 0 && (
        <div className="rounded-xl border border-dashed border-slate-200 px-4 py-12 text-center dark:border-slate-800">
          <Loader2 className="mx-auto h-5 w-5 animate-spin text-slate-400" />
          <p className="mt-2.5 text-[13px] text-slate-500 dark:text-slate-400">
            Searching funding rounds. This takes a few seconds.
          </p>
        </div>
      )}

      {!isSearching && hasRun && results.length === 0 && (
        <div className="rounded-xl border border-dashed border-slate-200 px-4 py-12 text-center dark:border-slate-800">
          <p className="text-[13px] text-slate-500 dark:text-slate-400">
            {diagnostics && diagnostics.returned > 0
              ? `Found ${diagnostics.returned} possible ${diagnostics.returned === 1 ? 'firm' : 'firms'}, but none named a deal they shared with ${firm.firmName || 'this firm'}.`
              : 'No co-investors found.'}
          </p>
          <p className="mt-1 text-[11.5px] text-slate-400">
            {diagnostics && diagnostics.returned > 0
              ? 'Firms without a specific round in common are left out on purpose — a firm that merely looks similar is not a warm introduction. Recording more of this firm\u2019s portfolio gives the search real rounds to work from.'
              : 'Recording more of this firm\u2019s portfolio companies gives the search something to work from.'}
          </p>
        </div>
      )}

      {!isSearching && !hasRun && (
        <div className="rounded-xl border border-dashed border-slate-200 px-4 py-12 text-center dark:border-slate-800">
          <Users className="mx-auto h-5 w-5 text-slate-300 dark:text-slate-700" />
          <p className="mt-2.5 text-[13px] text-slate-500 dark:text-slate-400">
            Not researched yet.
          </p>
        </div>
      )}

      {results.length > 0 && (
        <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
          {results.map(c => {
            const isAdded = added.has(c.firmName);
            return (
              <div
                key={c.firmName}
                className="flex flex-col rounded-xl border border-violet-200 bg-white p-4 dark:border-violet-500/25 dark:bg-slate-900"
              >
                <div className="mb-1.5 flex items-start gap-2">
                  <h4 className="flex-1 text-[14px] font-semibold text-slate-900 dark:text-white">{c.firmName}</h4>
                  {c.alreadyInRepository ? (
                    <span className="shrink-0 rounded bg-indigo-100 px-1.5 py-0.5 text-[10px] font-bold uppercase text-indigo-600 dark:bg-indigo-900/50 dark:text-indigo-400">
                      In repo
                    </span>
                  ) : isAdded ? (
                    <span className="flex shrink-0 items-center gap-1 rounded bg-emerald-100 px-1.5 py-0.5 text-[10px] font-bold uppercase text-emerald-700 dark:bg-emerald-500/20 dark:text-emerald-400">
                      <Check size={10} /> Added
                    </span>
                  ) : onAdd ? (
                    <button
                      type="button"
                      onClick={() => { onAdd(c); setAdded(prev => new Set(prev).add(c.firmName)); }}
                      className="flex shrink-0 items-center gap-1 rounded-md bg-emerald-50 px-2 py-1 text-[11.5px] font-semibold text-emerald-700 hover:bg-emerald-100 dark:bg-emerald-500/10 dark:text-emerald-400"
                    >
                      <Plus size={12} /> Add
                    </button>
                  ) : null}
                </div>

                {c.description && (
                  <p className="mb-2.5 line-clamp-4 text-[12px] leading-relaxed text-slate-600 dark:text-slate-300">
                    {c.description}
                  </p>
                )}

                <dl className="mb-2.5 grid grid-cols-2 gap-x-3 gap-y-1 text-[11.5px]">
                  {c.stages && (
                    <><dt className="text-slate-400">Stage</dt><dd className="text-slate-700 dark:text-slate-200">{c.stages}</dd></>
                  )}
                  {c.checkSize && (
                    <><dt className="text-slate-400">Check</dt><dd className="text-slate-700 dark:text-slate-200">{c.checkSize}</dd></>
                  )}
                  {c.sectors && (
                    <><dt className="text-slate-400">Sectors</dt><dd className="text-slate-700 dark:text-slate-200">{c.sectors}</dd></>
                  )}
                </dl>

                <div className="mt-auto border-t border-slate-100 pt-2.5 dark:border-slate-800">
                  <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">
                    Shared deals ({c.sharedDeals.length})
                  </p>
                  <p className="mt-0.5 text-[12px] text-slate-700 dark:text-slate-200">
                    {c.sharedDeals.join(', ')}
                  </p>

                  <div className="mt-2 flex flex-col gap-1">
                    {c.website && (
                      <a
                        href={c.website}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1.5 text-[11.5px] font-medium text-indigo-600 hover:underline dark:text-indigo-400"
                      >
                        {/*
                          Truncated rather than wrapped. A field fed by a model
                          has no length it is guaranteed to respect, and this
                          one once arrived with four hundred citation markers
                          on the end and filled the whole card.
                        */}
                        <Globe size={12} className="shrink-0" />
                        <span className="truncate">{c.website.replace(/^https?:\/\//, '')}</span>
                      </a>
                    )}

                    {(c.emails || []).map(email => (
                      <a
                        key={email}
                        href={`mailto:${email}`}
                        title="Read from the firm's own homepage"
                        className="inline-flex items-center gap-1.5 text-[11.5px] text-slate-600 hover:text-indigo-600 dark:text-slate-300"
                      >
                        <Mail size={12} className="shrink-0 text-slate-400" />
                        <span className="truncate">{email}</span>
                      </a>
                    ))}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
