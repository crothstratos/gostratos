import React, { useState, useEffect, useRef } from 'react';
import { collection, query, where, orderBy, limit, getDocs } from 'firebase/firestore';
import { db, handleFirestoreError, OperationType } from '../firebase';
import { Contact, Company } from '../types';
import { PersonProfile } from './PersonProfile';
import { Search, User, Mail, MapPin, Loader2 } from 'lucide-react';

/**
 * Search the people directory and open anyone's profile.
 *
 * The query is a server-side prefix match with a limit — typing never pulls
 * the 8,383-record directory into the browser.
 */
export function PeopleTab({ onCompanyClick }: { onCompanyClick?: (company: Company) => void }) {
  const [term, setTerm] = useState('');
  const [results, setResults] = useState<Contact[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);
  const requestId = useRef(0);

  useEffect(() => {
    const q = term.trim().toLowerCase();
    if (q.length < 2) { setResults([]); setIsSearching(false); return; }

    setIsSearching(true);
    const id = ++requestId.current;

    const timer = setTimeout(async () => {
      try {
        const snap = await getDocs(
          query(
            collection(db, 'contacts'),
            orderBy('nameLower'),
            where('nameLower', '>=', q),
            // \uf8ff is a very high code point, so this is a prefix match:
            // every name starting with what has been typed. Written as an
            // escape, not a literal, because the raw character is invisible.
            where('nameLower', '<=', q + '\uf8ff'),
            limit(40)
          )
        );
        if (id !== requestId.current) return;
        setResults(snap.docs.map(d => ({ id: d.id, ...(d.data() as any) })) as Contact[]);
      } catch (err) {
        handleFirestoreError(err, OperationType.LIST, 'contacts');
      } finally {
        if (id === requestId.current) setIsSearching(false);
      }
    }, 200);

    return () => clearTimeout(timer);
  }, [term]);

  return (
    <div className="flex h-full flex-col gap-4">
      <div className="border-b border-slate-200 pb-3 dark:border-slate-800">
        <div className="relative max-w-md">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <input
            autoFocus
            value={term}
            onChange={e => setTerm(e.target.value)}
            placeholder="Search people by name..."
            className="w-full rounded-lg border border-slate-200 bg-white py-2 pl-9 pr-3 text-[14px] text-slate-900 placeholder:text-slate-400 focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500 dark:border-slate-700 dark:bg-slate-900 dark:text-white"
          />
        </div>
        <p className="mt-2 text-[12px] text-slate-400">
          8,383 people. Search by first or last name, then open anyone to see what they're connected to.
        </p>
      </div>

      <div className="flex-1 overflow-y-auto">
        {term.trim().length < 2 ? (
          <div className="rounded-xl border border-dashed border-slate-200 px-4 py-16 text-center dark:border-slate-800">
            <User className="mx-auto h-6 w-6 text-slate-300 dark:text-slate-700" />
            <p className="mt-3 text-[13.5px] text-slate-500 dark:text-slate-400">Type at least two letters to search</p>
          </div>
        ) : isSearching && results.length === 0 ? (
          <div className="flex items-center justify-center gap-2 py-16 text-[13px] text-slate-400">
            <Loader2 className="h-4 w-4 animate-spin" /> Searching…
          </div>
        ) : results.length === 0 ? (
          <div className="rounded-xl border border-dashed border-slate-200 px-4 py-16 text-center dark:border-slate-800">
            <p className="text-[13.5px] text-slate-500 dark:text-slate-400">Nobody matches "{term}"</p>
            <p className="mt-1 text-[12px] text-slate-400">Search matches the start of a name, not the middle.</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 xl:grid-cols-3">
            {results.map(c => (
              <button
                key={c.id}
                onClick={() => setOpenId(c.id)}
                className="flex flex-col rounded-lg border border-slate-200 bg-white px-3.5 py-3 text-left transition-all hover:-translate-y-px hover:border-indigo-300 hover:shadow-md dark:border-slate-800 dark:bg-slate-900 dark:hover:border-indigo-500/40"
              >
                <span className="truncate text-[13.5px] font-semibold text-slate-900 dark:text-white">{c.name}</span>
                {c.emails && c.emails.length > 0 && (
                  <span className="mt-1 flex items-center gap-1.5 truncate text-[11.5px] text-slate-400">
                    <Mail className="h-3 w-3 shrink-0" />
                    <span className="truncate">{c.emails[0]}</span>
                    {c.emails.length > 1 && (
                      <span className="shrink-0 rounded bg-slate-100 px-1 text-[10px] text-slate-500 dark:bg-slate-800 dark:text-slate-400">
                        +{c.emails.length - 1}
                      </span>
                    )}
                  </span>
                )}
                {(c.city || c.state) && (
                  <span className="mt-0.5 flex items-center gap-1.5 truncate text-[11.5px] text-slate-400">
                    <MapPin className="h-3 w-3 shrink-0" />
                    {[c.city, c.state].filter(Boolean).join(', ')}
                  </span>
                )}
              </button>
            ))}
          </div>
        )}
      </div>

      {openId && (
        <PersonProfile
          contactId={openId}
          onClose={() => setOpenId(null)}
          onCompanyClick={onCompanyClick ? (c) => { setOpenId(null); onCompanyClick(c); } : undefined}
        />
      )}
    </div>
  );
}
