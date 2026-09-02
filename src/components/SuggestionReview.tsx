import React from 'react';
import { Sparkles, Check, X, ExternalLink, Loader2 } from 'lucide-react';
import { cn } from '../utils';

/**
 * The review lane: things a scan believes are true, waiting for someone to say
 * whether they are.
 *
 * The design rule is that a suggestion never looks like a record. It sits in
 * its own panel, wears an AI badge, and cannot be mistaken for the data below
 * it. Accepting is one click; so is dismissing, and a dismissal is remembered
 * so the next scan does not propose the same wrong thing again.
 */

export interface SuggestionRowProps {
  primary: string;
  secondary?: string;
  link?: string;
  /** Where this came from. 'website' is verified against fetched page text. */
  source?: 'website' | 'search';
  sourceUrl?: string;
  onAccept: () => void;
  onDismiss: () => void;
}

function Row({ primary, secondary, link, source, sourceUrl, onAccept, onDismiss }: SuggestionRowProps) {
  return (
    <div className="flex items-center gap-3 rounded-lg border border-violet-200 bg-white px-3 py-2 dark:border-violet-500/25 dark:bg-slate-900">
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5">
          <span className="truncate text-[13.5px] font-medium text-slate-900 dark:text-white">{primary}</span>
          {source === 'website' && (
            <a
              href={sourceUrl || undefined}
              target="_blank"
              rel="noopener noreferrer"
              onClick={e => e.stopPropagation()}
              title={sourceUrl ? `Named on ${sourceUrl}` : "Named on the firm's own site"}
              className="shrink-0 rounded bg-emerald-100 px-1.5 py-0.5 text-[10px] font-bold uppercase text-emerald-700 dark:bg-emerald-500/20 dark:text-emerald-400"
            >
              On site
            </a>
          )}
          {source === 'search' && (
            <span
              title="From web search, not the firm's own site. Worth a second look."
              className="shrink-0 rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-bold uppercase text-slate-500 dark:bg-slate-800 dark:text-slate-400"
            >
              Search
            </span>
          )}
          {link && (
            <a
              href={link}
              target="_blank"
              rel="noopener noreferrer"
              onClick={e => e.stopPropagation()}
              className="shrink-0 text-slate-400 hover:text-indigo-600"
              aria-label={`Open ${primary} link`}
            >
              <ExternalLink className="h-3 w-3" />
            </a>
          )}
        </div>
        {secondary && (
          <span className="block truncate text-[11.5px] text-slate-400">{secondary}</span>
        )}
      </div>
      <div className="flex shrink-0 items-center gap-1">
        <button
          type="button"
          onClick={onAccept}
          title="Add to the record"
          className="flex items-center gap-1 rounded-md bg-emerald-50 px-2 py-1 text-[11.5px] font-semibold text-emerald-700 hover:bg-emerald-100 dark:bg-emerald-500/10 dark:text-emerald-400 dark:hover:bg-emerald-500/20"
        >
          <Check className="h-3.5 w-3.5" /> Add
        </button>
        <button
          type="button"
          onClick={onDismiss}
          title="Not correct — don't suggest again"
          className="rounded-md p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700 dark:hover:bg-slate-800"
          aria-label={`Dismiss ${primary}`}
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>
    </div>
  );
}

export function SuggestionPanel({
  title,
  count,
  isScanning,
  scannedAt,
  foundNothing,
  onRescan,
  onAcceptAll,
  children,
}: {
  title: string;
  count: number;
  isScanning?: boolean;
  scannedAt?: string;
  foundNothing?: boolean;
  onRescan?: () => void;
  onAcceptAll?: () => void;
  children?: React.ReactNode;
}) {
  const showBody = isScanning || count > 0;

  return (
    <div
      className={cn(
        'rounded-xl border p-4',
        showBody
          ? 'border-violet-200 bg-violet-50/50 dark:border-violet-500/25 dark:bg-violet-500/[0.06]'
          : 'border-slate-200 bg-slate-50/60 dark:border-slate-800 dark:bg-slate-900/40'
      )}
    >
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <Sparkles className={cn('h-4 w-4', showBody ? 'text-violet-500' : 'text-slate-400')} />
        <h4 className="text-[13px] font-semibold tracking-tight text-slate-900 dark:text-white">{title}</h4>
        {count > 0 && (
          <span className="rounded-full bg-violet-100 px-2 py-0.5 text-[11px] font-bold text-violet-700 dark:bg-violet-500/20 dark:text-violet-300">
            {count}
          </span>
        )}
        <span className="ml-auto flex items-center gap-2">
          {count > 1 && onAcceptAll && (
            <button
              type="button"
              onClick={onAcceptAll}
              className="rounded-md px-2 py-1 text-[11.5px] font-medium text-emerald-700 hover:bg-emerald-50 dark:text-emerald-400 dark:hover:bg-emerald-500/10"
            >
              Add all {count}
            </button>
          )}
          {onRescan && (
            <button
              type="button"
              onClick={onRescan}
              disabled={isScanning}
              className="flex items-center gap-1.5 rounded-md px-2 py-1 text-[11.5px] font-medium text-slate-500 hover:bg-slate-100 disabled:opacity-50 dark:hover:bg-slate-800"
            >
              {isScanning ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />}
              {isScanning ? 'Researching…' : scannedAt ? 'Research again' : 'Research this firm'}
            </button>
          )}
        </span>
      </div>

      {isScanning && count === 0 && (
        <p className="text-[12.5px] text-slate-500 dark:text-slate-400">
          Searching the web for this firm. This takes a few seconds.
        </p>
      )}

      {!isScanning && count === 0 && (
        <p className="text-[12.5px] text-slate-500 dark:text-slate-400">
          {foundNothing
            ? 'Nothing found that was solid enough to suggest. Anything already on the record below is untouched.'
            : scannedAt
              ? 'Nothing waiting for review.'
              : 'Not researched yet.'}
        </p>
      )}

      {count > 0 && (
        <>
          <p className="mb-2.5 text-[11.5px] text-slate-500 dark:text-slate-400">
            Found by AI, not verified. Add what's right; dismiss the rest and it won't be suggested again.
          </p>
          <div className="flex flex-col gap-1.5">{children}</div>
        </>
      )}

      {scannedAt && !isScanning && (
        <p className="mt-3 text-[11px] text-slate-400">
          Last researched {new Date(scannedAt).toLocaleDateString()}
        </p>
      )}
    </div>
  );
}

export const SuggestionRow = Row;
