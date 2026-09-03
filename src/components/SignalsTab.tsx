import React, { useMemo, useState } from 'react';
import {
  Loader2, Radio, TrendingUp, Globe, UserMinus, PlusCircle, X, Check, ExternalLink,
} from 'lucide-react';
import { Company, Signal, SignalKind } from '../types';
import { useSignals } from '../hooks/useSignals';
import { cn } from '../utils';

/**
 * What changed, since last time somebody looked.
 *
 * Everything here is produced by a scheduled job comparing today against a
 * stored yesterday. None of it is answerable from the CRM's records alone,
 * because records hold current state and the previous value is gone — which
 * is the whole reason this feed exists.
 */

const KIND: Record<SignalKind, { label: string; icon: React.ReactNode; tone: string }> = {
  'sector-rotation': {
    label: 'Rotation',
    icon: <TrendingUp className="h-3.5 w-3.5" />,
    tone: 'bg-violet-50 text-violet-700 dark:bg-violet-500/10 dark:text-violet-300',
  },
  'person-moved': {
    label: 'Person moved',
    icon: <UserMinus className="h-3.5 w-3.5" />,
    tone: 'bg-amber-50 text-amber-700 dark:bg-amber-500/10 dark:text-amber-400',
  },
  'site-change': {
    label: 'Site change',
    icon: <Globe className="h-3.5 w-3.5" />,
    tone: 'bg-sky-50 text-sky-700 dark:bg-sky-500/10 dark:text-sky-300',
  },
  'portfolio-addition': {
    label: 'New position',
    icon: <PlusCircle className="h-3.5 w-3.5" />,
    tone: 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300',
  },
};

const dayLabel = (iso: string) => {
  const then = new Date(iso);
  const days = Math.floor((Date.now() - then.getTime()) / 86400000);
  if (days <= 0) return 'today';
  if (days === 1) return 'yesterday';
  if (days < 30) return `${days} days ago`;
  return then.toLocaleDateString();
};

export function SignalsTab({
  companies,
  onCompanyClick,
}: {
  companies: Company[];
  onCompanyClick?: (company: Company) => void;
}) {
  const { signals, isLoading, setStatus, unreadCount } = useSignals();
  const [showDismissed, setShowDismissed] = useState(false);

  const visible = useMemo(
    () => signals
      .filter(s => (showDismissed ? s.status === 'dismissed' : s.status !== 'dismissed'))
      // Weight first so a rotation is not buried under twenty routine
      // additions, then recency within the same weight.
      .sort((a, b) => (b.weight || 0) - (a.weight || 0) || b.occurredAt.localeCompare(a.occurredAt)),
    [signals, showDismissed]
  );

  const openCompany = (s: Signal) => {
    const match = companies.find(c => c.id === s.companyId)
      || companies.find(c => c.name.toLowerCase() === (s.companyName || '').toLowerCase());
    if (match && onCompanyClick) onCompanyClick(match);
  };

  return (
    <div className="flex h-full flex-col bg-slate-50 dark:bg-slate-950">
      <div className="border-b border-slate-200 bg-white px-8 py-6 dark:border-slate-800 dark:bg-slate-900">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold text-slate-900 dark:text-white">Signals</h1>
            <p className="mt-1 max-w-2xl text-sm text-slate-500 dark:text-slate-400">
              What changed since the last time we looked. Written by scheduled jobs comparing
              today against a stored yesterday — none of it is visible from the records alone.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setShowDismissed(false)}
              className={cn(
                'rounded-lg px-3 py-1.5 text-[13px] font-medium',
                !showDismissed ? 'bg-indigo-600 text-white' : 'text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800'
              )}
            >
              Open{unreadCount > 0 ? ` (${unreadCount} new)` : ''}
            </button>
            <button
              type="button"
              onClick={() => setShowDismissed(true)}
              className={cn(
                'rounded-lg px-3 py-1.5 text-[13px] font-medium',
                showDismissed ? 'bg-indigo-600 text-white' : 'text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800'
              )}
            >
              Dismissed
            </button>
          </div>
        </div>
      </div>

      <div className="flex-1 overflow-auto p-8">
        {isLoading ? (
          <div className="flex h-64 items-center justify-center">
            <Loader2 className="h-6 w-6 animate-spin text-slate-400" />
          </div>
        ) : visible.length === 0 ? (
          <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-slate-300 bg-white px-6 py-20 text-center dark:border-slate-700 dark:bg-slate-900/50">
            <Radio className="mb-3 h-8 w-8 text-slate-300 dark:text-slate-700" />
            <h3 className="text-[15px] font-medium text-slate-900 dark:text-white">
              {showDismissed ? 'Nothing dismissed' : 'Nothing yet'}
            </h3>
            <p className="mt-1 max-w-md text-[13px] text-slate-500 dark:text-slate-400">
              {showDismissed
                ? 'Signals you dismiss are kept here.'
                : 'The jobs take a baseline on their first run and report differences from the second onwards, so the first month is quiet by design.'}
            </p>
          </div>
        ) : (
          <div className="flex flex-col gap-2">
            {visible.map(s => {
              const kind = KIND[s.kind] || KIND['portfolio-addition'];
              const linkable = Boolean(onCompanyClick && (s.companyId || s.companyName));
              return (
                <div
                  key={s.id}
                  className={cn(
                    'flex items-start gap-4 rounded-xl border bg-white p-4 dark:bg-slate-900',
                    s.status === 'new'
                      ? 'border-slate-300 dark:border-slate-700'
                      : 'border-slate-200 dark:border-slate-800'
                  )}
                >
                  <span className={cn('mt-0.5 flex shrink-0 items-center gap-1.5 rounded px-2 py-1 text-[10.5px] font-semibold', kind.tone)}>
                    {kind.icon}
                    {kind.label}
                  </span>

                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-baseline gap-x-2.5 gap-y-1">
                      <h3 className="text-[14.5px] font-semibold text-slate-900 dark:text-white">
                        {s.headline}
                      </h3>
                      {s.status === 'new' && (
                        <span className="rounded bg-indigo-100 px-1.5 py-0.5 text-[9.5px] font-bold uppercase text-indigo-700 dark:bg-indigo-500/20 dark:text-indigo-300">
                          New
                        </span>
                      )}
                      <span className="text-[11.5px] text-slate-400">{dayLabel(s.occurredAt)}</span>
                    </div>

                    {s.detail && (
                      <p className="mt-1 whitespace-pre-line text-[13px] leading-relaxed text-slate-600 dark:text-slate-300">
                        {s.detail}
                      </p>
                    )}

                    <div className="mt-2 flex flex-wrap items-center gap-3 text-[12px]">
                      {linkable && (
                        <button
                          type="button"
                          onClick={() => openCompany(s)}
                          className="font-medium text-indigo-600 hover:underline dark:text-indigo-400"
                        >
                          Open {s.companyName}
                        </button>
                      )}
                      {s.sourceUrl && (
                        <a
                          href={s.sourceUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="flex items-center gap-1 text-slate-500 hover:text-indigo-600 dark:text-slate-400"
                        >
                          <ExternalLink className="h-3 w-3" /> Source
                        </a>
                      )}
                      {s.firmName && !linkable && (
                        <span className="text-slate-400">{s.firmName}</span>
                      )}
                    </div>
                  </div>

                  <div className="flex shrink-0 items-center gap-1">
                    {s.status === 'dismissed' ? (
                      <button
                        type="button"
                        onClick={() => setStatus(s.id, 'seen')}
                        className="rounded-md px-2.5 py-1.5 text-[12px] font-medium text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800"
                      >
                        Restore
                      </button>
                    ) : (
                      <>
                        {s.status === 'new' && (
                          <button
                            type="button"
                            onClick={() => setStatus(s.id, 'seen')}
                            title="Mark as read"
                            className="rounded-md p-1.5 text-slate-400 hover:bg-slate-100 hover:text-emerald-600 dark:hover:bg-slate-800"
                          >
                            <Check className="h-4 w-4" />
                          </button>
                        )}
                        <button
                          type="button"
                          onClick={() => setStatus(s.id, 'dismissed')}
                          title="Dismiss"
                          className="rounded-md p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700 dark:hover:bg-slate-800"
                        >
                          <X className="h-4 w-4" />
                        </button>
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
