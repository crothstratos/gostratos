import crypto from "crypto";

/**
 * Granola meeting notes, into the CRM.
 *
 * Granola records the call, writes the summary, and calls us when it is ready.
 * We decide which company the meeting was about, write the summary onto that
 * company as an interaction, and fill in any profile fields the call actually
 * answered.
 *
 * The matching is deterministic and free: an external attendee's email domain
 * is the company. ramy@gospidr.com is Spidr, matt@dwell.fi is DwellFi,
 * anthony.gadient@valicyber.com is Vali Cyber. No model is asked to guess who
 * a meeting was with, because a wrong guess files a confidential call against
 * the wrong company, which is the one failure here that actually matters.
 *
 * A model is used for one thing only — reading figures out of what was said —
 * and that call is not grounded, so it costs tokens and no search quota.
 *
 * Docs: https://docs.granola.ai/introduction
 */

const API_BASE = process.env.GRANOLA_API_BASE || "https://public-api.granola.ai";

/** Domains that are us, not a company we are meeting. */
const INTERNAL_DOMAINS = new Set(
  (process.env.GRANOLA_INTERNAL_DOMAINS || "gostratos.vc,highwayventures.com")
    .split(",")
    .map((d) => d.trim().toLowerCase())
    .filter(Boolean),
);

/**
 * Consumer mailboxes. A founder emailing from gmail is common, but the domain
 * says nothing about which company they are, so it must never be used to match
 * one — otherwise every meeting with a gmail address lands on whichever
 * company happens to have a gmail founder.
 */
const FREE_MAIL = new Set([
  "gmail.com", "googlemail.com", "outlook.com", "hotmail.com", "live.com",
  "yahoo.com", "icloud.com", "me.com", "aol.com", "proton.me", "protonmail.com",
  "msn.com", "comcast.net", "verizon.net",
]);

export interface GranolaUser {
  name?: string | null;
  email?: string | null;
}

export interface GranolaNote {
  id: string;
  title?: string | null;
  owner?: GranolaUser;
  attendees?: GranolaUser[];
  summary_text?: string | null;
  summary_markdown?: string | null;
  web_url?: string | null;
  created_at?: string;
  updated_at?: string;
  calendar_event?: {
    id?: string;
    title?: string | null;
    scheduled_start_time?: string;
    scheduled_end_time?: string;
    organizer?: GranolaUser;
    invitees?: GranolaUser[];
  } | null;
  transcript?: { speaker?: string | null; text?: string | null; timestamp?: string }[] | null;
}

// ───────────────────────────────────────────────────────────────────────────
// Webhook authenticity
// ───────────────────────────────────────────────────────────────────────────

/**
 * Verifies a Granola webhook against the Standard Webhooks scheme.
 *
 * This signature is the only thing standing between the endpoint and the open
 * web, exactly as the X-Appengine-Cron header is for the scheduled jobs, so it
 * is checked before anything in the payload is read or trusted.
 *
 * It must run on the RAW request body. Express's JSON parser reparses and
 * re-serialises, and the bytes that come back out are not the bytes that were
 * signed — key order and whitespace both move — so a verified-then-parsed
 * route is the only shape that works.
 */
export function verifyGranolaSignature(
  headers: Record<string, string | string[] | undefined>,
  rawBody: string,
  signingSecret: string,
): boolean {
  const get = (name: string): string => {
    const v = headers[name];
    return Array.isArray(v) ? v[0] || "" : String(v || "");
  };

  const id = get("webhook-id");
  const timestamp = get("webhook-timestamp");
  const signatureHeader = get("webhook-signature");
  if (!id || !timestamp || !signatureHeader || !signingSecret) return false;

  // A replayed delivery is a real request that is no longer current. Five
  // minutes is the Standard Webhooks tolerance.
  const age = Math.abs(Date.now() / 1000 - Number(timestamp));
  if (!Number.isFinite(age) || age > 300) return false;

  const secret = signingSecret.startsWith("whsec_") ? signingSecret.slice(6) : signingSecret;
  const key = Buffer.from(secret, "base64");
  const signed = `${id}.${timestamp}.${rawBody}`;
  const expected = Buffer.from(
    crypto.createHmac("sha256", key).update(signed, "utf8").digest("base64"),
  );

  // Every version in the header is checked, and compared in constant time: a
  // fast rejection leaks how much of the signature was right.
  return signatureHeader.split(" ").some((versioned) => {
    const [version, signature = ""] = versioned.split(",");
    if (version !== "v1") return false;
    const provided = Buffer.from(signature);
    return provided.length === expected.length && crypto.timingSafeEqual(provided, expected);
  });
}

// ───────────────────────────────────────────────────────────────────────────
// The API
// ───────────────────────────────────────────────────────────────────────────

function apiKey(): string {
  const key = (process.env.GRANOLA_API_KEY || "").trim();
  if (!key) {
    throw new Error(
      "GRANOLA_API_KEY is not set. Create one in the Granola desktop app under " +
        "Settings -> Connectors -> API keys, then add it to env.yaml.",
    );
  }
  return key;
}

async function granolaFetch(path: string): Promise<any> {
  const response = await fetch(`${API_BASE}${path}`, {
    headers: { Authorization: `Bearer ${apiKey()}`, Accept: "application/json" },
  });
  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new Error(`Granola ${path} returned ${response.status}: ${body.slice(0, 300)}`);
  }
  return response.json();
}

/** One note, with attendees, summary and calendar event. */
export const getNote = (noteId: string): Promise<GranolaNote> =>
  granolaFetch(`/v1/notes/${encodeURIComponent(noteId)}`);

/**
 * Notes updated since a timestamp, one page at a time.
 *
 * Only used to catch up after downtime — webhooks are the normal path. Page
 * size is capped at 30 by the API.
 */
export async function listNotes(opts: { updatedAfter?: string; cursor?: string; pageSize?: number }) {
  const params = new URLSearchParams();
  if (opts.updatedAfter) params.set("updated_after", opts.updatedAfter);
  if (opts.cursor) params.set("cursor", opts.cursor);
  params.set("page_size", String(Math.min(30, Math.max(1, opts.pageSize ?? 30))));
  const data = await granolaFetch(`/v1/notes?${params.toString()}`);
  return {
    notes: (Array.isArray(data?.notes) ? data.notes : []) as GranolaNote[],
    cursor: (data?.cursor ?? null) as string | null,
    hasMore: Boolean(data?.hasMore),
  };
}

// ───────────────────────────────────────────────────────────────────────────
// Which company was this meeting with?
// ───────────────────────────────────────────────────────────────────────────

const domainOf = (email?: string | null): string => {
  const at = String(email || "").trim().toLowerCase().lastIndexOf("@");
  return at === -1 ? "" : String(email).trim().toLowerCase().slice(at + 1);
};

/** The registrable part, so mail.acme.co.uk and acme.co.uk are one company. */
export function rootDomain(raw?: string | null): string {
  let host = String(raw || "").trim().toLowerCase();
  if (!host) return "";
  host = host.replace(/^https?:\/\//, "").replace(/^www\./, "").split("/")[0].split(":")[0];
  const parts = host.split(".").filter(Boolean);
  if (parts.length <= 2) return parts.join(".");
  // Two-part public suffixes that would otherwise collapse to the suffix.
  const twoPart = /^(co|com|org|net|gov|ac|edu)\.[a-z]{2}$/;
  const lastTwo = parts.slice(-2).join(".");
  return twoPart.test(lastTwo) ? parts.slice(-3).join(".") : lastTwo;
}

/** Every external party on the call, deduplicated by domain. */
export function externalDomains(note: GranolaNote): string[] {
  const people: GranolaUser[] = [
    ...(note.attendees || []),
    ...(note.calendar_event?.invitees || []),
    ...(note.calendar_event?.organizer ? [note.calendar_event.organizer] : []),
  ];
  const seen = new Set<string>();
  for (const p of people) {
    const domain = rootDomain(domainOf(p?.email));
    if (!domain) continue;
    if (INTERNAL_DOMAINS.has(domain)) continue;
    if (FREE_MAIL.has(domain)) continue;
    seen.add(domain);
  }
  return [...seen];
}

export interface CompanyLike {
  id: string;
  name: string;
  website?: string;
  founderEmail?: string;
}

export interface NoteMatch {
  companyId: string;
  companyName: string;
  /** How it was matched, so a wrong match can be understood rather than guessed at. */
  basis: string;
  confidence: "domain" | "name";
}

/**
 * Matches a note to exactly one company, or to none.
 *
 * Domain first and name second, and never both: a meeting whose attendees name
 * a company is about that company whatever the title says, because titles are
 * written by whoever made the invite and are frequently wrong or generic.
 *
 * Returns null rather than a best guess when two different external companies
 * were on the same call, or when nothing matches. An unmatched note is filed
 * for review; a misfiled one is a confidential call on a stranger's record.
 */
export function matchNote(note: GranolaNote, companies: CompanyLike[]): NoteMatch | null {
  const domains = externalDomains(note);

  if (domains.length > 0) {
    const byDomain = new Map<string, CompanyLike[]>();
    for (const c of companies) {
      for (const d of [rootDomain(c.website), rootDomain(domainOf(c.founderEmail))]) {
        if (!d || INTERNAL_DOMAINS.has(d) || FREE_MAIL.has(d)) continue;
        const list = byDomain.get(d) || [];
        if (!list.some((x) => x.id === c.id)) list.push(c);
        byDomain.set(d, list);
      }
    }

    const hits: { company: CompanyLike; domain: string }[] = [];
    for (const d of domains) {
      for (const company of byDomain.get(d) || []) {
        if (!hits.some((h) => h.company.id === company.id)) hits.push({ company, domain: d });
      }
    }

    if (hits.length === 1) {
      return {
        companyId: hits[0].company.id,
        companyName: hits[0].company.name,
        basis: `an attendee from ${hits[0].domain}`,
        confidence: "domain",
      };
    }
    // Two of our companies on one call. Real — a customer intro, a partnership
    // — and not something to resolve by picking one.
    if (hits.length > 1) return null;
  }

  // Nothing matched by domain. Fall back to the title, which is weaker and is
  // labelled as such: "Spidr / Stratos Venture Partners Call" names a company,
  // "Weekly sync" does not.
  const title = String(note.title || note.calendar_event?.title || "").toLowerCase();
  if (title.trim() === "") return null;

  const named = companies.filter((c) => {
    const name = String(c.name || "").trim().toLowerCase();
    // Short names produce false matches against ordinary words, and a
    // two-letter company name in a sentence is not evidence of anything.
    if (name.length < 4) return false;
    return new RegExp(`(^|[^a-z0-9])${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}([^a-z0-9]|$)`).test(title);
  });

  if (named.length === 1) {
    return {
      companyId: named[0].id,
      companyName: named[0].name,
      basis: `"${named[0].name}" in the meeting title`,
      confidence: "name",
    };
  }
  return null;
}

/**
 * The key that stops one call being logged twice.
 *
 * Two people at the firm both running Granola produce two notes of the same
 * meeting, with different note ids and identical calendar events — which is
 * exactly what the last thirty days of this account look like. The calendar
 * event is therefore the identity of the meeting; the note is only somebody's
 * record of it. Without a calendar event there is nothing better than the
 * note itself.
 */
export const meetingKey = (note: GranolaNote): string =>
  note.calendar_event?.id
    ? `cal:${note.calendar_event.id}`
    : `note:${note.id}`;

/** Plain text of the conversation, bounded. */
export function transcriptText(note: GranolaNote, maxChars = 60_000): string {
  const lines = (note.transcript || [])
    .map((t) => `${t?.speaker || "Speaker"}: ${String(t?.text || "").trim()}`)
    .filter((l) => l.length > 12);
  const joined = lines.join("\n");
  return joined.length > maxChars ? joined.slice(0, maxChars) + "\n[transcript truncated]" : joined;
}

// ───────────────────────────────────────────────────────────────────────────
// Reading the company's own figures out of what was said
// ───────────────────────────────────────────────────────────────────────────

/**
 * The profile fields a founder answers on a call, and how to ask for each.
 *
 * Only these. A call is good evidence for revenue, headcount and use of funds,
 * because the founder said them out loud and somebody at the firm was there to
 * hear it. It is not evidence for the company's website or its legal entity,
 * so those are not on the list and cannot be written by this path.
 */
export const EXTRACTABLE: { field: string; label: string; ask: string }[] = [
  { field: "revenue", label: "Revenue", ask: "Current revenue or ARR, with the unit as stated (e.g. '$1.2M ARR')." },
  { field: "customerCount", label: "Customers", ask: "Number of customers, clients or logos." },
  { field: "fte", label: "Headcount", ask: "Number of full-time employees." },
  { field: "yearFounded", label: "Year founded", ask: "The year the company was founded, as four digits." },
  { field: "tam", label: "TAM", ask: "Total addressable market size, as stated." },
  { field: "cashBalance", label: "Cash", ask: "Cash in the bank." },
  { field: "monthlyBurn", label: "Burn", ask: "Monthly burn rate." },
  { field: "useOfFunds", label: "Use of funds", ask: "What they intend to do with the money they are raising." },
  { field: "foundersBackground", label: "Founders' background", ask: "What the founders did before this company." },
  { field: "marketProblem", label: "Problem", ask: "The problem they say they solve." },
  { field: "companySolution", label: "Solution", ask: "What the product does, in their words." },
  { field: "competition", label: "Competition", ask: "Competitors they named." },
  { field: "pricing", label: "Pricing", ask: "How they charge and how much." },
  { field: "gtm", label: "Go-to-market", ask: "How they acquire customers." },
  { field: "pastFinancing", label: "Financing", ask: "Money raised to date: round, amount, investors." },
  { field: "dealTerms", label: "Deal terms", ask: "Terms of the round they are raising: amount, valuation, structure." },
];

export interface ExtractedFact {
  field: string;
  value: string;
  /** What was actually said. The reason this is checkable rather than trusted. */
  quote: string;
}

/**
 * Pulls stated facts out of a meeting, for fields the record has not got.
 *
 * Deliberately NOT grounded. Everything the model is allowed to use is in the
 * prompt — the summary and the transcript — so there is no web search, no
 * search quota consumed, and nothing from outside the call can end up in a
 * company record. It costs input tokens and nothing else.
 *
 * Only blank fields are requested. A figure somebody at the firm typed in
 * outranks one heard on a call, and a background job that quietly revises a
 * revenue number the day before it goes in front of an LP is a job that gets
 * switched off the first time it is noticed.
 *
 * Every fact carries the sentence it came from. An extracted figure that
 * cannot be traced to something said is worth less than no figure, because it
 * looks exactly like one somebody checked.
 */
export async function extractFacts(
  ai: any,
  model: string,
  Type: any,
  note: GranolaNote,
  blankFields: string[],
): Promise<ExtractedFact[]> {
  const wanted = EXTRACTABLE.filter((f) => blankFields.includes(f.field));
  if (wanted.length === 0) return [];

  const summary = String(note.summary_markdown || note.summary_text || "").trim();
  const transcript = transcriptText(note);
  if (summary.length < 40 && transcript.length < 200) return [];

  const prompt = `
Below are the notes and transcript of a call between our venture firm and a
company we are evaluating. Read them and report ONLY facts about the company
that were actually stated on this call.

Report these fields, and no others:
${wanted.map((f) => `- ${f.field}: ${f.ask}`).join("\n")}

Rules, which matter more than filling fields in:
- Report a field ONLY if it was stated on this call. An empty result is the
  correct answer for a field nobody mentioned, and is far more useful than a
  plausible guess.
- Do NOT infer, estimate, average, or calculate. If they said "a few hundred
  customers", the value is "a few hundred", not "300".
- Copy figures exactly as stated, including the unit. "1.2 million in ARR"
  stays "$1.2M ARR", not "1200000".
- For every field you report, give the sentence from the call that says it, in
  the "quote" field. If you cannot quote it, do not report it.
- Do not report anything the OUR-FIRM speakers said about the company. We are
  evaluating them; only what the company says about itself counts.
- No citation markers or bracketed numbers in any value.

--- MEETING NOTES ---
${summary || "(no summary)"}

--- TRANSCRIPT ---
${transcript || "(no transcript available)"}
`;

  const response = await ai.models.generateContent({
    model,
    contents: prompt,
    config: {
      responseMimeType: "application/json",
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          facts: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              properties: {
                field: { type: Type.STRING },
                value: { type: Type.STRING },
                quote: { type: Type.STRING, description: "The sentence from the call stating this" },
              },
            },
          },
        },
      },
      // No tools. Nothing outside this prompt may reach a company record.
    },
  });

  let data: any = {};
  try {
    data = JSON.parse(
      (response.text || "{}").replace(/^```(json)?\s*/i, "").replace(/```\s*$/, "").trim(),
    );
  } catch {
    return [];
  }

  const allowed = new Set(wanted.map((f) => f.field));
  const seen = new Set<string>();
  return (Array.isArray(data.facts) ? data.facts : [])
    .map((f: any) => ({
      field: String(f?.field || "").trim(),
      value: String(f?.value || "").trim().slice(0, 600),
      quote: String(f?.quote || "").trim().slice(0, 400),
    }))
    .filter((f: ExtractedFact) => {
      // Enforced here, not requested in the prompt: a field outside the list,
      // a value with no quote behind it, or a second answer for the same
      // field never reaches the record.
      if (!allowed.has(f.field)) return false;
      if (f.value === "" || f.quote === "") return false;
      if (seen.has(f.field)) return false;
      seen.add(f.field);
      return true;
    });
}

/** The interaction note, built from the summary and what it filled in. */
export function buildInteractionNote(
  note: GranolaNote,
  match: NoteMatch,
  facts: ExtractedFact[],
): string {
  const summary = String(note.summary_text || note.summary_markdown || "").trim();
  const parts: string[] = [];

  parts.push(summary || "(Granola recorded this call but produced no summary.)");

  const external = (note.attendees || [])
    .map((a) => a?.name || a?.email)
    .filter(Boolean)
    .slice(0, 12);
  if (external.length) parts.push(`\nAttendees: ${external.join(", ")}`);

  if (facts.length) {
    const labels = new Map(EXTRACTABLE.map((f) => [f.field, f.label]));
    parts.push(
      `\nFilled in from this call: ${facts.map((f) => `${labels.get(f.field) || f.field} — ${f.value}`).join("; ")}`,
    );
  }

  if (note.web_url) parts.push(`\nFull note: ${note.web_url}`);
  parts.push(`\nMatched to ${match.companyName} by ${match.basis}.`);

  return parts.join("\n").trim();
}
