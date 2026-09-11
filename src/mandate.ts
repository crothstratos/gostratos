/**
 * What Stratos invests in, as the firm states it publicly.
 *
 * Every value below was read off gostratos.vc on 11 September 2026 and is
 * quoted in the comments so the wording can be checked rather than trusted.
 * This is the input to every fit score in the app, which means editing this
 * file changes what the CRM thinks a good company looks like — deliberately,
 * because a scoring model nobody can adjust is one nobody will believe.
 *
 * Sources:
 *   gostratos.vc/stratos-opportunity-fund
 *     "FinTech, InsurTech, and RegTech companies"
 *     "Seed and Series A stage"
 *     "teams generating close to $1M in revenue, supported by referenceable
 *      clients"
 *     "Utilizing advanced technologies including AI, Agentic AI, Machine
 *      Learning, Blockchain, and IoT"
 *     "often leading rounds", "targeting a $100M fund"
 *   gostratos.vc/historical-funds
 *     Prosperity Fund: "Seed and Series A stages", "B2B Software-as-a-Service
 *      (SaaS) model"
 *     Frontier Fund: "AI/Machine Learning, Blockchain, IoT, Robotics"
 *     "just under 40 portfolio companies", "close to $100M in assets under
 *      management" since 2018
 *   gostratos.vc (home)
 *     "products that solve real problems", "management teams that can
 *      execute", "early customer traction that proves the model"
 *
 * The portfolio itself is NOT here. The logos on the Companies page are saved
 * as "Untitled design-2.png" through "-39.png", so the names are not in the
 * markup to be read.
 *
 * The vocabulary below was instead calibrated against the prior firm,
 * naplestechnologyventures.com/companies, which names all 37 of its
 * investments with a line on each. Only the FinTech, InsurTech and RegTech
 * ones were used. That page also lists healthcare, agtech, robotics, HR and
 * martech companies, and every one of those was deliberately left out: this
 * fund's mandate is three verticals, and widening the vocabulary to match a
 * previous fund's range would quietly score off-mandate companies as good
 * fits. The excluded names are listed in OFF_MANDATE_PRIOR_INVESTMENTS so the
 * omission is visible rather than looking like an oversight.
 */

export interface Mandate {
  sourcedFrom: string;
  sourcedAt: string;
  /** The three named verticals. A direct hit is the strongest single signal. */
  coreVerticals: string[];
  /**
   * Fintech, insurtech or regtech without using the word.
   *
   * Most companies describe what they do — "underwriting automation",
   * "payments reconciliation" — rather than which category they file under, so
   * matching only the three headline terms would score most of the actual
   * pipeline at zero.
   */
  adjacentVerticals: string[];
  /** Software, but not obviously in our sectors. Worth a little, not a lot. */
  genericSoftware: string[];
  preferredStages: string[];
  adjacentStages: string[];
  lateStages: string[];
  technologies: string[];
  b2bSignals: string[];
  consumerSignals: string[];
  /** "close to $1M in revenue" — the traction bar the fund states. */
  revenueTargetUsd: number;
  tractionSignals: string[];
  weakTractionSignals: string[];
}

export const MANDATE: Mandate = {
  sourcedFrom: 'gostratos.vc',
  sourcedAt: '2026-09-11',

  coreVerticals: [
    'fintech', 'fin-tech', 'financial technology',
    'insurtech', 'insure-tech', 'insurance technology',
    'regtech', 'reg-tech', 'regulatory technology', 'compliance technology',
  ],

  adjacentVerticals: [
    // payments and banking
    'payments', 'payment processing', 'embedded finance', 'open banking',
    'core banking', 'neobank', 'digital banking', 'card issuing', 'acquiring',
    'treasury', 'settlement', 'custody', 'remittance', 'money transfer',
    // credit and lending
    'lending', 'credit', 'underwriting', 'mortgage', 'loan origination',
    'credit scoring', 'debt', 'factoring', 'bnpl', 'buy now pay later',
    // insurance
    'insurance', 'reinsurance', 'claims', 'actuarial', 'policy administration',
    'broker', 'brokerage', 'annuity', 'benefits administration',
    // regulatory, risk and compliance
    'compliance', 'kyc', 'know your customer', 'aml', 'anti-money laundering',
    'fraud', 'fraud detection', 'financial crime', 'sanctions screening',
    'identity verification', 'risk management', 'audit', 'regulatory reporting',
    'governance risk', 'esg reporting',
    // capital markets, wealth and the back office
    'wealth management', 'asset management', 'capital markets', 'trading',
    'investment management', 'portfolio management', 'accounting', 'tax',
    'billing', 'invoicing', 'reconciliation', 'expense management', 'payroll',
    'spend management', 'financial planning', 'financial operations', 'fp&a',
    'financial services', 'banking software', 'cap table', 'equity management',
    // Read off the prior firm's own descriptions of its fintech, insurtech
    // and regtech investments. Companies describe themselves in these words
    // far more often than they say "fintech".
    'payouts', 'payout', 'wage', 'disbursement', 'merchant', 'merchants',
    'loan trading', 'origination', 'general ledger', 'digital accounts',
    'policyholder', 'policyholders', 'carrier', 'carriers', 'life insurance',
    'commercial insurance', 'point-of-sale', 'property risk',
    'vendor risk', 'security questionnaire', 'due diligence', 'screening',
    'tokenization', 'private assets', 'credit investors',
  ],

  genericSoftware: [
    'saas', 'software-as-a-service', 'enterprise software', 'b2b software',
    'platform', 'api', 'workflow automation', 'data platform', 'infrastructure',
  ],

  // "Seed and Series A stage" — the fund's own words, in both the current
  // fund and the Prosperity Fund before it.
  preferredStages: ['seed', 'series a', 'series-a', 'seed round', 'a round'],
  adjacentStages: ['pre-seed', 'preseed', 'pre seed', 'series b', 'series-b', 'bridge', 'seed extension'],
  lateStages: ['series c', 'series d', 'series e', 'series f', 'growth equity', 'late stage', 'pre-ipo', 'ipo', 'public', 'acquired'],

  technologies: [
    // 'ai' is matched on a word boundary, which is what keeps it out of
    // "retail", "email" and "certain" — all of which appear constantly in
    // company descriptions and all of which matched before the boundary was
    // added. Without the bare term, "uses AI and ML" counted as one signal.
    'ai', 'a.i.',
    'artificial intelligence', 'agentic ai', 'agentic', 'machine learning',
    'deep learning', 'llm', 'large language model', 'generative ai',
    'blockchain', 'distributed ledger', 'smart contract',
    'internet of things', 'robotics', 'rpa', 'computer vision', 'nlp',
    'natural language processing', 'predictive analytics',
  ],

  b2bSignals: [
    'b2b', 'business-to-business', 'enterprise', 'saas', 'software-as-a-service',
    'subscription', 'arr', 'enterprise customers', 'banks', 'insurers',
    'financial institutions', 'credit unions', 'lenders', 'brokers', 'api',
  ],

  consumerSignals: [
    'b2c', 'business-to-consumer', 'consumer app', 'direct-to-consumer', 'd2c',
    'shoppers', 'households', 'personal finance app',
  ],

  // "teams generating close to $1M in revenue, supported by referenceable
  // clients"
  revenueTargetUsd: 1_000_000,

  tractionSignals: [
    'referenceable', 'arr', 'annual recurring revenue', 'paying customers',
    'enterprise customers', 'fortune 500', 'profitable', 'revenue run rate',
    'signed contracts', 'named customers', 'production deployment',
  ],

  weakTractionSignals: [
    'pilot', 'pilots', 'customers', 'clients', 'users', 'traction',
    'design partner', 'design partners', 'waitlist', 'beta',
  ],
};

/**
 * The prior firm's FinTech, InsurTech and RegTech investments.
 *
 * Reference, not scoring input — this is what an on-mandate company has
 * looked like in practice, and it is the calibration the vocabulary above was
 * written against. Source: naplestechnologyventures.com/companies.
 */
export const ON_MANDATE_PRIOR_INVESTMENTS = [
  // FinTech
  'Community Capital', 'Ferry', 'Everyware', 'FinGoal', 'Finli', 'Kasisto',
  'LendingStandard', 'PayTheory', 'Rellevate', 'SoftLedger', 'Xup Payments',
  // InsurTech
  'AllDigital Specialty', 'Avanta Risk Management', 'GloveBox',
  'MRS (Management Research Services)', 'Pendella',
  // RegTech
  'Privva', 'Vertalo', 'Worldwatch Plus (ISS)',
];

/**
 * Prior investments deliberately NOT used to build the vocabulary.
 *
 * Listed so that the omission reads as a decision rather than an oversight.
 * These are real investments of the previous fund in healthcare, agtech,
 * robotics, HR, security and martech. This fund invests in three verticals,
 * and teaching the scorer this vocabulary would have it rank an agtech
 * company as on-mandate because a previous fund once backed one.
 */
export const OFF_MANDATE_PRIOR_INVESTMENTS = [
  'Acium', 'Agrisource Data', 'Beam Mobile IoT', 'Boulo Solutions',
  'BusinessOptix', 'Fixt', 'Gainfront', 'GoWell Benefits', 'Inclusively',
  'Iris', 'Itopia', 'Lucy', 'Medsien', 'Streann', 'Tinysponsor',
  'Tomahawk Robotics', 'Ventrue', 'Zenapse',
];
