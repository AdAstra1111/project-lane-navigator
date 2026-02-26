/**
 * Shared helpers for DevSeed data extraction.
 * Used by ApplyDevSeedDialog and SeedAppliedBanner.
 */
import type { RulesetPrefs } from '@/lib/rulesets/uiState';

export function buildPrefsDraft(devSeed: any): Partial<RulesetPrefs> {
  const prefs: Partial<RulesetPrefs> = {};
  const nuance = devSeed?.nuance_contract;
  if (!nuance) return prefs;

  if (nuance.restraint_level != null || nuance.conflict_mode) {
    prefs.last_ui = {};
    if (nuance.restraint_level != null) prefs.last_ui.restraint = nuance.restraint_level;
    if (nuance.conflict_mode) prefs.last_ui.conflict_mode = nuance.conflict_mode;
  }

  return prefs;
}
