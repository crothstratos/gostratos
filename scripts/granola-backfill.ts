/**
 * Files your existing Granola notes against the companies they were about.
 *
 * The webhook handles calls from now on; this is the history. It walks every
 * note in the date range, matches each to a company the same way the webhook
 * does, logs the call as an interaction, and fills in profile fields the call
 * actually answered.
 *
 * NEWEST FIRST, and that is not an implementation detail.
 *
 * Fields are only written when blank, so whichever call is processed first
 * claims them. Oldest-first would mean a company's August revenue figure fills
 * the field and its September call — the current one — finds nothing left to
 * write. You would end up with the stale number and no sign that a newer one
 * was ever heard. Working backwards means the most recent call wins every
 * field it can answer, and older calls fill only what the newer ones did not
 * mention.
 *
 *   npx tsx scripts/granola-backfill.ts                       survey, writes nothing
 *   npx tsx scripts/granola-backfill.ts --apply               write to staging
 *   npx tsx scripts/granola-backfill.ts --production          survey production
 *   npx tsx scripts/granola-backfill.ts --production --apply  the real thing
 *
 *   --create             add companies we do not have yet, the way the
 *                        webhook now does: one outside company on the call,
 *                        a new record in Analyst Call. Shown but not written
 *                        without --apply.
 *   --since=2026-08-01   earliest note to consider (default: everything)
 *   --limit=5            stop after this many matched meetings
 *   --no-ai              log the calls, extract no fields (free)
 */

import { initializeApp, applicationDefault } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { GoogleGenAI, Type } from "@google/genai";
import { readFileSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";
import {
  listNotes, getNote, matchNote, meetingKey, externalDomains, rootDomain,
  extractFacts, buildInteractionNote, EXTRACTABLE,
  deriveCompanyName, newCompanyFromNote, sameCompanyName,
} from "../granola.ts";

const PROJECT_ID = "gen-lang-client-0128987745";
const STAGING_DB = "staging";
const PRODUCTION_DB = "ai-studio-e212f446-e1ec-4969-b746-7a8ec637da86";

const argv = process.argv.slice(2);
const has = (f: string) => argv.includes(f);
const val = (n: string) => {
  const hit = argv.find((a) => a.startsWith(`--${n}=`));
  return hit ? hit.split("=").slice(1).join("=") : undefined;
};

const APPLY = has("--apply");
const PRODUCTION = has("--production");
const NO_AI = has("--no-ai");
const CREATE = has("--create");
const SINCE = val("since");
const LIMIT = Number(val("limit") || 0);
const DB = PRODUCTION ? PRODUCTION_DB : STAGING_DB;

/** env.yaml is where the deployed keys live; read them rather than duplicate them. */
function fromEnvYaml(key: string): string {
  const fromEnv = (process.env[key] || "").trim();
  if (fromEnv) return fromEnv;
  try {
    const here = dirname(fileURLToPath(import.meta.url));
    const yaml = readFileSync(join(here, "..", "env.yaml"), "utf8");
    for (const line of yaml.split(/\r?\n/)) {
      const m = line.match(new RegExp(`^\\s*${key}\\s*:\\s*["']?([^"'\\s#]+)["']?`));
      if (m && m[1]) return m[1];
    }
  } catch { /* no env.yaml here; the environment variable is the other way in */ }
  return "";
}

const model = process.env.GEMINI_MODEL || "gemini-3.8-flash";

(async () => {
  console.log(`\nDatabase : ${DB}${PRODUCTION ? "   *** PRODUCTION ***" : ""}`);
  console.log(`Mode     : ${APPLY ? "APPLY — records will be written" : "DRY RUN — nothing will be written"}`);
  console.log(`Fields   : ${NO_AI ? "not extracted (--no-ai)" : `extracted with ${model}`}`);
  console.log(`New      : ${CREATE ? "companies we do not have will be added in Analyst Call" : "unmatched calls are listed only (--create adds them)"}\n`);

  const granolaKey = fromEnvYaml("GRANOLA_API_KEY");
  if (!granolaKey) {
    console.error("No GRANOLA_API_KEY in env.yaml or the environment.\n");
    process.exit(1);
  }
  process.env.GRANOLA_API_KEY = granolaKey;

  const app = initializeApp({ credential: applicationDefault(), projectId: PROJECT_ID });
  const db = getFirestore(app, DB);
  db.settings({ ignoreUndefinedProperties: true });

  const ai = NO_AI ? null : new GoogleGenAI({ apiKey: fromEnvYaml("API_KEY") || fromEnvYaml("GEMINI_API_KEY") });

  // --- the companies, once
  const snap = await db.collection("companies").get();
  const companies = snap.docs.map((d) => {
    const v = d.data() as any;
    return { id: d.id, name: String(v.name || ""), website: v.website, founderEmail: v.founderEmail };
  });
  console.log(`${companies.length} companies in the CRM.\n`);

  // --- every note, newest first
  const all: { id: string; title: string; created: string }[] = [];
  let cursor: string | undefined;
  do {
    const page = await listNotes({ cursor, pageSize: 30, updatedAfter: SINCE });
    for (const n of page.notes) {
      all.push({ id: n.id, title: String(n.title || ""), created: String(n.created_at || "") });
    }
    cursor = page.cursor || undefined;
    if (!page.hasMore) break;
  } while (cursor);

  all.sort((a, b) => (b.created || "").localeCompare(a.created || ""));
  console.log(`${all.length} Granola note(s) found. Working newest first.\n`);

  const seenMeetings = new Set<string>();
  let matched = 0, skipped = 0, filled = 0, failed = 0, logged = 0, created = 0;
  const unmatched: string[] = [];

  for (const stub of all) {
    if (LIMIT && matched >= LIMIT) break;

    let note;
    try {
      note = await getNote(stub.id);
    } catch (err: any) {
      failed++;
      console.log(`  ! ${stub.title.slice(0, 40)}: ${err.message}`);
      continue;
    }

    let match = matchNote(note, companies);

    /**
     * Same rule as the webhook: exactly one outside company on the call is a
     * company, anything else is a guess. See the comment on that branch in
     * server.ts for why the count is the safeguard.
     */
    if (!match) {
      const domains = externalDomains(note);
      const domain = domains.length === 1 ? domains[0] : "";
      const derived = domain ? deriveCompanyName(note, domain) : "";
      const twins = derived ? companies.filter((c) => sameCompanyName(c.name, derived)) : [];

      if (CREATE && domain && twins.length === 0) {
        const record = newCompanyFromNote(note, domain);
        const id = String(record.id);
        console.log(`  + ${String(record.name).padEnd(22)} new company from ${rootDomain(domain)}`);
        if (APPLY) {
          try {
            await db.collection("companies").doc(id).create(record);
          } catch (err: any) {
            if (err?.code !== 6) throw err;
          }
        }
        created++;
        // Visible to the rest of this run, so a second call with the same
        // company logs against it instead of creating it again.
        companies.push({ id, name: String(record.name), website: String(record.website), founderEmail: undefined });
        match = {
          companyId: id,
          companyName: String(record.name),
          basis: `an attendee from ${rootDomain(domain)} \u2014 this company was added to the CRM from this call`,
          confidence: "domain",
        };
        // A dry run has nothing to write the call onto yet.
        if (!APPLY) { seenMeetings.add(meetingKey(note)); continue; }
      } else {
        skipped++;
        if (domains.length) unmatched.push(`${stub.title.slice(0, 44).padEnd(46)} ${domains.join(", ")}`);
        continue;
      }
    }

    // One call, not one note per colleague who recorded it.
    const key = meetingKey(note);
    if (seenMeetings.has(key)) { skipped++; continue; }
    seenMeetings.add(key);
    matched++;

    const ref = db.collection("companies").doc(match.companyId);
    const doc = await ref.get();
    if (!doc.exists) continue;
    const company = doc.data() as any;

    const existing: any[] = Array.isArray(company.interactions) ? company.interactions : [];
    const already = existing.some((i) => i?.granolaMeetingKey === key);

    const blanks = EXTRACTABLE.map((f) => f.field).filter((field) => {
      const v = company[field];
      if (field === "location") return !v || (typeof v === "string" ? v.trim() === "" : !v.formatted_address);
      return String(v || "").trim() === "";
    });

    let facts: any[] = [];
    let nextSteps: string | undefined;
    if (ai) {
      try {
        const out = await extractFacts(ai, model, Type, note, blanks);
        facts = out.facts;
        nextSteps = out.nextSteps;
      } catch (err: any) {
        console.log(`  ! extraction failed for ${match.companyName}: ${err.message}`);
      }
    }

    const when = String(note.calendar_event?.scheduled_start_time || note.created_at || "").slice(0, 10);
    console.log(`  ${when}  ${match.companyName.padEnd(22)} ${already ? "[already logged]" : "[new interaction]"}`);
    console.log(`            matched by ${match.basis}`);
    if (facts.length) {
      const labels = new Map(EXTRACTABLE.map((f) => [f.field, f.label]));
      for (const f of facts) console.log(`            + ${labels.get(f.field) || f.field}: ${String(f.value).slice(0, 70)}`);
      filled += facts.length;
    }
    if (nextSteps) console.log(`            > next: ${nextSteps.slice(0, 70)}`);
    if (!facts.length && !nextSteps) console.log(`            (nothing new stated on this call)`);

    if (!APPLY) continue;

    const occurredAt = note.calendar_event?.scheduled_start_time || note.created_at || new Date().toISOString();
    const entry = {
      id: crypto.randomUUID(),
      date: occurredAt,
      type: "Meeting" as const,
      notes: buildInteractionNote(note, match, facts),
      sentiment: "Neutral" as const,
      source: "granola" as const,
      granolaNoteId: note.id,
      granolaMeetingKey: key,
      granolaUrl: note.web_url || null,
      loggedBy: note.owner?.email || null,
      nextSteps: nextSteps || undefined,
    };

    const patch: Record<string, unknown> = {
      interactions: already ? existing : [entry, ...existing],
      lastGranolaSyncAt: new Date().toISOString(),
      lastModified: new Date().toISOString(),
    };
    if (!already) logged++;

    const sources: Record<string, unknown> = { ...(company.fieldSources || {}) };
    for (const fact of facts) {
      const current = company[fact.field];
      const isBlank = fact.field === "location"
        ? !current || (typeof current === "string" ? current.trim() === "" : !current.formatted_address)
        : String(current || "").trim() === "";
      if (!isBlank) continue;
      patch[fact.field] = fact.value;
      sources[fact.field] = {
        source: "granola", noteId: note.id, quote: fact.quote,
        meetingTitle: note.title || null, at: occurredAt, url: note.web_url || null,
      };
    }

    // Newest first means the first call to answer this wins, which is the one
    // we want. Later (older) calls find it set and leave it alone.
    if (nextSteps) {
      const prior = (company.fieldSources || {}).nextSteps;
      const typedByAPerson = String(company.nextSteps || "").trim() !== "" && !prior;
      if (!typedByAPerson && !sources.nextSteps) {
        patch.nextSteps = nextSteps;
        sources.nextSteps = {
          source: "granola", noteId: note.id, quote: nextSteps,
          meetingTitle: note.title || null, at: occurredAt, url: note.web_url || null,
        };
      }
    }

    if (Object.keys(sources).length) patch.fieldSources = sources;
    await ref.update(patch);
  }

  console.log("\nSummary");
  console.log("-------");
  console.log(`  notes read                ${String(all.length).padStart(5)}`);
  console.log(`  matched to a company      ${String(matched).padStart(5)}`);
  console.log(`  skipped (internal, dupes, no match) ${String(skipped).padStart(5)}`);
  console.log(`  interactions ${APPLY ? "written" : "to write"}   ${String(APPLY ? logged : matched).padStart(5)}`);
  console.log(`  fields ${APPLY ? "filled" : "fillable"}          ${String(filled).padStart(5)}`);
  if (CREATE) console.log(`  companies ${APPLY ? "added" : "to add"}         ${String(created).padStart(5)}`);
  if (failed) console.log(`  notes that could not be read ${String(failed).padStart(5)}`);

  if (unmatched.length) {
    console.log("\nMet, but not in the CRM");
    console.log("-----------------------");
    console.log(CREATE
      ? "  (two or more outside companies on the call, so not added automatically)"
      : "  (these are companies you have spoken to and are not tracking; --create adds them)");
    for (const u of unmatched.slice(0, 25)) console.log(`  ${u}`);
    if (unmatched.length > 25) console.log(`  ... and ${unmatched.length - 25} more`);
  }

  console.log(APPLY ? "\nDone.\n" : "\nDry run. Re-run with --apply to write these.\n");
})().catch((err) => {
  const message = String(err?.message || err);
  if (/invalid_grant|invalid_rapt|reauth related error|Could not load the default credentials|UNAUTHENTICATED/i.test(message)) {
    console.error("\n  Your Google credentials have expired.\n");
    console.error("      gcloud auth application-default login\n");
    process.exit(1);
  }
  console.error("\nFailed:", message, "\n");
  process.exit(1);
});
