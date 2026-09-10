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
 */
export function noteGrounded(db: Firestore | null, calls: number): void {
  if (!db) return;
  recordGrounded(db, calls).catch((err) => {
    console.warn(`[ai-budget] could not record ${calls} grounded call(s): ${err?.message || err}`);
  });
}
