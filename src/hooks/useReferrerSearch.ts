import { useState, useEffect, useRef } from 'react';
import { collection, query, where, orderBy, limit, getDocs } from 'firebase/firestore';
import { db, handleFirestoreError, OperationType } from '../firebase';
import { Contact, Referrer } from '../types';

/**
 * Searches referrers by name: the 8,000+ imported contacts, plus the firms in
 * the investor repository and the people listed under them.
 *
 * Contacts are queried server-side with a prefix match and a hard limit, so
 * typing never downloads the directory. Investor firms are few enough to keep
 * in memory and match locally.
 */

const RESULT_LIMIT = 8;
const DEBOUNCE_MS = 200;

export interface InvestorFirmLite {
  id: string;
  firmName: string;
  contacts?: { name?: string; email?: string }[];
}

export function useReferrerSearch(term: string, investorFirms: InvestorFirmLite[] = []) {
  const [results, setResults] = useState<Referrer[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const requestId = useRef(0);

  useEffect(() => {
    const q = term.trim().toLowerCase();
    if (q.length < 2) {
      setResults([]);
      setIsSearching(false);
      return;
    }

    setIsSearching(true);
    const id = ++requestId.current;

    const timer = setTimeout(async () => {
      // --- investor firms and their people, matched in memory (there are few)
      const local: Referrer[] = [];
      for (const firm of investorFirms) {
        if ((firm.firmName || '').toLowerCase().includes(q)) {
          local.push({ id: `firm:${firm.id}`, name: firm.firmName, kind: 'investorFirm' });
        }
        for (const person of firm.contacts || []) {
          if ((person.name || '').toLowerCase().includes(q)) {
            local.push({
              id: `firmContact:${firm.id}:${person.name}`,
              name: person.name || '',
              kind: 'investorContact',
              email: person.email,
              firmName: firm.firmName,
            });
          }
        }
      }

      // --- contacts, matched by prefix in Firestore with a limit
      let fromContacts: Referrer[] = [];
      try {
        const snap = await getDocs(
          query(
            collection(db, 'contacts'),
            orderBy('nameLower'),
            where('nameLower', '>=', q),
            // \uf8ff is a very high code point, so this is a prefix match:
            // every name starting with what has been typed.
            where('nameLower', '<=', q + '\uf8ff'),
            limit(RESULT_LIMIT)
          )
        );
        fromContacts = snap.docs.map(d => {
          const c = d.data() as Contact;
          return {
            id: `contact:${d.id}`,
            name: c.name,
            kind: 'contact' as const,
            email: c.emails && c.emails.length ? c.emails[0] : undefined,
          };
        });
      } catch (err) {
        handleFirestoreError(err, OperationType.LIST, 'contacts');
      }

      if (id !== requestId.current) return; // a newer keystroke won
      setResults([...local, ...fromContacts].slice(0, RESULT_LIMIT + local.length));
      setIsSearching(false);
    }, DEBOUNCE_MS);

    return () => clearTimeout(timer);
  }, [term, investorFirms]);

  return { results, isSearching };
}
