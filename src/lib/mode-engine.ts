/**
 * Mode Engine — defines workflows, scoring, finance models, and KPIs
 * for each project format. Algorithms are ISOLATED per type.
 */

import type { ProjectFormat } from '@/lib/types';
import { Film, Tv, Clapperboard, FileVideo, Monitor, Megaphone, Sparkles, Music, FlaskConical, Shuffle, Video, Smartphone } from 'lucide-react';

// ─── Workflow Stages per Format ───

export const MODE_WORKFLOWS: Record<ProjectFormat, { value: string; label: string }[]> = {
  film: [
    { value: 'development', label: 'Development' },
    { value: 'packaging', label: 'Packaging' },
    { value: 'financing', label: 'Financing' },
    { value: 'pre-production', label: 'Pre-Production' },
  ],
  'tv-series': [
    { value: 'development', label: 'Development' },
    { value: 'packaging', label: 'Packaging' },
    { value: 'financing', label: 'Financing' },
    { value: 'pre-production', label: 'Pre-Production' },
  ],
  'short-film': [
    { value: 'development', label: 'Development' },
    { value: 'packaging', label: 'Packaging' },
    { value: 'pre-production', label: 'Pre-Production' },
    { value: 'production', label: 'Production' },
    { value: 'post', label: 'Post' },
    { value: 'festival-strategy', label: 'Festival Strategy' },
    { value: 'online-release', label: 'Online Release' },
  ],
  documentary: [
    { value: 'development', label: 'Development' },
    { value: 'access-secured', label: 'Access Secured' },
    { value: 'funding-raised', label: 'Funding Raised' },
    { value: 'production', label: 'Production' },
    { value: 'archive-clearance', label: 'Archive & Clearance' },
    { value: 'post', label: 'Post' },
    { value: 'festival-broadcast', label: 'Festival / Broadcast' },
    { value: 'distribution', label: 'Distribution' },
  ],
  'digital-series': [
    { value: 'concept', label: 'Concept' },
    { value: 'platform-strategy', label: 'Platform Strategy' },
    { value: 'pilot-proof', label: 'Pilot / Proof' },
    { value: 'season-funding', label: 'Season Funding' },
    { value: 'production', label: 'Production' },
    { value: 'platform-launch', label: 'Platform Launch' },
    { value: 'growth-tracking', label: 'Growth Tracking' },
  ],
  commercial: [
    { value: 'brief', label: 'Brief' },
    { value: 'treatment', label: 'Treatment' },
    { value: 'awarded', label: 'Awarded' },
    { value: 'pre-pro', label: 'Pre-Pro' },
    { value: 'shoot', label: 'Shoot' },
    { value: 'post', label: 'Post' },
    { value: 'delivery', label: 'Delivery' },
    { value: 'invoice', label: 'Invoice' },
    { value: 'paid', label: 'Paid' },
  ],
  'branded-content': [
    { value: 'strategy', label: 'Strategy' },
    { value: 'creative-development', label: 'Creative Development' },
    { value: 'brand-approval', label: 'Brand Approval' },
    { value: 'production', label: 'Production' },
    { value: 'post', label: 'Post' },
    { value: 'distribution', label: 'Distribution' },
    { value: 'performance', label: 'Performance Tracking' },
  ],
  'documentary-series': [
    { value: 'development', label: 'Development' },
    { value: 'access-secured', label: 'Access Secured' },
    { value: 'funding-raised', label: 'Funding Raised' },
    { value: 'production', label: 'Production' },
    { value: 'post', label: 'Post' },
    { value: 'festival-broadcast', label: 'Festival / Broadcast' },
    { value: 'distribution', label: 'Distribution' },
  ],
  'hybrid-documentary': [
    { value: 'development', label: 'Development' },
    { value: 'access-secured', label: 'Access Secured' },
    { value: 'hybrid-design', label: 'Hybrid Design' },
    { value: 'funding-raised', label: 'Funding Raised' },
    { value: 'production', label: 'Production' },
    { value: 'post', label: 'Post' },
    { value: 'festival-broadcast', label: 'Festival / Broadcast' },
    { value: 'distribution', label: 'Distribution' },
  ],
  'music-video': [
    { value: 'brief', label: 'Brief / Commission' },
    { value: 'treatment', label: 'Treatment' },
    { value: 'awarded', label: 'Awarded' },
    { value: 'pre-pro', label: 'Pre-Pro' },
    { value: 'shoot', label: 'Shoot' },
    { value: 'post', label: 'Post' },
    { value: 'delivery', label: 'Delivery' },
    { value: 'release', label: 'Release' },
  ],
  'proof-of-concept': [
    { value: 'concept', label: 'Concept' },
    { value: 'script-treatment', label: 'Script / Treatment' },
    { value: 'funding', label: 'Funding' },
    { value: 'production', label: 'Production' },
    { value: 'post', label: 'Post' },
    { value: 'pitch-ready', label: 'Pitch-Ready' },
    { value: 'development-deal', label: 'Development Deal' },
  ],
  hybrid: [
    { value: 'concept', label: 'Concept' },
    { value: 'design', label: 'Design / Prototype' },
    { value: 'funding', label: 'Funding' },
    { value: 'build', label: 'Build / Production' },
    { value: 'launch', label: 'Launch' },
    { value: 'iteration', label: 'Iteration' },
  ],
  'vertical-drama': [
    { value: 'concept', label: 'Concept / Hook' },
    { value: 'script', label: 'Script (Episodes)' },
    { value: 'packaging', label: 'Packaging / Cast' },
    { value: 'platform-pitch', label: 'Platform Pitch' },
    { value: 'production', label: 'Production' },
    { value: 'post', label: 'Post / Edit' },
    { value: 'platform-launch', label: 'Platform Launch' },
    { value: 'growth', label: 'Growth / Renewal' },
  ],
  'limited-series': [
    { value: 'development', label: 'Development' },
    { value: 'packaging', label: 'Packaging' },
    { value: 'financing', label: 'Financing' },
    { value: 'pre-production', label: 'Pre-Production' },
    { value: 'production', label: 'Production' },
    { value: 'post', label: 'Post' },
    { value: 'release', label: 'Release / Awards' },
  ],
  'anim-feature': [
    { value: 'development', label: 'Development' },
    { value: 'packaging', label: 'Packaging' },
    { value: 'financing', label: 'Financing' },
    { value: 'pre-production', label: 'Pre-Production' },
    { value: 'production', label: 'Production' },
    { value: 'post', label: 'Post / VFX' },
    { value: 'distribution', label: 'Distribution' },
  ],
  'anim-series': [
    { value: 'development', label: 'Development' },
    { value: 'packaging', label: 'Packaging' },
    { value: 'platform-pitch', label: 'Platform Pitch' },
    { value: 'pre-production', label: 'Pre-Production' },
    { value: 'production', label: 'Production' },
    { value: 'post', label: 'Post' },
    { value: 'licensing', label: 'Licensing / Merch' },
  ],
  reality: [
    { value: 'format-development', label: 'Format Development' },
    { value: 'packaging', label: 'Packaging / Casting' },
    { value: 'commission', label: 'Commission' },
    { value: 'pre-production', label: 'Pre-Production' },
    { value: 'production', label: 'Production' },
    { value: 'post', label: 'Post' },
    { value: 'format-sales', label: 'Format Sales' },
  ],
  'podcast-ip': [
    { value: 'concept', label: 'Concept' },
    { value: 'pilot-episodes', label: 'Pilot Episodes' },
    { value: 'launch', label: 'Launch' },
    { value: 'growth', label: 'Audience Growth' },
    { value: 'monetisation', label: 'Monetisation' },
    { value: 'adaptation', label: 'Adaptation Development' },
  ],
};

// ─── Scoring Dimensions per Format ───

export interface ScoringDimension {
  key: string;
  label: string;
  weight: number; // out of 100
  description: string;
}

export const MODE_SCORING: Record<ProjectFormat, ScoringDimension[]> = {
  film: [
    { key: 'script', label: 'Script', weight: 25, description: 'Script strength and revision history' },
    { key: 'packaging', label: 'Packaging', weight: 30, description: 'Cast, crew, and partner attachments' },
    { key: 'finance', label: 'Finance', weight: 25, description: 'Finance scenarios and incentives' },
    { key: 'market', label: 'Market', weight: 20, description: 'Genre, audience, and market positioning' },
  ],
  'tv-series': [
    { key: 'engine', label: 'Engine Sustainability', weight: 25, description: 'Episodic repeatability and character elasticity' },
    { key: 'format', label: 'Format Clarity', weight: 20, description: 'Series bible and format definition' },
    { key: 'platform', label: 'Platform Alignment', weight: 20, description: 'Platform fit classification' },
    { key: 'showrunner', label: 'Showrunner', weight: 20, description: 'Showrunner viability index' },
    { key: 'market', label: 'Market', weight: 15, description: 'Market positioning and audience' },
  ],
  'short-film': [
    { key: 'festival', label: 'Festival Strength', weight: 25, description: 'Festival circuit potential and strategy' },
    { key: 'talent-exposure', label: 'Talent Exposure', weight: 20, description: 'Talent showcase and discovery potential' },
    { key: 'ip-expansion', label: 'IP Expansion', weight: 20, description: 'Feature or series expansion potential' },
    { key: 'proof-of-concept', label: 'Proof of Concept', weight: 20, description: 'Technical and creative demonstration' },
    { key: 'awards', label: 'Awards Probability', weight: 15, description: 'Awards circuit potential' },
  ],
  documentary: [
    { key: 'cultural-relevance', label: 'Cultural Relevance', weight: 20, description: 'Timeliness and cultural significance' },
    { key: 'access', label: 'Access Exclusivity', weight: 20, description: 'Exclusive access to subject matter' },
    { key: 'festival', label: 'Festival Potential', weight: 15, description: 'Documentary festival circuit strength' },
    { key: 'broadcaster-fit', label: 'Broadcaster Fit', weight: 20, description: 'Broadcaster and streamer alignment' },
    { key: 'impact', label: 'Impact Campaign', weight: 15, description: 'Social impact and campaign potential' },
    { key: 'clearance', label: 'Clearance Risk', weight: 10, description: 'Archive and rights clearance risk' },
  ],
  'digital-series': [
    { key: 'platform-fit', label: 'Platform Fit', weight: 25, description: 'Platform and audience alignment' },
    { key: 'audience-growth', label: 'Audience Growth', weight: 20, description: 'Growth and retention potential' },
    { key: 'repeatability', label: 'Format Repeatability', weight: 20, description: 'Episode scalability index' },
    { key: 'influencer', label: 'Influencer Leverage', weight: 15, description: 'Creator and influencer integration' },
    { key: 'retention', label: 'Retention Probability', weight: 20, description: 'Viewer retention and engagement' },
  ],
  commercial: [
    { key: 'brand-alignment', label: 'Brand Alignment', weight: 25, description: 'Brand and creative brief alignment' },
    { key: 'director-fit', label: 'Director Fit', weight: 20, description: 'Director suitability and track record' },
    { key: 'win-probability', label: 'Win Probability', weight: 20, description: 'Pitch win likelihood' },
    { key: 'portfolio-value', label: 'Portfolio Value', weight: 15, description: 'Strategic value to company portfolio' },
    { key: 'awards', label: 'Awards Potential', weight: 20, description: 'Cannes Lions and industry awards potential' },
  ],
  'branded-content': [
    { key: 'brand-story', label: 'Brand Story Alignment', weight: 25, description: 'Brand narrative authenticity' },
    { key: 'cultural-auth', label: 'Cultural Authenticity', weight: 20, description: 'Cultural resonance and authenticity' },
    { key: 'platform-amp', label: 'Platform Amplification', weight: 20, description: 'Distribution and amplification strategy' },
    { key: 'ip-expansion', label: 'IP Expansion', weight: 15, description: 'Long-tail IP potential' },
    { key: 'engagement', label: 'Audience Engagement', weight: 20, description: 'Audience engagement forecast' },
  ],
  'documentary-series': [
    { key: 'cultural-relevance', label: 'Cultural Relevance', weight: 20, description: 'Timeliness and cultural significance' },
    { key: 'access', label: 'Access Sustainability', weight: 20, description: 'Multi-episode subject access' },
    { key: 'format', label: 'Format Strength', weight: 15, description: 'Episodic format and structure' },
    { key: 'broadcaster-fit', label: 'Broadcaster Fit', weight: 20, description: 'Broadcaster and streamer alignment' },
    { key: 'impact', label: 'Impact Campaign', weight: 15, description: 'Social impact and campaign potential' },
    { key: 'clearance', label: 'Clearance Risk', weight: 10, description: 'Archive and rights clearance risk' },
  ],
  'hybrid-documentary': [
    { key: 'cultural-relevance', label: 'Cultural Relevance', weight: 20, description: 'Timeliness and cultural significance' },
    { key: 'hybrid-innovation', label: 'Hybrid Innovation', weight: 20, description: 'Strength of fiction/animation/experimental technique' },
    { key: 'access', label: 'Access & Evidence', weight: 15, description: 'Subject access and factual grounding' },
    { key: 'festival', label: 'Festival Potential', weight: 15, description: 'Documentary festival circuit strength' },
    { key: 'broadcaster-fit', label: 'Broadcaster Fit', weight: 15, description: 'Broadcaster and streamer alignment' },
    { key: 'impact', label: 'Impact Campaign', weight: 15, description: 'Social impact and campaign potential' },
  ],
  'music-video': [
    { key: 'visual-concept', label: 'Visual Concept', weight: 30, description: 'Treatment strength and originality' },
    { key: 'director-fit', label: 'Director Fit', weight: 25, description: 'Director suitability for artist/genre' },
    { key: 'production-scope', label: 'Production Scope', weight: 20, description: 'Budget vs ambition alignment' },
    { key: 'release-strategy', label: 'Release Strategy', weight: 15, description: 'Platform and timing strategy' },
    { key: 'portfolio-value', label: 'Portfolio Value', weight: 10, description: 'Career and awards value' },
  ],
  'proof-of-concept': [
    { key: 'ip-demonstration', label: 'IP Demonstration', weight: 30, description: 'How well the concept proves the larger project' },
    { key: 'technical-showcase', label: 'Technical Showcase', weight: 20, description: 'VFX, tone, or world-building proof' },
    { key: 'pitch-readiness', label: 'Pitch Readiness', weight: 25, description: 'Supporting materials and development package' },
    { key: 'talent-signal', label: 'Talent Signal', weight: 15, description: 'Director/cast attachment strength' },
    { key: 'market-viability', label: 'Market Viability', weight: 10, description: 'Target project market potential' },
  ],
  hybrid: [
    { key: 'innovation', label: 'Innovation Factor', weight: 25, description: 'Novelty and cross-platform originality' },
    { key: 'audience-design', label: 'Audience Design', weight: 20, description: 'Multi-touchpoint audience strategy' },
    { key: 'tech-feasibility', label: 'Technical Feasibility', weight: 20, description: 'Technology stack viability' },
    { key: 'funding-fit', label: 'Funding Fit', weight: 20, description: 'Innovation fund and partner alignment' },
    { key: 'cultural-impact', label: 'Cultural Impact', weight: 15, description: 'Cultural significance and reach' },
  ],
  'vertical-drama': [
    { key: 'speed-breakeven', label: 'Speed to Break-Even', weight: 22, description: 'How fast the title reaches profitability on platform' },
    { key: 'episode-scalability', label: 'Episode Count Scalability', weight: 18, description: 'Potential for multi-season episode expansion' },
    { key: 'cpm-potential', label: 'CPM Potential', weight: 18, description: 'Ad revenue CPM and in-app purchase viability' },
    { key: 'micro-transaction', label: 'Micro-Transaction Viability', weight: 15, description: 'Episode unlock, coin purchase, and IAP potential' },
    { key: 'subscriber-funnel', label: 'Subscriber Funnel Strength', weight: 15, description: 'Free-to-paid conversion and retention funnel' },
    { key: 'hook-strength', label: 'Hook & Retention Design', weight: 12, description: 'Cliffhanger density and scroll-stopping power' },
  ],
  'limited-series': [
    { key: 'narrative-power', label: 'Contained Narrative Power', weight: 25, description: 'Self-contained story strength' },
    { key: 'cast-heat', label: 'Cast Attractiveness', weight: 25, description: 'Probability-based cast attachment' },
    { key: 'platform-fit', label: 'Prestige Platform Fit', weight: 20, description: 'Platform mandate alignment' },
    { key: 'awards', label: 'Awards Potential', weight: 15, description: 'Awards circuit viability' },
    { key: 'market', label: 'Global Travelability', weight: 15, description: 'International appeal' },
  ],
  'anim-feature': [
    { key: 'world', label: 'Visual World Uniqueness', weight: 25, description: 'Original visual identity' },
    { key: 'franchise', label: 'Franchise Potential', weight: 25, description: 'IP expansion and merchandise' },
    { key: 'ip', label: 'IP Strength', weight: 20, description: 'Underlying IP value' },
    { key: 'cast', label: 'Voice Cast Strategy', weight: 15, description: 'Voice talent attachment' },
    { key: 'timeline', label: 'Production Timeline', weight: 15, description: 'Production pipeline feasibility' },
  ],
  'anim-series': [
    { key: 'engine', label: 'Episodic Engine', weight: 25, description: 'Repeatable story engine' },
    { key: 'licensing', label: 'Licensing Potential', weight: 25, description: 'Toyetic and merchandise value' },
    { key: 'platform', label: 'Platform Demo Fit', weight: 20, description: 'Target demographic alignment' },
    { key: 'ip', label: 'IP Strength', weight: 15, description: 'Underlying IP value' },
    { key: 'pipeline', label: 'Pipeline Efficiency', weight: 15, description: 'Production scalability' },
  ],
  reality: [
    { key: 'format', label: 'Format Originality', weight: 25, description: 'Format novelty and hook' },
    { key: 'repeatability', label: 'Repeatability', weight: 25, description: 'Season-on-season scalability' },
    { key: 'casting', label: 'Casting Scalability', weight: 20, description: 'Participant pipeline' },
    { key: 'commission', label: 'Commission Likelihood', weight: 15, description: 'Buyer appetite' },
    { key: 'cost-ratio', label: 'Cost-to-Return', weight: 15, description: 'Budget efficiency' },
  ],
  'podcast-ip': [
    { key: 'growth', label: 'Audience Growth', weight: 25, description: 'Listener acquisition velocity' },
    { key: 'adaptation', label: 'Adaptation Potential', weight: 25, description: 'Cross-media IP value' },
    { key: 'format', label: 'Format Expandability', weight: 20, description: 'Content scalability' },
    { key: 'brand', label: 'Brand Integration', weight: 15, description: 'Sponsorship potential' },
    { key: 'monetisation', label: 'Monetisation Mix', weight: 15, description: 'Revenue diversification' },
  ],
};

// ─── Finance Model Labels per Format ───

export const MODE_FINANCE_LABELS: Record<ProjectFormat, string[]> = {
  film: ['Equity', 'Pre-Sales', 'Incentives', 'Gap', 'Soft Money', 'Other'],
  'tv-series': ['Platform Deal', 'Broadcaster', 'Co-Pro', 'Incentives', 'Deficit Finance', 'Other'],
  'short-film': ['Self-Funded', 'Grants', 'Brand Support', 'In-Kind', 'Crowdfunding'],
  documentary: ['Grants', 'Broadcaster Pre-Sales', 'NGO Partners', 'Impact Investors', 'Sales Agent', 'Territory Splits'],
  'documentary-series': ['Broadcaster Commission', 'Platform Deal', 'Grants', 'Co-Pro', 'Impact Investors', 'Territory Splits'],
  'hybrid-documentary': ['Grants', 'Arts Council', 'Broadcaster Pre-Sales', 'Co-Pro', 'Impact Investors', 'Innovation Funds'],
  'digital-series': ['Brand Integration', 'Platform Deal', 'Ad Revenue', 'Sponsorship', 'Subscriber Model'],
  commercial: ['Client Budget', 'Production Fee', 'Director Fee', 'Post', 'Agency Commission', 'Contingency'],
  'branded-content': ['Brand Funding', 'Performance Bonus', 'IP Ownership', 'Distribution Deal', 'Long-tail Revenue'],
  'music-video': ['Label Budget', 'Artist Budget', 'Production Fee', 'Director Fee', 'Post Budget', 'Contingency'],
  'proof-of-concept': ['Self-Funded', 'Grants', 'In-Kind', 'Investor Seed', 'Crowdfunding'],
  hybrid: ['Brand Partners', 'Arts Council', 'Innovation Funds', 'Platform Deals', 'Experiential Budget', 'Tech Partners'],
  'vertical-drama': ['Platform Deal', 'Brand Integration', 'Ad Revenue', 'Sponsorship', 'Creator Fund', 'Pre-Sales'],
  'limited-series': ['Platform Deal', 'Broadcaster', 'Co-Pro', 'Incentives', 'Equity', 'Other'],
  'anim-feature': ['Studio Deal', 'Pre-Sales', 'Co-Pro', 'Incentives', 'Equity', 'Other'],
  'anim-series': ['Platform Deal', 'Broadcaster', 'Licensing Pre-Sales', 'Co-Pro', 'Incentives', 'Other'],
  reality: ['Commission Fee', 'Broadcaster', 'Platform Deal', 'Sponsorship', 'Format Sales', 'Other'],
  'podcast-ip': ['Ad Revenue', 'Sponsorship', 'Premium Subscriptions', 'Adaptation Option', 'Brand Integration', 'Other'],
};

// ─── KPI Definitions per Format ───

export interface KPIDefinition {
  key: string;
  label: string;
  description: string;
  unit: string; // e.g. 'count', 'currency', 'percentage', 'score'
}

export const MODE_KPIS: Record<ProjectFormat, KPIDefinition[]> = {
  film: [
    { key: 'readiness', label: 'Readiness Score', description: 'Overall project readiness', unit: 'score' },
    { key: 'finance-readiness', label: 'Finance Readiness', description: 'Funding structure strength', unit: 'score' },
    { key: 'deals-closed', label: 'Deals Closed', description: 'Total closed deals', unit: 'count' },
    { key: 'total-secured', label: 'Total Secured', description: 'Total confirmed financing', unit: 'currency' },
  ],
  'tv-series': [
    { key: 'tv-readiness', label: 'TV Readiness', description: 'Series engine readiness', unit: 'score' },
    { key: 'renewal-probability', label: 'Renewal Probability', description: 'Multi-season likelihood', unit: 'percentage' },
    { key: 'platform-fit', label: 'Platform Fit', description: 'Platform alignment score', unit: 'score' },
    { key: 'showrunner-viability', label: 'Showrunner Index', description: 'Showrunner strength', unit: 'score' },
  ],
  'short-film': [
    { key: 'festival-selections', label: 'Festival Selections', description: 'Number of festival acceptances', unit: 'count' },
    { key: 'awards-won', label: 'Awards Won', description: 'Awards received', unit: 'count' },
    { key: 'online-views', label: 'Online Views', description: 'Total online viewership', unit: 'count' },
    { key: 'talent-leverage', label: 'Talent Leverage', description: 'Career opportunities generated', unit: 'count' },
    { key: 'funding-secured', label: 'Next Funding', description: 'Funding secured off the back of project', unit: 'currency' },
  ],
  documentary: [
    { key: 'grants-secured', label: 'Grants Secured', description: 'Total grant funding', unit: 'currency' },
    { key: 'broadcaster-interest', label: 'Broadcaster Interest', description: 'Broadcasters engaged', unit: 'count' },
    { key: 'impact-score', label: 'Impact Score', description: 'Social impact measurement', unit: 'score' },
    { key: 'clearance-risk', label: 'Clearance Risk', description: 'Archive clearance status', unit: 'percentage' },
  ],
  'digital-series': [
    { key: 'subscriber-growth', label: 'Subscriber Growth', description: 'Audience growth rate', unit: 'percentage' },
    { key: 'episode-scalability', label: 'Episode Scalability', description: 'Content scalability index', unit: 'score' },
    { key: 'brand-deals', label: 'Brand Deals', description: 'Active brand integrations', unit: 'count' },
    { key: 'retention-rate', label: 'Retention Rate', description: 'Viewer retention percentage', unit: 'percentage' },
  ],
  commercial: [
    { key: 'margin', label: 'Margin %', description: 'Net production margin', unit: 'percentage' },
    { key: 'invoice-status', label: 'Invoice Status', description: 'Payment collection status', unit: 'currency' },
    { key: 'overdue-amount', label: 'Overdue Amount', description: 'Outstanding overdue payments', unit: 'currency' },
    { key: 'portfolio-value', label: 'Portfolio Value', description: 'Strategic portfolio contribution', unit: 'score' },
  ],
  'branded-content': [
    { key: 'brand-satisfaction', label: 'Brand Satisfaction', description: 'Client satisfaction score', unit: 'score' },
    { key: 'audience-reach', label: 'Audience Reach', description: 'Total audience reached', unit: 'count' },
    { key: 'engagement-rate', label: 'Engagement Rate', description: 'Content engagement rate', unit: 'percentage' },
    { key: 'ip-value', label: 'IP Value', description: 'Long-tail IP value assessment', unit: 'score' },
  ],
  'documentary-series': [
    { key: 'grants-secured', label: 'Grants Secured', description: 'Total grant funding', unit: 'currency' },
    { key: 'broadcaster-interest', label: 'Broadcaster Interest', description: 'Broadcasters engaged', unit: 'count' },
    { key: 'episodes-funded', label: 'Episodes Funded', description: 'Funded episode count', unit: 'count' },
    { key: 'impact-score', label: 'Impact Score', description: 'Social impact measurement', unit: 'score' },
  ],
  'hybrid-documentary': [
    { key: 'grants-secured', label: 'Grants Secured', description: 'Total grant funding', unit: 'currency' },
    { key: 'broadcaster-interest', label: 'Broadcaster Interest', description: 'Broadcasters engaged', unit: 'count' },
    { key: 'impact-score', label: 'Impact Score', description: 'Social impact measurement', unit: 'score' },
    { key: 'innovation-score', label: 'Innovation Score', description: 'Hybrid technique innovation', unit: 'score' },
  ],
  'music-video': [
    { key: 'views', label: 'Total Views', description: 'Cross-platform view count', unit: 'count' },
    { key: 'margin', label: 'Production Margin', description: 'Net production margin', unit: 'percentage' },
    { key: 'awards', label: 'Awards', description: 'Awards and nominations', unit: 'count' },
    { key: 'portfolio-value', label: 'Portfolio Value', description: 'Strategic portfolio contribution', unit: 'score' },
  ],
  'proof-of-concept': [
    { key: 'development-interest', label: 'Development Interest', description: 'Industry interest generated', unit: 'count' },
    { key: 'funding-unlocked', label: 'Funding Unlocked', description: 'Development funding secured', unit: 'currency' },
    { key: 'lab-selections', label: 'Lab Selections', description: 'Festival lab acceptances', unit: 'count' },
    { key: 'readiness', label: 'Pitch Readiness', description: 'Full project pitch readiness', unit: 'score' },
  ],
  hybrid: [
    { key: 'audience-reach', label: 'Audience Reach', description: 'Cross-platform audience', unit: 'count' },
    { key: 'innovation-score', label: 'Innovation Score', description: 'Technical innovation rating', unit: 'score' },
    { key: 'partner-engagement', label: 'Partner Engagement', description: 'Active technology/brand partners', unit: 'count' },
    { key: 'cultural-impact', label: 'Cultural Impact', description: 'Cultural significance rating', unit: 'score' },
  ],
  'vertical-drama': [
    { key: 'episode-completion', label: 'Episode Completion Rate', description: 'Avg % of episode watched', unit: 'percentage' },
    { key: 'series-retention', label: 'Series Retention', description: 'Viewers who watch 3+ episodes', unit: 'percentage' },
    { key: 'speed-breakeven', label: 'Days to Break-Even', description: 'Days from launch to profitability', unit: 'count' },
    { key: 'cpm-revenue', label: 'CPM Revenue', description: 'Average CPM across ad placements', unit: 'currency' },
    { key: 'iap-revenue', label: 'IAP Revenue', description: 'In-app purchase & episode unlock revenue', unit: 'currency' },
    { key: 'subscriber-conversion', label: 'Subscriber Conversion', description: 'Free-to-paid conversion rate', unit: 'percentage' },
    { key: 'total-views', label: 'Total Views', description: 'Cross-platform episode views', unit: 'count' },
  ],
  'limited-series': [
    { key: 'readiness', label: 'Readiness Score', description: 'Overall project readiness', unit: 'score' },
    { key: 'cast-heat', label: 'Cast Heat', description: 'Cast attachment strength', unit: 'score' },
    { key: 'awards-probability', label: 'Awards Probability', description: 'Awards potential', unit: 'percentage' },
    { key: 'platform-interest', label: 'Platform Interest', description: 'Platform buyer engagement', unit: 'count' },
  ],
  'anim-feature': [
    { key: 'readiness', label: 'Readiness Score', description: 'Overall project readiness', unit: 'score' },
    { key: 'franchise-value', label: 'Franchise Value', description: 'IP franchise potential', unit: 'score' },
    { key: 'production-progress', label: 'Production Progress', description: 'Animation pipeline completion', unit: 'percentage' },
    { key: 'presale-interest', label: 'Pre-Sale Interest', description: 'Territory buyer interest', unit: 'count' },
  ],
  'anim-series': [
    { key: 'readiness', label: 'Readiness Score', description: 'Overall project readiness', unit: 'score' },
    { key: 'licensing-deals', label: 'Licensing Deals', description: 'Active licensing agreements', unit: 'count' },
    { key: 'renewal-probability', label: 'Renewal Probability', description: 'Multi-season likelihood', unit: 'percentage' },
    { key: 'platform-fit', label: 'Platform Fit', description: 'Platform alignment score', unit: 'score' },
  ],
  reality: [
    { key: 'commission-probability', label: 'Commission Probability', description: 'Likelihood of commission', unit: 'percentage' },
    { key: 'format-sales', label: 'Format Sales', description: 'International format deals', unit: 'count' },
    { key: 'cost-per-episode', label: 'Cost per Episode', description: 'Average episode cost', unit: 'currency' },
    { key: 'sponsor-revenue', label: 'Sponsor Revenue', description: 'Sponsorship income', unit: 'currency' },
  ],
  'podcast-ip': [
    { key: 'listener-count', label: 'Listener Count', description: 'Average episode listeners', unit: 'count' },
    { key: 'growth-rate', label: 'Growth Rate', description: 'Month-over-month growth', unit: 'percentage' },
    { key: 'ad-revenue', label: 'Ad Revenue', description: 'Monthly ad revenue', unit: 'currency' },
    { key: 'adaptation-interest', label: 'Adaptation Interest', description: 'Studio/streamer inquiries', unit: 'count' },
  ],
};

// ─── Format Metadata ───

export interface FormatMeta {
  value: ProjectFormat;
  label: string;
  shortLabel: string;
  description: string;
  icon: typeof Film;
  color: string; // HSL-based tailwind class
}

export const FORMAT_META: FormatMeta[] = [
  { value: 'film', label: 'Narrative Feature', shortLabel: 'Film', description: 'Theatrical or streaming feature', icon: Film, color: 'text-primary' },
  { value: 'tv-series', label: 'Narrative Series', shortLabel: 'Series', description: 'Limited, returning, or anthology series', icon: Tv, color: 'text-purple-400' },
  { value: 'documentary', label: 'Documentary Feature', shortLabel: 'Doc', description: 'Feature-length documentary', icon: FileVideo, color: 'text-sky-400' },
  { value: 'documentary-series', label: 'Documentary Series', shortLabel: 'Doc Series', description: 'Multi-episode documentary', icon: Video, color: 'text-cyan-400' },
  { value: 'hybrid-documentary', label: 'Hybrid Documentary', shortLabel: 'Hybrid Doc', description: 'Blends fiction/animation with documentary', icon: Shuffle, color: 'text-teal-400' },
  { value: 'commercial', label: 'Commercial / Advert', shortLabel: 'Commercial', description: 'Brand-commissioned, margin-driven', icon: Megaphone, color: 'text-amber-400' },
  { value: 'branded-content', label: 'Branded Content', shortLabel: 'Branded', description: 'Brand-funded, IP-adjacent long form', icon: Sparkles, color: 'text-indigo-400' },
  { value: 'music-video', label: 'Music Video', shortLabel: 'MV', description: 'Label or artist-commissioned', icon: Music, color: 'text-pink-400' },
  { value: 'short-film', label: 'Short Film', shortLabel: 'Short', description: 'Festivals, talent showcase, proof of concept', icon: Clapperboard, color: 'text-emerald-400' },
  { value: 'proof-of-concept', label: 'Proof of Concept', shortLabel: 'PoC', description: 'IP demonstration, investor teaser', icon: FlaskConical, color: 'text-orange-400' },
  { value: 'digital-series', label: 'Digital / Social', shortLabel: 'Digital', description: 'Platform-native, high velocity content', icon: Monitor, color: 'text-rose-400' },
  { value: 'hybrid', label: 'Hybrid', shortLabel: 'Hybrid', description: 'Cross-platform, transmedia, immersive', icon: Shuffle, color: 'text-violet-400' },
  { value: 'vertical-drama', label: 'Vertical Drama', shortLabel: 'Vertical', description: 'Mobile-first, short-form episodic drama', icon: Smartphone, color: 'text-fuchsia-400' },
  { value: 'limited-series', label: 'Limited Series', shortLabel: 'Limited', description: 'Prestige event series', icon: Tv, color: 'text-blue-400' },
  { value: 'anim-feature', label: 'Animated Feature', shortLabel: 'Anim Film', description: 'Animated feature film', icon: Film, color: 'text-yellow-400' },
  { value: 'anim-series', label: 'Animated Series', shortLabel: 'Anim Series', description: 'Animated TV series', icon: Tv, color: 'text-lime-400' },
  { value: 'reality', label: 'Reality / Unscripted', shortLabel: 'Reality', description: 'Unscripted format entertainment', icon: Video, color: 'text-red-400' },
  { value: 'podcast-ip', label: 'Podcast IP', shortLabel: 'Podcast', description: 'Audio-first IP with adaptation potential', icon: Music, color: 'text-slate-400' },
];

export function getFormatMeta(format: string): FormatMeta {
  return FORMAT_META.find(f => f.value === format) || FORMAT_META[0];
}

// ─── Strategic Role Definitions ───

export const MODE_STRATEGIC_ROLES: Record<ProjectFormat, string[]> = {
  film: ['Revenue generation', 'IP creation', 'Awards prestige', 'Slate diversification'],
  'tv-series': ['Recurring revenue', 'Platform relationships', 'IP franchise', 'Talent pipeline'],
  'short-film': ['Talent showcase', 'Proof of concept', 'Festival strategy', 'IP incubation', 'Director launchpad'],
  documentary: ['Cultural impact', 'Brand positioning', 'Educational value', 'Rights library'],
  'documentary-series': ['Cultural impact', 'Platform relationships', 'Multi-season potential', 'Format licensing'],
  'hybrid-documentary': ['Cultural impact', 'Innovation leadership', 'Festival strategy', 'Arts council relationships'],
  'digital-series': ['Audience building', 'Platform leverage', 'Brand partnerships', 'Data-driven iteration'],
  commercial: ['Revenue margin', 'Client relationships', 'Director showcase', 'Awards (Cannes Lions)'],
  'branded-content': ['Brand partnerships', 'IP ownership', 'Audience engagement', 'Long-tail revenue'],
  'music-video': ['Director showcase', 'Artist relationships', 'Awards entry', 'Visual portfolio'],
  'proof-of-concept': ['IP incubation', 'Investor engagement', 'Festival labs', 'Feature development'],
  hybrid: ['Innovation leadership', 'Cross-platform storytelling', 'Technology partnerships', 'Cultural impact'],
  'vertical-drama': ['Mobile audience growth', 'Platform relationships', 'Brand partnerships', 'Cast social leverage', 'IP franchise potential'],
  'limited-series': ['Prestige positioning', 'Awards strategy', 'Cast heat leverage', 'Platform relationships', 'Event marketing'],
  'anim-feature': ['IP franchise building', 'Merchandise licensing', 'International pre-sales', 'Sequel development', 'Theme park potential'],
  'anim-series': ['Licensing revenue', 'Platform relationships', 'Toy/merch partnerships', 'Multi-season renewal', 'International format sales'],
  reality: ['Format creation', 'International format sales', 'Sponsorship revenue', 'Talent pipeline', 'Platform relationships'],
  'podcast-ip': ['IP incubation', 'Cross-media adaptation', 'Audience building', 'Brand partnerships', 'Revenue diversification'],
};
