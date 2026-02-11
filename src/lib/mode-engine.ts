/**
 * Mode Engine — defines workflows, scoring, finance models, and KPIs
 * for each project format. Algorithms are ISOLATED per type.
 */

import type { ProjectFormat } from '@/lib/types';
import { Film, Tv, Clapperboard, FileVideo, Monitor, Megaphone, Sparkles } from 'lucide-react';

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
    { value: 'brand-strategy', label: 'Brand Strategy' },
    { value: 'creative-development', label: 'Creative Development' },
    { value: 'funding-confirmed', label: 'Funding Confirmed' },
    { value: 'production', label: 'Production' },
    { value: 'distribution-strategy', label: 'Distribution Strategy' },
    { value: 'performance-analytics', label: 'Performance Analytics' },
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
};

// ─── Finance Model Labels per Format ───

export const MODE_FINANCE_LABELS: Record<ProjectFormat, string[]> = {
  film: ['Equity', 'Pre-Sales', 'Incentives', 'Gap', 'Soft Money', 'Other'],
  'tv-series': ['Platform Deal', 'Broadcaster', 'Co-Pro', 'Incentives', 'Deficit Finance', 'Other'],
  'short-film': ['Self-Funded', 'Grants', 'Brand Support', 'In-Kind', 'Crowdfunding'],
  documentary: ['Grants', 'Broadcaster Pre-Sales', 'NGO Partners', 'Impact Investors', 'Sales Agent', 'Territory Splits'],
  'digital-series': ['Brand Integration', 'Platform Deal', 'Ad Revenue', 'Sponsorship', 'Subscriber Model'],
  commercial: ['Client Budget', 'Production Fee', 'Director Fee', 'Post', 'Agency Commission', 'Contingency'],
  'branded-content': ['Brand Funding', 'Performance Bonus', 'IP Ownership', 'Distribution Deal', 'Long-tail Revenue'],
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
  { value: 'film', label: 'Feature Film', shortLabel: 'Film', description: 'Theatrical or streaming feature', icon: Film, color: 'text-primary' },
  { value: 'tv-series', label: 'TV Series', shortLabel: 'TV Series', description: 'Limited, returning, or anthology series', icon: Tv, color: 'text-purple-400' },
  { value: 'short-film', label: 'Short Film', shortLabel: 'Short', description: 'Festivals, talent showcase, proof of concept', icon: Clapperboard, color: 'text-emerald-400' },
  { value: 'documentary', label: 'Documentary', shortLabel: 'Doc', description: 'Feature or series documentary', icon: FileVideo, color: 'text-sky-400' },
  { value: 'digital-series', label: 'Digital Series', shortLabel: 'Digital', description: 'Platform-native, high velocity content', icon: Monitor, color: 'text-rose-400' },
  { value: 'commercial', label: 'Commercial / Advert', shortLabel: 'Commercial', description: 'Brand-commissioned, margin-driven', icon: Megaphone, color: 'text-amber-400' },
  { value: 'branded-content', label: 'Branded Content', shortLabel: 'Branded', description: 'Brand-funded, IP-adjacent long form', icon: Sparkles, color: 'text-indigo-400' },
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
  'digital-series': ['Audience building', 'Platform leverage', 'Brand partnerships', 'Data-driven iteration'],
  commercial: ['Revenue margin', 'Client relationships', 'Director showcase', 'Awards (Cannes Lions)'],
  'branded-content': ['Brand partnerships', 'IP ownership', 'Audience engagement', 'Long-tail revenue'],
};
