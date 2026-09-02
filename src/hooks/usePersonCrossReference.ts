import { useState, useEffect } from 'react';
import { collection, query, where, getDocs, limit } from 'firebase/firestore';
import { db, handleFirestoreError, OperationType } from '../firebase';
import { Contact, Company, InvestorRepositoryEntry } from '../types';

/**
 * The same human, wherever else the CRM already knows them.
 *
 * People arrive from several directions — imported in a contacts CSV, typed
 * onto a firm, found by a website scan, named as a referrer — and nothing
 * joined those up, so one person could exist four times without anyone
 * noticing. This looks for the other copies.
 *
 * Email is the strong signal and is checked first: two records with the same
 * address are the same person. Name is the weak one, used only as a fallback,
 * and it is reported as a possible match rather than asserted, because two
 * people really can be called David Chen.
 */

export interface CrossReference {
  /** Directory contacts that look like this person. */
  contacts: Contact[];
  /** Other firms in the repository listing someone by this name. */
  otherFirms: { firm: InvestorRepositoryEntry; role?: string; email?: string }[];
  /** Companies this person referred, if a directory contact matched. */
  referredCompanies: Company[];
  /** True when at least one link was found by email rather than by name. */
  matchedOnEmail: boolean;
  isLoading: boolean;
}

const EMPTY: CrossReference = {
  contacts: [],
  otherFirms: [],
  referredCompanies: [],
  matchedOnEmail: false,
  isLoading: false,
};

const norm = (s: string) => (s || '').toLowerCase().replace(/\s+/g, ' ').trim();

export function usePersonCrossReference(
  person: { name: string; email?: string } | null,
  /** Firms to search, excluding the one being viewed. */
  firms: InvestorRepositoryEntry[],
  excludeFirmId?: string
): CrossReference {
  const [state, setState] = useState<CrossReference>(EMPTY);

  useEffect(() => {
    if (!person || !person.name) { setState(EMPTY); return; }

    let cancelled = false;
    setState({ ...EMPTY, isLoading: true });

    (async () => {
      const nameKey = norm(person.name);
      const emailKey = (person.email || '').toLowerCase().trim();

      // --- other firms: in memory, there are few of them
      const otherFirms: CrossReference['otherFirms'] = [];
      for (const firm of firms) {
        if (firm.id === excludeFirmId) continue;
        for (const contact of firm.contacts || []) {
          const sameEmail = emailKey && (contact.email || '').toLowerCase().trim() === emailKey;
          const sameName = norm(contact.name) === nameKey;
          if (sameEmail || sameName) {
            otherFirms.push({ firm, role: contact.role, email: contact.email });
            break;
          }
        }
      }

      // --- directory contacts
      let contacts: Contact[] = [];
      let matchedOnEmail = false;
      try {
        if (emailKey) {
          const byEmail = await getDocs(
            query(collection(db, 'contacts'), where('emails', 'array-contains', emailKey), limit(10))
          );
          contacts = byEmail.docs.map(d => ({ id: d.id, ...(d.data() as any) }));
          matchedOnEmail = contacts.length > 0;
        }
        if (contacts.length === 0) {
          const byName = await getDocs(
            query(collection(db, 'contacts'), where('nameLower', '==', nameKey), limit(10))
          );
          contacts = byName.docs.map(d => ({ id: d.id, ...(d.data() as any) }));
        }
      } catch (err) {
        handleFirestoreError(err, OperationType.LIST, 'contacts');
      }

      // --- what those contacts referred
      let referredCompanies: Company[] = [];
      try {
        if (contacts.length > 0) {
          const snap = await getDocs(
            query(
              collection(db, 'companies'),
              where('referrerIds', 'array-contains', `contact:${contacts[0].id}`),
              limit(25)
            )
          );
          referredCompanies = snap.docs.map(d => ({ id: d.id, ...(d.data() as any) }));
        }
      } catch (err) {
        handleFirestoreError(err, OperationType.LIST, 'companies');
      }

      if (cancelled) return;
      setState({ contacts, otherFirms, referredCompanies, matchedOnEmail, isLoading: false });
    })();

    return () => { cancelled = true; };
  }, [person?.name, person?.email, firms, excludeFirmId]);

  return state;
}
