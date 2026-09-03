import { getFirestore, Firestore } from "firebase-admin/firestore";
import { fetchPagesFor, WATCH_HINTS } from "./siteScrape.ts";

/**
 * The scheduled jobs.
 *
 * All three answer the same shape of question: what changed since last time?
 * A CRM stores what is true now, which means every one of these questions is
 * unanswerable from the records alone — the previous value was overwritten.
 * These jobs keep the previous value, so the difference becomes visible.
 *
 * They run under the Admin SDK and so bypass security rules. That is correct
 * for a system job and is the reason the cron auth check in server.ts is
 * pinned to the /api/cron/ prefix.
 */

const SIGNALS = "signals";
const SNAPSHOTS = "portfolio_snapshots";
const SITE_SNAPSHOTS = "site_snapshots";
const PEOPLE_WATCH = "people_watch";

export interface JobResult {
  job: string;
  scanned: number;
  signals: number;
  notes: string[];
}

const period = (d = new Date()) =>
  `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;

const normalise = (s: string) =>
  (s || "").toLowerCase().normalize("NFKD").replace(/[^a-z0-9]/g, "");

/** Signals are written with a deterministic id so a re-run cannot duplicate them. */
async function emit(
  db: Firestore,
  id: string,
  signal: Record<string, unknown>
): Promise<boolean> {
  const ref = db.collection(SIGNALS).doc(id);
  const existing = await ref.get();
  if (existing.exists) return false;
  await ref.set({ ...signal, status: "new", occurredAt: new Date().toISOString() });
  return true;
}

// ───────────────────────────────────────────────────────────────────────────
// Portfolio history
// ───────────────────────────────────────────────────────────────────────────

/**
 * Records where every investor's portfolio stands, and reports what moved.
 *
 * The snapshot is the valuable part and is worth taking even in months when
 * nothing changed: rotation is only visible against a baseline, and a baseline
 * that starts today is worth more than a perfect one that starts next year.
 */
export async function runPortfolioSnapshot(db: Firestore): Promise<JobResult> {
  const result: JobResult = { job: "portfolio-snapshot", scanned: 0, signals: 0, notes: [] };
  const now = new Date();
  const thisPeriod = period(now);

  // Vertical lookup, so a new position can be reported as "in fintech" rather
  // than just as a name. Companies we do not track have no vertical, and the
  // signal says so rather than guessing one.
  const companySnap = await db.collection("companies").get();
  const verticalByName = new Map<string, string>();
  for (const doc of companySnap.docs) {
    const data = doc.data();
    if (data.name && data.vertical) verticalByName.set(normalise(data.name), data.vertical);
  }
  const sourcingSnap = await db.collection("sourcing").get();
  for (const doc of sourcingSnap.docs) {
    const data = doc.data();
    if (data.name && data.vertical && !verticalByName.has(normalise(data.name))) {
      verticalByName.set(normalise(data.name), data.vertical);
    }
  }

  const firms = await db.collection("investor_repository").get();

  for (const firmDoc of firms.docs) {
    const firm = firmDoc.data();
    const companies: string[] = Array.isArray(firm.portfolioCompanies)
      ? firm.portfolioCompanies.filter((c: any) => typeof c === "string" && c.trim() !== "")
      : [];
    result.scanned++;

    const snapshotId = `${firmDoc.id}_${thisPeriod}`;
    const snapshotRef = db.collection(SNAPSHOTS).doc(snapshotId);

    // The most recent snapshot that is not this month's.
    const priorQuery = await db
      .collection(SNAPSHOTS)
      .where("firmId", "==", firmDoc.id)
      .orderBy("period", "desc")
      .limit(2)
      .get();
    const prior = priorQuery.docs.map(d => d.data()).find(d => d.period !== thisPeriod);

    await snapshotRef.set({
      firmId: firmDoc.id,
      firmName: firm.firmName || "Unknown firm",
      takenAt: now.toISOString(),
      period: thisPeriod,
      companies,
    });

    if (!prior) {
      result.notes.push(`${firm.firmName}: first snapshot, ${companies.length} positions`);
      continue;
    }

    const before = new Set((prior.companies || []).map(normalise));
    const added = companies.filter(c => !before.has(normalise(c)));
    if (added.length === 0) continue;

    for (const name of added) {
      const vertical = verticalByName.get(normalise(name));
      const wrote = await emit(db, `add_${firmDoc.id}_${normalise(name)}`, {
        kind: "portfolio-addition",
        headline: `${firm.firmName} added ${name}`,
        detail: vertical
          ? `New position since ${prior.period}. We class ${name} as ${vertical}.`
          : `New position since ${prior.period}. Not a company we track, so no sector on file.`,
        weight: 2,
        firmId: firmDoc.id,
        firmName: firm.firmName,
        companyName: name,
      });
      if (wrote) result.signals++;
    }

    // Rotation: several additions into one sector is a different claim from
    // several additions, and a much more interesting one.
    const bySector = new Map<string, string[]>();
    for (const name of added) {
      const vertical = verticalByName.get(normalise(name));
      if (!vertical) continue;
      bySector.set(vertical, [...(bySector.get(vertical) || []), name]);
    }

    for (const [sector, names] of bySector) {
      if (names.length < 2) continue;

      const priorInSector = (prior.companies || []).filter(
        (c: string) => verticalByName.get(normalise(c)) === sector
      ).length;

      const wrote = await emit(db, `rot_${firmDoc.id}_${normalise(sector)}_${thisPeriod}`, {
        kind: "sector-rotation",
        headline: `${firm.firmName} is moving into ${sector}`,
        detail:
          `${names.length} new ${sector} positions since ${prior.period} ` +
          `(${names.join(", ")}), against ${priorInSector} held before.`,
        weight: priorInSector === 0 ? 5 : 4,
        firmId: firmDoc.id,
        firmName: firm.firmName,
      });
      if (wrote) result.signals++;
    }
  }

  return result;
}

// ───────────────────────────────────────────────────────────────────────────
// Website change detection
// ───────────────────────────────────────────────────────────────────────────

/** Stages where a company is live enough that changes on its site matter. */
const WATCHED_STAGES = new Set(["Portfolio Company", "DD", "Partner Call", "Analyst Call"]);

/** Cheap content fingerprint. Not cryptographic; only ever compared for equality. */
function hash(text: string): string {
  let h = 5381;
  for (let i = 0; i < text.length; i++) h = ((h << 5) + h + text.charCodeAt(i)) | 0;
  return (h >>> 0).toString(36);
}

/** The lines present now that were not before, ignoring pure reordering. */
function newLines(before: string, after: string, limit = 6): string[] {
  const seen = new Set(before.split("\n").map(l => l.trim()).filter(Boolean));
  const out: string[] = [];
  for (const line of after.split("\n")) {
    const trimmed = line.trim();
    if (trimmed.length < 12 || trimmed.length > 160) continue;
    if (seen.has(trimmed)) continue;
    out.push(trimmed);
    if (out.length >= limit) break;
  }
  return out;
}

export async function runSiteDiff(db: Firestore, maxCompanies = 25): Promise<JobResult> {
  const result: JobResult = { job: "site-diff", scanned: 0, signals: 0, notes: [] };

  const companies = await db.collection("companies").get();
  const watchable = companies.docs
    .map(d => ({ id: d.id, ...(d.data() as any) }))
    .filter(c => c.website && WATCHED_STAGES.has(c.stage));

  // Least recently checked first, so the whole set is covered over time
  // rather than the first 25 alphabetically being checked forever.
  const states = await db.collection(SITE_SNAPSHOTS).get();
  const lastChecked = new Map<string, string>();
  for (const doc of states.docs) lastChecked.set(doc.id, doc.data().checkedAt || "");

  watchable.sort((a, b) => (lastChecked.get(a.id) || "").localeCompare(lastChecked.get(b.id) || ""));

  for (const company of watchable.slice(0, maxCompanies)) {
    result.scanned++;
    const pages = await fetchPagesFor(company.website, WATCH_HINTS);
    if (pages.length === 0) {
      result.notes.push(`${company.name}: nothing readable at ${company.website}`);
      continue;
    }

    const ref = db.collection(SITE_SNAPSHOTS).doc(company.id);
    const existing = (await ref.get()).data() as any;
    const before: Record<string, { hash: string; text: string }> = existing?.pages || {};

    const after: Record<string, { hash: string; text: string }> = {};
    for (const page of pages) {
      // Capped: a snapshot is for comparison, not for archiving the web, and
      // the whole map has to stay inside Firestore's 1MB document ceiling.
      const text = page.text.slice(0, 6000);
      after[page.url] = { hash: hash(text), text };
    }

    await ref.set({
      companyId: company.id,
      companyName: company.name,
      website: company.website,
      checkedAt: new Date().toISOString(),
      pages: after,
    });

    if (!existing) {
      result.notes.push(`${company.name}: baseline taken, ${pages.length} pages`);
      continue;
    }

    for (const [url, now] of Object.entries(after)) {
      const was = before[url];
      if (!was || was.hash === now.hash) continue;

      const additions = newLines(was.text, now.text);
      if (additions.length === 0) continue;   // whitespace or ordering only

      const path = url.replace(/^https?:\/\/[^/]+/, "") || "/";
      const label =
        /career|job/i.test(path) ? "careers page" :
        /pricing|plan/i.test(path) ? "pricing page" :
        /team|about/i.test(path) ? "team page" : "site";

      const wrote = await emit(db, `site_${company.id}_${hash(url + now.hash)}`, {
        kind: "site-change",
        headline: `${company.name}'s ${label} changed`,
        detail: additions.map(a => `• ${a}`).join("\n"),
        weight: label === "careers page" ? 3 : label === "team page" ? 4 : 2,
        companyId: company.id,
        companyName: company.name,
        sourceUrl: url,
      });
      if (wrote) result.signals++;
    }
  }

  return result;
}

// ───────────────────────────────────────────────────────────────────────────
// People movement
// ───────────────────────────────────────────────────────────────────────────

/**
 * Rebuilds the watchlist of people worth keeping an eye on, and returns the
 * slice due for checking.
 *
 * Deliberately narrow. Every person here costs a grounded model call, and a
 * founder of a company we passed on in 2023 is not worth a weekly question.
 */
export async function peopleDueForCheck(db: Firestore, batchSize: number) {
  const watchRef = db.collection(PEOPLE_WATCH);

  const companies = await db.collection("companies").get();
  const wanted: { id: string; name: string; org: string; companyId?: string; kind: string }[] = [];

  for (const doc of companies.docs) {
    const c = doc.data();
    if (!c.founderName || !WATCHED_STAGES.has(c.stage)) continue;
    for (const raw of String(c.founderName).split(/[,;]|\band\b/)) {
      const name = raw.trim();
      if (name.length < 4) continue;
      wanted.push({
        id: `f_${doc.id}_${normalise(name)}`,
        name,
        org: c.name,
        companyId: doc.id,
        kind: "founder",
      });
    }
  }

  const firms = await db.collection("investor_repository").get();
  for (const doc of firms.docs) {
    const firm = doc.data();
    for (const contact of firm.contacts || []) {
      if (!contact?.name || contact.name.trim().length < 4) continue;
      wanted.push({
        id: `c_${doc.id}_${normalise(contact.name)}`,
        name: contact.name.trim(),
        org: firm.firmName,
        kind: "firmContact",
      });
    }
  }

  const existing = await watchRef.get();
  const known = new Map(existing.docs.map(d => [d.id, d.data()]));

  for (const person of wanted) {
    if (known.has(person.id)) continue;
    await watchRef.doc(person.id).set({ ...person, lastCheckedAt: null });
  }

  const all = await watchRef.get();
  return all.docs
    .map(d => ({ id: d.id, ...(d.data() as any) }))
    .filter(p => wanted.some(w => w.id === p.id))     // drop people who have left the graph
    .sort((a, b) => (a.lastCheckedAt || "").localeCompare(b.lastCheckedAt || ""))
    .slice(0, batchSize);
}

export async function recordPersonCheck(
  db: Firestore,
  person: { id: string; name: string; org: string; companyId?: string; kind: string },
  verdict: { movedTo?: string; sourceUrl?: string; confident: boolean }
): Promise<boolean> {
  await db.collection(PEOPLE_WATCH).doc(person.id).set(
    { lastCheckedAt: new Date().toISOString(), lastVerdict: verdict.movedTo || "unchanged" },
    { merge: true }
  );

  // Silence unless certain. A false "they have left" sends someone into a
  // conversation with wrong information in their head, which is worse than
  // hearing about a real departure a month late.
  if (!verdict.confident || !verdict.movedTo) return false;
  if (normalise(verdict.movedTo) === normalise(person.org)) return false;

  return emit(db, `moved_${person.id}_${normalise(verdict.movedTo)}`, {
    kind: "person-moved",
    headline: `${person.name} appears to have left ${person.org}`,
    detail: `Now associated with ${verdict.movedTo}. Worth confirming before acting on it.`,
    weight: person.kind === "founder" ? 5 : 3,
    personName: person.name,
    companyId: person.companyId,
    companyName: person.org,
    sourceUrl: verdict.sourceUrl,
  });
}

/**
 * The app's Firestore instance.
 *
 * This project's data does not live in "(default)" — it is a named database,
 * which is what the browser connects to and therefore what the jobs must write
 * to. getFirestore() with no argument would open an empty default database and
 * every job would report cheerfully that there was nothing to do.
 */
const PRODUCTION_DB = "ai-studio-e212f446-e1ec-4969-b746-7a8ec637da86";

export function getDb(): Firestore {
  return getFirestore(process.env.FIRESTORE_DATABASE_ID || PRODUCTION_DB);
}
