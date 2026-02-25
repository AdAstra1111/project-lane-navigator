/**
 * Ruleset Engine — Conflict detection
 */
import type { EngineProfile, RuleConflict } from './types';
import { getDefaultEngineProfile } from './defaults';

/**
 * Detect conflicts between a derived engine profile and lane defaults/expectations.
 */
export function detectConflicts(profile: EngineProfile): RuleConflict[] {
  const conflicts: RuleConflict[] = [];
  const defaults = getDefaultEngineProfile(profile.lane);

  // 1. High twist cap but high restraint expectation
  if (profile.budgets.twist_cap > defaults.budgets.twist_cap + 1) {
    conflicts.push({
      id: 'twist_vs_restraint',
      severity: 'warn',
      dimension: 'twist_budget',
      message: `Twist cap (${profile.budgets.twist_cap}) exceeds lane default (${defaults.budgets.twist_cap}). May undermine restraint.`,
      inferred_value: String(profile.budgets.twist_cap),
      expected_value: String(defaults.budgets.twist_cap),
      suggested_actions: ['honor_comps', 'honor_overrides'],
    });
  }

  // 2. Global stakes too early
  if (profile.stakes_ladder.no_global_before_pct < defaults.stakes_ladder.no_global_before_pct - 0.05) {
    conflicts.push({
      id: 'early_global_stakes',
      severity: 'warn',
      dimension: 'stakes_ladder',
      message: `Global stakes allowed earlier (${Math.round(profile.stakes_ladder.no_global_before_pct * 100)}%) than lane default (${Math.round(defaults.stakes_ladder.no_global_before_pct * 100)}%).`,
      inferred_value: String(profile.stakes_ladder.no_global_before_pct),
      expected_value: String(defaults.stakes_ladder.no_global_before_pct),
      suggested_actions: ['honor_overrides', 'blend'],
    });
  }

  // 3. Forbidden move appears allowed
  for (const move of defaults.forbidden_moves) {
    if (!profile.forbidden_moves.includes(move)) {
      conflicts.push({
        id: `missing_forbidden_${move}`,
        severity: 'hard',
        dimension: 'forbidden_moves',
        message: `Default forbidden move "${move}" is not in the derived profile.`,
        inferred_value: 'allowed',
        expected_value: 'forbidden',
        suggested_actions: ['honor_overrides'],
      });
    }
  }

  // 4. Complexity exceeds lane caps
  if (profile.budgets.core_character_cap > defaults.gate_thresholds.complexity_core_chars_max) {
    conflicts.push({
      id: 'char_overcomplexity',
      severity: 'warn',
      dimension: 'twist_budget',
      message: `Core character cap (${profile.budgets.core_character_cap}) exceeds gate threshold (${defaults.gate_thresholds.complexity_core_chars_max}).`,
      inferred_value: String(profile.budgets.core_character_cap),
      expected_value: String(defaults.gate_thresholds.complexity_core_chars_max),
      suggested_actions: ['honor_overrides', 'blend'],
    });
  }

  // 5. Melodrama threshold too permissive vs defaults
  if (profile.gate_thresholds.melodrama_max > defaults.gate_thresholds.melodrama_max + 0.1) {
    conflicts.push({
      id: 'melodrama_permissive',
      severity: 'warn',
      dimension: 'pacing',
      message: `Melodrama threshold (${profile.gate_thresholds.melodrama_max}) is more permissive than lane default (${defaults.gate_thresholds.melodrama_max}).`,
      inferred_value: String(profile.gate_thresholds.melodrama_max),
      expected_value: String(defaults.gate_thresholds.melodrama_max),
      suggested_actions: ['honor_overrides', 'honor_comps'],
    });
  }

  return conflicts;
}
