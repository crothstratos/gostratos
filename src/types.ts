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
}

export interface ProfileNote {
  id: string;
  text: string;
  timestamp: string;
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
