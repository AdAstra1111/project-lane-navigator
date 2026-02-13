/**
 * Paradox House Mode / Company Intelligence Profile Engine
 *
 * Generalised to support dynamic company profiles loaded from the
 * company_intelligence_profiles table. Each profile encodes budget
 * sweet spots, genre/streamer biases, packaging strength, finance
 * tolerance, and a bias weighting modifier (0–2, default 1).
 *
 * Bias modifier must never exceed 10% total score influence.
 */

import type { Project } from '@/lib/types';

// ---- Company Profile type (matches DB shape) ----

export interface CompanyIntelligenceProfile {
  id: string;
  company_id: string | null;
  company_name: string;
  mode_name: string;
  budget_sweet_spot_min: number;
  budget_sweet_spot_max: number;
  genre_bias_list: string[];
  streamer_bias_list: string[];
  packaging_strength: 'Low' | 'Moderate' | 'Strong';
  finance_tolerance: 'Conservative' | 'Balanced' | 'Aggressive';
  attachment_tier_range: 'Emerging' | 'Mid' | 'A-List';
  series_track_record: 'None' | 'Emerging' | 'Established';
  strategic_priorities: string;
  bias_weighting_modifier: number;
}

// ---- Legacy Paradox profile (backwards compat) ----

export const PARADOX_PROFILE = {
  companyType: 'Independent UK-based production company with development in-house',
  coreStrengths: [
    'Strong development capability',
    'Packaging relationships',
    'Streamer access (Amazon history)',
    'Ability to attach credible directors',
    'Flexible budget scaling',
  ],
  currentLimitations: [
    'No long-running series track record yet',
    'Heavy reliance on packaging momentum',
    'Packaging delays impact timeline',
    'Financing sensitive to cast tier',
  ],
  budgetSweetSpot: { minGBP: 2_000_000, maxGBP: 15_000_000 },
  preferredGenres: [
    'contained-thriller',
    'elevated-genre',
    'youth-skew-commercial',
    'streamer-aligned-mid-budget',
  ],
  streamerHistory: ['Amazon'],
  streamerAlignedGenres: ['ya', 'elevated-commercial', 'contained-thriller', 'youth-comedy'],
} as const;

// ---- Flag types ----

export interface CompanyModeFlags {
  budgetRealismCheck: boolean;
  packagingFragilityRisk: boolean;
  developmentStallRisk: boolean;
  streamerAlignmentBoost: boolean;
  prestigeRequiresFestival: boolean;
  biasAdjustments: BiasAdjustment[];
  profileActive: boolean;
  profileName: string;
}

// Keep old name for backwards compat
export type ParadoxHouseFlags = CompanyModeFlags;

export interface BiasAdjustment {
  dimension: string;
  delta: number; // capped to ±1
  reason: string;
}

export interface ExecConfidenceFactors {
  realisticToPackage: number;
  realisticToFinance: number;
  fitWithStrategy: number;
  opportunityCostAcceptable: number;
  overall: number;
}

// ---- Development signals ----

export interface DevelopmentSignals {
  rewriteCount?: number;
  structuralImprovement?: boolean;
  packagingWaiting?: boolean;
  financeMomentum?: boolean;
  budgetInflation?: boolean;
  hookStrengthImproving?: boolean;
}

// ---- Budget parsing ----

function parseBudgetValue(budgetRange: string): number | null {
  const lower = budgetRange.toLowerCase().replace(/[£$€,]/g, '');
  const match = lower.match(/(\d+(?:\.\d+)?)\s*(k|m|million|mil)?/);
  if (!match) return null;
  let val = parseFloat(match[1]);
  const unit = match[2] || '';
  if (unit === 'k') val *= 1_000;
  else if (unit === 'm' || unit.startsWith('mil')) val *= 1_000_000;
  else if (val < 1000) val *= 1_000_000;
  return val;
}

// ---- Core evaluation (profile-driven) ----

function checkBudgetRealism(budgetRange: string, profile: CompanyIntelligenceProfile): boolean {
  const budget = parseBudgetValue(budgetRange);
  if (budget === null) return false;
  return budget > profile.budget_sweet_spot_max;
}

function checkPackagingFragility(project: Project, profile: CompanyIntelligenceProfile): boolean {
  const tone = (project.tone || '').toLowerCase();
  const budget = parseBudgetValue(project.budget_range);
  if (profile.packaging_strength === 'Low') return true;
  if (budget && budget > profile.budget_sweet_spot_max &&
    (tone.includes('prestige') || tone.includes('arthouse') || tone.includes('auteur'))) {
    return true;
  }
  if (profile.attachment_tier_range === 'Emerging' && budget && budget > 10_000_000) {
    return true;
  }
  return false;
}

function checkStreamerAlignment(project: Project, profile: CompanyIntelligenceProfile): boolean {
  const genres = (project.genres || []).map(g => g.toLowerCase());
  const tone = (project.tone || '').toLowerCase();
  const streamers = profile.streamer_bias_list.map(s => s.toLowerCase());
  const genreBias = profile.genre_bias_list.map(g => g.toLowerCase());

  // Check if project genres overlap with streamer-aligned genres from profile
  return genreBias.some(bg =>
    genres.some(g => g.includes(bg) || bg.includes(g)) || tone.includes(bg)
  ) || streamers.length > 0;
}

function checkPrestigeRequiresFestival(project: Project): boolean {
  const tone = (project.tone || '').toLowerCase();
  const genres = (project.genres || []).map(g => g.toLowerCase());
  return (
    (tone.includes('prestige') || tone.includes('arthouse') || tone.includes('auteur')) &&
    !genres.some(g => ['thriller', 'horror', 'comedy', 'action'].includes(g))
  );
}

function checkDevelopmentStall(signals: DevelopmentSignals): boolean {
  if ((signals.rewriteCount || 0) > 3 && !signals.structuralImprovement) return true;
  if (signals.packagingWaiting && !signals.financeMomentum) return true;
  if (signals.budgetInflation) return true;
  if ((signals.rewriteCount || 0) > 2 && !signals.hookStrengthImproving) return true;
  return false;
}

function calculateBiasAdjustments(project: Project, profile: CompanyIntelligenceProfile): BiasAdjustment[] {
  const adjustments: BiasAdjustment[] = [];
  const genres = (project.genres || []).map(g => g.toLowerCase());
  const tone = (project.tone || '').toLowerCase();
  const budget = parseBudgetValue(project.budget_range);

  // Budget sweet spot alignment
  if (budget && budget >= profile.budget_sweet_spot_min && budget <= profile.budget_sweet_spot_max) {
    adjustments.push({
      dimension: 'Budget Feasibility',
      delta: 1,
      reason: `Within ${profile.company_name} sweet spot`,
    });
  }

  // Genre bias alignment
  const genreBias = profile.genre_bias_list.map(g => g.toLowerCase());
  if (genreBias.some(bg => genres.some(g => g.includes(bg) || bg.includes(g)))) {
    adjustments.push({
      dimension: 'Market Heat',
      delta: 1,
      reason: `Genre aligns with ${profile.company_name} strengths`,
    });
  }

  // Packaging strength bonus
  if (profile.packaging_strength === 'Strong' && (tone.includes('character') || tone.includes('lead'))) {
    adjustments.push({
      dimension: 'Packaging Leverage',
      delta: 1,
      reason: 'Strong packaging capability meets lead-driven project',
    });
  }

  // Finance tolerance adjustment
  if (profile.finance_tolerance === 'Aggressive' && budget && budget > profile.budget_sweet_spot_max * 0.8) {
    adjustments.push({
      dimension: 'Finance Risk',
      delta: -1,
      reason: 'Budget near cap — aggressive tolerance still flags caution',
    });
  }

  // Apply modifier and cap each delta to ±1
  const mod = Math.min(2, Math.max(0, profile.bias_weighting_modifier));
  return adjustments.map(a => ({
    ...a,
    delta: Math.max(-1, Math.min(1, Math.round(a.delta * mod))),
  }));
}

// ---- Main evaluation ----

export function evaluateCompanyMode(
  project: Project,
  profile: CompanyIntelligenceProfile | null,
  devSignals?: DevelopmentSignals,
): CompanyModeFlags {
  if (!profile) {
    return {
      budgetRealismCheck: false,
      packagingFragilityRisk: false,
      developmentStallRisk: devSignals ? checkDevelopmentStall(devSignals) : false,
      streamerAlignmentBoost: false,
      prestigeRequiresFestival: false,
      biasAdjustments: [],
      profileActive: false,
      profileName: 'Neutral',
    };
  }

  return {
    budgetRealismCheck: checkBudgetRealism(project.budget_range, profile),
    packagingFragilityRisk: checkPackagingFragility(project, profile),
    developmentStallRisk: devSignals ? checkDevelopmentStall(devSignals) : false,
    streamerAlignmentBoost: checkStreamerAlignment(project, profile),
    prestigeRequiresFestival: checkPrestigeRequiresFestival(project),
    biasAdjustments: calculateBiasAdjustments(project, profile),
    profileActive: true,
    profileName: profile.mode_name,
  };
}

// Legacy wrapper
export function evaluateParadoxHouseMode(
  project: Project,
  devSignals?: DevelopmentSignals,
): CompanyModeFlags {
  // Convert legacy Paradox profile to CompanyIntelligenceProfile shape
  const legacyProfile: CompanyIntelligenceProfile = {
    id: 'legacy-paradox',
    company_id: null,
    company_name: 'Paradox House',
    mode_name: 'Paradox Mode',
    budget_sweet_spot_min: PARADOX_PROFILE.budgetSweetSpot.minGBP,
    budget_sweet_spot_max: PARADOX_PROFILE.budgetSweetSpot.maxGBP,
    genre_bias_list: ['contained-thriller', 'elevated-genre', 'youth-skew-commercial', 'streamer-aligned-mid-budget'],
    streamer_bias_list: ['Amazon'],
    packaging_strength: 'Strong',
    finance_tolerance: 'Balanced',
    attachment_tier_range: 'Mid',
    series_track_record: 'None',
    strategic_priorities: 'Contained thrillers, elevated genre, youth-skew commercial, streamer-aligned mid-budget',
    bias_weighting_modifier: 1.0,
  };
  return evaluateCompanyMode(project, legacyProfile, devSignals);
}

// ---- Exec Confidence ----

export function calculateExecConfidence(
  packageScore: number,
  financeScore: number,
  strategyFit: number,
  opportunityCost: number,
): ExecConfidenceFactors {
  const overall = Math.round(((packageScore + financeScore + strategyFit + opportunityCost) / 4) * 10) / 10;
  return {
    realisticToPackage: packageScore,
    realisticToFinance: financeScore,
    fitWithStrategy: strategyFit,
    opportunityCostAcceptable: opportunityCost,
    overall: Math.min(10, Math.max(0, overall)),
  };
}

// ---- Apply bias (max 10% total influence) ----

export function applyCompanyBias(baseScore: number, flags: CompanyModeFlags): number {
  if (!flags.profileActive) return baseScore;
  let adjustment = 0;
  if (flags.streamerAlignmentBoost) adjustment += 1;
  if (flags.budgetRealismCheck) adjustment -= 1;
  if (flags.packagingFragilityRisk) adjustment -= 1;
  // Sum bias adjustments but cap total influence to 10% of score
  const biasSum = flags.biasAdjustments.reduce((sum, a) => sum + a.delta, 0);
  adjustment += biasSum;
  const maxInfluence = Math.ceil(baseScore * 0.1);
  const capped = Math.max(-maxInfluence, Math.min(maxInfluence, adjustment));
  return Math.max(0, Math.min(100, baseScore + capped));
}

// Keep old export name
export const applyParadoxBias = applyCompanyBias;
