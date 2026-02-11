/**
 * Production Type Governance Engine
 * 
 * Defines ALLOWED and DISALLOWED concepts per production type,
 * financing model templates, stakeholder templates, deliverables templates,
 * and AI conditioning context. No cross-type contamination.
 */

import type { ProjectFormat } from '@/lib/types';

// ─── Governance Rule ───

export interface ProductionTypeRule {
  type: ProjectFormat;
  label: string;
  emoji: string;
  allowedConcepts: string[];
  disallowedConcepts: string[];
  financingModel: string[];
  stakeholderTemplate: string[];
  deliverablesTemplate: string[];
  aiConditioningContext: string;
  marketStrategyFocus: string[];
  dashboardSummaryLabel: string;
}

export const PRODUCTION_TYPE_RULES: Record<ProjectFormat, ProductionTypeRule> = {
  film: {
    type: 'film',
    label: 'Narrative Feature',
    emoji: '🎬',
    allowedConcepts: [
      'pre-sales', 'equity', 'gap-finance', 'tax-credit', 'co-production',
      'theatrical-release', 'streaming-deal', 'festival-premiere', 'awards-campaign',
      'cast-packaging', 'sales-agent', 'minimum-guarantee', 'recoupment-waterfall',
      'territory-rights', 'holdback', 'day-and-date', 'p&a', 'backend-participation',
    ],
    disallowedConcepts: [
      'subscriber-model', 'brand-integration', 'client-budget', 'agency-commission',
      'episode-scalability', 'renewal-probability', 'platform-algorithm',
      'influencer-leverage', 'ad-revenue', 'sponsorship-tier',
    ],
    financingModel: ['Equity', 'Pre-Sales', 'Incentives', 'Gap', 'Soft Money', 'Other'],
    stakeholderTemplate: ['Producer', 'Director', 'Writer', 'Cast', 'Sales Agent', 'Financier', 'Distributor', 'Co-Producer'],
    deliverablesTemplate: ['DCP', 'ProRes Master', 'M&E', 'Subtitles', 'Key Art', 'Trailer', 'EPK', 'Screener'],
    aiConditioningContext: 'This is a NARRATIVE FEATURE FILM. Evaluate through the lens of theatrical/streaming distribution, festival strategy, pre-sales potential, and traditional film financing structures. Do NOT reference series concepts, brand clients, ad revenue, or digital-first metrics.',
    marketStrategyFocus: ['Festival premiere strategy', 'Sales agent engagement', 'Territory pre-sales', 'Awards positioning', 'P&A planning'],
    dashboardSummaryLabel: 'Feature Film Intelligence',
  },
  'tv-series': {
    type: 'tv-series',
    label: 'Narrative Series',
    emoji: '📺',
    allowedConcepts: [
      'platform-deal', 'broadcaster-commission', 'co-production', 'deficit-finance',
      'showrunner', 'series-bible', 'pilot', 'writers-room', 'season-arc',
      'renewal-probability', 'episode-budget', 'per-episode-cost', 'multi-season',
      'platform-fit', 'territory-rights', 'format-rights', 'remake-rights',
    ],
    disallowedConcepts: [
      'theatrical-release', 'p&a', 'day-and-date', 'festival-premiere',
      'client-budget', 'agency-commission', 'brand-integration',
      'subscriber-model', 'influencer-leverage', 'ad-revenue',
    ],
    financingModel: ['Platform Deal', 'Broadcaster', 'Co-Pro', 'Incentives', 'Deficit Finance', 'Other'],
    stakeholderTemplate: ['Showrunner', 'Producer', 'Director', 'Writer', 'Cast', 'Platform Buyer', 'Broadcaster', 'Co-Producer', 'Sales Agent'],
    deliverablesTemplate: ['Series Bible', 'Pilot Script', 'Season Outline', 'Pitch Deck', 'Sizzle Reel', 'Master Files', 'M&E per Episode'],
    aiConditioningContext: 'This is a NARRATIVE TV SERIES. Evaluate through the lens of platform/broadcaster commissioning, showrunner strength, series engine sustainability, multi-season potential, and per-episode economics. Do NOT reference theatrical distribution, one-off film financing, or brand clients.',
    marketStrategyFocus: ['Platform/broadcaster pitching', 'Co-production structuring', 'Format rights licensing', 'International distribution', 'Multi-season planning'],
    dashboardSummaryLabel: 'Series Intelligence',
  },
  documentary: {
    type: 'documentary',
    label: 'Documentary Feature',
    emoji: '🎥',
    allowedConcepts: [
      'grants', 'broadcaster-pre-sales', 'ngo-partners', 'impact-investors',
      'impact-campaign', 'archive-clearance', 'subject-access', 'editorial-independence',
      'festival-circuit', 'educational-distribution', 'rights-clearance',
      'broadcaster-commission', 'streamer-acquisition', 'theatrical-doc',
    ],
    disallowedConcepts: [
      'cast-packaging', 'cast-attached', 'talent-tier', 'minimum-guarantee',
      'recoupment-waterfall', 'equity-financing', 'gap-finance',
      'client-budget', 'agency-commission', 'brand-integration',
      'subscriber-model', 'episode-scalability', 'influencer-leverage',
    ],
    financingModel: ['Grants', 'Broadcaster Pre-Sales', 'NGO Partners', 'Impact Investors', 'Sales Agent', 'Territory Splits'],
    stakeholderTemplate: ['Director', 'Producer', 'Subject/Access', 'Broadcaster', 'Sales Agent', 'Impact Partner', 'Archive Licensor'],
    deliverablesTemplate: ['Feature Master', 'M&E', 'Extended Interviews', 'Impact Toolkit', 'Educational Guide', 'Key Art', 'Trailer'],
    aiConditioningContext: 'This is a DOCUMENTARY FEATURE. Evaluate through the lens of subject access exclusivity, grant funding eligibility, broadcaster/streamer fit, impact campaign potential, and rights clearance. Do NOT reference narrative cast packaging, fictional script structure, or commercial brand clients.',
    marketStrategyFocus: ['Grant applications', 'Broadcaster pitching', 'Impact campaign design', 'Festival strategy', 'Educational distribution'],
    dashboardSummaryLabel: 'Documentary Intelligence',
  },
  'documentary-series': {
    type: 'documentary-series',
    label: 'Documentary Series',
    emoji: '📹',
    allowedConcepts: [
      'grants', 'broadcaster-commission', 'platform-deal', 'co-production',
      'impact-campaign', 'archive-clearance', 'subject-access', 'editorial-independence',
      'multi-episode', 'season-arc', 'per-episode-budget', 'broadcaster-pre-sales',
      'format-rights', 'remake-rights', 'educational-distribution',
    ],
    disallowedConcepts: [
      'cast-packaging', 'talent-tier', 'minimum-guarantee', 'recoupment-waterfall',
      'equity-financing', 'gap-finance', 'theatrical-release', 'p&a',
      'client-budget', 'agency-commission', 'brand-integration',
      'subscriber-model', 'influencer-leverage',
    ],
    financingModel: ['Broadcaster Commission', 'Platform Deal', 'Grants', 'Co-Pro', 'Impact Investors', 'Territory Splits'],
    stakeholderTemplate: ['Showrunner', 'Director', 'Producer', 'Subject/Access', 'Broadcaster', 'Platform Buyer', 'Sales Agent', 'Impact Partner'],
    deliverablesTemplate: ['Series Bible', 'Episode Masters', 'M&E per Episode', 'Extended Interviews', 'Impact Toolkit', 'Educational Guide'],
    aiConditioningContext: 'This is a DOCUMENTARY SERIES. Evaluate through the lens of multi-episode storytelling, broadcaster/platform commissioning, subject access sustainability across episodes, per-episode economics, and impact campaign potential. Do NOT reference narrative cast packaging, fictional scripts, or commercial brand clients.',
    marketStrategyFocus: ['Broadcaster/platform pitching', 'Multi-episode format design', 'Co-production structuring', 'Impact campaign', 'Format licensing'],
    dashboardSummaryLabel: 'Doc Series Intelligence',
  },
  commercial: {
    type: 'commercial',
    label: 'Commercial / Advert',
    emoji: '📢',
    allowedConcepts: [
      'client-budget', 'agency-commission', 'production-fee', 'director-fee',
      'production-margin', 'usage-rights', 'buyout', 'talent-buyout',
      'media-spend', 'creative-brief', 'brand-guidelines', 'storyboard',
      'animatic', 'grade', 'conform', 'deliverables-matrix', 'broadcast-clearance',
    ],
    disallowedConcepts: [
      'pre-sales', 'equity', 'gap-finance', 'recoupment-waterfall',
      'festival-premiere', 'awards-campaign', 'sales-agent', 'territory-rights',
      'co-production', 'broadcaster-commission', 'grants', 'ngo-partners',
      'impact-campaign', 'subscriber-model', 'episode-scalability',
    ],
    financingModel: ['Client Budget', 'Production Fee', 'Director Fee', 'Post', 'Agency Commission', 'Contingency'],
    stakeholderTemplate: ['Client', 'Agency', 'Director', 'Producer', 'DoP', 'Editor', 'Post House', 'Music Supervisor'],
    deliverablesTemplate: ['Master TVC', 'Cutdowns (30s, 15s, 6s)', 'Social Edits', 'Stills', 'BTS', 'Broadcast Specs', 'Digital Specs'],
    aiConditioningContext: 'This is a COMMERCIAL / ADVERTISEMENT. Evaluate through the lens of client brief alignment, production margin, director fit, brand guidelines compliance, usage rights, and deliverables matrix. Do NOT reference film financing, festival strategy, equity, pre-sales, or streaming deals.',
    marketStrategyFocus: ['Client relationship management', 'Director bidding', 'Production margin optimization', 'Awards entry (Cannes Lions, D&AD)', 'Portfolio building'],
    dashboardSummaryLabel: 'Commercial Intelligence',
  },
  'branded-content': {
    type: 'branded-content',
    label: 'Branded Content',
    emoji: '✨',
    allowedConcepts: [
      'brand-funding', 'performance-bonus', 'ip-ownership', 'distribution-deal',
      'long-tail-revenue', 'brand-alignment', 'cultural-authenticity',
      'platform-amplification', 'audience-engagement', 'content-strategy',
      'social-distribution', 'influencer-integration', 'editorial-value',
    ],
    disallowedConcepts: [
      'pre-sales', 'equity', 'gap-finance', 'recoupment-waterfall',
      'festival-premiere', 'sales-agent', 'minimum-guarantee', 'territory-rights',
      'co-production', 'broadcaster-commission', 'grants', 'ngo-partners',
      'subscriber-model', 'episode-scalability', 'theatrical-release',
    ],
    financingModel: ['Brand Funding', 'Performance Bonus', 'IP Ownership', 'Distribution Deal', 'Long-tail Revenue'],
    stakeholderTemplate: ['Brand Client', 'Agency', 'Director', 'Producer', 'Talent', 'Distribution Partner', 'Social Strategist'],
    deliverablesTemplate: ['Hero Film', 'Social Edits', 'BTS', 'Stills', 'Performance Report', 'Usage Rights Documentation'],
    aiConditioningContext: 'This is BRANDED CONTENT. Evaluate through the lens of brand story alignment, cultural authenticity, platform amplification potential, audience engagement, and long-tail IP value. Do NOT reference traditional film financing, festival strategy, equity, pre-sales, or broadcaster commissioning.',
    marketStrategyFocus: ['Brand partnership development', 'Content distribution strategy', 'Performance analytics', 'IP ownership negotiation', 'Cultural relevance assessment'],
    dashboardSummaryLabel: 'Branded Content Intelligence',
  },
  'short-film': {
    type: 'short-film',
    label: 'Short Film',
    emoji: '🎞️',
    allowedConcepts: [
      'self-funded', 'grants', 'brand-support', 'in-kind', 'crowdfunding',
      'festival-strategy', 'talent-showcase', 'proof-of-concept', 'ip-incubation',
      'director-launchpad', 'online-premiere', 'festival-selections',
      'awards-submissions', 'talent-discovery',
    ],
    disallowedConcepts: [
      'pre-sales', 'gap-finance', 'recoupment-waterfall', 'territory-rights',
      'minimum-guarantee', 'sales-agent', 'theatrical-release', 'p&a',
      'client-budget', 'agency-commission', 'brand-integration',
      'subscriber-model', 'episode-scalability', 'platform-deal',
      'broadcaster-commission', 'co-production',
    ],
    financingModel: ['Self-Funded', 'Grants', 'Brand Support', 'In-Kind', 'Crowdfunding'],
    stakeholderTemplate: ['Director', 'Producer', 'Writer', 'Cast', 'DoP', 'Editor'],
    deliverablesTemplate: ['Festival DCP', 'ProRes Master', 'Poster', 'Trailer', 'Press Kit', 'Online Master'],
    aiConditioningContext: 'This is a SHORT FILM. Evaluate through the lens of festival circuit strategy, talent showcase potential, proof-of-concept viability, and IP expansion possibilities. Do NOT reference feature film financing structures, pre-sales, equity, gap financing, or commercial brand clients.',
    marketStrategyFocus: ['Festival submission strategy', 'Online premiere timing', 'Talent showcase maximization', 'Feature development potential', 'Awards circuit planning'],
    dashboardSummaryLabel: 'Short Film Intelligence',
  },
  'music-video': {
    type: 'music-video',
    label: 'Music Video',
    emoji: '🎵',
    allowedConcepts: [
      'label-budget', 'artist-budget', 'director-treatment', 'commissioner',
      'production-fee', 'director-fee', 'choreography', 'visual-effects',
      'youtube-premiere', 'social-release', 'behind-the-scenes', 'lyric-video',
      'performance-video', 'concept-video', 'awards-entry', 'portfolio-piece',
    ],
    disallowedConcepts: [
      'pre-sales', 'equity', 'gap-finance', 'recoupment-waterfall',
      'festival-premiere', 'sales-agent', 'minimum-guarantee', 'territory-rights',
      'co-production', 'broadcaster-commission', 'grants', 'ngo-partners',
      'subscriber-model', 'episode-scalability', 'theatrical-release',
      'impact-campaign', 'editorial-independence',
    ],
    financingModel: ['Label Budget', 'Artist Budget', 'Production Fee', 'Director Fee', 'Post Budget', 'Contingency'],
    stakeholderTemplate: ['Commissioner', 'Artist/Band', 'Director', 'Producer', 'DoP', 'Choreographer', 'Editor', 'Colourist'],
    deliverablesTemplate: ['Master Video', 'Clean Version', 'BTS', 'Stills', 'Social Edits (Vertical)', 'Lyric Version', 'Performance Edit'],
    aiConditioningContext: 'This is a MUSIC VIDEO. Evaluate through the lens of visual storytelling, artist brand alignment, label/commissioner relationship, director treatment strength, and social media release strategy. Do NOT reference film financing, festival strategy, equity, pre-sales, or broadcasting deals.',
    marketStrategyFocus: ['Treatment development', 'Commissioner relationship', 'Social release strategy', 'Awards entry (MVPAs, UK MVAs)', 'Portfolio building'],
    dashboardSummaryLabel: 'Music Video Intelligence',
  },
  'proof-of-concept': {
    type: 'proof-of-concept',
    label: 'Proof of Concept',
    emoji: '🧪',
    allowedConcepts: [
      'self-funded', 'grants', 'in-kind', 'crowdfunding', 'investor-teaser',
      'ip-demonstration', 'vfx-proof', 'tone-proof', 'world-building-demo',
      'pitch-material', 'sizzle-reel', 'test-footage', 'prototype',
      'feature-development', 'series-development', 'packaging-tool',
    ],
    disallowedConcepts: [
      'pre-sales', 'gap-finance', 'recoupment-waterfall', 'territory-rights',
      'minimum-guarantee', 'sales-agent', 'theatrical-release', 'p&a',
      'client-budget', 'agency-commission', 'brand-integration',
      'subscriber-model', 'episode-scalability', 'platform-deal',
      'broadcaster-commission',
    ],
    financingModel: ['Self-Funded', 'Grants', 'In-Kind', 'Investor Seed', 'Crowdfunding'],
    stakeholderTemplate: ['Director', 'Producer', 'Writer', 'VFX Supervisor', 'Cast', 'Investor/Mentor'],
    deliverablesTemplate: ['Proof Reel', 'Behind-the-Scenes', 'Pitch Deck', 'VFX Breakdown', 'Full Project Bible'],
    aiConditioningContext: 'This is a PROOF OF CONCEPT. Evaluate through the lens of IP demonstration potential, feature/series development viability, investor pitch readiness, and technical showcase quality. This is NOT a finished product — it is a strategic tool to unlock bigger production. Do NOT reference distribution, sales, or recoupment.',
    marketStrategyFocus: ['Investor pitch preparation', 'Festival lab submissions', 'Development fund applications', 'Packaging tool creation', 'Feature/series bible development'],
    dashboardSummaryLabel: 'Proof of Concept Intelligence',
  },
  'digital-series': {
    type: 'digital-series',
    label: 'Digital / Social',
    emoji: '📱',
    allowedConcepts: [
      'brand-integration', 'platform-deal', 'ad-revenue', 'sponsorship',
      'subscriber-model', 'creator-fund', 'audience-growth', 'retention-rate',
      'episode-scalability', 'platform-algorithm', 'social-distribution',
      'influencer-integration', 'content-calendar', 'analytics-driven',
    ],
    disallowedConcepts: [
      'pre-sales', 'equity', 'gap-finance', 'recoupment-waterfall',
      'festival-premiere', 'sales-agent', 'minimum-guarantee', 'territory-rights',
      'co-production', 'theatrical-release', 'p&a', 'awards-campaign',
      'broadcaster-commission', 'grants', 'ngo-partners',
    ],
    financingModel: ['Brand Integration', 'Platform Deal', 'Ad Revenue', 'Sponsorship', 'Subscriber Model'],
    stakeholderTemplate: ['Creator', 'Producer', 'Platform Manager', 'Brand Partner', 'Editor', 'Social Strategist'],
    deliverablesTemplate: ['Episode Masters', 'Social Clips', 'Thumbnails', 'BTS', 'Analytics Report', 'Brand Integration Report'],
    aiConditioningContext: 'This is a DIGITAL / SOCIAL SERIES. Evaluate through the lens of platform-native audience growth, content scalability, brand integration potential, subscriber/ad revenue models, and algorithm optimization. Do NOT reference traditional film/TV financing, theatrical distribution, or festival strategy.',
    marketStrategyFocus: ['Platform selection strategy', 'Audience growth hacking', 'Brand partnership development', 'Content calendar optimization', 'Analytics-driven iteration'],
    dashboardSummaryLabel: 'Digital Intelligence',
  },
  hybrid: {
    type: 'hybrid',
    label: 'Hybrid',
    emoji: '🔀',
    allowedConcepts: [
      'cross-platform', 'transmedia', 'interactive', 'immersive',
      'multi-format', 'mixed-reality', 'live-event', 'installation',
      'web3', 'nft', 'gaming-integration', 'experiential',
      'documentary-fiction', 'scripted-reality', 'mixed-genre',
    ],
    disallowedConcepts: [], // Hybrid allows flexibility — governance is lighter
    financingModel: ['Brand Partners', 'Arts Council', 'Innovation Funds', 'Platform Deals', 'Experiential Budget', 'Tech Partners'],
    stakeholderTemplate: ['Creative Director', 'Producer', 'Tech Lead', 'Director', 'Platform Partner', 'Brand Partner', 'Venue/Installation'],
    deliverablesTemplate: ['Core Content', 'Interactive Elements', 'Installation Specs', 'Platform Builds', 'Documentation', 'Press Kit'],
    aiConditioningContext: 'This is a HYBRID project that spans multiple formats, platforms, or media types. Evaluate through the lens of cross-platform storytelling, transmedia potential, innovation fund eligibility, and experiential audience engagement. Be flexible with financing and distribution models as hybrid projects defy conventional categorisation.',
    marketStrategyFocus: ['Cross-platform distribution', 'Innovation fund applications', 'Experiential venue partnerships', 'Transmedia narrative design', 'Technology partner engagement'],
    dashboardSummaryLabel: 'Hybrid Intelligence',
  },
};

// ─── Governance Validation ───

export interface ValidationResult {
  valid: boolean;
  violations: string[];
}

/**
 * Validates that AI output text does not contain disallowed concepts for a production type.
 */
export function validateAgainstRules(productionType: ProjectFormat, text: string): ValidationResult {
  const rules = PRODUCTION_TYPE_RULES[productionType];
  if (!rules) return { valid: true, violations: [] };

  const lower = text.toLowerCase();
  const violations: string[] = [];

  for (const concept of rules.disallowedConcepts) {
    const searchTerm = concept.replace(/-/g, '[\\s-]');
    const regex = new RegExp(searchTerm, 'i');
    if (regex.test(lower)) {
      violations.push(concept);
    }
  }

  return {
    valid: violations.length === 0,
    violations,
  };
}

/**
 * Returns the AI conditioning context for a production type.
 */
export function getAIContext(productionType: ProjectFormat): string {
  return PRODUCTION_TYPE_RULES[productionType]?.aiConditioningContext || PRODUCTION_TYPE_RULES.film.aiConditioningContext;
}

/**
 * Returns the financing model template for a production type.
 */
export function getFinancingTemplate(productionType: ProjectFormat): string[] {
  return PRODUCTION_TYPE_RULES[productionType]?.financingModel || PRODUCTION_TYPE_RULES.film.financingModel;
}

/**
 * Returns the stakeholder template for a production type.
 */
export function getStakeholderTemplate(productionType: ProjectFormat): string[] {
  return PRODUCTION_TYPE_RULES[productionType]?.stakeholderTemplate || PRODUCTION_TYPE_RULES.film.stakeholderTemplate;
}

/**
 * Returns the deliverables template for a production type.
 */
export function getDeliverablesTemplate(productionType: ProjectFormat): string[] {
  return PRODUCTION_TYPE_RULES[productionType]?.deliverablesTemplate || PRODUCTION_TYPE_RULES.film.deliverablesTemplate;
}

/**
 * Returns the dashboard summary label for a production type.
 */
export function getDashboardLabel(productionType: ProjectFormat): string {
  return PRODUCTION_TYPE_RULES[productionType]?.dashboardSummaryLabel || 'Project Intelligence';
}

/**
 * Returns market strategy focus areas for a production type.
 */
export function getMarketStrategy(productionType: ProjectFormat): string[] {
  return PRODUCTION_TYPE_RULES[productionType]?.marketStrategyFocus || [];
}

/**
 * Returns the display label and emoji for a production type.
 */
export function getProductionTypeDisplay(productionType: ProjectFormat): { label: string; emoji: string } {
  const rule = PRODUCTION_TYPE_RULES[productionType];
  return rule ? { label: rule.label, emoji: rule.emoji } : { label: 'Film', emoji: '🎬' };
}
