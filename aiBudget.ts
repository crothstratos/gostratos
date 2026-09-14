import type { Firestore } from "firebase-admin/firestore";

/**
 * How many grounded searches we have spent this month, and when to stop.
 *
 * Google gives 5,000 grounded searches a month free and then bills $14 per
 * thousand. Nothing in this codebase used to count them, which meant the
 * honest answer to "will the overnight jobs cost anything" was "nobody knows".
 * A slower schedule is not an answer to that question — it is a guess that
 * happens to be low. This is the answer: a counter every grounded call
 * increments, and a ceiling the scheduled jobs refuse to cross.
 *
 * The count is ours, not Google's. There is no API that reports the live
 * quota, so this tracks what we ask for and leaves headroom rather than
 * pretending to be exact. Being approximately right and stopping early beats
 * being exactly right after the invoice.
 *
 * Interactive use gets first claim. Somebody clicking Research and waiting on
 * an answer must not be told the budget went on a scheduled job at 2am, so a
 * reserve is held back that only the app can spend.
 */

const DOC = "ai_budget";

/** Google's free monthly grounding allowance. */
export const MONTHLY_FREE_GROUNDED = Number(process.env.AI_GROUNDED_MONTHLY_CAP) || 5000;

/** Held back for people using the app. Scheduled jobs may not touch it. */
export const INTERACTIVE_RESERVE = Number(process.env.AI_INTERACTIVE_RESERVE) || 1200;

/**
 * The stop switch. Set AI_HARD_STOP=true in env.yaml and redeploy, and every
 * grounded call in the application refuses immediately — scheduled and
 * interactive alike. There to be reached for without having to think.
 */
export const HARD_STOP = String(process.env.AI_HARD_STOP || '').toLowerCase() === 'true';

/** The ceiling the scheduled jobs stop at. */
export const SCHEDULED_CEILING = Math.max(0, MONTHLY_FREE_GROUNDED - INTERACTIVE_RESERVE);

const period = (d = new Date()) =>
  `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;

export interface Budget {
  period: string;
  used: number;
  /** What a scheduled job may still spend. Zero means stop. */
  remaining: number;
  /** The whole free allowance, for reporting. */
  allowance: number;
  ceiling: number;
}

export async function readBudget(db: Firestore): Promise<Budget> {
  const now = period();
  let used = 0;
  try {
    const doc = await db.collection("system").doc(DOC).get();
    const data = doc.exists ? (doc.data() as any) : null;
    // A count from last month is not this month's spend. Treated as zero
    // rather than reset here, so a read never writes.
    if (data && data.period === now) used = Number(data.grounded) || 0;
  } catch {
    /* If the counter cannot be read, assume the worst and let the caller
       decide. Reporting zero would license a full month's spend on a
       transient Firestore error. */
    return { period: now, used: SCHEDULED_CEILING, remaining: 0, allowance: MONTHLY_FREE_GROUNDED, ceiling: SCHEDULED_CEILING };
  }
  return {
    period: now,
    used,
    remaining: Math.max(0, SCHEDULED_CEILING - used),
    allowance: MONTHLY_FREE_GROUNDED,
    ceiling: SCHEDULED_CEILING,
  };
}

/**
 * Adds to this month's count.
 *
 * A transaction rather than an increment, because the month rolls over and a
 * blind increment would add September's calls to August's total. Called once
 * per firm by the jobs and once per request by the API, so the cost of the
 * transaction is irrelevant next to the model call it is counting.
 */
export async function recordGrounded(db: Firestore, calls: number): Promise<void> {
  if (!Number.isFinite(calls) || calls <= 0) return;
  const ref = db.collection("system").doc(DOC);
  const now = period();
  await db.runTransaction(async (tx) => {
    const doc = await tx.get(ref);
    const data = doc.exists ? (doc.data() as any) : null;
    if (!data || data.period !== now) {
      tx.set(ref, {
        period: now,
        grounded: calls,
        // Kept so a month's spend is still visible after the rollover.
        previousPeriod: data?.period || null,
        previousGrounded: data?.grounded || null,
        updatedAt: new Date().toISOString(),
      });
    } else {
      tx.update(ref, {
        grounded: (Number(data.grounded) || 0) + calls,
        updatedAt: new Date().toISOString(),
      });
    }
  });
}

/**
 * Records interactive use without making the caller wait for it.
 *
 * The count matters, but not enough to add a Firestore round trip to a request
 * somebody is sitting in front of, and certainly not enough to fail that
 * request if the write fails.
 *
 * Also updates the in-memory figure the gate reads, so a burst of requests
 * inside one cache window still counts against the ceiling rather than all
 * seeing the same stale total and all being let through.
 */
export function noteGrounded(db: Firestore | null, calls: number): void {
  if (!db) return;
  cached.used += calls;
  recordGrounded(db, calls).catch((err) => {
    console.warn(`[ai-budget] could not record ${calls} grounded call(s): ${err?.message || err}`);
  });
}

// ───────────────────────────────────────────────────────────────────────────
// The gate
// ───────────────────────────────────────────────────────────────────────────

/**
 * Counting was never a control.
 *
 * The first version of this file recorded every grounded call and stopped
 * only the two scheduled jobs. Everything else — the scan buttons, co-investor
 * research, company enrichment, and above all the Sourcing tab's automatic
 * research loop — was counted and then allowed to proceed. The loop runs one
 * grounded search roughly every five seconds for as long as the tab is open,
 * which is about seven hundred an hour that nothing in the system was in a
 * position to refuse.
 *
 * A ceiling that only some callers observe is not a ceiling. This is the one
 * every path goes through.
 */

let cached = { used: 0, period: '', at: 0 };
const CACHE_MS = 20_000;

/**
 * Deliberately cached, and deliberately only for a few seconds.
 *
 * Reading Firestore before every model call would add a round trip to a
 * request somebody is waiting on. Twenty seconds of staleness is worth at most
 * a handful of calls past the line, against a ceiling that already holds back
 * a reserve — and noteGrounded increments the cached figure as calls are made,
 * so a burst inside one window is still counted.
 */
async function usedThisMonth(db: Firestore): Promise<number> {
  const now = period();
  if (cached.period === now && Date.now() - cached.at < CACHE_MS) return cached.used;
  const budget = await readBudget(db);
  cached = { used: budget.used, period: now, at: Date.now() };
  return cached.used;
}

export class BudgetExhausted extends Error {
  readonly used: number;
  readonly ceiling: number;
  constructor(used: number, ceiling: number, scope: string) {
    super(
      `The month's free Gemini allowance is spent (${used} of ${ceiling} grounded searches used). ` +
        `${scope} AI research is paused until the 1st, so this cannot run up a bill. ` +
        `Raise AI_GROUNDED_MONTHLY_CAP in env.yaml if you have decided to pay for more.`,
    );
    this.name = 'BudgetExhausted';
    this.used = used;
    this.ceiling = ceiling;
  }
}

/**
 * Throws unless there is room for `calls` more grounded searches.
 *
 * Called immediately before the model call, never after. Interactive callers
 * may spend the whole free allowance including the reserve; scheduled jobs
 * stop at the lower ceiling so a night of research cannot take what somebody
 * clicking Research tomorrow morning will need.
 */
export async function assertCanSpend(
  db: Firestore | null,
  calls = 1,
  kind: 'interactive' | 'scheduled' = 'interactive',
): Promise<void> {
  if (HARD_STOP) {
    throw new BudgetExhausted(0, 0, 'All');
  }
  if (!db) return;
  const ceiling = kind === 'scheduled' ? SCHEDULED_CEILING : MONTHLY_FREE_GROUNDED;
  const used = await usedThisMonth(db);
  if (used + calls > ceiling) {
    throw new BudgetExhausted(used, ceiling, kind === 'scheduled' ? 'Overnight' : 'On-demand');
  }
}

/** True when there is no room left. For reporting, not for gating. */
export async function isExhausted(db: Firestore): Promise<boolean> {
  if (HARD_STOP) return true;
  return (await usedThisMonth(db)) >= MONTHLY_FREE_GROUNDED;
}
