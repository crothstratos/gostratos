import React, { useState, useRef, useEffect } from 'react';
import { X, Search, Building2, User, UserPlus, Loader2 } from 'lucide-react';
import { Referrer } from '../types';
import { useReferrerSearch, InvestorFirmLite } from '../hooks/useReferrerSearch';
import { useAddContact } from '../hooks/useAddContact';
import { cn } from '../utils';

/**
 * Multi-select for who referred a company. Searches the imported contacts
 * directory and the investor repository, and holds any number of referrers.
 *
 * Sits alongside the free-text External Source field rather than replacing it.
 */
export function ReferrerSelect({
  value,
  onChange,
  investorFirms = [],
  onPersonClick,
}: {
  value: Referrer[];
  onChange: (next: Referrer[]) => void;
  investorFirms?: InvestorFirmLite[];
  /**
   * Opens a person's profile. Only contacts have one — firms and the people
   * listed under them live inside investor_repository, not the directory, so
   * there is no document to open. Their chips stay plain text.
   */
  onPersonClick?: (contactId: string) => void;
}) {
  const [term, setTerm] = useState('');
  const [isOpen, setIsOpen] = useState(false);
  const [highlight, setHighlight] = useState(0);
  const boxRef = useRef<HTMLDivElement>(null);

  const { results, isSearching } = useReferrerSearch(term, investorFirms);
  const { addContact, isSaving } = useAddContact();
  const [isAdding, setIsAdding] = useState(false);
  const [draftEmail, setDraftEmail] = useState('');
  const [draftFirm, setDraftFirm] = useState('');
  const selectedIds = new Set(value.map(v => v.id));
  const available = results.filter(r => !selectedIds.has(r.id));

  useEffect(() => { setHighlight(0); setIsAdding(false); setDraftEmail(''); setDraftFirm(''); }, [term]);

  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setIsOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, []);

  const add = (r: Referrer) => {
    onChange([...value, r]);
    setTerm('');
    setHighlight(0);
  };

  const remove = (id: string) => onChange(value.filter(v => v.id !== id));

  /**
   * Creates the person in the directory and selects them in one go. If the name
   * is already there under a different spelling of case or spacing, addContact
   * returns the existing record rather than making a second one.
   */
  const createAndAdd = async () => {
    const created = await addContact({ name: term, email: draftEmail, affiliation: draftFirm });
    if (!created) return;
    if (selectedIds.has(`contact:${created.id}`)) { setTerm(''); setIsAdding(false); return; }
    add({
      id: `contact:${created.id}`,
      name: created.name,
      kind: 'contact',
      email: created.emails && created.emails.length ? created.emails[0] : undefined,
      firmName: created.affiliation,
    });
    setIsAdding(false);
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); setHighlight(h => Math.min(h + 1, available.length - 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setHighlight(h => Math.max(h - 1, 0)); }
    else if (e.key === 'Enter' && available[highlight]) { e.preventDefault(); add(available[highlight]); }
    else if (e.key === 'Escape') { if (isAdding) setIsAdding(false); else setIsOpen(false); }
    else if (e.key === 'Backspace' && term === '' && value.length) { remove(value[value.length - 1].id); }
  };

  const icon = (kind: Referrer['kind']) =>
    kind === 'investorFirm'
      ? <Building2 className="h-3.5 w-3.5 shrink-0 text-slate-400" />
      : <User className="h-3.5 w-3.5 shrink-0 text-slate-400" />;

  return (
    <div className="relative" ref={boxRef}>
      {value.length > 0 && (
        <div className="mb-2 flex flex-wrap gap-1.5">
          {value.map(r => {
            // `contact:<docId>` is the only kind backed by a contacts document.
            const contactId = onPersonClick && r.kind === 'contact' && r.id.startsWith('contact:')
              ? r.id.slice('contact:'.length)
              : null;
            return (
            <span
              key={r.id}
              className="inline-flex items-center gap-1.5 rounded-md border border-indigo-200 bg-indigo-50 py-1 pl-2 pr-1 text-[12.5px] font-medium text-indigo-700 dark:border-indigo-500/30 dark:bg-indigo-500/10 dark:text-indigo-300"
              title={[r.email, r.firmName].filter(Boolean).join(' · ')}
            >
              {contactId ? (
                <button
                  type="button"
                  onClick={() => onPersonClick!(contactId)}
                  className="inline-flex items-center gap-1.5 rounded underline-offset-2 hover:underline focus:outline-none focus:ring-1 focus:ring-indigo-500"
                >
                  {icon(r.kind)}
                  {r.name}
                </button>
              ) : (
                <>
                  {icon(r.kind)}
                  {r.name}
                </>
              )}
              <button
                type="button"
                onClick={() => remove(r.id)}
                aria-label={`Remove ${r.name}`}
                className="rounded p-0.5 hover:bg-indigo-100 dark:hover:bg-indigo-500/20"
              >
                <X className="h-3 w-3" />
              </button>
            </span>
            );
          })}
        </div>
      )}

      <div className="relative">
        <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
        <input
          type="text"
          value={term}
          onChange={e => { setTerm(e.target.value); setIsOpen(true); }}
          onFocus={() => setIsOpen(true)}
          onKeyDown={onKeyDown}
          placeholder="Type a name to find a contact or firm..."
          className="w-full rounded-lg border border-slate-200 bg-white py-2 pl-8 pr-3 text-[13.5px] text-slate-900 placeholder:text-slate-400 focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500 dark:border-slate-700 dark:bg-slate-800 dark:text-white"
        />
      </div>

      {isOpen && term.trim().length >= 2 && (
        <div className="absolute z-50 mt-1 max-h-72 w-full overflow-y-auto rounded-lg border border-slate-200 bg-white p-1 shadow-xl dark:border-slate-700 dark:bg-slate-900">
          {isSearching && available.length === 0 && (
            <div className="px-3 py-2 text-[12.5px] text-slate-400">Searching...</div>
          )}
          {!isSearching && available.length === 0 && !isAdding && (
            <div className="px-3 py-2 text-[12.5px] text-slate-400">
              No match for "{term}".
            </div>
          )}

          {!isAdding && available.map((r, i) => (
            <button
              key={r.id}
              type="button"
              onMouseEnter={() => setHighlight(i)}
              onClick={() => add(r)}
              className={cn(
                'flex w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-left transition-colors',
                i === highlight ? 'bg-slate-100 dark:bg-slate-800' : ''
              )}
            >
              {icon(r.kind)}
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[13px] font-medium text-slate-900 dark:text-white">{r.name}</span>
                {(r.email || r.firmName) && (
                  <span className="block truncate text-[11.5px] text-slate-400">
                    {[r.firmName, r.email].filter(Boolean).join(' · ')}
                  </span>
                )}
              </span>
              {r.kind === 'investorFirm' && (
                <span className="shrink-0 rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-medium text-slate-500 dark:bg-slate-800 dark:text-slate-400">
                  Firm
                </span>
              )}
            </button>
          ))}

          {isAdding ? (
            <div className="space-y-2 p-2">
              <div className="text-[12.5px] font-medium text-slate-900 dark:text-white">
                Add {term.trim()}
              </div>
              <input
                type="email"
                autoFocus
                value={draftEmail}
                onChange={e => setDraftEmail(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); createAndAdd(); } }}
                placeholder="Email (optional)"
                className="w-full rounded-md border border-slate-200 bg-white px-2.5 py-1.5 text-[12.5px] text-slate-900 placeholder:text-slate-400 focus:border-indigo-500 focus:outline-none dark:border-slate-700 dark:bg-slate-800 dark:text-white"
              />
              <input
                type="text"
                value={draftFirm}
                onChange={e => setDraftFirm(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); createAndAdd(); } }}
                placeholder="Who they're with (optional)"
                className="w-full rounded-md border border-slate-200 bg-white px-2.5 py-1.5 text-[12.5px] text-slate-900 placeholder:text-slate-400 focus:border-indigo-500 focus:outline-none dark:border-slate-700 dark:bg-slate-800 dark:text-white"
              />
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={createAndAdd}
                  disabled={isSaving}
                  className="inline-flex items-center gap-1.5 rounded-md bg-indigo-600 px-2.5 py-1.5 text-[12.5px] font-medium text-white hover:bg-indigo-700 disabled:opacity-60"
                >
                  {isSaving && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                  Add person
                </button>
                <button
                  type="button"
                  onClick={() => setIsAdding(false)}
                  className="rounded-md px-2.5 py-1.5 text-[12.5px] font-medium text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800"
                >
                  Cancel
                </button>
              </div>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => setIsAdding(true)}
              className="mt-0.5 flex w-full items-center gap-2 rounded-md border-t border-slate-100 px-2.5 py-2 text-left text-[12.5px] font-medium text-indigo-600 hover:bg-indigo-50/60 dark:border-slate-800 dark:text-indigo-400 dark:hover:bg-indigo-500/10"
            >
              <UserPlus className="h-3.5 w-3.5 shrink-0" />
              Add "{term.trim()}" as a new person
            </button>
          )}
        </div>
      )}
    </div>
  );
}
