/**
 * Server-side Production Type Rules for Edge Functions
 * 
 * Mirrors the client-side PRODUCTION_TYPE_RULES but optimized for prompt injection.
 * Single source of truth for AI conditioning context across all LLM engines.
 */

export interface ProductionTypeContext {
  type: string;
  label: string;
  aiConditioningContext: string;
  allowedConcepts: string[];
  disallowedConcepts: string[];
  financingModel: string[];
  marketStrategyFocus: string[];
}

const RULES: Record<string, ProductionTypeContext> = {
  film: {
    type: 'film', label: 'Narrative Feature',
    aiConditioningContext: 'This is a NARRATIVE FEATURE FILM. Evaluate through the lens of theatrical/streaming distribution, festival strategy, pre-sales potential, and traditional film financing structures. Do NOT reference series concepts, brand clients, ad revenue, or digital-first metrics.',
    allowedConcepts: ['pre-sales', 'equity', 'gap-finance', 'tax-credit', 'co-production', 'theatrical-release', 'streaming-deal', 'festival-premiere', 'awards-campaign', 'cast-packaging', 'sales-agent', 'minimum-guarantee', 'recoupment-waterfall', 'territory-rights'],
    disallowedConcepts: ['subscriber-model', 'brand-integration', 'client-budget', 'agency-commission', 'episode-scalability', 'renewal-probability', 'platform-algorithm', 'influencer-leverage', 'ad-revenue', 'sponsorship-tier'],
    financingModel: ['Equity', 'Pre-Sales', 'Incentives', 'Gap', 'Soft Money', 'Other'],
    marketStrategyFocus: ['Festival premiere strategy', 'Sales agent engagement', 'Territory pre-sales', 'Awards positioning', 'P&A planning'],
  },
  'tv-series': {
    type: 'tv-series', label: 'Narrative Series',
    aiConditioningContext: 'This is a NARRATIVE TV SERIES. Evaluate through the lens of platform/broadcaster commissioning, showrunner strength, series engine sustainability, multi-season potential, and per-episode economics. Do NOT reference theatrical distribution, one-off film financing, or brand clients.',
    allowedConcepts: ['platform-deal', 'broadcaster-commission', 'co-production', 'deficit-finance', 'showrunner', 'series-bible', 'pilot', 'season-arc', 'renewal-probability', 'episode-budget', 'multi-season', 'platform-fit', 'territory-rights'],
    disallowedConcepts: ['theatrical-release', 'p&a', 'day-and-date', 'festival-premiere', 'client-budget', 'agency-commission', 'brand-integration', 'subscriber-model', 'influencer-leverage', 'ad-revenue'],
    financingModel: ['Platform Deal', 'Broadcaster', 'Co-Pro', 'Incentives', 'Deficit Finance', 'Other'],
    marketStrategyFocus: ['Platform/broadcaster pitching', 'Co-production structuring', 'Format rights licensing', 'International distribution', 'Multi-season planning'],
  },
  documentary: {
    type: 'documentary', label: 'Documentary Feature',
    aiConditioningContext: 'This is a DOCUMENTARY FEATURE. Evaluate through the lens of subject access exclusivity, grant funding eligibility, broadcaster/streamer fit, impact campaign potential, and rights clearance. Do NOT reference narrative cast packaging, fictional script structure, or commercial brand clients.',
    allowedConcepts: ['grants', 'broadcaster-pre-sales', 'ngo-partners', 'impact-investors', 'impact-campaign', 'archive-clearance', 'subject-access', 'editorial-independence', 'festival-circuit', 'educational-distribution'],
    disallowedConcepts: ['cast-packaging', 'cast-attached', 'talent-tier', 'minimum-guarantee', 'recoupment-waterfall', 'equity-financing', 'gap-finance', 'client-budget', 'agency-commission', 'brand-integration', 'subscriber-model', 'episode-scalability', 'influencer-leverage'],
    financingModel: ['Grants', 'Broadcaster Pre-Sales', 'NGO Partners', 'Impact Investors', 'Sales Agent', 'Territory Splits'],
    marketStrategyFocus: ['Grant applications', 'Broadcaster pitching', 'Impact campaign design', 'Festival strategy', 'Educational distribution'],
  },
  'documentary-series': {
    type: 'documentary-series', label: 'Documentary Series',
    aiConditioningContext: 'This is a DOCUMENTARY SERIES. Evaluate through the lens of multi-episode storytelling, broadcaster/platform commissioning, subject access sustainability, per-episode economics, and impact campaign potential. Do NOT reference narrative cast packaging, fictional scripts, or commercial brand clients.',
    allowedConcepts: ['grants', 'broadcaster-commission', 'platform-deal', 'co-production', 'impact-campaign', 'archive-clearance', 'subject-access', 'multi-episode', 'season-arc', 'per-episode-budget'],
    disallowedConcepts: ['cast-packaging', 'talent-tier', 'minimum-guarantee', 'recoupment-waterfall', 'equity-financing', 'gap-finance', 'theatrical-release', 'client-budget', 'agency-commission', 'brand-integration', 'subscriber-model', 'influencer-leverage'],
    financingModel: ['Broadcaster Commission', 'Platform Deal', 'Grants', 'Co-Pro', 'Impact Investors', 'Territory Splits'],
    marketStrategyFocus: ['Broadcaster/platform pitching', 'Multi-episode format design', 'Co-production structuring', 'Impact campaign', 'Format licensing'],
  },
  'hybrid-documentary': {
    type: 'hybrid-documentary', label: 'Hybrid Documentary',
    aiConditioningContext: 'This is a HYBRID DOCUMENTARY that blends non-fiction with fiction, animation, or experimental techniques. Evaluate through the lens of documentary integrity, hybrid innovation, grant eligibility, festival potential, and cultural impact. The factual core must remain evidence-anchored even when using creative reconstruction or animation.',
    allowedConcepts: ['grants', 'broadcaster-pre-sales', 'ngo-partners', 'impact-campaign', 'archive-clearance', 'subject-access', 'arts-council', 'animation-integration', 'reconstruction', 'scripted-elements'],
    disallowedConcepts: ['cast-packaging', 'talent-tier', 'minimum-guarantee', 'recoupment-waterfall', 'equity-financing', 'gap-finance', 'client-budget', 'agency-commission', 'subscriber-model', 'influencer-leverage'],
    financingModel: ['Grants', 'Arts Council', 'Broadcaster Pre-Sales', 'Co-Pro', 'Impact Investors', 'Innovation Funds'],
    marketStrategyFocus: ['Arts council applications', 'Festival strategy', 'Innovation fund pitching', 'Impact campaign design', 'Broadcaster pitching'],
  },
  commercial: {
    type: 'commercial', label: 'Commercial / Advert',
    aiConditioningContext: 'This is a COMMERCIAL / ADVERTISEMENT. Evaluate through the lens of client brief alignment, production margin, director fit, brand guidelines compliance, usage rights, and deliverables matrix. Do NOT reference film financing, festival strategy, equity, pre-sales, or streaming deals.',
    allowedConcepts: ['client-budget', 'agency-commission', 'production-fee', 'director-fee', 'usage-rights', 'buyout', 'talent-buyout', 'media-spend', 'creative-brief', 'brand-guidelines'],
    disallowedConcepts: ['pre-sales', 'equity', 'gap-finance', 'recoupment-waterfall', 'festival-premiere', 'awards-campaign', 'sales-agent', 'territory-rights', 'co-production', 'broadcaster-commission', 'grants'],
    financingModel: ['Client Budget', 'Production Fee', 'Director Fee', 'Post', 'Agency Commission', 'Contingency'],
    marketStrategyFocus: ['Client relationship management', 'Director bidding', 'Production margin optimization', 'Awards entry', 'Portfolio building'],
  },
  'branded-content': {
    type: 'branded-content', label: 'Branded Content',
    aiConditioningContext: 'This is BRANDED CONTENT. Evaluate through the lens of brand story alignment, cultural authenticity, platform amplification potential, audience engagement, and long-tail IP value. Do NOT reference traditional film financing, festival strategy, equity, pre-sales, or broadcaster commissioning.',
    allowedConcepts: ['brand-funding', 'performance-bonus', 'ip-ownership', 'distribution-deal', 'long-tail-revenue', 'brand-alignment', 'platform-amplification', 'audience-engagement', 'content-strategy'],
    disallowedConcepts: ['pre-sales', 'equity', 'gap-finance', 'recoupment-waterfall', 'festival-premiere', 'sales-agent', 'minimum-guarantee', 'territory-rights', 'co-production', 'broadcaster-commission', 'grants'],
    financingModel: ['Brand Funding', 'Performance Bonus', 'IP Ownership', 'Distribution Deal', 'Long-tail Revenue'],
    marketStrategyFocus: ['Brand partnership development', 'Content distribution strategy', 'Performance analytics', 'IP ownership negotiation', 'Cultural relevance assessment'],
  },
  'short-film': {
    type: 'short-film', label: 'Short Film',
    aiConditioningContext: 'This is a SHORT FILM. Evaluate through the lens of festival circuit strategy, talent showcase potential, proof-of-concept viability, and IP expansion possibilities. Do NOT reference feature film financing structures, pre-sales, equity, gap financing, or commercial brand clients.',
    allowedConcepts: ['self-funded', 'grants', 'brand-support', 'in-kind', 'crowdfunding', 'festival-strategy', 'talent-showcase', 'proof-of-concept', 'ip-incubation'],
    disallowedConcepts: ['pre-sales', 'gap-finance', 'recoupment-waterfall', 'territory-rights', 'minimum-guarantee', 'sales-agent', 'theatrical-release', 'client-budget', 'agency-commission'],
    financingModel: ['Self-Funded', 'Grants', 'Brand Support', 'In-Kind', 'Crowdfunding'],
    marketStrategyFocus: ['Festival submission strategy', 'Online premiere timing', 'Talent showcase maximization', 'Feature development potential', 'Awards circuit planning'],
  },
  'music-video': {
    type: 'music-video', label: 'Music Video',
    aiConditioningContext: 'This is a MUSIC VIDEO. Evaluate through the lens of visual storytelling, artist brand alignment, label/commissioner relationship, director treatment strength, and social media release strategy. Do NOT reference film financing, festival strategy, equity, pre-sales, or broadcasting deals.',
    allowedConcepts: ['label-budget', 'artist-budget', 'director-treatment', 'commissioner', 'production-fee', 'youtube-premiere', 'social-release'],
    disallowedConcepts: ['pre-sales', 'equity', 'gap-finance', 'recoupment-waterfall', 'festival-premiere', 'sales-agent', 'minimum-guarantee', 'territory-rights', 'co-production', 'broadcaster-commission'],
    financingModel: ['Label Budget', 'Artist Budget', 'Production Fee', 'Director Fee', 'Post Budget', 'Contingency'],
    marketStrategyFocus: ['Treatment development', 'Commissioner relationship', 'Social release strategy', 'Awards entry', 'Portfolio building'],
  },
  'proof-of-concept': {
    type: 'proof-of-concept', label: 'Proof of Concept',
    aiConditioningContext: 'This is a PROOF OF CONCEPT. Evaluate through the lens of IP demonstration potential, feature/series development viability, investor pitch readiness, and technical showcase quality. This is NOT a finished product — it is a strategic tool to unlock bigger production. Do NOT reference distribution, sales, or recoupment.',
    allowedConcepts: ['self-funded', 'grants', 'in-kind', 'crowdfunding', 'investor-teaser', 'ip-demonstration', 'vfx-proof', 'tone-proof', 'pitch-material'],
    disallowedConcepts: ['pre-sales', 'gap-finance', 'recoupment-waterfall', 'territory-rights', 'minimum-guarantee', 'sales-agent', 'theatrical-release', 'client-budget', 'agency-commission'],
    financingModel: ['Self-Funded', 'Grants', 'In-Kind', 'Investor Seed', 'Crowdfunding'],
    marketStrategyFocus: ['Investor pitch preparation', 'Festival lab submissions', 'Development fund applications', 'Packaging tool creation'],
  },
  'digital-series': {
    type: 'digital-series', label: 'Digital / Social',
    aiConditioningContext: 'This is a DIGITAL / SOCIAL SERIES. Evaluate through the lens of platform-native audience growth, content scalability, brand integration potential, subscriber/ad revenue models, and algorithm optimization. Do NOT reference traditional film/TV financing, theatrical distribution, or festival strategy.',
    allowedConcepts: ['brand-integration', 'platform-deal', 'ad-revenue', 'sponsorship', 'subscriber-model', 'creator-fund', 'audience-growth', 'episode-scalability', 'platform-algorithm'],
    disallowedConcepts: ['pre-sales', 'equity', 'gap-finance', 'recoupment-waterfall', 'festival-premiere', 'sales-agent', 'minimum-guarantee', 'territory-rights', 'co-production', 'theatrical-release'],
    financingModel: ['Brand Integration', 'Platform Deal', 'Ad Revenue', 'Sponsorship', 'Subscriber Model'],
    marketStrategyFocus: ['Platform selection strategy', 'Audience growth hacking', 'Brand partnership development', 'Content calendar optimization'],
  },
  'vertical-drama': {
    type: 'vertical-drama', label: 'Vertical Drama',
    aiConditioningContext: 'This is a VERTICAL DRAMA — short-form, mobile-first narrative content designed for platforms like TikTok, YouTube Shorts, Instagram Reels, Snapchat, or dedicated vertical drama apps (ReelShort, ShortMax, FlexTV). Evaluate through the lens of episode pacing (1–3 min episodes), cliffhanger design, swipe retention, cast social reach, youth audience appeal, platform algorithm optimization, and brand integration potential. Do NOT reference theatrical distribution, festival strategy, traditional film financing, or long-form television structures.',
    allowedConcepts: ['platform-deal', 'brand-integration', 'episode-scalability', 'social-distribution', 'mobile-first', 'vertical-format', 'short-form-episode', 'cliffhanger-design', 'ad-revenue', 'sponsorship', 'cast-packaging'],
    disallowedConcepts: ['theatrical-release', 'p&a', 'day-and-date', 'festival-premiere', 'dcp', 'sales-agent', 'minimum-guarantee', 'recoupment-waterfall', 'co-production', 'gap-finance', 'grants'],
    financingModel: ['Platform Deal', 'Brand Integration', 'Ad Revenue', 'Sponsorship', 'Creator Fund', 'Pre-Sales'],
    marketStrategyFocus: ['Platform selection & algorithm strategy', 'Cast social reach optimization', 'Cliffhanger & retention design', 'Brand partnership development'],
  },
  'limited-series': {
    type: 'limited-series', label: 'Limited Series',
    aiConditioningContext: 'This is a LIMITED SERIES — a contained, prestige event series. Evaluate through the lens of cast heat, contained narrative power, awards potential, and platform positioning. Do NOT reference multi-season renewal, format repeatability, or brand clients.',
    allowedConcepts: ['platform-deal', 'broadcaster-commission', 'co-production', 'equity', 'cast-packaging', 'showrunner', 'awards-campaign', 'festival-premiere', 'streaming-deal', 'territory-rights'],
    disallowedConcepts: ['renewal-probability', 'episode-scalability', 'multi-season', 'client-budget', 'agency-commission', 'brand-integration', 'subscriber-model', 'influencer-leverage', 'ad-revenue'],
    financingModel: ['Platform Deal', 'Broadcaster', 'Co-Pro', 'Incentives', 'Equity', 'Other'],
    marketStrategyFocus: ['Cast packaging', 'Platform pitching', 'Awards positioning', 'Festival strategy', 'International sales'],
  },
  hybrid: {
    type: 'hybrid', label: 'Hybrid',
    aiConditioningContext: 'This is a HYBRID project that spans multiple formats, platforms, or media types. Evaluate through the lens of cross-platform storytelling, transmedia potential, innovation fund eligibility, and experiential audience engagement. Be flexible with financing and distribution models.',
    allowedConcepts: ['cross-platform', 'transmedia', 'interactive', 'immersive', 'multi-format', 'mixed-reality', 'live-event'],
    disallowedConcepts: [],
    financingModel: ['Brand Partners', 'Arts Council', 'Innovation Funds', 'Platform Deals', 'Experiential Budget', 'Tech Partners'],
    marketStrategyFocus: ['Cross-platform distribution', 'Innovation fund applications', 'Experiential venue partnerships', 'Transmedia narrative design'],
  },
  'anim-feature': {
    type: 'anim-feature', label: 'Animated Feature',
    aiConditioningContext: 'This is an ANIMATED FEATURE FILM. Evaluate through the lens of visual world uniqueness, franchise/IP potential, voice cast strategy, production timeline feasibility, and international pre-sale attractiveness. Do NOT reference live-action production, brand clients, or digital-first metrics.',
    allowedConcepts: ['pre-sales', 'equity', 'co-production', 'tax-credit', 'voice-cast', 'franchise-potential', 'merchandise', 'streaming-deal', 'theatrical-release'],
    disallowedConcepts: ['client-budget', 'agency-commission', 'brand-integration', 'subscriber-model', 'influencer-leverage', 'ad-revenue', 'live-action-cast'],
    financingModel: ['Studio Deal', 'Pre-Sales', 'Co-Pro', 'Incentives', 'Equity', 'Other'],
    marketStrategyFocus: ['IP franchise development', 'Merchandise licensing', 'International pre-sales', 'Platform/theatrical strategy'],
  },
  'anim-series': {
    type: 'anim-series', label: 'Animated Series',
    aiConditioningContext: 'This is an ANIMATED SERIES. Evaluate through the lens of episodic engine strength, toyetic/licensing potential, platform demographic alignment, production pipeline efficiency, and renewal probability. Do NOT reference theatrical distribution or live-action production.',
    allowedConcepts: ['platform-deal', 'broadcaster-commission', 'co-production', 'licensing', 'merchandise', 'toy-deal', 'format-rights', 'multi-season'],
    disallowedConcepts: ['theatrical-release', 'p&a', 'festival-premiere', 'awards-campaign', 'client-budget', 'agency-commission', 'live-action-cast'],
    financingModel: ['Platform Deal', 'Broadcaster', 'Licensing Pre-Sales', 'Co-Pro', 'Incentives', 'Other'],
    marketStrategyFocus: ['Platform pitching', 'Licensing partnerships', 'Toy/merch development', 'International format sales'],
  },
  reality: {
    type: 'reality', label: 'Reality / Unscripted',
    aiConditioningContext: 'This is a REALITY / UNSCRIPTED format. Evaluate through the lens of format originality, repeatability, casting scalability, commission likelihood, cost-to-return ratio, and international format adaptability. Do NOT reference scripted screenplay analysis, theatrical distribution, or traditional film financing.',
    allowedConcepts: ['format-rights', 'commission', 'broadcaster-deal', 'platform-deal', 'sponsorship', 'brand-integration', 'casting-scalability', 'repeatability'],
    disallowedConcepts: ['script-coverage', 'screenplay', 'cast-packaging', 'pre-sales', 'equity', 'gap-finance', 'recoupment-waterfall', 'festival-premiere', 'awards-campaign'],
    financingModel: ['Commission Fee', 'Broadcaster', 'Platform Deal', 'Sponsorship', 'Format Sales', 'Other'],
    marketStrategyFocus: ['Format development', 'Commissioner pitching', 'International format sales', 'Sponsorship development'],
  },
  'podcast-ip': {
    type: 'podcast-ip', label: 'Podcast IP',
    aiConditioningContext: 'This is a PODCAST IP project. Evaluate through the lens of audience growth velocity, cross-media adaptation potential, format expandability, brand integration opportunity, and monetisation scalability. Do NOT reference visual production, theatrical distribution, or traditional film/TV financing.',
    allowedConcepts: ['ad-revenue', 'sponsorship', 'premium-subscriptions', 'adaptation-option', 'brand-integration', 'audience-growth', 'cross-media', 'ip-ownership'],
    disallowedConcepts: ['theatrical-release', 'p&a', 'festival-premiere', 'dcp', 'sales-agent', 'minimum-guarantee', 'recoupment-waterfall', 'co-production', 'gap-finance'],
    financingModel: ['Ad Revenue', 'Sponsorship', 'Premium Subscriptions', 'Adaptation Option', 'Brand Integration', 'Other'],
    marketStrategyFocus: ['Audience growth strategy', 'Ad sales optimization', 'Adaptation development', 'Brand partnership'],
  },
};

/**
 * Get the production type context for a given type key.
 * Falls back to 'film' if unknown.
 */
export function getProductionTypeContext(
  productionType: string,
  _format?: string,
  _laneWeights?: Record<string, number>
): ProductionTypeContext {
  const key = (productionType || 'film').toLowerCase();
  return RULES[key] || RULES.film;
}

/**
 * Get the AI conditioning text block for injection into system prompts.
 */
export function getConditioningBlock(productionType: string): string {
  const ctx = getProductionTypeContext(productionType);
  return `\n═══ PRODUCTION TYPE GOVERNANCE ═══\n${ctx.aiConditioningContext}\n\nALLOWED CONCEPTS: ${ctx.allowedConcepts.join(', ')}\nDISALLOWED CONCEPTS: ${ctx.disallowedConcepts.join(', ')}\n═══ END PRODUCTION TYPE GOVERNANCE ═══`;
}

/**
 * Check text for disallowed concept violations.
 */
export function checkDisallowedConcepts(productionType: string, text: string): string[] {
  const ctx = getProductionTypeContext(productionType);
  const lower = text.toLowerCase();
  const violations: string[] = [];
  for (const concept of ctx.disallowedConcepts) {
    const searchTerm = concept.replace(/-/g, '[\\s-]');
    if (new RegExp(searchTerm, 'i').test(lower)) {
      violations.push(concept);
    }
  }
  return violations;
}
