/**
 * Nuance Control Stack — Deterministic Gate (lane-aware)
 */
import type { NuanceMetrics, GateFailure, GateAttempt, NuanceCaps } from './types';
import { computeMelodramaScore, computeNuanceScore } from './scoring';
import { getMelodramaThreshold, getSimilarityThreshold } from './defaults';

export interface GateConfig {
  lane: string;
  caps: NuanceCaps;
  diversifyEnabled: boolean;
  similarityRisk: number;
  restraint: number;
}

/**
 * Run the nuance gate on computed metrics with lane-aware thresholds.
 */
export function runNuanceGate(
  metrics: NuanceMetrics,
  config: GateConfig,
): GateAttempt {
  const failures: GateFailure[] = [];
  const melodramaScore = computeMelodramaScore(metrics);
  const nuanceScore = computeNuanceScore(metrics);

  const melodramaThreshold = getMelodramaThreshold(config.lane);
  // Restraint modifies threshold: higher restraint = lower tolerance
  const adjustedThreshold = melodramaThreshold * (1 - (config.restraint - 50) / 200);

  // 1. MELODRAMA
  if (melodramaScore > adjustedThreshold) {
    failures.push('MELODRAMA');
  }

  // 2. OVERCOMPLEXITY — lane-aware caps
  if (
    metrics.plot_thread_count > config.caps.plotThreadCap * 2 ||
    metrics.named_factions > config.caps.factionCap * 2 ||
    metrics.new_character_density > config.caps.newCharacterCap
  ) {
    failures.push('OVERCOMPLEXITY');
  }

  // 3. TEMPLATE_SIMILARITY — lane-aware threshold
  const simThreshold = getSimilarityThreshold(config.lane);
  if (config.diversifyEnabled && config.similarityRisk > simThreshold) {
    failures.push('TEMPLATE_SIMILARITY');
  }

  // 4. STAKES_TOO_BIG_TOO_EARLY
  if (config.caps.stakesScaleEarly && metrics.shock_events_early > 2) {
    failures.push('STAKES_TOO_BIG_TOO_EARLY');
  }

  // 5. TWIST_OVERUSE
  if (metrics.twist_keyword_rate > (config.caps.twistCap + 1) * 3) {
    failures.push('TWIST_OVERUSE');
  }

  // 6. SUBTEXT_MISSING — lane-aware minimum
  if (metrics.subtext_scene_count < config.caps.subtextScenesMin) {
    failures.push('SUBTEXT_MISSING');
  }

  // 7. QUIET_BEATS_MISSING — lane-aware minimum
  if (metrics.quiet_beats_count < config.caps.quietBeatsMin) {
    failures.push('QUIET_BEATS_MISSING');
  }

  // 8. MEANING_SHIFT_MISSING
  if (metrics.meaning_shift_count < 1) {
    failures.push('MEANING_SHIFT_MISSING');
  }

  return {
    pass: failures.length === 0,
    failures,
    metrics,
    melodrama_score: melodramaScore,
    nuance_score: nuanceScore,
  };
}
