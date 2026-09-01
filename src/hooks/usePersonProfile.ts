import { useState, useEffect } from 'react';
import { collection, query, where, getDocs, doc, getDoc, limit } from 'firebase/firestore';
import { db, handleFirestoreError, OperationType } from '../firebase';
import { Contact, Company } from '../types';

/**
 * Everything the CRM knows about one person, assembled from what is already
 * stored — no new data entry required.
 *
 * Three sources of affiliation:
 *   1. Companies they referred      — companies where referrerIds contains them
 *   2. Investor firms they belong to — the contacts nested in investor_repository
 *   3. Companies they founded        — founderEmail matching one of their addresses
 *
 * The third is best-effort: founderEmail is free text, so it only matches when
 * the address was entered exactly. Shown as such rather than presented as
 * complete.
 */

export interface Affiliation {
  kind: 'referred' | 'founded' | 'investorFirm';
  id: string;
  name: string;
  detail?: string;
}

export interface PersonProfile {
  contact: Contact | null;
  referredCompanies: Company[];
  foundedCompanies: Company[];
  investorFirms: { id: string; firmName: string; role?: string }[];
  isLoading: boolean;
  error: string | null;
}

const EMPTY: PersonProfile = {
  contact: null,
  referredCompanies: [],
  foundedCompanies: [],
  investorFirms: [],
  isLoading: false,
  error: null,
};

export function usePersonProfile(contactId: string | null): PersonProfile {
  const [state, setState] = useState<PersonProfile>(EMPTY);

  useEffect(() => {
    if (!contactId) { setState(EMPTY); return; }

    let cancelled = false;
    setState({ ...EMPTY, isLoading: true });

    (async () => {
      try {
        const snap = await getDoc(doc(db, 'contacts', contactId));
        if (!snap.exists()) {
          if (!cancelled) setState({ ...EMPTY, error: 'That person is no longer in the directory.' });
          return;
        }
        const contact = { id: snap.id, ...(snap.data() as any) } as Contact;
        const emails = (contact.emails || []).map(e => e.toLowerCase()).filter(Boolean);

        // 1. Referred — the reverse lookup the flat id array exists for.
        const referredSnap = await getDocs(
          query(collection(db, 'companies'), where('referrerIds', 'array-contains', `contact:${contactId}`), limit(50))
        );
        const referredCompanies = referredSnap.docs.map(d => ({ id: d.id, ...(d.data() as any) })) as Company[];

        // 2. Founded — best effort, exact match on each known address.
        const founded = new Map<string, Company>();
        for (const email of emails.slice(0, 5)) {
          const s = await getDocs(
            query(collection(db, 'companies'), where('founderEmail', '==', email), limit(20))
          );
          s.docs.forEach(d => founded.set(d.id, { id: d.id, ...(d.data() as any) } as Company));
        }

        // 3. Investor firms — only ten of them, so scanning is cheaper than indexing.
        const firmsSnap = await getDocs(collection(db, 'investor_repository'));
        const investorFirms: { id: string; firmName: string; role?: string }[] = [];
        for (const d of firmsSnap.docs) {
          const data: any = d.data();
          const match = (data.contacts || []).find((c: any) =>
            (c?.email && emails.includes(String(c.email).toLowerCase())) ||
            (c?.name && contact.name && String(c.name).trim().toLowerCase() === contact.name.trim().toLowerCase())
          );
          if (match) investorFirms.push({ id: d.id, firmName: data.firmName || '(unnamed firm)', role: match.role });
        }

        if (!cancelled) {
          setState({
            contact,
            referredCompanies,
            foundedCompanies: [...founded.values()],
            investorFirms,
            isLoading: false,
            error: null,
          });
        }
      } catch (err) {
        handleFirestoreError(err, OperationType.GET, 'contacts');
        if (!cancelled) setState({ ...EMPTY, error: 'Could not load this person.' });
      }
    })();

    return () => { cancelled = true; };
  }, [contactId]);

  return state;
}
