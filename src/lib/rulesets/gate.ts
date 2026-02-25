/**
 * Ruleset Engine — Deterministic Gate (ruleset-aware)
 */
import type { EngineProfile, GateFailure, GateAttempt } from './types';
import type { RulesetMetrics } from './scoring';
import {
  computeRulesetMelodramaScore,
  computeRulesetNuanceScore,
  detectForbiddenMoves,
} from './scoring';

/**
 * Run the nuance gate against resolved rules.
 */
export function runRulesetGate(
  metrics: RulesetMetrics,
  text: string,
  profile: EngineProfile,
  similarityRisk: number,
  diversifyEnabled: boolean,
): GateAttempt {
  const failures: GateFailure[] = [];
  const melodramaScore = computeRulesetMelodramaScore(metrics);
  const nuanceScore = computeRulesetNuanceScore(metrics);
  const thresholds = profile.gate_thresholds;

  // MELODRAMA
  if (melodramaScore > thresholds.melodrama_max) {
    failures.push('MELODRAMA');
  }

  // OVERCOMPLEXITY
  if (
    metrics.plot_thread_count > thresholds.complexity_threads_max * 2 ||
    metrics.named_factions > thresholds.complexity_factions_max * 2 ||
    metrics.new_character_density > thresholds.complexity_core_chars_max
  ) {
    failures.push('OVERCOMPLEXITY');
  }

  // TEMPLATE_SIMILARITY
  if (diversifyEnabled && similarityRisk > thresholds.similarity_max) {
    failures.push('TEMPLATE_SIMILARITY');
  }

  // STAKES_TOO_BIG_TOO_EARLY
  if (metrics.shock_events_early > 2) {
    failures.push('STAKES_TOO_BIG_TOO_EARLY');
  }

  // TWIST_OVERUSE
  if (metrics.twist_keyword_rate > (profile.budgets.twist_cap + 1) * 3) {
    failures.push('TWIST_OVERUSE');
  }

  // SUBTEXT_MISSING
  if (metrics.subtext_scene_count < profile.pacing_profile.subtext_scenes_min) {
    failures.push('SUBTEXT_MISSING');
  }

  // QUIET_BEATS_MISSING
  if (metrics.quiet_beats_count < profile.pacing_profile.quiet_beats_min) {
    failures.push('QUIET_BEATS_MISSING');
  }

  // MEANING_SHIFT_MISSING
  if (metrics.meaning_shift_count < profile.pacing_profile.meaning_shifts_min_per_act) {
    failures.push('MEANING_SHIFT_MISSING');
  }

  // FORBIDDEN_MOVE_PRESENT
  const foundMoves = detectForbiddenMoves(text, profile.forbidden_moves);
  if (foundMoves.length > 0) {
    failures.push('FORBIDDEN_MOVE_PRESENT');
  }

  return {
    pass: failures.length === 0,
    failures,
    melodrama_score: melodramaScore,
    nuance_score: nuanceScore,
    metrics: metrics as unknown as Record<string, number | boolean>,
  };
}
