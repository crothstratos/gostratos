export type Stage = 'Initial Review' | 'Analyst Call' | 'Partner Call' | 'DD' | 'Portfolio Company' | 'Watchlist' | 'Passed';
export type Vertical = 'Fintech' | 'Insurtech' | 'Regtech' | 'Healthtech' | 'Supply Chain' | 'MarTech' | 'Ag Tech' | 'Business Productivity Software' | 'PropTech' | 'Cybersecurity' | 'Other';

export const STAGES: Stage[] = [
  'Initial Review',
  'Analyst Call',
  'Partner Call',
  'DD',
  'Portfolio Company',
  'Watchlist',
  'Passed',
];

export const TEAM_MEMBERS = [
  'Winston Bennett',
  'Mike Abbaei',
  'Jeff Musgrove',
  'Daria Sakaris',
  'Cameron Roth',
  'Joe Comizio',
  'Lane Patterson',
  'Eric Latin',
];

export const VERTICALS: Vertical[] = [
  'Fintech',
  'Insurtech',
  'Regtech',
  'Healthtech',
  'Supply Chain',
  'MarTech',
  'Ag Tech',
  'Business Productivity Software',
  'PropTech',
  'Cybersecurity',
  'Other',
];

export interface Attachment {
  id: string;
  name: string;
  url: string;
  type: string;
  size: number;
}

export interface StageHistory {
  stage: Stage;
  date: string;
}

export const INVESTOR_TYPES = [
  'HNWI - Low VC maturity',
  'HNWI - High VC maturity',
  'FO - Low VC maturity',
  'FO - High VC maturity',
  'Fund of Funds (FoF)',
  'Institutional (pensions, endowments, foundations)',
  'Corporate',
  'Public (government & public funds)',
  'RIA/ Wealth Managers'
] as const;

export type FundraisingStage = 'Identified' | 'Outreach' | 'First Meeting' | 'Active Discussions' | 'Commitment' | 'On Hold' | 'Closed/Passed';

export const FUNDRAISING_STAGES: FundraisingStage[] = [
  'Identified',
  'Outreach',
  'First Meeting',
  'Active Discussions',
  'Commitment',
  'On Hold',
  'Closed/Passed',
];

export interface LocationData {
  formatted_address: string | null;
  latitude: number | null;
  longitude: number | null;
  place_id: string | null;
  city: string | null;
  state: string | null;
  zip_code: string | null;
}

export type LocationType = string | LocationData;

export interface RevenueRecord {
  id: string;
  year: string;
  revenue: string;
  type: 'Projected' | 'Actual' | '';
  recurringVsTransactional: string;
}

export interface RevenueEntry {
  id: string;
  timestamp?: string;
  entries?: RevenueRecord[];
  // Legacy fields
  year?: string;
  revenue?: string;
  type?: 'Projected' | 'Actual' | '';
  recurringVsTransactional?: string;
}

export interface DealTermEntry {
  id: string;
  date: string;
  terms?: string;
  raise?: string;
  raiseAmount?: number | '';
  raiseType?: string;
  notes?: string;
}

export interface InteractionLog {
  id: string;
  date: string;
  type: 'Meeting' | 'Email' | 'Call' | 'Other';
  notes: string;
  nextSteps?: string;
  statusUpdate?: string;
  sentiment: 'Positive' | 'Neutral' | 'Negative';
  followUpDate?: string;
  followUpRequirements?: string;
  dealTerms?: string;
  revenue?: string;
  pastFinancing?: string;
}

export interface InvestorProfile {
  id: string;
  firmName: string;
  website?: string;
  linkedin?: string;
  calendarLink?: string;
  stratosOwner?: string;
  description?: string;
  leadPartner: string;
  email?: string;
  phone?: string;
  location?: LocationType;
  total_interactions?: number;
  type: string;
  aum: string;
  typicalCheckSize: number;
  strategicFit: string;
  stage: FundraisingStage;
  softCircleAmount: number;
  actualCommitmentAmount?: number;
  initialCommitmentAmount?: number;
  warmIntroSource: string;
  interactions: InteractionLog[];
  lastModified: string;
  sequenceNumber?: string;
  subscriptionPaperworkSigned?: boolean;
  amlRequirementsSentByApex?: boolean;
  allAmlDocumentationReceived?: boolean;
  documentsCountersigned?: boolean;
  fundsReceived?: boolean;
  managementFeePercent?: number;
  carryFeePercent?: number;
  annualManagementFee?: number;
  quarterlyManagementFee?: number;
  probabilityToClose?: number;
  fund?: string;
  funds?: string[];
}

export type EventStatus = 'Considering' | 'Confirmed' | 'Not Going';

export interface CalendarEvent {
  id: string;
  title: string;
  startDate: string; // ISO string
  endDate: string; // ISO string
  status: EventStatus;
  location: LocationType;
  attendees: string;
  cost: string;
  notes: string;
  nextSteps?: string;
  statusUpdate?: string;
  calendarType?: 'Shared' | 'Personal';
  createdBy?: string;
}

export interface InvestorContact {
  id: string;
  name: string;
  email: string;
  phone: string;
  role?: string;
  linkedin?: string;
  notes?: string;
  /** Absent means typed by a person, which is what every existing record is. */
  provenance?: Provenance;
  /** For accepted suggestions: the page the name was found on, if any. */
  sourceUrl?: string;
  /** For accepted suggestions: the page the email was printed on, if any. */
  emailSourceUrl?: string;
  /** Who accepted this from a scan suggestion, and when. */
  confirmedBy?: string;
  confirmedAt?: string;
}

export interface ProfileNote {
  id: string;
  text: string;
  timestamp: string;
}

/**
 * Where a piece of data came from. Stamped on anything a model produced so a
 * guess is never mistaken for something a person checked.
 */
export type Provenance = 'human' | 'ai' | 'ai-confirmed';

export type SuggestionStatus = 'pending' | 'accepted' | 'dismissed';

/** A portfolio company a scan believes this firm holds, awaiting review. */
export interface PortfolioSuggestion {
  name: string;
  status: SuggestionStatus;
  foundAt: string;
  /** Where the model says it found this, when it says. Free text. */
  evidence?: string;
}

/**
 * Someone a scan believes works at this firm, awaiting review.
 *
 * An email only ever appears here when that exact address was printed on a
 * page the server actually fetched — never one a model composed from the
 * pattern of the others. That check is enforced server-side, because an
 * address that looks right but is wrong is the error nobody catches until
 * mail has already gone out.
 */
export interface PersonSuggestion {
  name: string;
  role?: string;
  email?: string;
  /** The page the address was printed on. Present whenever email is. */
  emailSourceUrl?: string;
  status: SuggestionStatus;
  foundAt: string;
  /**
   * 'website' means this name was found in text fetched from the firm's own
   * site, and sourceUrl says which page. 'search' means it came from the
   * model's research and is weaker. The distinction is verified server-side,
   * not taken from the model's own claim.
   */
  source?: 'website' | 'search';
  sourceUrl?: string;
}

/**
 * A company an investor in our repository has backed that we do not track.
 *
 * Discovery is free and deterministic: portfolio lists minus the companies
 * already in the CRM. Everything below `website` is researched afterwards and
 * is therefore softer — see `researchState`.
 */
export interface SourcingCandidate {
  id: string;
  name: string;
  /** Normalised name, so the same company from two firms is one row. */
  nameKey: string;
  /** Every firm in our repository whose portfolio lists this company. */
  sourceFirms: { id: string; firmName: string }[];

  status: 'active' | 'dismissed';
  researchState: 'pending' | 'done' | 'failed';

  website?: string;
  description?: string;
  founderName?: string;
  /**
   * Only ever an address printed on a page the server fetched, whose local
   * part matches the founder's name. Never composed from a pattern.
   */
  founderEmail?: string;
  /**
   * The best address on the site that is not the founder's — a colleague, or
   * failing that info@, support@, privacy@, whatever is there. Not attributed
   * to anyone: it is an address for the company, which is a weaker claim than
   * an address for a person and is shown as one.
   */
  alternateEmail?: string;
  alternateEmailSourceUrl?: string;
  /** Every address found on the site, best first. */
  contactEmails?: string[];
  emailSourceUrl?: string;
  location?: string;
  vertical?: string;
  yearFounded?: string;
  lastRound?: string;

  discoveredAt: string;
  researchedAt?: string;
  /** Why research produced nothing, when it did not. */
  researchNote?: string;
}

/**
 * Something changed that somebody should look at.
 *
 * Signals are produced by scheduled jobs, never by a person, and they are
 * events rather than records: each one describes a change at a moment, and
 * stays true even after the underlying thing changes again. That is the point
 * of keeping them — a CRM that only stores current state cannot tell you a
 * firm started buying into a sector, only that it holds those positions now.
 */
export type SignalKind =
  | 'portfolio-addition'
  | 'sector-rotation'
  | 'site-change'
  | 'person-moved';

export interface Signal {
  id: string;
  kind: SignalKind;
  /** One line, written for a person scanning a feed. */
  headline: string;
  /** The supporting detail, including what it was compared against. */
  detail?: string;
  /** How much this deserves attention. Derived, never typed. */
  weight: number;

  /** What it is about, for linking through. */
  companyId?: string;
  companyName?: string;
  firmId?: string;
  firmName?: string;
  personName?: string;

  /** Where the claim came from, when there is a page to point at. */
  sourceUrl?: string;

  occurredAt: string;
  status: 'new' | 'seen' | 'dismissed';
}

/** One firm's portfolio as it stood on a date. The raw material for rotation. */
export interface PortfolioSnapshot {
  id: string;
  firmId: string;
  firmName: string;
  takenAt: string;
  /** Period key, e.g. "2026-09". One snapshot per firm per period. */
  period: string;
  companies: string[];
}

/** A firm that has shared a cap table with one of ours. */
export interface CoInvestorSuggestion {
  firmName: string;
  description?: string;
  stages?: string;
  checkSize?: string;
  sectors?: string;
  website?: string;
  /** Companies both firms backed. The evidence; never empty. */
  sharedDeals: string[];
  alreadyInRepository?: boolean;
}

export interface InvestorRepositoryEntry {
  id: string;
  firmName: string;
  location?: LocationType;
  website: string;
  contactName: string; // Legacy
  contactEmail: string; // Legacy
  contactPhone: string; // Legacy
  contacts?: InvestorContact[];
  fundDetails: string;
  investmentStage: string | string[];
  checkSize: string;
  verticals: string | string[];
  portfolioCompanies: string[];
  notes: string;
  profileNotes?: ProfileNote[];
  nextSteps?: string;
  statusUpdate?: string;
  calendarType?: 'Shared' | 'Personal';
  createdBy?: string;
  lastModified: string;
  isLead?: boolean;

  /** Scan output awaiting a human decision. See the review lane in InvestorModal. */
  suggestedPortfolioCompanies?: PortfolioSuggestion[];
  suggestedContacts?: PersonSuggestion[];
  /** When the firm was last scanned, so it is not re-scanned on every open. */
  lastScanAt?: string;
  /** Set when a scan produced nothing, to distinguish "not scanned" from "nothing found". */
  lastScanFoundNothing?: boolean;
}


export interface CompanyVersion {
  id: string;
  versionName: string;
  timestamp: string;
  data: any; // We'll just store the modified fields here
}

export interface Company {
  versions?: CompanyVersion[];
  activeVersionId?: string;
  id: string;
  name: string;
  location?: LocationType;
  website?: string;
  slogan?: string;
  vertical?: Vertical;
  source?: string;
  externalSource?: string;
  /** Structured referrers. See the Referrer type. */
  referrers?: Referrer[];
  /**
   * Flat mirror of referrers[].id, maintained on save.
   * Firestore's array-contains matches whole array elements, so it cannot
   * look inside the objects in referrers[]. Without this field there is no
   * way to ask "which companies did this person refer?" — only the forward
   * direction works. Derived data: never edit it by hand.
   */
  referrerIds?: string[];
  stage: Stage;
  basics: string;
  marketProblem: string;
  companySolution: string;
  competition: string;
  pricing: string;
  gtm: string;
  revenue: string;
  pastRevenue?: string;
  dealTerms: string;
  pastFinancing: string;
  reasonForPass?: string;
  statusUpdate?: string;
  calendarType?: 'Shared' | 'Personal';
  createdBy?: string;
  founderEmail?: string;
  founderName?: string;
  /** Who the founders are and what they did before. Carries into the one-pager. */
  foundersBackground?: string;

  // --- Company facts.
  //
  // All free text, deliberately. These come off pitch decks, where the honest
  // answer is usually "~40 enterprise logos" or "2019 (spun out of Stanford)",
  // and a number field forces whoever is typing to either lose that or leave
  // it blank. Same reasoning the team already settled on for revenue.
  /** Year the company was founded. */
  yearFounded?: string;
  /** Legal entity and domicile, e.g. "Delaware C-Corp". */
  entityInfo?: string;
  /** Headcount. */
  fte?: string;
  /** How many customers they have. */
  customerCount?: string;
  /** Total addressable market. */
  tam?: string;
  /** Cash in the bank. Parsed for runway where it can be. */
  cashBalance?: string;
  /** Net monthly burn. Parsed for runway where it can be. */
  monthlyBurn?: string;
  /** What they intend to do with the raise. */
  useOfFunds?: string;
  conversationSummary?: {
    summary: string;
    nextSteps: string[];
    lastSyncedAt?: string;
    lastSyncedByEmail?: string;
    emailCount?: number;
  };
  attachments?: Attachment[];
  aiCoInvestors?: any[];
  lastModified?: string;
  stageHistory?: StageHistory[];
  nextSteps?: string;
  interactions?: InteractionLog[];
  revenueHistory?: RevenueEntry[];
  dealTermsHistory?: DealTermEntry[];
  
  // Due Diligence specific fields
  ddCompletedItems?: string[];
  ddFindings?: Record<string, string>;
  ddCurrentStage?: string;
  ddVerdict?: 'Proceed' | 'Pass' | null;

  // Portfolio Monitoring specific fields
  portfolioHealth?: 'Stable' | 'At Risk' | 'Hypergrowth';
  portfolioExitScenarios?: { id: number; value: number }[];

  // General Classification
  fund?: string;
  funds?: string[];

  // Shortlist specific fields
  isShortlisted?: boolean;
  targetCloseDate?: string;
  probabilityOfClose?: number;
  investmentAmount?: number;
}

/** A person from the imported contacts directory. */
export interface Contact {
  id: string;
  name: string;
  nameLower: string;
  firstName?: string;
  lastName?: string;
  emails: string[];
  city?: string;
  state?: string;
  /** Who they are with — firm, fund, company. Free text, set on quick-add. */
  affiliation?: string;
  source?: string;
  importedAt?: string;
}

/**
 * Who referred a company to us. Stored on the company alongside the original
 * free-text externalSource, which is left untouched — this is additive, so
 * nothing anyone typed before is lost.
 */
export interface Referrer {
  id: string;
  name: string;
  kind: 'contact' | 'investorFirm' | 'investorContact';
  email?: string;
  /** For a person attached to a firm, the firm they belong to. */
  firmName?: string;
}
