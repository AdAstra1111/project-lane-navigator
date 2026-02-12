/**
 * Master Viability Score: Phase-weighted composite of all 6 stage readiness scores.
 * Weights adjust dynamically based on production type.
 */

import type { LifecycleStage } from '@/lib/lifecycle-stages';
import type { StageReadinessResult } from '@/lib/stage-readiness';

export interface MasterViabilityResult {
  score: number;
  stageScores: Record<LifecycleStage, number>;
  weights: Record<LifecycleStage, number>;
  dominantStage: LifecycleStage;
  label: string;
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

  return {
    score,
    stageScores,
    weights,
    dominantStage,
    label: getLabel(score),
  };
}
