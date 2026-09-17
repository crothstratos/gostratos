import "dotenv/config";
import express from "express";
import path from "path";
import { fileURLToPath } from "url";
import { GoogleGenAI, Type } from "@google/genai";
import { PDFParse } from "pdf-parse";
import { parseOffice } from "officeparser";
import { initializeApp, cert, getApps } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import http from "http";
import { fetchFirmPages, isRoleInbox } from "./siteScrape.ts";
import { isAllowed } from "./src/access.ts";
import { scanFirm, discoverCoInvestors, runInvestorResearch, runFirmEnrichment } from "./investorResearch.ts";
import { noteGrounded, assertCanSpend, BudgetExhausted, HARD_STOP } from "./aiBudget.ts";
import {
  verifyGranolaSignature, getNote, matchNote, meetingKey,
  extractFacts, buildInteractionNote, EXTRACTABLE,
  externalDomains, rootDomain, deriveCompanyName, newCompanyFromNote, sameCompanyName,
} from "./granola.ts";
import { getDb, runPortfolioSnapshot, runSiteDiff, peopleDueForCheck, recordPersonCheck, runFirestoreExport } from "./cronJobs.ts";

/**
 * The Gemini model every endpoint uses.
 *
 * One constant, overridable without a deploy. It was previously written out at
 * each of the ten call sites, which meant changing model was ten edits and one
 * chance to miss one — the same shape of mistake that once left a quota
 * message unhandled in a single endpoint nobody thought to check.
 *
 * Set GEMINI_MODEL in env.yaml to move the whole app to another model; the
 * default is the current stable Flash release.
 */
const GEMINI_MODEL = process.env.GEMINI_MODEL || "gemini-3.8-flash";

// Initialize Firebase Admin if credentials are provided
try {
  if (process.env.FIREBASE_SERVICE_ACCOUNT) {
    const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
    initializeApp({ credential: cert(serviceAccount) });
    console.log("Firebase Admin initialized successfully.");
  } else if (process.env.GOOGLE_CLOUD_PROJECT) {
    // Running on App Engine / Cloud Run: use Application Default Credentials,
    // i.e. the platform's own service account. No key file needed.
    initializeApp();
    console.log("Firebase Admin initialized with Application Default Credentials.");
  } else {
    console.warn(
      "FIREBASE_SERVICE_ACCOUNT not set and no ADC available. Webhooks requiring admin access will fail.",
    );
  }
} catch (error) {
  console.error("Failed to initialize Firebase Admin:", error);
}

async function startServer() {
  const app = express();
  const PORT = Number(process.env.PORT) || 3000; // Cloud Run injects PORT

  // API routes FIRST
  // NOTE: body parsing is deliberately NOT registered here. Express runs
  // middleware in registration order, so a parser mounted above the auth
  // gate buffers and parses payloads from unauthenticated callers before
  // rejecting them — enough concurrent large posts would exhaust the
  // instance without anyone logging in. Parsers are mounted below the gate.

  app.get("/api/health", (req, res) => {
    res.json({ status: "ok" });
  });

  /**
   * Files one Granola note against the company the meeting was with.
   *
   * Matching is deterministic and happens before any model is involved: if we
   * cannot say which company this was, the note is parked for review rather
   * than filed somewhere plausible. A confidential call on the wrong
   * company's record is the failure this whole path is arranged to avoid.
   */
  async function ingestGranolaNote(noteId: string, eventType: string): Promise<void> {
    const db = getDb();
    const note = await getNote(noteId);

    // --- which company
    const snap = await db.collection("companies").get();
    const companies = snap.docs.map((d) => {
      const v = d.data() as any;
      return { id: d.id, name: String(v.name || ""), website: v.website, founderEmail: v.founderEmail };
    });

    let match = matchNote(note, companies);
    const key = meetingKey(note);

    /**
     * A company we do not have yet.
     *
     * If exactly one outside company was on the call, that company is new to
     * us and gets a record, in Analyst Call, with this call logged on it. A
     * conversation that happened is a company in the CRM, without anybody
     * typing it in afterwards.
     *
     * Exactly one, and the count is the whole safeguard. Zero external
     * domains is an internal meeting, or a call where everyone dialled in
     * from gmail — neither names a company. Two is a customer intro or a
     * partnership, where choosing one would be a guess. Both of those still
     * park for review, exactly as they did before.
     */
    if (!match) {
      const domains = externalDomains(note);
      const domain = domains.length === 1 ? domains[0] : "";
      const derived = domain ? deriveCompanyName(note, domain) : "";

      // Same company under a record that simply had no website or founder
      // email on it — which is why the domain did not match anything.
      const twins = derived ? companies.filter((c) => sameCompanyName(c.name, derived)) : [];

      if (domain && twins.length === 1) {
        const twin = twins[0];
        if (!String(twin.website || "").trim()) {
          // Fill in what we now know, so their next call matches outright.
          await db.collection("companies").doc(twin.id).update({
            website: `https://${rootDomain(domain)}`,
            lastModified: new Date().toISOString(),
          });
        }
        match = {
          companyId: twin.id,
          companyName: twin.name,
          basis: `its name in the meeting title, confirmed by an attendee from ${rootDomain(domain)}`,
          confidence: "name",
        };
      } else if (domain && twins.length === 0) {
        const record = newCompanyFromNote(note, domain);
        const newRef = db.collection("companies").doc(String(record.id));

        /**
         * create(), not set().
         *
         * Two people at the firm both running Granola produce two deliveries
         * for one call, seconds apart, and neither can see the other's write.
         * The id is derived from the domain so both address the same
         * document; create() makes the second one fail rather than overwrite
         * the first, and the failure falls straight through to logging the
         * call on the record that already exists.
         */
        try {
          await newRef.create(record);
          console.log(
            `[granola] ${noteId}: added ${record.name} (${rootDomain(domain)}) in Analyst Call`,
          );
        } catch (error: any) {
          // 6 = ALREADY_EXISTS. Anything else is a real failure.
          if (error?.code !== 6) throw error;
          console.log(`[granola] ${noteId}: ${record.name} was created by another delivery`);
        }

        const created = await newRef.get();
        match = {
          companyId: newRef.id,
          companyName: String((created.data() as any)?.name || record.name),
          basis:
            `an attendee from ${rootDomain(domain)} \u2014 this company was added to the CRM from this call`,
          confidence: "domain",
        };
      } else {
        // Recorded, not discarded. Nothing here names one outside company,
        // so there is nothing to create that would not be a guess.
        await db.collection("granola_unmatched").doc(noteId).set({
          noteId,
          title: note.title || note.calendar_event?.title || null,
          occurredAt: note.calendar_event?.scheduled_start_time || note.created_at || null,
          attendees: (note.attendees || []).map((a) => a?.email).filter(Boolean),
          externalDomains: domains,
          webUrl: note.web_url || null,
          meetingKey: key,
          seenAt: new Date().toISOString(),
          reason: domains.length === 0
            ? "no external company on the call"
            : `${domains.length} outside companies on the call`,
        });
        console.log(
          `[granola] ${noteId}: no company matched (${domains.length} external domain(s)); parked for review`,
        );
        return;
      }
    }

    const ref = db.collection("companies").doc(match.companyId);
    const doc = await ref.get();
    if (!doc.exists) return;
    const company = doc.data() as any;

    // --- already logged?
    //
    // Two people at the firm both running Granola produce two notes of the
    // same call. They arrive as separate deliveries with different note ids
    // and the same calendar event, so the calendar event is what identifies
    // the meeting. An edit to a note we already filed updates that entry
    // rather than adding a second one.
    const existing: any[] = Array.isArray(company.interactions) ? company.interactions : [];
    const already = existing.find((i) => i?.granolaMeetingKey === key);
    if (already && eventType === "note.generated") {
      console.log(`[granola] ${noteId}: this meeting is already on ${match.companyName}`);
      return;
    }

    // --- read the company's own figures out of the call, for blanks only
    let facts: any[] = [];
    let nextSteps: string | undefined;
    const blanks = EXTRACTABLE.map((f) => f.field).filter((field) => {
      const v = company[field];
      // location may be a string or a place object; either counts as filled.
      if (field === "location") return !v || (typeof v === "string" ? v.trim() === "" : !v.formatted_address);
      return String(v || "").trim() === "";
    });

    if (!HARD_STOP) {
      try {
        // Not a grounded call, so it draws no search quota — but it is still
        // a model call, and AI_HARD_STOP must silence every one of those.
        const extraction = await extractFacts(getGeminiAI(), GEMINI_MODEL, Type, note, blanks);
        facts = extraction.facts;
        nextSteps = extraction.nextSteps;
      } catch (error: any) {
        // The summary is the point; the extraction is a bonus. A company must
        // still get its call logged when the extraction fails.
        console.warn(`[granola] ${noteId}: extraction failed: ${error?.message || error}`);
      }
    }

    // --- write
    const occurredAt =
      note.calendar_event?.scheduled_start_time || note.created_at || new Date().toISOString();

    const entry = {
      id: already?.id || crypto.randomUUID(),
      date: occurredAt,
      type: "Meeting" as const,
      notes: buildInteractionNote(note, match, facts),
      sentiment: "Neutral" as const,
      source: "granola" as const,
      granolaNoteId: noteId,
      granolaMeetingKey: key,
      granolaUrl: note.web_url || null,
      loggedBy: note.owner?.email || null,
      nextSteps: nextSteps || undefined,
    };

    const patch: Record<string, unknown> = {
      interactions: already
        ? existing.map((i) => (i?.granolaMeetingKey === key ? entry : i))
        : [entry, ...existing],
      lastGranolaSyncAt: new Date().toISOString(),
      lastModified: new Date().toISOString(),
    };

    // Blank fields only, and each one stamped with where it came from. A
    // figure on a company record that nobody can trace back to a sentence
    // somebody said is worth less than an empty field, because it looks
    // exactly like one a person checked.
    const sources: Record<string, unknown> = { ...(company.fieldSources || {}) };
    for (const fact of facts) {
      if (String(company[fact.field] || "").trim() !== "") continue;
      patch[fact.field] = fact.value;
      sources[fact.field] = {
        source: "granola",
        noteId,
        quote: fact.quote,
        meetingTitle: note.title || note.calendar_event?.title || null,
        at: occurredAt,
        url: note.web_url || null,
      };
    }
    /**
     * Next steps are the exception to the blank-only rule.
     *
     * Every other field holds something that was true when it was written and
     * probably still is. A next step is different: last month's "send the
     * deck" is not stale, it is wrong, and leaving it there tells somebody to
     * do a thing that was done weeks ago. So the most recent call wins.
     *
     * A next step a person typed still wins over any call, and a call only
     * overwrites another call's when it is genuinely the later one — which is
     * what makes the backfill safe to run in any order.
     */
    if (nextSteps) {
      const prior = (company.fieldSources || {}).nextSteps;
      const priorAt = prior?.source === "granola" ? Date.parse(prior.at || "") : NaN;
      const typedByAPerson = String(company.nextSteps || "").trim() !== "" && !prior;

      if (!typedByAPerson && (!Number.isFinite(priorAt) || Date.parse(occurredAt) >= priorAt)) {
        patch.nextSteps = nextSteps;
        sources.nextSteps = {
          source: "granola",
          noteId,
          quote: nextSteps,
          meetingTitle: note.title || note.calendar_event?.title || null,
          at: occurredAt,
          url: note.web_url || null,
        };
      }
    }

    if (Object.keys(sources).length) patch.fieldSources = sources;

    await ref.update(patch);
    console.log(
      `[granola] ${noteId}: filed on ${match.companyName} (${match.basis}); ` +
        `${facts.length} field(s) filled`,
    );
  }

  /**
   * Granola calls this when it has finished writing up a meeting.
   *
   * Mounted ABOVE the authentication gate and above the JSON body parser, and
   * both of those placements are load-bearing.
   *
   * Above the gate, because Granola has no Firebase account and cannot present
   * a token. Its HMAC signature is what authenticates it instead — the same
   * shape of argument as the X-Appengine-Cron header on the scheduled jobs,
   * and like that one, this exemption is pinned to a single exact path and
   * grants nothing beyond it.
   *
   * Above the JSON parser, because the signature covers the raw bytes. Express
   * reparses and re-serialises, and what comes back out is not what was
   * signed: key order moves, whitespace goes. A route that parses first can
   * never verify.
   */
  app.post(
    "/api/webhooks/granola",
    express.raw({ type: "*/*", limit: "1mb" }),
    async (req, res) => {
      const secret = process.env.GRANOLA_WEBHOOK_SECRET || "";

      /**
       * No secret yet: answer, but do nothing.
       *
       * Granola probes this URL before it will hand over a signing secret, and
       * the secret is what this endpoint needs in order to trust anything —
       * so refusing the probe until the secret exists makes registration
       * impossible. An earlier version returned 503 here and did exactly that.
       *
       * Answering 200 costs nothing: no payload is read, no note is fetched,
       * nothing is written. It says only "this URL exists", which is the one
       * question the probe is asking. The moment the secret is configured,
       * every delivery has to carry a valid signature again.
       */
      if (!secret) {
        console.warn(
          "[granola] a delivery arrived but GRANOLA_WEBHOOK_SECRET is not set. " +
            "Acknowledged and ignored. Set the secret in env.yaml and redeploy.",
        );
        return res.status(200).json({ status: "awaiting-configuration" });
      }

      const raw = Buffer.isBuffer(req.body) ? req.body.toString("utf8") : String(req.body || "");
      if (!verifyGranolaSignature(req.headers as any, raw, secret)) {
        // Deliberately terse. A rejection that explains itself explains itself
        // to whoever is probing the endpoint.
        console.warn("[granola] rejected a delivery with an invalid signature");
        return res.status(401).json({ error: "Invalid signature." });
      }

      let event: any = {};
      try {
        event = JSON.parse(raw);
      } catch {
        return res.status(400).json({ error: "Malformed body." });
      }

      const noteId = String(event?.note_id || "");
      const type = String(event?.event_type || "");
      if (!noteId) return res.status(400).json({ error: "No note_id." });

      // Granola allows fifteen seconds and retries for four days on a 5xx.
      // Acknowledging first and working afterwards means a slow company match
      // never turns into a duplicate delivery — and an error in our own
      // processing is ours to fix from the logs, not something to make
      // Granola retry for four days.
      res.status(202).json({ received: true });

      if (type !== "note.generated" && type !== "note.edited") return;

      try {
        await ingestGranolaNote(noteId, type);
      } catch (error: any) {
        console.error(`[granola] ${noteId}: ${error?.message || error}`);
      }
    },
  );

  // ---- Authentication gate for every /api route defined below ----
  // Verifies the caller's Firebase ID token and applies the same access
  // policy as firestore.rules. /api/health is defined above this line and
  // stays public so App Engine can health-check the service.

  /**
   * Scheduled jobs authenticate differently from people.
   *
   * App Engine sets X-Appengine-Cron on requests it originates and strips the
   * header from anything arriving off the internet, so its presence is proof
   * the request came from the scheduler. That is the documented mechanism and
   * the only thing standing between /api/cron and the open web — hence the
   * path check: this exemption must never widen to the rest of the API.
   */
  const isCronRequest = (req: any) =>
    req.get("X-Appengine-Cron") === "true" && req.path.startsWith("/cron/");

  app.use("/api", async (req, res, next) => {
    if (isCronRequest(req)) {
      (req as any).isCron = true;
      return next();
    }

    if (!getApps().length) {
      if (process.env.NODE_ENV === "production") {
        console.error("Firebase Admin is not initialised — refusing API requests.");
        return res.status(503).json({ error: "Server authentication is not configured." });
      }
      console.warn("Firebase Admin not initialised — skipping API auth (development only).");
      return next();
    }

    try {
      const header = req.headers.authorization || "";
      const token = header.startsWith("Bearer ") ? header.slice(7).trim() : "";
      if (!token) {
        return res.status(401).json({ error: "Not signed in." });
      }

      const decoded = await getAuth().verifyIdToken(token);
      const email = (decoded.email || "").toLowerCase();
      if (!(decoded.email_verified === true && isAllowed(email))) {
        console.warn(`Rejected API call from unauthorized account: ${email || "unknown"}`);
        return res.status(403).json({ error: "This account is not authorized to use the Stratos VP CRM." });
      }

      (req as any).user = decoded;
      next();
    } catch (err) {
      return res.status(401).json({ error: "Your session has expired. Please sign in again." });
    }
  });

  // Bodies are parsed only once the caller is known to be one of us.
  // /api/extract accepts base64 pitch decks and needs headroom; nothing
  // else does.
  app.use("/api/extract", express.json({ limit: "25mb" }));
  app.use(express.json({ limit: "2mb" }));

  // Per-user rate limit on the AI routes. These call Gemini — two of them
  // with grounded search, which bills at a higher rate — and previously
  // nothing stopped a runaway client loop from spending without limit.
  // In-memory, so the effective ceiling is this multiplied by the instance
  // count; that is a bound, which is what was missing.
  const RATE_WINDOW_MS = 60_000;
  const RATE_MAX_PER_WINDOW = 20;
  const rateBuckets = new Map<string, { start: number; count: number }>();

  app.use("/api", (req, res, next) => {
    // The scheduler is not a user and paces itself; the ceiling here would
    // stop a job part way through and leave the run half-done.
    if ((req as any).isCron) return next();

    const uid = (req as any).user?.uid || "unknown";
    const now = Date.now();

    if (rateBuckets.size > 500) {
      for (const [key, b] of rateBuckets) {
        if (now - b.start > RATE_WINDOW_MS) rateBuckets.delete(key);
      }
    }

    let bucket = rateBuckets.get(uid);
    if (!bucket || now - bucket.start > RATE_WINDOW_MS) {
      bucket = { start: now, count: 0 };
      rateBuckets.set(uid, bucket);
    }

    bucket.count++;
    if (bucket.count > RATE_MAX_PER_WINDOW) {
      const retryAfter = Math.ceil((bucket.start + RATE_WINDOW_MS - now) / 1000);
      console.warn(`Rate limit hit by ${(req as any).user?.email || uid}`);
      res.setHeader("Retry-After", String(retryAfter));
      return res.status(429).json({
        error: `You have made too many AI requests in a short time. Please wait ${retryAfter} seconds and try again.`,
      });
    }

    next();
  });

  const getGeminiAI = () => {
    let apiKey = (
      process.env.API_KEY ||
      process.env.GEMINI_API_KEY ||
      ""
    ).trim();
    if (!apiKey || apiKey === "MY_GEMINI_API_KEY") {
      throw new Error(
        "API key is missing or invalid. The server's Gemini API key is not configured. Contact your administrator."
      );
    }
    return new GoogleGenAI({ apiKey });
  };

  app.post("/api/scan-website", async (req, res) => {
    try {
      const { url } = req.body;
      const ai = getGeminiAI();

      const prompt = `
You are an expert VC analyst. I am providing you with a website URL of a venture capital firm: ${url}.
Using your search capabilities and knowledge base, please identify:
1. A comprehensive list of their portfolio companies (as an array of strings). Please try to find and list as many of their portfolio companies as possible using search.
2. The primary location or headquarters of the firm (as a string).

Return the information strictly as a JSON object matching this schema:
{
  "companies": ["Company 1", "Company 2"],
  "location": "City, State/Country"
}
`;

      await assertCanSpend(getDb(), 1);
      const response = await ai.models.generateContent({
        model: GEMINI_MODEL,
        contents: prompt,
        config: {
          responseMimeType: "application/json",
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              companies: {
                type: Type.ARRAY,
                items: { type: Type.STRING },
                description: "List of portfolio companies",
              },
              location: {
                type: Type.STRING,
                description: "Primary location of the firm",
              },
            },
          },
          tools: [{ googleSearch: {} }],
        },
      });
      noteGrounded(getDb(), 1);   // scan-website

      let text = response.text || "{}";
      text = text
        .replace(/^```(json)?\s*/i, "")
        .replace(/```\s*$/, "")
        .trim();
      let data = {};
      try {
        data = JSON.parse(text);
      } catch (err) {
        console.error("JSON parsing error. Raw response:", text);
        throw err;
      }
      res.json(data);
    } catch (error) {
      if (error instanceof BudgetExhausted) return res.status(429).json({ error: error.message, budgetExhausted: true });
      console.error("Error scanning website:", error);
      res.status(500).json({ error: "Failed to scan website" });
    }
  });

  /**
   * Researches a venture firm: who works there, and what they have backed.
   * Feeds the review lane in the investor profile, so everything it returns is
   * a suggestion someone still has to accept.
   *
   * It reads the firm's own site first and only then falls back on the model's
   * recall. That order is the whole point. Asked "who works at Acme Ventures",
   * a model produces plausible names — some current, some three years stale,
   * some invented outright. Handed the text of acmevc.com/team and asked which
   * names appear in it, the same model is doing extraction, which it is good
   * at, and every answer comes with a URL a person can check.
   *
   * Two constraints are deliberate:
   *
   *   - No email addresses, ever. Asked for a colleague's address a model will
   *     invent a plausible one, and a plausible wrong address is the mistake
   *     nobody catches until mail has gone out. Enforced in the prompt, in the
   *     schema, and again by stripping the field server-side.
   *   - Omit rather than pad. A short accurate list is worth more than a long
   *     one that has to be checked line by line, because a list that needs
   *     checking everywhere gets checked nowhere.
   */
  app.post("/api/scan-investor-firm", async (req, res) => {
    try {
      const { url, firmName } = req.body;
      if (!url && !firmName) {
        return res.status(400).json({ error: "A website or firm name is required." });
      }
      // The research itself lives in investorResearch.ts so the overnight job
      // runs exactly this code rather than a copy of it. The email rules in
      // particular are not something to maintain in two places.
      await assertCanSpend(getDb(), 1);
      const result = await scanFirm(getGeminiAI(), GEMINI_MODEL, { url, firmName });
      // Counted against the same monthly allowance the scheduled jobs draw on,
      // so a night of research cannot quietly spend what somebody clicking
      // Research tomorrow morning was going to need.
      noteGrounded(getDb(), result.groundedCalls);
      res.json(result);
    } catch (error) {
      if (error instanceof BudgetExhausted) return res.status(429).json({ error: error.message, budgetExhausted: true });
      console.error("Error scanning investor firm:", error);
      res.status(500).json({ error: "Failed to scan firm" });
    }
  });

  /**
   * Who does this firm invest alongside?
   *
   * Asked round by round, not all at once. The first version handed the model
   * a whole portfolio and asked it to work out the co-investors across it, and
   * it consistently came back with one or two firms: that is a research
   * project, not a question, and a single answer cannot hold the result of
   * one. Asking "who else was in Acme's rounds?" is a question with an answer,
   * so this fans out over the portfolio, one focused call per company, and
   * aggregates.
   *
   * A firm appearing across several of those rounds is exactly the signal
   * worth surfacing, and it only exists once the results are counted together.
   */
  app.post("/api/discover-firm-coinvestors", async (req, res) => {
    try {
      const { firmName, website, portfolioCompanies, knownFirms } = req.body;
      if (!firmName) {
        return res.status(400).json({ error: "A firm name is required." });
      }
      await assertCanSpend(getDb(), 10);
      const result = await discoverCoInvestors(getGeminiAI(), GEMINI_MODEL, {
        firmName,
        website,
        portfolioCompanies,
        knownFirms,
      });
      noteGrounded(getDb(), result.groundedCalls);
      res.json(result);
    } catch (error) {
      if (error instanceof BudgetExhausted) return res.status(429).json({ error: error.message, budgetExhausted: true });
      console.error("Error discovering firm co-investors:", error);
      res.status(500).json({ error: "Failed to research co-investors" });
    }
  });

  app.post("/api/discover-coinvestors", async (req, res) => {
    try {
      const { companyName, companyDescription, vertical } = req.body;
      const ai = getGeminiAI();

      const prompt = `
You are an expert VC analyst. I am providing you with details of a startup:
Name: ${companyName}
Description: ${companyDescription}
Vertical: ${vertical}

Using your knowledge base and search, suggest 3-5 real Venture Capital firms that are highly likely to invest in this type of company (based on their actual historical investments in this vertical or stage).

Return the information strictly as a JSON object matching this schema:
{
  "investors": [
    {
      "name": "Firm Name",
      "rationale": "Why they are a good fit",
      "similarInvestments": ["Company A", "Company B"]
    }
  ]
}
`;

      await assertCanSpend(getDb(), 1);
      const response = await ai.models.generateContent({
        model: GEMINI_MODEL,
        contents: prompt,
        config: {
          responseMimeType: "application/json",
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              investors: {
                type: Type.ARRAY,
                items: {
                  type: Type.OBJECT,
                  properties: {
                    name: { type: Type.STRING },
                    rationale: { type: Type.STRING },
                    similarInvestments: {
                      type: Type.ARRAY,
                      items: { type: Type.STRING },
                    },
                  },
                },
              },
            },
          },
          tools: [{ googleSearch: {} }],
        },
      });
      noteGrounded(getDb(), 1);   // discover-coinvestors

      let text = response.text || "{}";
      text = text
        .replace(/^```(json)?\s*/i, "")
        .replace(/```\s*$/, "")
        .trim();
      let data = {};
      try {
        data = JSON.parse(text);
      } catch (err) {
        console.error("JSON parsing error. Raw response:", text);
        throw err;
      }
      res.json(data);
    } catch (error) {
      if (error instanceof BudgetExhausted) return res.status(429).json({ error: error.message, budgetExhausted: true });
      console.error("Error discovering coinvestors:", error);
      res.status(500).json({ error: "Failed to discover coinvestors" });
    }
  });

  /**
   * Researches one company found in an investor's portfolio that we do not
   * track yet. Feeds the Sourcing tab.
   *
   * One grounded call establishes the company and its site; the site is then
   * fetched and read directly for the description and for addresses. Splitting
   * it that way is what keeps the email honest — the model is never asked for
   * one, and the only addresses returned are the ones literally printed on a
   * page. An address is attributed to the founder only when its local part
   * actually contains their name; everything else comes back as a general
   * contact address with no person attached to it.
   */
  app.post("/api/enrich-company", async (req, res) => {
    try {
      const { name, viaFirm } = req.body;
      if (!name || String(name).trim() === "") {
        return res.status(400).json({ error: "A company name is required." });
      }
      const ai = getGeminiAI();

      const prompt = `
You are a VC analyst. Using web search, research the startup "${name}"${
        viaFirm ? `, which is a portfolio company of ${viaFirm}` : ""
      }.

Report what you can establish:
- Their official website (the company's own domain, not a directory listing,
  not a news article, not the investor's portfolio page).
- A two-sentence description of what the company does.
- The founder or founders, by name.
- Headquarters location, as "City, Country" or "City, State".
- The sector they operate in.
- The year they were founded.
- Their most recent funding round, if reported.

Rules:
- Do NOT return any email address. There is no email field.
- Do NOT guess a website. An incorrect domain sends someone to a stranger's
  site, so leave it empty unless you are confident it is theirs.
- If more than one company shares this name, pick the one backed by${
        viaFirm ? ` ${viaFirm}` : " a venture investor"
      } and say which in the description.
- If you cannot establish the company at all, return empty fields. That is a
  valid answer.
`;

      await assertCanSpend(getDb(), 1);
      const response = await ai.models.generateContent({
        model: GEMINI_MODEL,
        contents: prompt,
        config: {
          responseMimeType: "application/json",
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              website: { type: Type.STRING },
              description: { type: Type.STRING },
              founderName: { type: Type.STRING },
              location: { type: Type.STRING },
              vertical: { type: Type.STRING },
              yearFounded: { type: Type.STRING },
              lastRound: { type: Type.STRING },
            },
          },
          tools: [{ googleSearch: {} }],
        },
      });
      noteGrounded(getDb(), 1);   // enrich-company

      let text = response.text || "{}";
      text = text.replace(/^```(json)?\s*/i, "").replace(/```\s*$/, "").trim();

      let data: any = {};
      try {
        data = JSON.parse(text);
      } catch (err) {
        console.error("enrich-company: JSON parsing error. Raw response:", text);
        throw err;
      }

      const clean = (v: any) => (typeof v === "string" && v.trim() !== "" ? v.trim() : undefined);

      const website = clean(data.website);
      const founderName = clean(data.founderName);

      // --- read the company's own site for addresses
      //
      // Two different claims come out of this, and they are kept apart on
      // purpose. "The founder's address" requires the address to name them.
      // "An address for this company" requires only that it was printed on
      // their site, so info@ and privacy@ qualify — for a company nobody here
      // knows, a general inbox is often the only way in.
      let contactEmails: string[] = [];
      let founderEmail: string | undefined;
      let emailSourceUrl: string | undefined;
      let alternateEmail: string | undefined;
      let alternateEmailSourceUrl: string | undefined;

      if (website) {
        const pages = await fetchFirmPages(website);
        const seen = new Map<string, string>();
        for (const page of pages) {
          for (const address of page.emails) {
            if (!seen.has(address)) seen.set(address, page.url);
          }
        }
        // Already ordered best-first by extractEmails.
        contactEmails = [...seen.keys()];

        // Attribution is by name match only, and never to a role inbox: a
        // founder called Ira must not be handed ir@ because the letters line up.
        if (founderName) {
          const parts = founderName
            .toLowerCase()
            .split(/[\s,]+/)
            .filter((w) => w.length >= 3);
          for (const address of contactEmails) {
            if (isRoleInbox(address)) continue;
            const local = address.split("@")[0].toLowerCase();
            if (parts.some((part) => local.includes(part))) {
              founderEmail = address;
              emailSourceUrl = seen.get(address);
              break;
            }
          }
        }

        // The best remaining address, whatever it is.
        alternateEmail = contactEmails.find((a) => a !== founderEmail);
        if (alternateEmail) alternateEmailSourceUrl = seen.get(alternateEmail);
      }

      res.json({
        website,
        description: clean(data.description),
        founderName,
        founderEmail,
        alternateEmail,
        alternateEmailSourceUrl,
        contactEmails: contactEmails.slice(0, 8),
        emailSourceUrl,
        location: clean(data.location),
        vertical: clean(data.vertical),
        yearFounded: clean(data.yearFounded),
        lastRound: clean(data.lastRound),
      });
    } catch (error) {
      if (error instanceof BudgetExhausted) return res.status(429).json({ error: error.message, budgetExhausted: true });
      console.error("Error enriching company:", error);
      res.status(500).json({ error: "Failed to research company" });
    }
  });

  // ─────────────────────────────────────────────────────────────────────
  // Scheduled jobs. Authenticated by App Engine's X-Appengine-Cron header,
  // which it strips from external requests — see the gate above.
  //
  // Each returns what it did rather than an empty 200, so a run can be read
  // in the logs without instrumenting anything: "scanned 10, wrote 3" is the
  // difference between a job that works and one that silently does nothing,
  // which is exactly how the sourcing queue managed to never run at all.
  // ─────────────────────────────────────────────────────────────────────

  // app.all, because App Engine cron issues GET. POST is accepted too so a
  // run can be triggered by hand from an authenticated session while testing.
  app.all("/api/cron/portfolio-snapshot", async (_req, res) => {
    try {
      const result = await runPortfolioSnapshot(getDb());
      console.log("[cron] portfolio-snapshot", JSON.stringify(result));
      res.json(result);
    } catch (error: any) {
      console.error("[cron] portfolio-snapshot failed:", error);
      res.status(500).json({ error: error.message });
    }
  });
  app.all("/api/cron/firestore-export", async (_req, res) => {
    try {
      const result = await runFirestoreExport(getDb());
      console.log("[cron] firestore-export", JSON.stringify(result));
      res.json(result);
    } catch (error: any) {
      // Loud on purpose. A backup that quietly stopped running is worse than
      // no backup, because it is a backup people believe they have.
      console.error("[cron] firestore-export FAILED:", error);
      res.status(500).json({ error: error.message });
    }
  });

  /**
   * Works through the investor repository: who works at each firm, and who
   * each firm invests alongside.
   *
   * Runs nightly and takes a slice, rather than the whole list at once. Three
   * reasons, all of which bite: App Engine kills a request at ten minutes, the
   * grounded searches are metered, and a firm researched tonight is not worth
   * researching again tomorrow. It works through the repository over weeks and
   * then keeps it fresh, which is the shape of the job whatever the schedule
   * says.
   *
   * Query parameters exist for running it by hand. ?dryRun=1 researches
   * nothing and reports what a real run would write — the way to find out how
   * many firms a full pass would add before letting it add them.
   */
  app.all("/api/cron/investor-research", async (req, res) => {
    const num = (name: string, fallback?: number) => {
      const raw = req.query[name];
      const n = Number(Array.isArray(raw) ? raw[0] : raw);
      return Number.isFinite(n) && n >= 0 ? n : fallback;
    };
    try {
      const result = await runInvestorResearch(getDb(), getGeminiAI(), GEMINI_MODEL, {
        dryRun: req.query.dryRun === "1" || req.query.dryRun === "true",
        maxInvestors: num("max", Number(process.env.RESEARCH_FIRMS_PER_NIGHT) || undefined),
        maxNewFirms: num("maxNewFirms", Number(process.env.RESEARCH_MAX_NEW_FIRMS) || undefined),
        budgetMs: num("budgetMs"),
        refreshAfterDays: num("refreshAfterDays"),
        includeDiscovered: req.query.includeDiscovered === "1",
      });
      console.log("[cron] investor-research", JSON.stringify(result));
      res.json(result);
    } catch (error: any) {
      console.error("[cron] investor-research failed:", error);
      res.status(500).json({ error: error.message });
    }
  });

  /**
   * Fills in the profile of every firm still waiting for one.
   *
   * The research job discovers firms and creates them thin; this reads each
   * one's own website and fills in the mandate — stages, check size, verticals,
   * fund details, the investment team. Runs an hour after the research pass so
   * a firm found tonight has a profile by morning.
   *
   * ?includeThin=1 also sweeps up firms somebody created by hand that have
   * never had a mandate recorded.
   */
  app.all("/api/cron/enrich-firms", async (req, res) => {
    const num = (name: string, fallback?: number) => {
      const raw = req.query[name];
      const n = Number(Array.isArray(raw) ? raw[0] : raw);
      return Number.isFinite(n) && n >= 0 ? n : fallback;
    };
    try {
      const result = await runFirmEnrichment(getDb(), getGeminiAI(), GEMINI_MODEL, {
        dryRun: req.query.dryRun === "1" || req.query.dryRun === "true",
        maxFirms: num("max", Number(process.env.ENRICH_FIRMS_PER_NIGHT) || undefined),
        budgetMs: num("budgetMs"),
        includeThinManualFirms: req.query.includeThin === "1",
      });
      console.log("[cron] enrich-firms", JSON.stringify(result));
      res.json(result);
    } catch (error: any) {
      console.error("[cron] enrich-firms failed:", error);
      res.status(500).json({ error: error.message });
    }
  });

  app.all("/api/cron/site-diff", async (_req, res) => {
    try {
      const result = await runSiteDiff(getDb());
      console.log("[cron] site-diff", JSON.stringify(result));
      res.json(result);
    } catch (error: any) {
      console.error("[cron] site-diff failed:", error);
      res.status(500).json({ error: error.message });
    }
  });

  /**
   * Checks where a slice of the people in our graph currently work.
   *
   * A small batch on purpose: this is the only job that spends a grounded call
   * per row, and covering everyone every week would be both expensive and
   * pointless — people do not change jobs weekly. Least-recently-checked
   * first, so the whole list is covered over a couple of months.
   */
  app.all("/api/cron/people-watch", async (_req, res) => {
    const BATCH = 12;
    const summary = { job: "people-watch", scanned: 0, signals: 0, notes: [] as string[] };

    try {
      const db = getDb();
      const ai = getGeminiAI();
      const due = await peopleDueForCheck(db, BATCH);

      for (const person of due) {
        summary.scanned++;
        try {
          await assertCanSpend(getDb(), 1);
          const response = await ai.models.generateContent({
            model: GEMINI_MODEL,
            contents: `
Using web search, determine where ${person.name} currently works. Our records
say ${person.org}.

Answer only from what you can actually verify in search results. This is used
to decide whether to contact someone, so a confident wrong answer is worse
than no answer:

- currentOrg: the organisation they work at now. Leave empty if unsure.
- changed: true ONLY if you found clear evidence they have left ${person.org}.
  Absence of evidence is not evidence of a move — if you simply cannot find
  them, changed is false.
- sourceUrl: the page you based this on.
- confidence: "high" only when a specific dated source says so.
`,
            config: {
              responseMimeType: "application/json",
              responseSchema: {
                type: Type.OBJECT,
                properties: {
                  currentOrg: { type: Type.STRING },
                  changed: { type: Type.BOOLEAN },
                  sourceUrl: { type: Type.STRING },
                  confidence: { type: Type.STRING },
                },
              },
              tools: [{ googleSearch: {} }],
            },
          });
          noteGrounded(getDb(), 1);   // people-watch: one grounded check per person

          let text = (response.text || "{}").replace(/^```(json)?\s*/i, "").replace(/```\s*$/, "").trim();
          const verdict = JSON.parse(text);

          const wrote = await recordPersonCheck(db, person, {
            movedTo: typeof verdict.currentOrg === "string" ? verdict.currentOrg.trim() : undefined,
            sourceUrl: typeof verdict.sourceUrl === "string" ? verdict.sourceUrl.trim() : undefined,
            confident: verdict.changed === true && verdict.confidence === "high",
          });
          if (wrote) summary.signals++;
        } catch (err: any) {
          summary.notes.push(`${person.name}: ${err.message}`);
        }

        // Paced for the same reason the sourcing queue is: grounded calls
        // rate-limit, and a burst fails rather than going faster.
        await new Promise((r) => setTimeout(r, 1200));
      }

      console.log("[cron] people-watch", JSON.stringify(summary));
      res.json(summary);
    } catch (error: any) {
      console.error("[cron] people-watch failed:", error);
      res.status(500).json({ error: error.message, ...summary });
    }
  });

  app.post("/api/extract", async (req, res) => {
    try {
      const { notes, type, input } = req.body;
      const ai = getGeminiAI();

      const prompt = `
You are an expert VC analyst. Analyze the following startup data provided.
Extract the following information and return it strictly as a JSON object matching this schema (use null if not found).

Copy figures as the source states them — "~40 enterprise logos", "$1.2M ARR",
"2019 (spun out of Stanford)". Do not round, convert, normalise or infer a
value that is not stated. A figure that is nearly right is worse than a blank
field, because a blank one gets asked about and a wrong one gets quoted.
{
  "name": "Startup Name",
  "website": "Domain",
  "location": "City, State",
  "vertical": "Vertical category",
  "slogan": "Company Slogan",
  "basics": "One paragraph summary",
  "founderName": "Founders",
  "founderEmail": "Emails",
  "foundersBackground": "Who the founders are and what they did before — prior companies, roles, education",
  "yearFounded": "Year the company was founded",
  "entityInfo": "Legal entity and domicile, e.g. Delaware C-Corp",
  "fte": "Headcount / full-time employees",
  "customerCount": "Number of customers, as stated",
  "tam": "Total addressable market, as stated",
  "cashBalance": "Cash on hand, as stated",
  "monthlyBurn": "Monthly burn rate, as stated",
  "useOfFunds": "What they plan to do with the money raised",
  "revenue": "Revenue stats",
  "dealTerms": "Deal terms",
  "pastFinancing": "Past rounds",
  "marketProblem": "Problem statement",
  "companySolution": "Solution statement",
  "competition": "Competition",
  "pricing": "Pricing",
  "gtm": "Go-To-Market (GTM)",
  "source": "Internal Source",
  "externalSource": "External Source",
  "takeaways": "Key takeaways or meeting notes for the interaction",
  "nextSteps": "Actionable next steps"
}
`;

      let contentConfig;

      if (type === "deck" && input) {
        const match = input.match(/^data:(.*?);base64,(.*)$/);
        if (match) {
          const mimeType = match[1];
          const base64Str = match[2];
          contentConfig = {
            parts: [
              { text: prompt },
              { inlineData: { mimeType, data: base64Str } },
            ],
          };
        } else {
          contentConfig = prompt + "\n\nData:\n" + input;
        }
      } else if (notes) {
        contentConfig = prompt + "\n\nData:\n" + notes;
      } else {
        return res.status(400).json({ error: "No input provided" });
      }

      const response = await ai.models.generateContent({
        model: GEMINI_MODEL,
        contents: contentConfig,
        config: {
          responseMimeType: "application/json",
        },
      });

      let result = {};
      try {
        let text = response.text || "{}";
        text = text
          .replace(/^```(json)?\s*/i, "")
          .replace(/```\s*$/, "")
          .trim();
        result = JSON.parse(text);
      } catch (e) {
        console.error("JSON parsing error in /api/extract", e);
      }
      res.json(result);
    } catch (err) {
      console.error("Extract Error:", err);
      res.status(500).json({ error: err.message });
    }
  });

  app.post("/api/describe", async (req, res) => {
    try {
      const { name, website } = req.body;
      const ai = getGeminiAI();

      const prompt = `
You are an expert venture capital analyst.
Write a concise, professional, 1-2 paragraph description of the company "${name}" (${website}).
Focus on what they do, their market, and their core product/service. Do not use filler text.
Output ONLY the raw description text.
`;

      const response = await ai.models.generateContent({
        model: GEMINI_MODEL,
        contents: prompt,
      });

      res.json({ description: response.text });
    } catch (err) {
      console.error("Describe Error:", err);
      res.status(500).json({ error: err.message });
    }
  });

  // The /api/analyze route was removed with the Company Sourcing feature.
  // It was the only caller, and the feature was retired because it
  // displayed fabricated analysis as though it were real results.

  app.post("/api/summarize-conversations", async (req, res) => {
    try {
      const { emails } = req.body;
      if (!Array.isArray(emails) || emails.length === 0) {
        return res.status(400).json({ error: "No emails provided to summarize." });
      }

      const ai = getGeminiAI();
      const transcript = emails
        .map(
          (e) =>
            `Date: ${e.date}\nFrom: ${e.from}\nTo: ${e.to}\nSubject: ${e.subject}\n${e.body || e.snippet || ""}`
        )
        .join("\n\n---\n\n");

      const prompt = `You are an analyst at a venture capital firm. Below is an email thread between the firm and a founder.

Summarize the current state of the relationship in one short paragraph, then list the concrete next steps the firm should take. Be specific and factual. Do not invent commitments that were not actually made.

Return JSON strictly matching this shape:
{ "summary": "one paragraph", "nextSteps": ["step 1", "step 2"] }

Emails:
${transcript}`;

      const response = await ai.models.generateContent({
        model: GEMINI_MODEL,
        contents: prompt,
        config: { responseMimeType: "application/json" },
      });

      const parsed = JSON.parse(response.text || '{"summary":"","nextSteps":[]}');
      res.json({
        summary: parsed.summary || "",
        nextSteps: Array.isArray(parsed.nextSteps) ? parsed.nextSteps : [],
      });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // NOTE: the /api/config route was removed during the Firebase migration.
  // It returned the Gemini API key to any unauthenticated caller and
  // nothing in src/ ever called it. Gemini access stays server-side only.

  const server = http.createServer(app);

  let vite;
  // Vite middleware for development
  if (process.env.NODE_ENV !== "production") {
    const { createServer: createViteServer } = await import("vite");
    vite = await createViteServer({
      server: {
        middlewareMode: true,
        hmr: false,
      },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");

    // Vite gives asset files content-hashed names, so they can be cached
    // forever. index.html must NOT be cached: a browser holding an old copy
    // will ask for asset files that no longer exist after a deploy and
    // render a blank page.
    app.use(
      express.static(distPath, {
        setHeaders: (res, filePath) => {
          if (filePath.endsWith("index.html")) {
            res.setHeader("Cache-Control", "no-cache");
          } else if (filePath.includes(`${path.sep}assets${path.sep}`)) {
            res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
          }
        },
      })
    );

    app.get("*", (req, res) => {
      res.setHeader("Cache-Control", "no-cache");
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  // NodeJS.ErrnoException, not Error: the listener is typed as receiving a
  // plain Error, which has no `code`, so this never compiled.
  server.on("error", (e: NodeJS.ErrnoException) => {
    if (e.code === "EADDRINUSE") {
      console.error(`Port ${PORT} is in use, retrying...`);
      setTimeout(() => {
        server.close();
        server.listen(PORT, "0.0.0.0");
      }, 1000);
    } else {
      console.error("Server error:", e);
    }
  });

  server.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });

  // Graceful shutdown
  const shutdown = async () => {
    console.log("Shutting down server...");
    setTimeout(() => {
      console.log("Forcing exit after timeout");
      process.exit(0);
    }, 1000);

    if (vite) {
      try {
        await vite.close();
      } catch (e) {
        console.error("Error closing Vite:", e);
      }
    }
    server.close(() => {
      console.log("Server closed");
      process.exit(0);
    });
  };

  process.on("SIGTERM", shutdown);
  process.on("SIGINT", shutdown);
}

startServer();
