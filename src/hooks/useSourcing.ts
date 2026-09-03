import { useState, useEffect, useCallback, useRef } from 'react';
import {
  collection, doc, onSnapshot, setDoc, updateDoc, deleteDoc, getDocs,
} from 'firebase/firestore';
import { db, handleFirestoreError, OperationType } from '../firebase';
import { apiFetch } from '../services/api';
import { SourcingCandidate, InvestorRepositoryEntry, Company } from '../types';
import { normaliseCompanyName, buildCompanyIndex } from '../companyMatch';

/**
 * Companies our investors have backed that we are not tracking.
 *
 * Two halves, deliberately separated because they cost very different things:
 *
 *   Discovery is free and deterministic — every portfolio list in the investor
 *   repository, minus everything already in the companies collection. It runs
 *   whenever the tab is open and the inputs change.
 *
 *   Research is a grounded model call plus a handful of page fetches, per
 *   company. It runs automatically, but strictly one at a time with a pause
 *   between: firing thirty at once would rate-limit and fail, so a queue is not
 *   a cost decision here so much as the only thing that actually works.
 */

/** Gap between research calls. Enough to stay clear of per-minute limits. */
const RESEARCH_GAP_MS = 1500;

/** Same derivation the contacts importer uses, so ids are stable across runs. */
async function idFor(nameKey: string): Promise<string> {
  const bytes = new TextEncoder().encode(nameKey);
  const digest = await crypto.subtle.digest('SHA-1', bytes);
  return Array.from(new Uint8Array(digest))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('')
    .slice(0, 20);
}

export function useSourcing(
  investors: InvestorRepositoryEntry[],
  companies: Company[],
  enabled: boolean
) {
  const [candidates, setCandidates] = useState<SourcingCandidate[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isDiscovering, setIsDiscovering] = useState(false);
  const [researchingId, setResearchingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // --- live list
  useEffect(() => {
    const unsub = onSnapshot(
      collection(db, 'sourcing'),
      snap => {
        setCandidates(snap.docs.map(d => ({ id: d.id, ...(d.data() as any) })));
        setIsLoading(false);
      },
      err => {
        handleFirestoreError(err, OperationType.LIST, 'sourcing');
        setIsLoading(false);
      }
    );
    return unsub;
  }, []);

  /**
   * Reconciles the sourcing list against the investor portfolios and the CRM.
   *
   * Adds portfolio companies we do not track, and clears out rows for
   * companies that have since been added to the CRM by any route — otherwise
   * a company someone entered by hand would sit in Sourcing forever, being
   * offered as new.
   */
  const discover = useCallback(async () => {
    if (!investors.length) return;
    setIsDiscovering(true);
    setError(null);
    try {
      const crmIndex = buildCompanyIndex(companies);

      // Every distinct portfolio name, with the firms that list it.
      const found = new Map<string, { name: string; firms: { id: string; firmName: string }[] }>();
      for (const firm of investors) {
        for (const raw of firm.portfolioCompanies || []) {
          const key = normaliseCompanyName(raw);
          if (!key) continue;
          if (crmIndex.has(key)) continue;              // already tracked
          const entry = found.get(key);
          if (entry) {
            if (!entry.firms.some(f => f.id === firm.id)) {
              entry.firms.push({ id: firm.id, firmName: firm.firmName });
            }
          } else {
            found.set(key, { name: raw.trim(), firms: [{ id: firm.id, firmName: firm.firmName }] });
          }
        }
      }

      const existing = await getDocs(collection(db, 'sourcing'));
      const byKey = new Map<string, SourcingCandidate>();
      for (const d of existing.docs) {
        const data = { id: d.id, ...(d.data() as any) } as SourcingCandidate;
        byKey.set(data.nameKey, data);
      }

      const writes: Promise<unknown>[] = [];

      for (const [key, { name, firms }] of found) {
        const current = byKey.get(key);
        if (!current) {
          const id = await idFor(key);
          writes.push(setDoc(doc(db, 'sourcing', id), {
            name,
            nameKey: key,
            sourceFirms: firms,
            status: 'active',
            researchState: 'pending',
            discoveredAt: new Date().toISOString(),
          }));
        } else if (JSON.stringify(current.sourceFirms || []) !== JSON.stringify(firms)) {
          // A second firm now lists it, which is itself a signal worth seeing.
          writes.push(updateDoc(doc(db, 'sourcing', current.id), { sourceFirms: firms }));
        }
      }

      // Rows whose company is now in the CRM have served their purpose.
      for (const [key, candidate] of byKey) {
        if (crmIndex.has(key)) writes.push(deleteDoc(doc(db, 'sourcing', candidate.id)));
      }

      await Promise.all(writes);
    } catch (err: any) {
      handleFirestoreError(err, OperationType.CREATE, 'sourcing');
      setError(err.message || 'Discovery failed.');
    } finally {
      setIsDiscovering(false);
    }
  }, [investors, companies]);

  /** Researches one candidate and writes what came back. */
  const research = useCallback(async (candidate: SourcingCandidate) => {
    setResearchingId(candidate.id);
    try {
      const response = await apiFetch('/api/enrich-company', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: candidate.name,
          viaFirm: candidate.sourceFirms?.[0]?.firmName,
        }),
      });
      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        throw new Error(body.error || `Server error: ${response.status}`);
      }
      const data = await response.json();

      const found = Boolean(data.website || data.description);
      await updateDoc(doc(db, 'sourcing', candidate.id), {
        website: data.website ?? null,
        description: data.description ?? null,
        founderName: data.founderName ?? null,
        founderEmail: data.founderEmail ?? null,
        contactEmails: data.contactEmails ?? [],
        emailSourceUrl: data.emailSourceUrl ?? null,
        location: data.location ?? null,
        vertical: data.vertical ?? null,
        yearFounded: data.yearFounded ?? null,
        lastRound: data.lastRound ?? null,
        researchState: 'done',
        researchedAt: new Date().toISOString(),
        researchNote: found ? null : 'Nothing solid found for this name.',
      });
    } catch (err: any) {
      const message = err.message || 'Unknown error';
      // Marked failed rather than left pending, so the queue moves on instead
      // of retrying the same company until the rate limit resets.
      await updateDoc(doc(db, 'sourcing', candidate.id), {
        researchState: 'failed',
        researchedAt: new Date().toISOString(),
        researchNote: /quota|429|exhausted/i.test(message)
          ? 'Rate limited. Retry when the quota resets.'
          : message,
      }).catch(() => {});
      setError(/quota|429|exhausted/i.test(message)
        ? 'Too many AI requests in a short time. Research paused; it will resume when you come back.'
        : `Research failed: ${message}`);
    } finally {
      setResearchingId(null);
    }
  }, []);

  // --- the queue. Runs only while the tab is open, one at a time.
  const busy = useRef(false);
  useEffect(() => {
    if (!enabled || busy.current) return;
    const next = candidates.find(c => c.status === 'active' && c.researchState === 'pending');
    if (!next) return;

    busy.current = true;
    let cancelled = false;

    const timer = setTimeout(async () => {
      if (cancelled) { busy.current = false; return; }
      try {
        await research(next);
      } finally {
        // Cleared only here. An earlier version also cleared it in the effect
        // cleanup, which runs on every Firestore snapshot — so a snapshot
        // arriving mid-call unlocked the queue and let a second research start
        // alongside the first, doubling the spend and racing on the same row.
        busy.current = false;
      }
    }, RESEARCH_GAP_MS);

    return () => { cancelled = true; clearTimeout(timer); };
  }, [enabled, candidates, research]);

  const pendingCount = candidates.filter(c => c.status === 'active' && c.researchState === 'pending').length;

  /** Hides a candidate without deleting it, so discovery cannot re-add it. */
  const dismiss = useCallback(async (id: string) => {
    try {
      await updateDoc(doc(db, 'sourcing', id), { status: 'dismissed' });
    } catch (err) {
      handleFirestoreError(err, OperationType.UPDATE, 'sourcing');
    }
  }, []);

  const restore = useCallback(async (id: string) => {
    try {
      await updateDoc(doc(db, 'sourcing', id), { status: 'active' });
    } catch (err) {
      handleFirestoreError(err, OperationType.UPDATE, 'sourcing');
    }
  }, []);

  const removeRow = useCallback(async (id: string) => {
    try {
      await deleteDoc(doc(db, 'sourcing', id));
    } catch (err) {
      handleFirestoreError(err, OperationType.DELETE, 'sourcing');
    }
  }, []);

  return {
    candidates,
    isLoading,
    isDiscovering,
    researchingId,
    pendingCount,
    error,
    setError,
    discover,
    research,
    dismiss,
    restore,
    removeRow,
  };
}
