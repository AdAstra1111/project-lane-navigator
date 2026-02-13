/**
 * Paradox House Mode — Internal strategic calibration engine.
 *
 * Encodes Paradox House's strengths, budget bands, packaging reality filters,
 * streamer leverage logic, and development bottleneck detection to bias IFFY's
 * scoring subtly (+1 max) toward projects that align with the company's
 * realistic ability to package, finance, and deliver.
 */

import type { Project } from '@/lib/types';

// ---- Company Profile ----

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

export interface ParadoxHouseFlags {
  budgetRealismCheck: boolean;
  packagingFragilityRisk: boolean;
  developmentStallRisk: boolean;
  streamerAlignmentBoost: boolean;
  prestigeRequiresFestival: boolean;
  biasAdjustments: BiasAdjustment[];
}

export interface BiasAdjustment {
  dimension: string;
  delta: number; // max ±1
  reason: string;
}

export interface ExecConfidenceFactors {
  realisticToPackage: number; // 0-10
  realisticToFinance: number;
  fitWithStrategy: number;
  opportunityCostAcceptable: number;
  overall: number;
}

// ---- Budget realism ----

function parseBudgetGBP(budgetRange: string): number | null {
  const lower = budgetRange.toLowerCase().replace(/[£$€,]/g, '');
  const match = lower.match(/(\d+(?:\.\d+)?)\s*(k|m|million|mil)?/);
  if (!match) return null;
  let val = parseFloat(match[1]);
  const unit = match[2] || '';
  if (unit === 'k') val *= 1_000;
  else if (unit === 'm' || unit.startsWith('mil')) val *= 1_000_000;
  else if (val < 1000) val *= 1_000_000; // assume millions if bare number <1000
  return val;
}

function checkBudgetRealism(budgetRange: string): boolean {
  const budget = parseBudgetGBP(budgetRange);
  if (budget === null) return false;
  return budget > PARADOX_PROFILE.budgetSweetSpot.maxGBP;
}

// ---- Packaging fragility ----

function checkPackagingFragility(project: Project): boolean {
  // Flag if project only works with unattainable cast / single dependency
  const tone = (project.tone || '').toLowerCase();
  const budget = parseBudgetGBP(project.budget_range);
  // High budget + prestige tone = likely needs A-list
  if (budget && budget > 10_000_000 && (tone.includes('prestige') || tone.includes('arthouse') || tone.includes('auteur'))) {
    return true;
  }
  return false;
}

// ---- Streamer alignment ----

function checkStreamerAlignment(project: Project): boolean {
  const genres = (project.genres || []).map(g => g.toLowerCase());
  const tone = (project.tone || '').toLowerCase();
  const aligned = PARADOX_PROFILE.streamerAlignedGenres;
  return aligned.some(ag =>
    genres.some(g => g.includes(ag) || ag.includes(g)) ||
    tone.includes(ag)
  );
}

function checkPrestigeRequiresFestival(project: Project): boolean {
  const tone = (project.tone || '').toLowerCase();
  const genres = (project.genres || []).map(g => g.toLowerCase());
  return (
    (tone.includes('prestige') || tone.includes('arthouse') || tone.includes('auteur')) &&
    !genres.some(g => ['thriller', 'horror', 'comedy', 'action'].includes(g))
  );
}

// ---- Development stall detection ----

export interface DevelopmentSignals {
  rewriteCount?: number;
  structuralImprovement?: boolean;
  packagingWaiting?: boolean;
  financeMomentum?: boolean;
  budgetInflation?: boolean;
  hookStrengthImproving?: boolean;
}

function checkDevelopmentStall(signals: DevelopmentSignals): boolean {
  if ((signals.rewriteCount || 0) > 3 && !signals.structuralImprovement) return true;
  if (signals.packagingWaiting && !signals.financeMomentum) return true;
  if (signals.budgetInflation) return true;
  if ((signals.rewriteCount || 0) > 2 && !signals.hookStrengthImproving) return true;
  return false;
}

// ---- Strategic bias adjustments (max +1 per dimension) ----

function calculateBiasAdjustments(project: Project): BiasAdjustment[] {
  const adjustments: BiasAdjustment[] = [];
  const genres = (project.genres || []).map(g => g.toLowerCase());
  const tone = (project.tone || '').toLowerCase();

  // Contained production value
  const budget = parseBudgetGBP(project.budget_range);
  if (budget && budget <= PARADOX_PROFILE.budgetSweetSpot.maxGBP && budget >= PARADOX_PROFILE.budgetSweetSpot.minGBP) {
    adjustments.push({ dimension: 'Budget Feasibility', delta: 1, reason: 'Within Paradox House sweet spot (£2M–£15M)' });
  }

  // Strong lead roles
  if (tone.includes('character') || tone.includes('lead-driven') || tone.includes('protagonist')) {
    adjustments.push({ dimension: 'Packaging Leverage', delta: 1, reason: 'Strong lead role emphasis aligns with packaging strengths' });
  }

  // International genre clarity
  if (genres.some(g => ['thriller', 'horror', 'sci-fi', 'action'].includes(g))) {
    adjustments.push({ dimension: 'Market Heat', delta: 1, reason: 'Genre travels internationally — strong pre-sales potential' });
  }

  // Streamer-friendly pacing
  if (tone.includes('pace') || tone.includes('propulsive') || tone.includes('binge') || genres.includes('thriller')) {
    adjustments.push({ dimension: 'Trend Alignment', delta: 1, reason: 'Streamer-friendly pacing/genre' });
  }

  // Cap all deltas to ±1
  return adjustments.map(a => ({ ...a, delta: Math.max(-1, Math.min(1, a.delta)) }));
}

// ---- Exec Confidence Score ----

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

// ---- Main evaluation ----

export function evaluateParadoxHouseMode(
  project: Project,
  devSignals?: DevelopmentSignals,
): ParadoxHouseFlags {
  return {
    budgetRealismCheck: checkBudgetRealism(project.budget_range),
    packagingFragilityRisk: checkPackagingFragility(project),
    developmentStallRisk: devSignals ? checkDevelopmentStall(devSignals) : false,
    streamerAlignmentBoost: checkStreamerAlignment(project),
    prestigeRequiresFestival: checkPrestigeRequiresFestival(project),
    biasAdjustments: calculateBiasAdjustments(project),
  };
}

// ---- Apply bias to viability score (max +1 total influence) ----

export function applyParadoxBias(baseScore: number, flags: ParadoxHouseFlags): number {
  let adjustment = 0;
  if (flags.streamerAlignmentBoost) adjustment += 1;
  if (flags.budgetRealismCheck) adjustment -= 1;
  if (flags.packagingFragilityRisk) adjustment -= 1;
  // Net bias capped at ±1
  const capped = Math.max(-1, Math.min(1, adjustment));
  return Math.max(0, Math.min(100, baseScore + capped));
}
