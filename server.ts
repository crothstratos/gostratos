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

  // ---- Authentication gate for every /api route defined below ----
  // Verifies the caller's Firebase ID token and applies the same access
  // policy as firestore.rules. /api/health is defined above this line and
  // stays public so App Engine can health-check the service.
  const ALLOWED_DOMAIN = "gostratos.vc";
  const REVOKED_EMAILS = new Set([
    "dwhite@gostratos.vc",
    "cjrothai@gmail.com",
    "joe@highwayventures.com",
  ]);

  app.use("/api", async (req, res, next) => {
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
      const allowed =
        decoded.email_verified === true &&
        email.endsWith("@" + ALLOWED_DOMAIN) &&
        !REVOKED_EMAILS.has(email);

      if (!allowed) {
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

      const response = await ai.models.generateContent({
        model: "gemini-3.6-flash",
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
      const ai = getGeminiAI();

      // --- read the firm's own site, if we were given one
      const pages = url ? await fetchFirmPages(String(url)) : [];
      const siteText = pages
        .map((p) => `--- PAGE: ${p.url} ---\n${p.text}`)
        .join("\n\n");

      // Every address printed anywhere on the pages we read. The model may
      // only pick from this list; it may not compose one.
      //
      // Role inboxes are excluded here specifically. This list exists so the
      // model can attach an address to a named partner, and info@ attached to
      // a person reads as their personal address and gets used as one.
      const siteEmails = [...new Set(pages.flatMap((p) => p.emails))].filter(
        (address) => !isRoleInbox(address),
      );
      const emailByAddress = new Map<string, string>();
      for (const page of pages) {
        for (const address of page.emails) {
          if (isRoleInbox(address)) continue;
          if (!emailByAddress.has(address)) emailByAddress.set(address, page.url);
        }
      }

      const subject = firmName
        ? `the venture capital firm "${firmName}"${url ? ` (website: ${url})` : ""}`
        : `the venture capital firm at ${url}`;

      const sourceSection = pages.length
        ? `
Below is the text of ${pages.length} page(s) from the firm's own website. This
is your PRIMARY source and it outranks anything you recall or find elsewhere:
it is current, and it is the firm describing itself.

For every person whose name appears in this text, set source to "website" and
sourceUrl to the PAGE url they appeared on. Do not set source to "website" for
anyone who is not named in the text below.

${
  siteEmails.length
    ? `These email addresses were found printed on those pages:
${siteEmails.join("\n")}

If one of them clearly belongs to a specific person you are listing, put it in
that person's email field, copied EXACTLY. If you are not sure whose it is,
leave the person's email empty. Never write an address that is not on this
list, even if the pattern seems obvious.`
    : `No email addresses were found on those pages, so leave every person's
email field empty.`
}

${siteText}
`
        : `
No usable text could be retrieved from the firm's website (it may block
automated readers, require a login, or render entirely in JavaScript). Fall
back on web search, and set source to "search" for everyone you list.
`;

      const prompt = `
You are a VC research analyst. Research ${subject}.
${sourceSection}

Report:
1. The people who work at the firm — investment team, partners, principals,
   operating partners. Give name, job title, which source the person came
   from, and their email ONLY if it is in the list of addresses above.
2. Their portfolio companies, named as the company names itself, with a brief
   note of where you saw each listed.
3. The firm's headquarters city.

Rules, which matter more than completeness:
- NEVER invent or infer an email address. Do not derive one from a pattern you
  notice in the other addresses. Copy exactly from the supplied list or leave
  the field empty. An address that looks right but is wrong is worse than none.
- Do NOT guess at anything else either. If you are not confident a person
  currently works there, or that a company is in their portfolio, leave it out.
- Do not include people who have left the firm.
- Prefer the website text over your own recollection wherever they disagree.
- If you cannot find reliable information, return empty arrays. Returning
  nothing is a valid and useful answer.
`;

      const response = await ai.models.generateContent({
        model: "gemini-3.6-flash",
        contents: prompt,
        config: {
          responseMimeType: "application/json",
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              companies: {
                type: Type.ARRAY,
                description: "Portfolio companies the firm has invested in",
                items: {
                  type: Type.OBJECT,
                  properties: {
                    name: { type: Type.STRING },
                    evidence: { type: Type.STRING, description: "Briefly, where this was found" },
                  },
                },
              },
              people: {
                type: Type.ARRAY,
                description: "People currently at the firm. Never include email addresses.",
                items: {
                  type: Type.OBJECT,
                  properties: {
                    name: { type: Type.STRING },
                    role: { type: Type.STRING },
                    email: {
                      type: Type.STRING,
                      description: "Only an address copied exactly from the supplied list. Never composed.",
                    },
                    source: {
                      type: Type.STRING,
                      description: "'website' if named in the supplied page text, otherwise 'search'",
                    },
                    sourceUrl: {
                      type: Type.STRING,
                      description: "The page URL this person was found on, when source is 'website'",
                    },
                  },
                },
              },
              location: { type: Type.STRING, description: "Headquarters city" },
            },
          },
          tools: [{ googleSearch: {} }],
        },
      });

      let text = response.text || "{}";
      text = text.replace(/^```(json)?\s*/i, "").replace(/```\s*$/, "").trim();

      let data: any = {};
      try {
        data = JSON.parse(text);
      } catch (err) {
        console.error("scan-investor-firm: JSON parsing error. Raw response:", text);
        throw err;
      }

      const pageUrls = new Set(pages.map((p) => p.url));
      const pageText = siteText.toLowerCase();

      // Belt and braces. The prompt and the schema both exclude emails; a model
      // that returns one anyway must not have it reach the client.
      //
      // The source claim is verified rather than trusted: a person is only
      // labelled as coming from the website if their name is actually in the
      // text we fetched. Without this check "website" would mean "the model
      // said website", which is exactly the assurance we are trying to avoid.
      const rawPeople = Array.isArray(data.people) ? data.people : [];
      const seenPeople = new Set<string>();
      const cleanPeople = rawPeople
        .filter((p: any) => p && typeof p.name === "string" && p.name.trim() !== "")
        .map((p: any) => {
          const name = String(p.name).trim();
          const claimedUrl = p.sourceUrl ? String(p.sourceUrl).trim() : "";
          // Named in text we actually fetched. Not proof of employment, but it
          // is proof the firm's own site says so, which is the claim being made.
          const verified = pages.length > 0 && pageText.includes(name.toLowerCase());

          // The address must be one we read off the page. The prompt says so
          // too, but a prompt is a request and this is the enforcement: a model
          // that helpfully constructs first.last@firm.com gets it dropped here,
          // silently and every time.
          const claimedEmail = p.email ? String(p.email).trim().toLowerCase() : "";
          const emailIsReal = claimedEmail !== "" && emailByAddress.has(claimedEmail);

          return {
            name,
            role: p.role ? String(p.role).trim() : undefined,
            email: emailIsReal ? claimedEmail : undefined,
            emailSourceUrl: emailIsReal ? emailByAddress.get(claimedEmail) : undefined,
            source: verified ? "website" : "search",
            sourceUrl: verified && pageUrls.has(claimedUrl) ? claimedUrl : undefined,
          };
        })
        .filter((p: any) => {
          const key = p.name.toLowerCase();
          if (seenPeople.has(key)) return false;
          seenPeople.add(key);
          return true;
        });

      const rawCompanies = Array.isArray(data.companies) ? data.companies : [];
      const seenCompanies = new Set<string>();
      const cleanCompanies = rawCompanies
        .filter((c: any) => c && typeof c.name === "string" && c.name.trim() !== "")
        .map((c: any) => ({
          name: String(c.name).trim(),
          evidence: c.evidence ? String(c.evidence).trim() : undefined,
        }))
        .filter((c: any) => {
          const key = c.name.toLowerCase();
          if (seenCompanies.has(key)) return false;
          seenCompanies.add(key);
          return true;
        });

      res.json({
        companies: cleanCompanies,
        people: cleanPeople,
        location: typeof data.location === "string" ? data.location : undefined,
        pagesRead: pages.map((p) => p.url),
      });
    } catch (error) {
      console.error("Error scanning investor firm:", error);
      res.status(500).json({ error: "Failed to scan firm" });
    }
  });

  /**
   * Who does this firm invest alongside?
   *
   * Answers it from actual rounds — "both were in Acme's Series A" — rather
   * than from thematic similarity, because a firm that merely looks similar is
   * not a warm introduction and a firm that has shared three cap tables is.
   * Each recommendation comes back with enough of a profile to judge it
   * without leaving the page, and with the deals that justify it, so a
   * suggestion can be checked rather than taken on faith.
   */
  app.post("/api/discover-firm-coinvestors", async (req, res) => {
    try {
      const { firmName, website, portfolioCompanies, knownFirms } = req.body;
      if (!firmName) {
        return res.status(400).json({ error: "A firm name is required." });
      }
      const ai = getGeminiAI();

      const portfolio = Array.isArray(portfolioCompanies) ? portfolioCompanies.slice(0, 60) : [];
      const known = Array.isArray(knownFirms) ? knownFirms.slice(0, 200) : [];

      const prompt = `
You are a VC research analyst. Using web search, research which other investors
have participated in the same funding rounds as ${firmName}${website ? ` (${website})` : ""}.

${
  portfolio.length
    ? `These are companies we believe ${firmName} has backed. Look at the rounds
in these companies in particular:
${portfolio.join(", ")}`
    : `Start by finding the companies ${firmName} has backed, then look at who
else was in those rounds.`
}

For each co-investor you can evidence, report:
- Their firm name.
- A one-or-two sentence description of what they do.
- The stages they invest at (e.g. "Pre-seed, Seed").
- Their typical check size, if reported anywhere.
- The sectors they focus on.
- Their website.
- Which specific companies they and ${firmName} were both investors in. This is
  the evidence for the recommendation, so it must be real.
- How many of those shared deals you found.

Rules:
- Only list a firm where you can name at least one company both invested in. A
  firm that merely looks similar is not a co-investor and is not useful here.
- Do NOT invent shared deals. If you cannot name the company, leave the firm out.
- Prefer firms with more shared deals, and list at most 12.
- If you cannot evidence any co-investors, return an empty array. That is a
  valid answer.
`;

      const response = await ai.models.generateContent({
        model: "gemini-3.6-flash",
        contents: prompt,
        config: {
          responseMimeType: "application/json",
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              coInvestors: {
                type: Type.ARRAY,
                items: {
                  type: Type.OBJECT,
                  properties: {
                    firmName: { type: Type.STRING },
                    description: { type: Type.STRING },
                    stages: { type: Type.STRING },
                    checkSize: { type: Type.STRING },
                    sectors: { type: Type.STRING },
                    website: { type: Type.STRING },
                    sharedDeals: {
                      type: Type.ARRAY,
                      description: "Companies both firms invested in. Must be real and nameable.",
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

      let text = response.text || "{}";
      text = text.replace(/^```(json)?\s*/i, "").replace(/```\s*$/, "").trim();

      let data: any = {};
      try {
        data = JSON.parse(text);
      } catch (err) {
        console.error("discover-firm-coinvestors: JSON parsing error. Raw response:", text);
        throw err;
      }

      const normalise = (v: string) => v.toLowerCase().replace(/[^a-z0-9]/g, "");
      const knownSet = new Set(known.map((k: any) => normalise(String(k))));
      const selfKey = normalise(String(firmName));

      const raw = Array.isArray(data.coInvestors) ? data.coInvestors : [];
      const seen = new Set<string>();

      const cleaned = raw
        .filter((c: any) => c && typeof c.firmName === "string" && c.firmName.trim() !== "")
        .map((c: any) => ({
          firmName: String(c.firmName).trim(),
          description: c.description ? String(c.description).trim() : undefined,
          stages: c.stages ? String(c.stages).trim() : undefined,
          checkSize: c.checkSize ? String(c.checkSize).trim() : undefined,
          sectors: c.sectors ? String(c.sectors).trim() : undefined,
          website: c.website ? String(c.website).trim() : undefined,
          sharedDeals: Array.isArray(c.sharedDeals)
            ? c.sharedDeals.filter((d: any) => typeof d === "string" && d.trim() !== "").map((d: string) => d.trim())
            : [],
        }))
        // The whole premise is a shared cap table. No named deal, no entry —
        // otherwise this degrades into a list of firms that sound alike.
        .filter((c: any) => c.sharedDeals.length > 0)
        .filter((c: any) => {
          const key = normalise(c.firmName);
          if (key === selfKey || seen.has(key)) return false;
          seen.add(key);
          return true;
        })
        .map((c: any) => ({ ...c, alreadyInRepository: knownSet.has(normalise(c.firmName)) }))
        .sort((a: any, b: any) => b.sharedDeals.length - a.sharedDeals.length)
        .slice(0, 12);

      res.json({ coInvestors: cleaned });
    } catch (error) {
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

      const response = await ai.models.generateContent({
        model: "gemini-3.6-flash",
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

      const response = await ai.models.generateContent({
        model: "gemini-3.6-flash",
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
      console.error("Error enriching company:", error);
      res.status(500).json({ error: "Failed to research company" });
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
        model: "gemini-3.6-flash",
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
        model: "gemini-3.6-flash",
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

  app.post("/api/analyze-email", async (req, res) => {
    try {
      const { emailContent, investorType } = req.body;
      const ai = getGeminiAI();
      const prompt = `Analyze this VC email (${investorType}):\n${emailContent}\nExtract an array of tasks or next steps based on the context. Return JSON: { "tasks": ["task 1", "task 2"] }`;
      const response = await ai.models.generateContent({
        model: "gemini-3.6-flash",
        contents: prompt,
        config: { responseMimeType: "application/json" },
      });
      res.json(JSON.parse(response.text || '{"tasks": []}'));
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post("/api/search-chat", async (req, res) => {
    try {
      const { query, localCompanies = [] } = req.body;
      const ai = getGeminiAI();

      // Cap what reaches the model. Sending the whole pipeline works today
      // but will eventually exceed the context window and costs tokens on
      // every question. Over the cap, keep the companies whose text matches
      // the query, then fill the remainder with the rest.
      const MAX_COMPANIES = 250;
      let scopedCompanies = localCompanies;
      let wasTruncated = false;

      if (localCompanies.length > MAX_COMPANIES) {
        const terms = String(query || "")
          .toLowerCase()
          .split(/[^a-z0-9]+/)
          .filter((t) => t.length > 2);

        const matches = (c) => {
          const hay = JSON.stringify(c).toLowerCase();
          return terms.some((t) => hay.includes(t));
        };

        const relevant = localCompanies.filter(matches);
        const rest = localCompanies.filter((c) => !matches(c));
        scopedCompanies = [...relevant, ...rest].slice(0, MAX_COMPANIES);
        wasTruncated = true;
        console.log(
          `search-chat: ${localCompanies.length} companies reduced to ${scopedCompanies.length} (${relevant.length} keyword matches)`
        );
      }
      const finalPrompt = `
You are an expert Venture Capital Analyst and Data Assistant for a Venture Capital firm.
Your job is to help the VC team evaluate, source, and learn more about startups in our internal database.
The user (a VC associate or partner) asked: "${query}"

Here is the local CRM Web App Data from the active session (companies currently tracked on the kanban boards):
${
  scopedCompanies.length > 0
    ? JSON.stringify(
        scopedCompanies.map((c) => ({
          name: c.name,
          stage: c.stage,
          vertical: c.vertical,
          location: c.location,
          fund: c.fund,
          basics: c.basics,
        })),
        null,
        2
      )
    : "No local CRM companies available or none tracked."
}
${
  wasTruncated
    ? `\nNOTE: the firm tracks ${localCompanies.length} companies; only the ${scopedCompanies.length} most relevant to this question are shown. Say so if the answer might be incomplete.`
    : ""
}

Instructions:
1. Act as a trusted VC analyst. Answer the user's question clearly, concisely, and professionally using ONLY the provided data.
2. Format your response beautifully in Markdown:
   - Start with a direct, insightful summary (the "TL;DR").
   - Use Markdown tables to cleanly display lists of companies or comparisons.
   - Use bullet points for key takeaways, strengths, or observations.
   - Bold key metrics (e.g., **Revenue**, **Raise Size**, **Location**).
3. STRICT DATA POLICY: If the data to answer the user's question is missing, incomplete, or the result set is empty:
   - CLEARLY state that you do not have that information in the current database.
   - Do NOT invent, hallucinate, or guess data.
   - Do NOT complain about JSON schemas or SQL queries. Just state the facts.
4. Provide analytical depth (e.g., identifying market trends, comparing burn rates, or noting funding stage patterns) if the data supports it, rather than just regurgitating rows.
      `;

      const finalResponse = await ai.models.generateContent({
        model: "gemini-3.6-flash",
        contents: finalPrompt,
      });

      res.json({ response: finalResponse.text });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // The Gmail OAuth routes, the email-sync endpoints and the 15-minute
  // background sync job were removed during the Firebase migration. Their
  // front-end buttons had already been stripped out by an AI Studio script,
  // so they were unreachable code left exposed on a public endpoint.
  // The live Gmail/Calendar features call Google's APIs directly from the
  // browser using the token from Google sign-in.

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
        model: "gemini-3.6-flash",
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

  server.on("error", (e) => {
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
