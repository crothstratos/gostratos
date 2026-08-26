import { Company, STAGES } from './types';

export const initialCompanies: Company[] = [
  {
    id: 'Acme Corp',
    name: 'Acme Corp',
    location: 'San Francisco, CA',
    slogan: 'Automating HR Data Entry',
    vertical: 'Other',
    stage: 'Initial Review',
    basics: 'B2B SaaS for HR',
    marketProblem: 'HR teams spend 20 hours a week on manual data entry.',
    companySolution: 'AI-powered data extraction and syncing.',
    competition: 'Workday, BambooHR, manual spreadsheets.',
    pricing: '$50/user/month',
    gtm: 'Direct sales to mid-market tech companies.',
    revenue: '$1M ARR',
    dealTerms: '$5M at $25M post-money',
    pastFinancing: '$1M Seed from YC',
    lastModified: new Date().toISOString(),
    stageHistory: [{ stage: 'Initial Review', date: new Date().toISOString() }],
  },
  {
    id: 'Globex',
    name: 'Globex',
    location: 'New York, NY',
    slogan: 'Instant Global Transfers via API',
    vertical: 'Fintech',
    stage: 'Analyst Call',
    basics: 'Fintech infrastructure API',
    marketProblem: 'Cross-border payments are slow and expensive.',
    companySolution: 'Unified API for instant global transfers.',
    competition: 'Stripe, Adyen, local banks.',
    pricing: '0.5% per transaction',
    gtm: 'Developer-first API adoption.',
    revenue: '$500k ARR',
    dealTerms: '$2M at $15M post-money',
    pastFinancing: 'Bootstrapped',
    lastModified: new Date().toISOString(),
    stageHistory: [{ stage: 'Initial Review', date: new Date(Date.now() - 86400000).toISOString() }, { stage: 'Analyst Call', date: new Date().toISOString() }],
  },
];

export const MOCK_SCAN_RESULT = {
  score: 87,
  verdict: 'STRONGLY ALIGNED' as const,
  breakdown: [
    { title: 'Vertical & Model', score: 95, reasoning: 'B2B SaaS in Financial Technology perfectly matches core thesis.' },
    { title: 'Stage & Check Size', score: 90, reasoning: 'Raising $2M Seed round falls exactly within the $500k-$3M target.' },
    { title: 'Geography', score: 100, reasoning: 'Headquartered in New York, US.' },
    { title: 'Traction & Risk', score: 65, reasoning: 'Early revenue signals are positive, but customer concentration is slightly high.' },
  ],
  pros: [
    'Strong Founder-Market fit in FinTech.',
    'B2B SaaS model with high gross margins.',
    'US-based entity simplifies legal/tax structure.',
    'Targeting a massive, underserved compliance niche.'
  ],
  cons: [
    'Valuation expectations are slightly above median for Seed.',
    'Go-to-market strategy relies heavily on expensive outbound sales.',
    'Incumbent competitors have significant distribution advantages.'
  ]
};
