import type { Firestore } from "firebase-admin/firestore";
import { GoogleGenAI, Type } from "@google/genai";
import {
  fetchFirmPages,
  fetchHomepage,
  isRoleInbox,
  stripCitations,
  extractWebsite,
} from "./siteScrape.ts";
import type { JobResult } from "./cronJobs.ts";

/**
 * Researching a venture firm: who works there, and who they invest alongside.
 *
 * Both routines used to live inline in server.ts route handlers, which was
 * fine while a person clicking a button was the only caller. The overnight job
 * is a second caller, and the alternative to extracting them was copying four
 * hundred lines that include the email-verification rules — the exact code
 * that must never be allowed to drift into a second, subtly different version.
 * So the HTTP routes and the scheduled job now run the same functions.
 *
 * The rule those functions enforce, stated once: an email address reaches the
 * CRM only if that exact string was printed on a page this server fetched. Not
 * derived from a pattern, not recalled, not inferred from a name. It is
 * checked in the prompt, constrained in the schema, and then verified again
 * here against the pages actually read — because the first two are requests
 * and only the third is enforcement.
 */

const normalise = (s: string) =>
  String(s || "").toLowerCase().normalize("NFKD").replace(/[^a-z0-9]/g, "");

// ───────────────────────────────────────────────────────────────────────────
// Scanning a firm
// ───────────────────────────────────────────────────────────────────────────

export interface ScannedPerson {
  name: string;
  role?: string;
  email?: string;
  emailSourceUrl?: string;
  /** 'website' means the name was in text we fetched. Verified, not claimed. */
  source: "website" | "search";
  sourceUrl?: string;
}

export interface ScannedCompany {
  name: string;
  evidence?: string;
}

export interface FirmScan {
  companies: ScannedCompany[];
  people: ScannedPerson[];
  location?: string;
  pagesRead: string[];
}

export async function scanFirm(
  ai: GoogleGenAI,
  model: string,
  opts: { url?: string; firmName?: string },
): Promise<FirmScan> {
  const { url, firmName } = opts;

  const pages = url ? await fetchFirmPages(String(url)) : [];
  const siteText = pages.map((p) => `--- PAGE: ${p.url} ---\n${p.text}`).join("\n\n");

  // Every address printed anywhere on the pages we read. The model may only
  // pick from this list; it may not compose one.
  //
  // Role inboxes are excluded here specifically. This list exists so the model
  // can attach an address to a named partner, and info@ attached to a person
  // reads as their personal address and gets used as one.
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
    model,
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
    console.error("scanFirm: JSON parsing error. Raw response:", text.slice(0, 500));
    throw err;
  }

  const pageUrls = new Set(pages.map((p) => p.url));
  const pageText = siteText.toLowerCase();

  // Belt and braces. The prompt and the schema both exclude emails; a model
  // that returns one anyway must not have it reach the client.
  //
  // The source claim is verified rather than trusted: a person is only
  // labelled as coming from the website if their name is actually in the text
  // we fetched. Without this check "website" would mean "the model said
  // website", which is exactly the assurance we are trying to avoid.
  const rawPeople = Array.isArray(data.people) ? data.people : [];
  const seenPeople = new Set<string>();
  const people: ScannedPerson[] = rawPeople
    .filter((p: any) => p && typeof p.name === "string" && p.name.trim() !== "")
    .map((p: any): ScannedPerson => {
      const name = stripCitations(String(p.name)).trim();
      const claimedUrl = p.sourceUrl ? String(p.sourceUrl).trim() : "";
      const verified = pages.length > 0 && pageText.includes(name.toLowerCase());

      const claimedEmail = p.email ? String(p.email).trim().toLowerCase() : "";
      const emailIsReal = claimedEmail !== "" && emailByAddress.has(claimedEmail);

      return {
        name,
        role: p.role ? stripCitations(String(p.role)).trim() : undefined,
        email: emailIsReal ? claimedEmail : undefined,
        emailSourceUrl: emailIsReal ? emailByAddress.get(claimedEmail) : undefined,
        source: verified ? "website" : "search",
        sourceUrl: verified && pageUrls.has(claimedUrl) ? claimedUrl : undefined,
      };
    })
    .filter((p: ScannedPerson) => {
      if (p.name === "") return false;
      const key = p.name.toLowerCase();
      if (seenPeople.has(key)) return false;
      seenPeople.add(key);
      return true;
    });

  const rawCompanies = Array.isArray(data.companies) ? data.companies : [];
  const seenCompanies = new Set<string>();
  const companies: ScannedCompany[] = rawCompanies
    .filter((c: any) => c && typeof c.name === "string" && c.name.trim() !== "")
    .map((c: any) => ({
      name: stripCitations(String(c.name)).trim(),
      evidence: c.evidence ? stripCitations(String(c.evidence)).trim() : undefined,
    }))
    .filter((c: ScannedCompany) => {
      if (c.name === "") return false;
      const key = c.name.toLowerCase();
      if (seenCompanies.has(key)) return false;
      seenCompanies.add(key);
      return true;
    });

  return {
    companies,
    people,
    location: typeof data.location === "string" ? stripCitations(data.location).trim() : undefined,
    pagesRead: pages.map((p) => p.url),
  };
}

/**
 * How senior a job title sounds, lower being more senior.
 *
 * Used only for ordering, never for filtering. A firm's team page can list
 * forty people and the two worth seeing first are the ones who sign cheques;
 * without this the list arrives in whatever order the model happened to emit,
 * which is usually page order, which is usually alphabetical.
 *
 * An unrecognised title sorts last rather than being dropped. Firms invent
 * titles constantly and a "Venture Advisor" is still a real person.
 */
const SENIORITY: RegExp[] = [
  /\bfound(er|ing)\b|\bco-?founder\b/i,
  /\bmanaging (partner|director)\b|\bchief executive\b|\bceo\b/i,
  /\bgeneral partner\b|\bgp\b/i,
  /\bpartner\b/i,
  /\bprincipal\b/i,
  /\b(chief|c[toifm]o)\b/i,
  /\bvice president\b|\bvp\b/i,
  /\bdirector\b/i,
  /\bassociate\b/i,
  /\banalyst\b/i,
];

export function seniorityRank(role?: string): number {
  const r = String(role || "");
  for (let i = 0; i < SENIORITY.length; i++) if (SENIORITY[i].test(r)) return i;
  return SENIORITY.length;
}

// ───────────────────────────────────────────────────────────────────────────
// Who a firm invests alongside
// ───────────────────────────────────────────────────────────────────────────

export interface CoInvestor {
  firmName: string;
  description?: string;
  stages?: string;
  checkSize?: string;
  sectors?: string;
  website?: string;
  sharedDeals: string[];
  rounds: string[];
  alreadyInRepository: boolean;
  emails: string[];
}

export interface CoInvestorResult {
  coInvestors: CoInvestor[];
  diagnostics: { returned: number; dropped: number; companiesExamined: string[] };
}

/**
 * Asked round by round, not all at once.
 *
 * The first version handed the model a whole portfolio and asked it to work
 * out the co-investors across it, and it consistently came back with one or
 * two firms: that is a research project, not a question, and a single answer
 * cannot hold the result of one. Asking "who else was in Acme's rounds?" is a
 * question with an answer, so this fans out over the portfolio, one focused
 * call per company, and aggregates.
 *
 * A firm appearing across several of those rounds is exactly the signal worth
 * surfacing, and it only exists once the results are counted together.
 */
export async function discoverCoInvestors(
  ai: GoogleGenAI,
  model: string,
  opts: {
    firmName: string;
    website?: string;
    portfolioCompanies?: string[];
    knownFirms?: string[];
    maxCompanies?: number;
  },
): Promise<CoInvestorResult> {
  const { firmName, website } = opts;
  const selfKey = normalise(firmName);
  const knownSet = new Set((opts.knownFirms || []).map((k) => normalise(String(k))));

  // Bounded: each of these is a grounded call, and they run together.
  const MAX_COMPANIES = opts.maxCompanies ?? 8;

  let portfolio: string[] = (opts.portfolioCompanies || [])
    .filter((c) => typeof c === "string" && c.trim() !== "")
    .map((c) => c.trim());

  // With no portfolio on file there is nothing to fan out over, so one call
  // establishes some first.
  if (portfolio.length === 0) {
    const seed = await ai.models.generateContent({
      model,
      contents: `Using web search, list up to ${MAX_COMPANIES} companies that the venture firm "${firmName}"${
        website ? ` (${website})` : ""
      } has invested in. Return only company names you can evidence.`,
      config: {
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.OBJECT,
          properties: { companies: { type: Type.ARRAY, items: { type: Type.STRING } } },
        },
        tools: [{ googleSearch: {} }],
      },
    });
    try {
      const parsed = JSON.parse(
        (seed.text || "{}").replace(/^```(json)?\s*/i, "").replace(/```\s*$/, "").trim(),
      );
      portfolio = (parsed.companies || [])
        .filter((c: any) => typeof c === "string")
        .map((c: string) => stripCitations(c).trim())
        .filter(Boolean);
    } catch {
      portfolio = [];
    }
  }

  const examined = portfolio.slice(0, MAX_COMPANIES);
  if (examined.length === 0) {
    return { coInvestors: [], diagnostics: { returned: 0, dropped: 0, companiesExamined: [] } };
  }

  // --- one focused question per company, run together
  const perCompany = await Promise.all(
    examined.map(async (company) => {
      try {
        const response = await ai.models.generateContent({
          model,
          contents: `
Using web search, list the investors that have participated in funding rounds
for the company "${company}". We already know ${firmName} is an investor.

For each other investor, give the firm's name and which round they took part in
(for example "Series A, 2023"). Include every investor you can evidence, not
just the well-known ones.

Do not invent investors. If you cannot establish who backed this company,
return an empty array. Do not include citation markers in any field.
`,
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
                      firmName: { type: Type.STRING },
                      round: { type: Type.STRING },
                    },
                  },
                },
              },
            },
            tools: [{ googleSearch: {} }],
          },
        });

        const parsed = JSON.parse(
          (response.text || "{}").replace(/^```(json)?\s*/i, "").replace(/```\s*$/, "").trim(),
        );
        const investors = (parsed.investors || [])
          .map((i: any) => ({
            firmName: stripCitations(String(i?.firmName || "")).trim(),
            round: stripCitations(String(i?.round || "")).trim(),
          }))
          .filter((i: any) => i.firmName !== "" && normalise(i.firmName) !== selfKey);
        return { company, investors };
      } catch (err: any) {
        console.warn(`[coinvestors] ${company}: ${err.message}`);
        return { company, investors: [] as { firmName: string; round: string }[] };
      }
    }),
  );

  // --- aggregate: a firm's weight is how many of these rounds it shared
  const byFirm = new Map<string, { firmName: string; sharedDeals: string[]; rounds: string[] }>();

  for (const { company, investors } of perCompany) {
    for (const investor of investors) {
      const key = normalise(investor.firmName);
      const entry = byFirm.get(key);
      if (entry) {
        if (!entry.sharedDeals.includes(company)) {
          entry.sharedDeals.push(company);
          if (investor.round) entry.rounds.push(`${company} (${investor.round})`);
        }
      } else {
        byFirm.set(key, {
          firmName: investor.firmName,
          sharedDeals: [company],
          rounds: investor.round ? [`${company} (${investor.round})`] : [],
        });
      }
    }
  }

  const ranked = [...byFirm.values()]
    .sort((a, b) => b.sharedDeals.length - a.sharedDeals.length)
    .slice(0, 20);

  // --- one call to profile the firms actually worth showing
  const profiles: Record<string, any> = {};
  if (ranked.length > 0) {
    try {
      const response = await ai.models.generateContent({
        model,
        contents: `
Using web search, profile each of these venture investors:

${ranked.map((r) => `- ${r.firmName}`).join("\n")}

For each, give: a one or two sentence description of what they do, the stages
they invest at, their typical check size if it is reported anywhere, the
sectors they focus on, and their website.

Leave a field empty rather than guessing at it. Write plain prose with no
citation markers, reference numbers or bracketed indices.
`,
        config: {
          responseMimeType: "application/json",
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              firms: {
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
                  },
                },
              },
            },
          },
          tools: [{ googleSearch: {} }],
        },
      });

      const parsed = JSON.parse(
        (response.text || "{}").replace(/^```(json)?\s*/i, "").replace(/```\s*$/, "").trim(),
      );
      for (const firm of parsed.firms || []) {
        if (firm?.firmName) profiles[normalise(String(firm.firmName))] = firm;
      }
    } catch (err: any) {
      console.warn(`[coinvestors] profiling failed: ${err.message}`);
    }
  }

  const text_ = (v: any, cap = 400): string | undefined => {
    if (typeof v !== "string") return undefined;
    const t = stripCitations(v).slice(0, cap).trim();
    return t === "" ? undefined : t;
  };

  const cleaned: CoInvestor[] = ranked.map((r) => {
    const profile = profiles[normalise(r.firmName)] || {};
    return {
      firmName: r.firmName,
      description: text_(profile.description, 400),
      stages: text_(profile.stages, 120),
      checkSize: text_(profile.checkSize, 80),
      sectors: text_(profile.sectors, 160),
      website: profile.website ? extractWebsite(String(profile.website)) : undefined,
      sharedDeals: r.sharedDeals,
      rounds: r.rounds.slice(0, 6),
      alreadyInRepository: knownSet.has(normalise(r.firmName)),
      emails: [] as string[],
    };
  });

  // Addresses come off each firm's own homepage, never from the model.
  await Promise.all(
    cleaned.map(async (c) => {
      if (!c.website) return;
      try {
        const home = await fetchHomepage(c.website);
        if (home) c.emails = home.emails.slice(0, 3);
      } catch {
        /* a firm whose site will not load simply has no addresses */
      }
    }),
  );

  console.log(
    `[coinvestors] ${firmName}: examined ${examined.length} companies, ` +
      `found ${byFirm.size} distinct firms, returning ${cleaned.length}`,
  );

  return {
    coInvestors: cleaned,
    diagnostics: {
      returned: byFirm.size,
      dropped: byFirm.size - cleaned.length,
      companiesExamined: examined,
    },
  };
}

// ───────────────────────────────────────────────────────────────────────────
// The overnight job
// ───────────────────────────────────────────────────────────────────────────

const INVESTORS = "investor_repository";

export interface InvestorResearchOptions {
  /**
   * Wall-clock budget. App Engine terminates a cron request at ten minutes,
   * and a killed run is worse than a short one: the work is paid for and
   * thrown away, and nothing records where it got to. So the job checks the
   * clock before starting each firm and stops early of its own accord.
   */
  budgetMs?: number;
  /** Hard cap on firms per run, whatever the budget would have allowed. */
  maxInvestors?: number;
  /** Hard cap on new firms created per run. The runaway guard — see below. */
  maxNewFirms?: number;
  /** Website-verified people added outright; the rest queue for review. */
  maxAutoContacts?: number;
  /** A firm researched more recently than this is left alone. */
  refreshAfterDays?: number;
  /**
   * Research everything and report what it would have written, without
   * writing any of it. The way to find out what a full pass costs and how
   * many firms it would add before letting it add them.
   */
  dryRun?: boolean;
  /**
   * Whether firms this job created itself are eligible to be researched.
   *
   * Off, and it must stay off by default. Each firm researched yields up to
   * twenty co-investors, so a repository that researches its own discoveries
   * grows geometrically: twenty firms become four hundred become eight
   * thousand, and every one of them costs grounded searches. "Every investor
   * we have right now" is a finite list. Its output is not an addition to it.
   */
  includeDiscovered?: boolean;
}

interface Candidate {
  id: string;
  firmName: string;
  website: string;
  portfolioCompanies: string[];
  lastAutoResearchAt?: string;
}

/**
 * Works through the investor repository overnight: who works at each firm, and
 * who each firm invests alongside.
 *
 * Two things are deliberately different from the buttons in the app.
 *
 * People found on the firm's own website are added to Team & Contacts outright,
 * stamped `provenance: 'ai'` so nobody mistakes them for someone a colleague
 * confirmed. People the model only found by search are queued for review
 * instead. The distinction is the one the scan already verifies — whether the
 * name was in text this server fetched — and it is the difference between "the
 * firm says so" and "a model recalls so".
 *
 * Co-investor firms not already in the repository are created as new records.
 * That is a large, opinionated write, so every one of them carries
 * `sourceKind: 'co-investor-discovery'` and the firm it came from. They can be
 * filtered out of any view and deleted in bulk, which is what makes it safe to
 * let a machine add them at all.
 */
export async function runInvestorResearch(
  db: Firestore,
  ai: GoogleGenAI,
  model: string,
  opts: InvestorResearchOptions = {},
): Promise<JobResult> {
  const budgetMs = opts.budgetMs ?? 8 * 60 * 1000;
  const maxInvestors = opts.maxInvestors ?? 10;
  const maxNewFirms = opts.maxNewFirms ?? 150;
  const maxAutoContacts = opts.maxAutoContacts ?? 12;
  const refreshAfterDays = opts.refreshAfterDays ?? 90;
  const dryRun = opts.dryRun === true;
  const deadline = Date.now() + budgetMs;

  const result: JobResult = {
    job: "investor-research",
    scanned: 0,
    signals: 0,
    notes: [],
  };

  // --- the whole repository, read once: it is both the work queue and the
  //     index that stops the same co-investor being created twice.
  const snap = await db.collection(INVESTORS).get();

  const knownFirmKeys = new Set<string>();
  const knownFirmNames: string[] = [];
  const candidates: Candidate[] = [];

  const cutoff = Date.now() - refreshAfterDays * 24 * 60 * 60 * 1000;

  snap.forEach((doc) => {
    const v = doc.data() as any;
    const firmName = String(v.firmName || "").trim();
    if (firmName) {
      knownFirmKeys.add(normalise(firmName));
      knownFirmNames.push(firmName);
    }

    if (!firmName) return;
    if (!opts.includeDiscovered && v.sourceKind === "co-investor-discovery") return;

    const last = v.lastAutoResearchAt ? Date.parse(v.lastAutoResearchAt) : NaN;
    if (Number.isFinite(last) && last > cutoff) return;

    candidates.push({
      id: doc.id,
      firmName,
      website: String(v.website || "").trim(),
      portfolioCompanies: Array.isArray(v.portfolioCompanies)
        ? v.portfolioCompanies.filter((c: any) => typeof c === "string" && c.trim() !== "")
        : [],
      lastAutoResearchAt: v.lastAutoResearchAt,
    });
  });

  // Never researched first, then longest ago. A firm nobody has ever looked at
  // is worth more than a refresh of one done last month.
  candidates.sort((a, b) => {
    const at = a.lastAutoResearchAt ? Date.parse(a.lastAutoResearchAt) : 0;
    const bt = b.lastAutoResearchAt ? Date.parse(b.lastAutoResearchAt) : 0;
    return at - bt;
  });

  const queue = candidates.slice(0, maxInvestors);
  result.notes.push(
    `${snap.size} firms on file, ${candidates.length} due for research, taking ${queue.length}.`,
  );
  if (dryRun) result.notes.push("DRY RUN — nothing will be written.");

  let peopleAdded = 0;
  let peopleQueued = 0;
  let companiesQueued = 0;
  let firmsCreated = 0;
  let coInvestorsFound = 0;
  let failures = 0;
  const createdNames: string[] = [];
  let stoppedEarly = false;

  for (const candidate of queue) {
    // Checked before starting, not during: a firm half-researched is a firm
    // that paid for its searches and recorded nothing.
    if (Date.now() > deadline) {
      stoppedEarly = true;
      result.notes.push(`Stopped after ${result.scanned} firms — out of time.`);
      break;
    }

    try {
      const scan = await scanFirm(ai, model, {
        url: candidate.website || undefined,
        firmName: candidate.firmName,
      });

      // The scan's companies are used for the co-investor fan-out even though
      // they are still only suggestions. They are the best evidence available
      // this minute, and using them avoids paying for a seed call that asks
      // the same question again.
      const portfolioForFanout = [
        ...candidate.portfolioCompanies,
        ...scan.companies.map((c) => c.name),
      ].filter((v, i, a) => a.findIndex((x) => normalise(x) === normalise(v)) === i);

      const co = await discoverCoInvestors(ai, model, {
        firmName: candidate.firmName,
        website: candidate.website || undefined,
        portfolioCompanies: portfolioForFanout,
        knownFirms: knownFirmNames,
      });
      coInvestorsFound += co.coInvestors.length;

      // --- what to create, decided before anything is written
      const toCreate = co.coInvestors.filter(
        (c) => !c.alreadyInRepository && !knownFirmKeys.has(normalise(c.firmName)),
      );
      const roomLeft = Math.max(0, maxNewFirms - firmsCreated);
      const creating = toCreate.slice(0, roomLeft);

      if (dryRun) {
        result.scanned++;
        peopleAdded += scan.people.filter((p) => p.source === "website").length;
        peopleQueued += scan.people.filter((p) => p.source !== "website").length;
        companiesQueued += scan.companies.length;
        firmsCreated += creating.length;
        createdNames.push(...creating.map((c) => c.firmName));
        continue;
      }

      // --- create the new firms first, so the investor's stored co-investor
      //     list is written against a repository that already contains them.
      if (creating.length) {
        const batch = db.batch();
        const now = new Date().toISOString();
        for (const c of creating) {
          const ref = db.collection(INVESTORS).doc();
          batch.set(ref, {
            firmName: c.firmName,
            website: c.website || "",
            investmentStage: c.stages || "",
            checkSize: c.checkSize || "",
            verticals: c.sectors || "",
            notes: [
              c.description,
              `Found as a co-investor of ${candidate.firmName}.`,
              `Shared deals: ${c.sharedDeals.join(", ")}.`,
            ]
              .filter(Boolean)
              .join(" "),
            // Addresses read off the firm's own homepage, never composed.
            contactName: "",
            contactEmail: c.emails[0] || "",
            contactPhone: "",
            fundDetails: "",
            portfolioCompanies: c.sharedDeals,
            profileNotes: [],
            // The marker that makes this reversible. Every record this job
            // creates is findable, filterable and deletable as a group.
            sourceKind: "co-investor-discovery",
            // Created thin, on purpose. Reading this firm's own website to
            // fill in its mandate is another page fetch and another grounded
            // call, and doing that inline would mean one slow firm's site
            // eating the budget that should have gone to researching the next
            // firm on the list. The enrichment job picks these up.
            enrichmentState: "pending",
            discoveredVia: {
              firmId: candidate.id,
              firmName: candidate.firmName,
              sharedDeals: c.sharedDeals,
              foundAt: now,
            },
            createdBy: "overnight-research",
            lastModified: now,
          });
          knownFirmKeys.add(normalise(c.firmName));
          knownFirmNames.push(c.firmName);
        }
        await batch.commit();
        firmsCreated += creating.length;
        createdNames.push(...creating.map((c) => c.firmName));
      }

      // --- then patch the firm we researched, merging against its current
      //     state. The research took a minute; somebody may have been editing
      //     this record the whole time.
      const applied = await db.runTransaction(async (tx) => {
        const ref = db.collection(INVESTORS).doc(candidate.id);
        const doc = await tx.get(ref);
        if (!doc.exists) return { added: 0, queued: 0, companies: 0 };
        const current = doc.data() as any;

        const contacts: any[] = Array.isArray(current.contacts) ? [...current.contacts] : [];
        const suggestedContacts: any[] = Array.isArray(current.suggestedContacts)
          ? [...current.suggestedContacts]
          : [];
        const suggestedCompanies: any[] = Array.isArray(current.suggestedPortfolioCompanies)
          ? [...current.suggestedPortfolioCompanies]
          : [];

        const knownPeople = new Set(
          contacts.map((c) => String(c?.name || "").toLowerCase().trim()),
        );
        const decidedPeople = new Set(
          suggestedContacts.map((c) => String(c?.name || "").toLowerCase().trim()),
        );
        const knownCompanies = new Set(
          (Array.isArray(current.portfolioCompanies) ? current.portfolioCompanies : []).map(
            (n: any) => String(n).toLowerCase().trim(),
          ),
        );
        const decidedCompanies = new Set(
          suggestedCompanies.map((c) => String(c?.name || "").toLowerCase().trim()),
        );

        const foundAt = new Date().toISOString();
        let added = 0;
        let queued = 0;

        // Seniority order, so the founder and the general partners are the
        // first names on the record rather than whoever the team page listed
        // alphabetically.
        const fresh = scan.people
          .filter((p) => {
            const key = p.name.toLowerCase().trim();
            return key !== "" && !knownPeople.has(key) && !decidedPeople.has(key);
          })
          .sort((a, b) => seniorityRank(a.role) - seniorityRank(b.role));

        for (const person of fresh) {
          const verified = person.source === "website";
          if (verified && added < maxAutoContacts) {
            contacts.push({
              id: crypto.randomUUID(),
              name: person.name,
              role: person.role || "",
              // Only ever an address printed on a page the server read.
              email: person.email || "",
              emailSourceUrl: person.emailSourceUrl,
              phone: "",
              // 'ai', not 'ai-confirmed'. No person has confirmed this.
              provenance: "ai",
              sourceUrl: person.sourceUrl,
              addedBy: "overnight-research",
              addedAt: foundAt,
            });
            added++;
          } else {
            suggestedContacts.push({
              name: person.name,
              role: person.role,
              email: person.email,
              emailSourceUrl: person.emailSourceUrl,
              source: person.source,
              sourceUrl: person.sourceUrl,
              status: "pending",
              foundAt,
            });
            queued++;
          }
        }

        let companies = 0;
        for (const company of scan.companies) {
          const key = company.name.toLowerCase().trim();
          if (key === "" || knownCompanies.has(key) || decidedCompanies.has(key)) continue;
          suggestedCompanies.push({
            name: company.name,
            evidence: company.evidence,
            status: "pending",
            foundAt,
          });
          companies++;
        }

        const patch: Record<string, unknown> = {
          contacts,
          suggestedContacts,
          suggestedPortfolioCompanies: suggestedCompanies,
          coInvestors: co.coInvestors,
          coInvestorsResearchedAt: foundAt,
          coInvestorsFound: co.coInvestors.length,
          lastScanAt: foundAt,
          lastScanFoundNothing: scan.people.length === 0 && scan.companies.length === 0,
          lastAutoResearchAt: foundAt,
          autoResearchError: null,
        };
        // Only filled in when it is missing. A location somebody typed is
        // better than one a model inferred, and this must not overwrite it.
        if (scan.location && !current.location) patch.location = scan.location;

        tx.update(ref, patch);
        return { added, queued, companies };
      });

      peopleAdded += applied.added;
      peopleQueued += applied.queued;
      companiesQueued += applied.companies;
      result.scanned++;
    } catch (err: any) {
      failures++;
      const message = String(err?.message || err).slice(0, 300);
      console.error(`[investor-research] ${candidate.firmName}: ${message}`);
      result.notes.push(`${candidate.firmName}: ${message}`);

      // Recorded on the firm, not only in the logs. A firm that fails every
      // night should be visible as a firm that fails every night, and the
      // timestamp moves it to the back of the queue so one broken record
      // cannot block the rest of the list forever.
      if (!dryRun) {
        await db
          .collection(INVESTORS)
          .doc(candidate.id)
          .update({
            lastAutoResearchAt: new Date().toISOString(),
            autoResearchError: message,
          })
          .catch(() => { /* the record may have been deleted mid-run */ });
      }

      // A quota error will hit the next firm too, and the one after that.
      // Better to stop and leave the rest for tomorrow than to spend the
      // remaining budget collecting the same 429.
      if (/quota|429|exhausted|RESOURCE_EXHAUSTED/i.test(message)) {
        stoppedEarly = true;
        result.notes.push("Stopped early: the Gemini quota is exhausted.");
        break;
      }
    }
  }

  result.notes.push(
    `${peopleAdded} people added, ${peopleQueued} queued for review, ` +
      `${companiesQueued} portfolio companies queued, ` +
      `${coInvestorsFound} co-investors found, ${firmsCreated} new firms ${dryRun ? "would be " : ""}created.`,
  );
  if (failures) result.notes.push(`${failures} firm(s) failed.`);
  if (firmsCreated >= maxNewFirms) {
    result.notes.push(`Hit the ${maxNewFirms}-firm creation cap for this run.`);
  }

  if (dryRun) return result;

  // --- a record of the run, so "is this working?" has an answer that is not
  //     a log search. Same reasoning as the backup job's system document.
  const remaining = Math.max(0, candidates.length - result.scanned);
  await db
    .collection("system")
    .doc("investor_research")
    .set({
      lastRunAt: new Date().toISOString(),
      scanned: result.scanned,
      peopleAdded,
      peopleQueued,
      firmsCreated,
      failures,
      stoppedEarly,
      firmsRemaining: remaining,
      notes: result.notes.slice(0, 20),
    })
    .catch(() => { /* bookkeeping only; the work is already done */ });

  // One signal a night, and only when there is something to say. A feed that
  // reports "nothing happened" every morning stops being read by the end of
  // the week, and then the morning something did happen is missed too.
  if (firmsCreated > 0 || peopleAdded > 0) {
    const day = new Date().toISOString().slice(0, 10);
    const headline =
      firmsCreated > 0
        ? `${firmsCreated} new co-investor firm${firmsCreated === 1 ? "" : "s"} added overnight`
        : `${peopleAdded} contact${peopleAdded === 1 ? "" : "s"} added overnight`;
    const wrote = await emitSignal(db, `investor_research_${day}`, {
      kind: "portfolio-addition",
      headline,
      detail:
        `Researched ${result.scanned} firm${result.scanned === 1 ? "" : "s"}. ` +
        `${peopleAdded} people added to Team & Contacts, ${peopleQueued} queued for review. ` +
        (firmsCreated
          ? `New firms: ${createdNames.slice(0, 25).join(", ")}${createdNames.length > 25 ? `, and ${createdNames.length - 25} more` : ""}. `
          : "") +
        `${remaining} firm${remaining === 1 ? "" : "s"} still to work through.`,
      weight: firmsCreated > 0 ? 4 : 2,
    });
    if (wrote) result.signals++;
  }

  return result;
}

/** Deterministic id, so a re-run on the same day cannot duplicate the signal. */
async function emitSignal(
  db: Firestore,
  id: string,
  signal: Record<string, unknown>,
): Promise<boolean> {
  const ref = db.collection("signals").doc(id);
  const existing = await ref.get();
  if (existing.exists) return false;
  await ref.set({ ...signal, status: "new", occurredAt: new Date().toISOString() });
  return true;
}

// ───────────────────────────────────────────────────────────────────────────
// Filling in a firm's profile from its own website
// ───────────────────────────────────────────────────────────────────────────

export interface FirmProfile {
  website?: string;
  description?: string;
  fundDetails?: string;
  investmentStage?: string;
  checkSize?: string;
  verticals?: string;
  location?: string;
  leadsRounds?: boolean;
  portfolioCompanies: string[];
  people: ScannedPerson[];
  /** Role inboxes and the like — a way in when no named address was printed. */
  firmEmails: string[];
  pagesRead: string[];
}

/**
 * Reads a firm's own website and fills in the fields a profile card shows.
 *
 * A firm discovered as somebody's co-investor arrives with a name, a probable
 * website and whatever the round-by-round research happened to establish. That
 * is enough to justify a record and not enough to be one: a card with a name
 * and three blank fields is a to-do item wearing a firm's clothes.
 *
 * So this reads the site — about, team, portfolio, thesis — and asks one
 * question of it. The website is treated as authoritative over recollection
 * throughout, for the same reason as everywhere else: it is current, and it is
 * the firm describing itself.
 *
 * The email rule is unchanged and is not negotiable. Named people get an
 * address only when that exact string was printed on a page fetched here.
 * Role inboxes are kept separately, as the firm's address rather than a
 * person's, which is the distinction that stops info@ being emailed as though
 * it were a partner.
 */
export async function enrichFirm(
  ai: GoogleGenAI,
  model: string,
  opts: { firmName: string; website?: string },
): Promise<FirmProfile> {
  const firmName = opts.firmName;
  let website = (opts.website || "").trim();

  // No website on file, so establish one before there is anything to read.
  // Cheaper than it looks: without it every field below comes from
  // recollection, which is exactly the sourcing this whole design avoids.
  if (!website) {
    try {
      const found = await ai.models.generateContent({
        model,
        contents: `Using web search, give the official website URL of the venture capital firm "${firmName}". Return only the URL. If you cannot find it with confidence, return an empty string.`,
        config: {
          responseMimeType: "application/json",
          responseSchema: {
            type: Type.OBJECT,
            properties: { website: { type: Type.STRING } },
          },
          tools: [{ googleSearch: {} }],
        },
      });
      const parsed = JSON.parse(
        (found.text || "{}").replace(/^```(json)?\s*/i, "").replace(/```\s*$/, "").trim(),
      );
      website = extractWebsite(String(parsed.website || "")) || "";
    } catch {
      website = "";
    }
  }

  const pages = website ? await fetchFirmPages(website) : [];
  const siteText = pages.map((p) => `--- PAGE: ${p.url} ---\n${p.text}`).join("\n\n");

  const allEmails = [...new Set(pages.flatMap((p) => p.emails))];
  const personalEmails = allEmails.filter((a) => !isRoleInbox(a));
  const firmEmails = allEmails.filter((a) => isRoleInbox(a));
  const emailByAddress = new Map<string, string>();
  for (const page of pages) {
    for (const address of page.emails) {
      if (isRoleInbox(address)) continue;
      if (!emailByAddress.has(address)) emailByAddress.set(address, page.url);
    }
  }

  const sourceSection = pages.length
    ? `
Below is the text of ${pages.length} page(s) from ${firmName}'s own website.
This is your PRIMARY source and outranks anything you recall: it is current,
and it is the firm describing itself. Where the site and your recollection
disagree, the site is right.

${
  personalEmails.length
    ? `These email addresses were printed on those pages:
${personalEmails.join("\n")}

Attach one to a person ONLY if it clearly belongs to that specific person, and
copy it EXACTLY. Never write an address that is not on this list.`
    : `No personal email addresses were found on those pages, so leave every
person's email field empty.`
}

${siteText}
`
    : `
No text could be retrieved from this firm's website${website ? ` (${website})` : " (no website was found)"}.
Fall back on web search. Leave every person's email field empty, and leave any
field you cannot establish empty rather than guessing at it.
`;

  const prompt = `
You are a VC research analyst building a profile card for the venture capital
firm "${firmName}"${website ? ` (${website})` : ""}.
${sourceSection}

Establish, as precisely as the sources allow:

- description: two or three sentences on what the firm does and its investment
  thesis. Plain prose.
- investmentStage: the stages they invest at, e.g. "Pre-Seed, Seed, Series A".
- checkSize: their typical initial check, e.g. "$500K - $2M". Only if it is
  stated somewhere; this is the field most often guessed at and it must not be.
- verticals: the sectors and industries they invest in, comma separated.
- fundDetails: fund size, vintage, which fund they are currently investing out
  of — whatever of this is stated.
- location: headquarters city, and state or country.
- leadsRounds: true only if the firm states that it leads rounds.
- portfolioCompanies: companies they have backed, named as each company names
  itself.
- people: the investment team. Name, job title, and an email ONLY from the
  list above.

Rules that outrank completeness:
- NEVER invent or infer an email address, and never derive one from the pattern
  of the others. An address that looks right but is wrong is worse than none.
- An empty field is a correct answer. A plausible-sounding check size that
  nobody published is not.
- Do not include people who have left the firm.
- No citation markers, reference numbers or bracketed indices in any field.
`;

  const response = await ai.models.generateContent({
    model,
    contents: prompt,
    config: {
      responseMimeType: "application/json",
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          description: { type: Type.STRING },
          investmentStage: { type: Type.STRING },
          checkSize: { type: Type.STRING },
          verticals: { type: Type.STRING },
          fundDetails: { type: Type.STRING },
          location: { type: Type.STRING },
          leadsRounds: { type: Type.BOOLEAN },
          portfolioCompanies: { type: Type.ARRAY, items: { type: Type.STRING } },
          people: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              properties: {
                name: { type: Type.STRING },
                role: { type: Type.STRING },
                email: {
                  type: Type.STRING,
                  description: "Only an address copied exactly from the supplied list. Never composed.",
                },
              },
            },
          },
        },
      },
      tools: [{ googleSearch: {} }],
    },
  });

  let data: any = {};
  try {
    data = JSON.parse(
      (response.text || "{}").replace(/^```(json)?\s*/i, "").replace(/```\s*$/, "").trim(),
    );
  } catch (err) {
    console.error(`enrichFirm(${firmName}): JSON parsing error`);
    throw err;
  }

  const clean = (v: any, cap = 500): string | undefined => {
    if (typeof v !== "string") return undefined;
    const t = stripCitations(v).slice(0, cap).trim();
    return t === "" ? undefined : t;
  };

  const pageText = siteText.toLowerCase();
  const seen = new Set<string>();
  const people: ScannedPerson[] = (Array.isArray(data.people) ? data.people : [])
    .map((p: any): ScannedPerson | null => {
      const name = clean(p?.name, 120);
      if (!name) return null;
      const claimedEmail = p?.email ? String(p.email).trim().toLowerCase() : "";
      const emailIsReal = claimedEmail !== "" && emailByAddress.has(claimedEmail);
      const verified = pages.length > 0 && pageText.includes(name.toLowerCase());
      return {
        name,
        role: clean(p?.role, 120),
        email: emailIsReal ? claimedEmail : undefined,
        emailSourceUrl: emailIsReal ? emailByAddress.get(claimedEmail) : undefined,
        source: verified ? "website" : "search",
      };
    })
    .filter((p: ScannedPerson | null): p is ScannedPerson => {
      if (!p) return false;
      const key = p.name.toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .sort((a: ScannedPerson, b: ScannedPerson) => seniorityRank(a.role) - seniorityRank(b.role));

  const portfolioCompanies = (Array.isArray(data.portfolioCompanies) ? data.portfolioCompanies : [])
    .map((c: any) => clean(c, 120))
    .filter((c: string | undefined): c is string => Boolean(c))
    .filter((c: string, i: number, a: string[]) => a.findIndex((x) => normalise(x) === normalise(c)) === i);

  return {
    website: website || undefined,
    description: clean(data.description, 900),
    fundDetails: clean(data.fundDetails, 400),
    investmentStage: clean(data.investmentStage, 160),
    checkSize: clean(data.checkSize, 100),
    verticals: clean(data.verticals, 300),
    location: clean(data.location, 160),
    leadsRounds: data.leadsRounds === true,
    portfolioCompanies,
    people,
    firmEmails: firmEmails.slice(0, 3),
    pagesRead: pages.map((p) => p.url),
  };
}

export interface FirmEnrichmentOptions {
  budgetMs?: number;
  maxFirms?: number;
  maxAutoContacts?: number;
  dryRun?: boolean;
  /** Also fill in firms a person created that are missing a mandate. */
  includeThinManualFirms?: boolean;
}

/**
 * Fills in the profile of every firm still waiting for one.
 *
 * Runs as its own job rather than inside the research pass, because the two
 * have different shapes. Research is expensive per firm and bounded by the
 * repository; enrichment is cheap per firm and bounded by a queue that the
 * research pass keeps filling. Tangled together, one slow firm's website would
 * eat the budget meant for researching the next firm on the list, and the
 * cost of a night would depend on how many co-investors happened to turn up.
 */
export async function runFirmEnrichment(
  db: Firestore,
  ai: GoogleGenAI,
  model: string,
  opts: FirmEnrichmentOptions = {},
): Promise<JobResult> {
  const budgetMs = opts.budgetMs ?? 8 * 60 * 1000;
  const maxFirms = opts.maxFirms ?? 40;
  const maxAutoContacts = opts.maxAutoContacts ?? 12;
  const dryRun = opts.dryRun === true;
  const deadline = Date.now() + budgetMs;

  const result: JobResult = { job: "firm-enrichment", scanned: 0, signals: 0, notes: [] };

  const snap = await db.collection(INVESTORS).get();
  const queue: { id: string; firmName: string; website: string }[] = [];

  snap.forEach((doc) => {
    const v = doc.data() as any;
    const firmName = String(v.firmName || "").trim();
    if (!firmName) return;

    const pending = v.enrichmentState === "pending";
    // A firm somebody typed in with nothing but a name is the same problem
    // wearing different clothes, so it can be swept up by the same pass.
    const thin =
      opts.includeThinManualFirms === true &&
      !v.enrichmentState &&
      !String(v.checkSize || "").trim() &&
      !String(v.investmentStage || "").trim() &&
      !(Array.isArray(v.verticals) ? v.verticals.length : String(v.verticals || "").trim());

    if (pending || thin) queue.push({ id: doc.id, firmName, website: String(v.website || "").trim() });
  });

  result.notes.push(`${queue.length} firm(s) waiting for a profile, taking up to ${maxFirms}.`);
  if (dryRun) result.notes.push("DRY RUN — nothing will be written.");

  let filled = 0;
  let peopleAdded = 0;
  let failures = 0;

  for (const firm of queue.slice(0, maxFirms)) {
    if (Date.now() > deadline) {
      result.notes.push(`Stopped after ${result.scanned} firms — out of time.`);
      break;
    }

    try {
      const profile = await enrichFirm(ai, model, { firmName: firm.firmName, website: firm.website });
      result.scanned++;

      if (dryRun) {
        if (profile.checkSize || profile.investmentStage || profile.verticals) filled++;
        peopleAdded += profile.people.filter((p) => p.source === "website").length;
        continue;
      }

      const now = new Date().toISOString();

      // Website-verified people become contacts, exactly as in the research
      // pass, and for the same reason: the firm's own site saying someone
      // works there is a different class of claim from a model recalling it.
      const contacts = profile.people
        .filter((p) => p.source === "website")
        .slice(0, maxAutoContacts)
        .map((p) => ({
          id: crypto.randomUUID(),
          name: p.name,
          role: p.role || "",
          email: p.email || "",
          emailSourceUrl: p.emailSourceUrl,
          phone: "",
          provenance: "ai",
          addedBy: "overnight-enrichment",
          addedAt: now,
        }));

      const suggested = profile.people
        .filter((p) => p.source !== "website" || !contacts.some((c) => c.name === p.name))
        .map((p) => ({
          name: p.name,
          role: p.role,
          email: p.email,
          emailSourceUrl: p.emailSourceUrl,
          source: p.source,
          status: "pending",
          foundAt: now,
        }));

      // The count comes back from the transaction rather than being added
      // inside it: Firestore retries a contended transaction, and a counter
      // incremented in the body is incremented once per attempt.
      const addedHere = await db.runTransaction(async (tx) => {
        const ref = db.collection(INVESTORS).doc(firm.id);
        const doc = await tx.get(ref);
        if (!doc.exists) return 0;
        const current = doc.data() as any;

        // Only ever fills a blank. Anything a person typed outranks this, and
        // an overnight job that quietly rewrites somebody's notes is a job
        // that gets switched off the first time it is noticed.
        const keepExisting = (existing: any, found?: string) => {
          const has = Array.isArray(existing) ? existing.length > 0 : String(existing || "").trim() !== "";
          return has ? existing : found || existing || "";
        };

        const existingContacts: any[] = Array.isArray(current.contacts) ? current.contacts : [];
        const knownPeople = new Set(
          existingContacts.map((c) => String(c?.name || "").toLowerCase().trim()),
        );
        const existingSuggested: any[] = Array.isArray(current.suggestedContacts)
          ? current.suggestedContacts
          : [];
        const decided = new Set(
          existingSuggested.map((c) => String(c?.name || "").toLowerCase().trim()),
        );

        const freshContacts = contacts.filter((c) => !knownPeople.has(c.name.toLowerCase().trim()));
        const freshSuggested = suggested.filter(
          (s) => !knownPeople.has(s.name.toLowerCase().trim()) && !decided.has(s.name.toLowerCase().trim()),
        );

        const patch: Record<string, unknown> = {
          website: keepExisting(current.website, profile.website),
          investmentStage: keepExisting(current.investmentStage, profile.investmentStage),
          checkSize: keepExisting(current.checkSize, profile.checkSize),
          verticals: keepExisting(current.verticals, profile.verticals),
          fundDetails: keepExisting(current.fundDetails, profile.fundDetails),
          notes: keepExisting(current.notes, profile.description),
          contacts: [...existingContacts, ...freshContacts],
          suggestedContacts: [...existingSuggested, ...freshSuggested],
          enrichmentState: "done",
          enrichedAt: now,
          enrichedFrom: profile.pagesRead,
          enrichmentError: null,
          lastModified: now,
        };

        if (!current.location && profile.location) patch.location = profile.location;
        if (current.isLead === undefined && profile.leadsRounds) patch.isLead = true;

        // The shared deals that justified the record are kept; the firm's own
        // portfolio is added to them rather than replacing them.
        const existingPortfolio: string[] = Array.isArray(current.portfolioCompanies)
          ? current.portfolioCompanies
          : [];
        const merged = [...existingPortfolio, ...profile.portfolioCompanies].filter(
          (v, i, a) => a.findIndex((x) => normalise(x) === normalise(v)) === i,
        );
        patch.portfolioCompanies = merged.slice(0, 200);

        // A role inbox is the firm's address, not a partner's. It fills the
        // legacy contact field only when nothing better is there.
        if (!String(current.contactEmail || "").trim() && profile.firmEmails.length) {
          patch.contactEmail = profile.firmEmails[0];
        }

        tx.update(ref, patch);
        return freshContacts.length;
      });
      peopleAdded += addedHere;

      if (profile.checkSize || profile.investmentStage || profile.verticals) filled++;
    } catch (err: any) {
      failures++;
      const message = String(err?.message || err).slice(0, 300);
      console.error(`[firm-enrichment] ${firm.firmName}: ${message}`);
      result.notes.push(`${firm.firmName}: ${message}`);

      // Marked failed rather than left pending, so one firm whose site never
      // loads cannot sit at the head of the queue forever.
      if (!dryRun) {
        await db
          .collection(INVESTORS)
          .doc(firm.id)
          .update({ enrichmentState: "failed", enrichmentError: message })
          .catch(() => { /* the record may have been deleted mid-run */ });
      }

      if (/quota|429|exhausted|RESOURCE_EXHAUSTED/i.test(message)) {
        result.notes.push("Stopped early: the Gemini quota is exhausted.");
        break;
      }
    }
  }

  result.notes.push(
    `${result.scanned} firm(s) profiled, ${filled} with a mandate, ` +
      `${peopleAdded} people added${failures ? `, ${failures} failed` : ""}.`,
  );

  if (!dryRun) {
    await db
      .collection("system")
      .doc("firm_enrichment")
      .set({
        lastRunAt: new Date().toISOString(),
        scanned: result.scanned,
        filled,
        peopleAdded,
        failures,
        queueRemaining: Math.max(0, queue.length - result.scanned),
        notes: result.notes.slice(0, 20),
      })
      .catch(() => { /* bookkeeping only */ });
  }

  return result;
}
