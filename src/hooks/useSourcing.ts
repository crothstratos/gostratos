import { useState, useEffect, useCallback, useRef } from 'react';
import {
  collection, doc, onSnapshot, setDoc, updateDoc, deleteDoc, getDocs, writeBatch,
} from 'firebase/firestore';
import { db, handleFirestoreError, OperationType } from '../firebase';
import { apiFetch } from '../services/api';
import { SourcingCandidate, InvestorRepositoryEntry, Company } from '../types';
import { normaliseCompanyName, buildCompanyIndex } from '../companyMatch';
import { recordPerson } from '../peopleDirectory';

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

/**
 * Gap between research calls.
 *
 * Was 1500ms, which is about seven hundred grounded searches an hour for as
 * long as the tab is open. Nothing stopped it, and a tab left open for an
 * afternoon is the most likely explanation for a bill nobody authorised. The
 * server now refuses over the allowance, but the gap is also widened: the
 * queue is worked through over hours rather than minutes, which is the right
 * pace for something that runs unattended and spends money.
 */
const RESEARCH_GAP_MS = 20_000;

/** How often the idle loop looks for newly discovered work. */
const IDLE_POLL_MS = 30_000;

/**
 * How many companies one open tab will research before it stops.
 *
 * The loop used to run for as long as the tab was open, which meant its cost
 * was set by how long somebody left a browser window open — not a decision
 * anybody made. After this many it stops and waits to be asked, which turns an
 * unbounded background spend into a bounded one.
 */
const MAX_PER_SESSION = 25;

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
  /** Why automatic research stopped, when it has. Shown in the tab. */
  const [pausedReason, setPausedReason] = useState<string | null>(null);

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

      /**
       * Work out every write first, then commit them in batches.
       *
       * This used to build an array of individual setDoc/updateDoc promises
       * and hand the lot to Promise.all. With a few dozen candidates that is
       * fine. With a few thousand -- which is what an investor repository
       * full of auto-discovered firms produces -- it opens a few thousand
       * concurrent Firestore writes from a browser tab, and the tab stops
       * responding. That is the freeze.
       *
       * Batched commits are also atomic per chunk, so a failure halfway
       * through leaves whole batches applied rather than an arbitrary subset.
       */
      type Op =
        | { kind: 'set'; id: string; data: Record<string, unknown> }
        | { kind: 'update'; id: string; data: Record<string, unknown> }
        | { kind: 'delete'; id: string };

      const ops: Op[] = [];

      // Hashing is async, so compute every id at once rather than awaiting
      // one per iteration inside the loop.
      const fresh = [...found.entries()].filter(([key]) => !byKey.has(key));
      const freshIds = await Promise.all(fresh.map(([key]) => idFor(key)));

      fresh.forEach(([key, { name, firms }], i) => {
        ops.push({
          kind: 'set',
          id: freshIds[i],
          data: {
            name,
            nameKey: key,
            sourceFirms: firms,
            status: 'active',
            researchState: 'pending',
            discoveredAt: new Date().toISOString(),
          },
        });
      });

      for (const [key, { firms }] of found) {
        const current = byKey.get(key);
        if (!current) continue;
        if (JSON.stringify(current.sourceFirms || []) !== JSON.stringify(firms)) {
          // A second firm now lists it, which is itself a signal worth seeing.
          ops.push({ kind: 'update', id: current.id, data: { sourceFirms: firms } });
        }
      }

      // Rows whose company is now in the CRM have served their purpose.
      for (const [key, candidate] of byKey) {
        if (crmIndex.has(key)) ops.push({ kind: 'delete', id: candidate.id });
      }

      // Firestore caps a batch at 500. Committed one chunk at a time, on
      // purpose: the point is to stop flooding the connection, and firing
      // every batch at once would only move the flood up a level.
      const CHUNK = 400;
      for (let i = 0; i < ops.length; i += CHUNK) {
        const batch = writeBatch(db);
        for (const op of ops.slice(i, i + CHUNK)) {
          const ref = doc(db, 'sourcing', op.id);
          if (op.kind === 'set') batch.set(ref, op.data);
          else if (op.kind === 'update') batch.update(ref, op.data);
          else batch.delete(ref);
        }
        await batch.commit();
      }

      if (ops.length > 500) {
        console.warn(
          `[sourcing] reconciled ${ops.length} rows across ${investors.length} investors. ` +
          `A number this large usually means the investor repository has filled up with ` +
          `auto-discovered firms; see scripts/discovered-firms.cjs.`
        );
      }
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
        /**
         * The month's allowance is gone. Stop the whole loop.
         *
         * Not marked as a failed row: the company is fine, we simply cannot
         * afford to look at it this month, and flagging it failed would mean
         * it never gets researched once the allowance resets. The loop halts
         * so it does not walk the rest of the queue collecting the same
         * refusal several hundred times.
         */
        if (response.status === 429 && body.budgetExhausted) {
          haltedRef.current = true;
          attempted.current.delete(candidate.id);
          setPausedReason(body.error || "The month's free AI allowance is spent.");
          return;
        }
        throw new Error(body.error || `Server error: ${response.status}`);
      }
      const data = await response.json();

      const found = Boolean(data.website || data.description);
      await updateDoc(doc(db, 'sourcing', candidate.id), {
        website: data.website ?? null,
        description: data.description ?? null,
        founderName: data.founderName ?? null,
        founderEmail: data.founderEmail ?? null,
        alternateEmail: data.alternateEmail ?? null,
        alternateEmailSourceUrl: data.alternateEmailSourceUrl ?? null,
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

      /**
       * The founder joins the people directory as soon as we know their name.
       *
       * Here rather than when the company is promoted, because a name found
       * tonight is worth having whether or not anyone moves the row: the
       * person is real, they run a company one of our investors backed, and a
       * dismissed sourcing row should not take them with it.
       *
       * The email is only attached when the research attributed it to them by
       * name. An alternate address — info@, support@ — belongs to the company
       * and is deliberately not carried onto a person's contact card.
       */
      if (data.founderName) {
        void recordPerson(
          {
            name: String(data.founderName),
            email: data.founderEmail || undefined,
            affiliation: candidate.name,
            source: 'sourcing',
          },
          candidate.name,
        );
      }
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
  /**
   * The queue. One long-lived loop for the life of the tab, rather than an
   * effect that reschedules itself.
   *
   * The obvious shape — an effect keyed on `candidates` that sets a timer for
   * the next pending row — does not work here, and failed in two different
   * ways before this. `candidates` changes on every Firestore snapshot, so the
   * effect tears down and rebuilds constantly: releasing the lock in the
   * cleanup let two calls run at once, and not releasing it deadlocked the
   * queue the first time a snapshot landed inside the delay. Discovery writes
   * a burst of documents, so a snapshot always landed inside the delay, and
   * nothing was ever researched.
   *
   * A loop that reads the current list from a ref has neither problem: it is
   * the only thing driving the work, it holds no lock, and snapshots cannot
   * interrupt it.
   */
  const candidatesRef = useRef(candidates);
  useEffect(() => { candidatesRef.current = candidates; }, [candidates]);

  // Rows tried this session. A row whose failure could not be written back —
  // a permissions problem, say — would otherwise stay pending and be retried
  // forever, which is an expensive way to keep failing.
  const attempted = useRef<Set<string>>(new Set());

  /**
   * Set when the server says the month's allowance is gone.
   *
   * A ref rather than state because the loop reads it between iterations and
   * must see the change immediately; a state update would not reach the
   * closure already running.
   */
  const haltedRef = useRef(false);
  const doneThisSession = useRef(0);

  useEffect(() => {
    if (!enabled) return;
    let stopped = false;
    const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

    (async () => {
      while (!stopped) {
        if (haltedRef.current) return;

        if (doneThisSession.current >= MAX_PER_SESSION) {
          setPausedReason(
            `Paused after researching ${MAX_PER_SESSION} companies. Reload the tab to continue.`
          );
          return;
        }

        const next = candidatesRef.current.find(
          c => c.status === 'active' && c.researchState === 'pending' && !attempted.current.has(c.id)
        );

        if (!next) {
          await sleep(IDLE_POLL_MS);
          continue;
        }

        attempted.current.add(next.id);
        doneThisSession.current++;
        await research(next);
        if (stopped || haltedRef.current) return;
        await sleep(RESEARCH_GAP_MS);
      }
    })();

    return () => { stopped = true; };
    // `research` is stable (useCallback with no deps), so this runs once.
  }, [enabled, research]);

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
    pausedReason,
    discover,
    research,
    dismiss,
    restore,
    removeRow,
  };
}
