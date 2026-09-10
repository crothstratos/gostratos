/**
 * Runs the overnight investor research from your own machine.
 *
 * The /api/cron/ endpoints cannot be opened in a browser, and that is on
 * purpose: App Engine sets X-Appengine-Cron on requests it originates and
 * strips it from anything arriving off the internet, so that header is the
 * only thing authenticating those jobs. A request without it falls through to
 * the normal API gate, which wants a Firebase token a browser tab does not
 * send. Hence this script — same code, run locally, against whichever
 * database you point it at.
 *
 * Three modes, cheapest first:
 *
 *   npx tsx scripts/research-dry-run.ts --production
 *       ESTIMATE. Free. No AI calls at all. Reads the repository and reports
 *       how many firms are due, what a pass would cost in grounded searches,
 *       and how many nights a full pass would take.
 *
 *   npx tsx scripts/research-dry-run.ts --production --dry-run --max=3
 *       Real research on 3 firms. Costs grounded searches. Writes NOTHING —
 *       reports what it would have written, including how many new firms.
 *
 *   npx tsx scripts/research-dry-run.ts --production --apply --max=3
 *       The real thing, on 3 firms.
 *
 *   Add --enrich to run the profile-filling pass instead of the research pass.
 *
 * Without --production it reads staging, which is the right place to try this.
 */

import { initializeApp, applicationDefault } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { GoogleGenAI } from "@google/genai";
import { readFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { runInvestorResearch, runFirmEnrichment } from "../investorResearch.ts";

const PROJECT_ID = "gen-lang-client-0128987745";
const STAGING_DB = "staging";
const PRODUCTION_DB = "ai-studio-e212f446-e1ec-4969-b746-7a8ec637da86";

const argv = process.argv.slice(2);
const has = (f: string) => argv.includes(f);
const val = (name: string) => {
  const hit = argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.split("=").slice(1).join("=") : undefined;
};

const PRODUCTION = has("--production");
const APPLY = has("--apply");
const DRY_RUN = has("--dry-run");
const ENRICH = has("--enrich");
const MAX = Number(val("max") || 5);
const DB = PRODUCTION ? PRODUCTION_DB : STAGING_DB;

/**
 * The Gemini key, from the same env.yaml App Engine deploys.
 *
 * Deliberately not committed and deliberately not echoed. A two-line YAML
 * reader is enough and avoids a dependency; if the key is not there, an
 * environment variable still works.
 */
function geminiKey(): string {
  const fromEnv = (process.env.GEMINI_API_KEY || process.env.API_KEY || "").trim();
  if (fromEnv) return fromEnv;
  try {
    const here = dirname(fileURLToPath(import.meta.url));
    const yaml = readFileSync(join(here, "..", "env.yaml"), "utf8");
    for (const line of yaml.split(/\r?\n/)) {
      const m = line.match(/^\s*(?:API_KEY|GEMINI_API_KEY)\s*:\s*["']?([^"'\s#]+)["']?/);
      if (m && m[1] && m[1] !== "MY_GEMINI_API_KEY") return m[1];
    }
  } catch {
    /* no env.yaml on this machine; the env var is the other way in */
  }
  return "";
}

const model = process.env.GEMINI_MODEL || "gemini-3.8-flash";

(async () => {
  const mode = APPLY ? "APPLY — records will be written" : DRY_RUN ? "DRY RUN — nothing written" : "ESTIMATE — no AI calls";
  console.log(`\nDatabase : ${DB}${PRODUCTION ? "   *** PRODUCTION ***" : ""}`);
  console.log(`Job      : ${ENRICH ? "enrich-firms" : "investor-research"}`);
  console.log(`Mode     : ${mode}`);
  console.log(`Model    : ${model}\n`);

  const app = initializeApp({ credential: applicationDefault(), projectId: PROJECT_ID });
  const db = getFirestore(app, DB);
  db.settings({ ignoreUndefinedProperties: true });

  // ---- estimate: arithmetic only, no model calls, no cost
  if (!APPLY && !DRY_RUN) {
    const snap = await db.collection("investor_repository").get();

    let discovered = 0, manual = 0, due = 0, researched = 0;
    let pendingEnrich = 0, doneEnrich = 0, failedEnrich = 0;
    let withPortfolio = 0, withoutPortfolio = 0, withWebsite = 0;

    snap.forEach((doc) => {
      const v = doc.data() as any;
      if (!String(v.firmName || "").trim()) return;
      const isDiscovered = v.sourceKind === "co-investor-discovery";
      if (isDiscovered) discovered++; else manual++;

      if (v.enrichmentState === "pending") pendingEnrich++;
      else if (v.enrichmentState === "done") doneEnrich++;
      else if (v.enrichmentState === "failed") failedEnrich++;

      if (isDiscovered) return;                        // never a research subject
      if (v.lastAutoResearchAt) { researched++; return; }
      due++;
      if (String(v.website || "").trim()) withWebsite++;
      const p = Array.isArray(v.portfolioCompanies) ? v.portfolioCompanies.filter(Boolean) : [];
      if (p.length) withPortfolio++; else withoutPortfolio++;
    });

    console.log("Investor repository");
    console.log("-------------------");
    console.log(`  records in total                 ${String(snap.size).padStart(6)}`);
    console.log(`  created by a person              ${String(manual).padStart(6)}`);
    console.log(`  created by the research job      ${String(discovered).padStart(6)}`);
    console.log("");
    console.log(`  already researched               ${String(researched).padStart(6)}`);
    console.log(`  DUE for research                 ${String(due).padStart(6)}`);
    console.log(`    of those, with a website       ${String(withWebsite).padStart(6)}   (a site to read beats search)`);
    console.log(`    with a portfolio on file       ${String(withPortfolio).padStart(6)}`);
    console.log(`    with no portfolio yet          ${String(withoutPortfolio).padStart(6)}   (one extra call each to seed)`);
    console.log("");
    console.log(`  profile pending                  ${String(pendingEnrich).padStart(6)}`);
    console.log(`  profile filled in                ${String(doneEnrich).padStart(6)}`);
    console.log(`  profile failed                   ${String(failedEnrich).padStart(6)}`);

    // 1 team scan + up to 8 per-company round lookups + 1 profiling call,
    // plus a seed call for a firm with no portfolio on file.
    const perFirm = 10;
    const passCalls = due * perFirm + withoutPortfolio;
    const perNight = Number(process.env.RESEARCH_FIRMS_PER_NIGHT) || 10;
    const nights = due === 0 ? 0 : Math.ceil(due / perNight);

    console.log("\nWhat a full pass costs");
    console.log("----------------------");
    console.log(`  grounded searches per firm     ~${perFirm}`);
    console.log(`  grounded searches for the pass ~${passCalls.toLocaleString()}`);
    console.log(`  enrichment, 1 per new firm     + however many firms get discovered`);
    console.log("");
    console.log(`  at ${perNight} firms a night, a full pass takes ${nights} night(s).`);
    console.log("");
    console.log(`  Google's grounding allowance is 5,000 free searches a month,`);
    console.log(`  then $14 per 1,000. This pass is ~${passCalls.toLocaleString()} searches, so`);
    if (passCalls <= 5000) {
      console.log(`  it fits inside the free allowance.`);
    } else {
      const billable = passCalls - 5000;
      console.log(`  roughly ${billable.toLocaleString()} of them are billable — about $${((billable / 1000) * 14).toFixed(0)}, once.`);
      console.log(`  Spread over ${nights} nights that is ~${Math.ceil(passCalls / Math.max(nights, 1)).toLocaleString()} a night.`);
    }
    console.log(`\n  Nothing was called and nothing was written. Add --dry-run --max=3`);
    console.log(`  to research three firms for real and see what it would write.\n`);
    return;
  }

  // ---- dry run or apply: the real job
  const key = geminiKey();
  if (!key) {
    console.error("No Gemini API key found. Set GEMINI_API_KEY, or put API_KEY in env.yaml.\n");
    process.exit(1);
  }
  const ai = new GoogleGenAI({ apiKey: key });

  if (PRODUCTION && APPLY) {
    console.log("Writing to production in 5 seconds. Ctrl+C to abort.\n");
    await new Promise((r) => setTimeout(r, 5000));
  }

  const started = Date.now();
  const result = ENRICH
    ? await runFirmEnrichment(db, ai, model, { dryRun: !APPLY, maxFirms: MAX, budgetMs: 30 * 60 * 1000 })
    : await runInvestorResearch(db, ai, model, { dryRun: !APPLY, maxInvestors: MAX, budgetMs: 30 * 60 * 1000 });

  console.log(`\n${result.job} — ${result.scanned} firm(s) in ${Math.round((Date.now() - started) / 1000)}s\n`);
  for (const note of result.notes) console.log(`  ${note}`);
  console.log(
    !APPLY
      ? `\n  Nothing was written. Re-run with --apply to do it for real.\n`
      : `\n  Done. ${result.signals} signal(s) written.\n`
  );
})().catch((err) => {
  console.error("\nFailed:", err?.message || err);
  process.exit(1);
});
