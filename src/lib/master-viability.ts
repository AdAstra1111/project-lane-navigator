/**
 * Master Viability Score: Phase-weighted composite of all 6 stage readiness scores.
 * Weights adjust dynamically based on production type.
 */

import type { LifecycleStage } from '@/lib/lifecycle-stages';
import type { StageReadinessResult } from '@/lib/stage-readiness';

export interface ViabilityComponents {
  lane_fit: number;
  structural_strength: number;
  market_heat: number;
  trend_alignment: number;
  budget_feasibility: number;
  packaging_leverage: number;
}

export interface MasterViabilityResult {
  score: number;
  stageScores: Record<LifecycleStage, number>;
  weights: Record<LifecycleStage, number>;
  dominantStage: LifecycleStage;
  label: string;
  components: ViabilityComponents;
}

type WeightProfile = Record<LifecycleStage, number>;

const DEFAULT_WEIGHTS: WeightProfile = {
  'development': 0.20,
  'packaging': 0.25,
  'pre-production': 0.20,
  'production': 0.15,
  'post-production': 0.10,
  'sales-delivery': 0.10,
};

const WEIGHT_PROFILES: Record<string, WeightProfile> = {
  'film': DEFAULT_WEIGHTS,
  'tv-series': {
    'development': 0.15,
    'packaging': 0.30,
    'pre-production': 0.15,
    'production': 0.15,
    'post-production': 0.10,
    'sales-delivery': 0.15,
  },
  'documentary': {
    'development': 0.25,
    'packaging': 0.15,
    'pre-production': 0.15,
    'production': 0.20,
    'post-production': 0.10,
    'sales-delivery': 0.15,
  },
  'short-film': {
    'development': 0.30,
    'packaging': 0.15,
    'pre-production': 0.20,
    'production': 0.15,
    'post-production': 0.15,
    'sales-delivery': 0.05,
  },
  'digital-series': {
    'development': 0.15,
    'packaging': 0.20,
    'pre-production': 0.15,
    'production': 0.15,
    'post-production': 0.10,
    'sales-delivery': 0.25,
  },
  'commercial': {
    'development': 0.10,
    'packaging': 0.15,
    'pre-production': 0.30,
    'production': 0.25,
    'post-production': 0.15,
    'sales-delivery': 0.05,
  },
  'branded-content': {
    'development': 0.10,
    'packaging': 0.20,
    'pre-production': 0.25,
    'production': 0.20,
    'post-production': 0.15,
    'sales-delivery': 0.10,
  },
  'vertical-drama': {
    'development': 0.15,
    'packaging': 0.25,
    'pre-production': 0.15,
    'production': 0.15,
    'post-production': 0.10,
    'sales-delivery': 0.20,
  },
  'documentary-series': {
    'development': 0.20,
    'packaging': 0.15,
    'pre-production': 0.15,
    'production': 0.20,
    'post-production': 0.10,
    'sales-delivery': 0.20,
  },
  'hybrid-documentary': {
    'development': 0.25,
    'packaging': 0.15,
    'pre-production': 0.15,
    'production': 0.20,
    'post-production': 0.10,
    'sales-delivery': 0.15,
  },
};

function getLabel(score: number): string {
  if (score >= 80) return 'Finance-Ready';
  if (score >= 60) return 'Strong';
  if (score >= 40) return 'Building';
  if (score >= 20) return 'Early';
  return 'Inception';
}

export function calculateMasterViability(
  stageResults: Partial<Record<LifecycleStage, StageReadinessResult>>,
  format: string,
  currentLifecycleStage: LifecycleStage,
  laneConfidence?: number | null,
  trendScore?: number | null,
): MasterViabilityResult {
  const weights = WEIGHT_PROFILES[format] || DEFAULT_WEIGHTS;

  const stageScores: Record<LifecycleStage, number> = {
    'development': 0,
    'packaging': 0,
    'pre-production': 0,
    'production': 0,
    'post-production': 0,
    'sales-delivery': 0,
  };

  const STAGE_ORDER: LifecycleStage[] = [
    'development', 'packaging', 'pre-production', 'production', 'post-production', 'sales-delivery',
  ];

  const currentIdx = STAGE_ORDER.indexOf(currentLifecycleStage);

  let weightedTotal = 0;
  let totalWeight = 0;

  for (const stage of STAGE_ORDER) {
    const stageIdx = STAGE_ORDER.indexOf(stage);
    const result = stageResults[stage];

    if (result) {
      stageScores[stage] = result.score;
    }

    // Only count stages up to current + 1 in the master score
    if (stageIdx <= currentIdx + 1) {
      weightedTotal += stageScores[stage] * weights[stage];
      totalWeight += weights[stage];
    }
  }

  const score = totalWeight > 0 ? Math.round(weightedTotal / totalWeight) : 0;

  // Find the dominant (weakest) stage to highlight
  let dominantStage: LifecycleStage = 'development';
  let lowestScore = 101;
  for (const stage of STAGE_ORDER) {
    if (STAGE_ORDER.indexOf(stage) <= currentIdx && stageScores[stage] < lowestScore) {
      lowestScore = stageScores[stage];
      dominantStage = stage;
    }
  }

  // Derive 6-component breakdown from existing stage data
  const devBreakdown = stageResults['development']?.breakdown || [];
  const pkgBreakdown = stageResults['packaging']?.breakdown || [];
  const preProBreakdown = stageResults['pre-production']?.breakdown || [];

  // Lane Fit: from project lane confidence (0-1 → 0-100) + commercial tension from dev
  const commercialItem = devBreakdown.find(b => b.label === 'Commercial Tension');
  const commercialNorm = commercialItem ? Math.round((commercialItem.score / commercialItem.max) * 100) : 0;
  const laneFit = laneConfidence != null
    ? Math.round(((laneConfidence * 100) * 0.6) + (commercialNorm * 0.4))
    : commercialNorm;

  // Structural Strength: script quality + IP clarity from dev stage
  const scriptItem = devBreakdown.find(b => b.label === 'Script Quality');
  const ipItem = devBreakdown.find(b => b.label === 'IP Clarity');
  const scriptNorm = scriptItem ? (scriptItem.score / scriptItem.max) * 100 : 0;
  const ipNorm = ipItem ? (ipItem.score / ipItem.max) * 100 : 0;
  const structuralStrength = Math.round((scriptNorm * 0.6) + (ipNorm * 0.4));

  // Market Heat: audience clarity from dev + sales-delivery stage score
  const audienceItem = devBreakdown.find(b => b.label === 'Audience Clarity');
  const audienceNorm = audienceItem ? (audienceItem.score / audienceItem.max) * 100 : 0;
  const salesScore = stageScores['sales-delivery'] || 0;
  const marketHeat = Math.round((audienceNorm * 0.5) + (salesScore * 0.5));

  // Trend Alignment: from trend viability score if available, else derive from market heat
  const trendAlignment = trendScore != null ? Math.round(trendScore) : Math.round(marketHeat * 0.7);

  // Budget Feasibility: from pre-production budget + finance items
  const budgetItem = preProBreakdown.find(b => b.label === 'Budget');
  const financeItem = preProBreakdown.find(b => b.label === 'Incentives & Finance');
  const budgetNorm = budgetItem ? (budgetItem.score / budgetItem.max) * 100 : 0;
  const financeNorm = financeItem ? (financeItem.score / financeItem.max) * 100 : 0;
  const budgetFeasibility = Math.round((budgetNorm * 0.6) + (financeNorm * 0.4));

  // Packaging Leverage: directly from packaging stage score
  const packagingLeverage = stageScores['packaging'] || 0;

  const components: ViabilityComponents = {
    lane_fit: Math.min(100, Math.max(0, laneFit)),
    structural_strength: Math.min(100, Math.max(0, structuralStrength)),
    market_heat: Math.min(100, Math.max(0, marketHeat)),
    trend_alignment: Math.min(100, Math.max(0, trendAlignment)),
    budget_feasibility: Math.min(100, Math.max(0, budgetFeasibility)),
    packaging_leverage: Math.min(100, Math.max(0, packagingLeverage)),
  };

  return {
    score,
    stageScores,
    weights,
    dominantStage,
    label: getLabel(score),
    components,
  };
}
