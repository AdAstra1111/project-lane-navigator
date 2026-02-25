/**
 * Ruleset Engine — Lane-aware defaults
 */
import type { EngineProfile, Lane } from './types';

const DEFAULT_FORBIDDEN_MOVES = [
  'secret_organization', 'omniscient_surveillance', 'sniper_assassination',
  'helicopter_extraction', 'villain_monologue', 'everything_is_connected',
];

const DEFAULT_SIGNATURE_DEVICES = [
  'meaning_shift_instead_of_twist', 'leverage_over_violence',
  'polite_threats', 'status_choreography',
];

export function getDefaultEngineProfile(lane: Lane): EngineProfile {
  const base: EngineProfile = {
    version: '1.0',
    lane,
    comps: { influencers: [], tags: [] },
    engine: {
      story_engine: 'pressure_cooker',
      causal_grammar: 'accumulation',
      conflict_mode: 'moral_trap',
    },
    pacing_profile: {
      beats_per_minute: { min: 2, target: 3, max: 5 },
      cliffhanger_rate: { target: 0.5, max: 0.7 },
      quiet_beats_min: 3,
      subtext_scenes_min: 4,
      meaning_shifts_min_per_act: 1,
    },
    stakes_ladder: {
      early_allowed: ['personal'],
      no_global_before_pct: 0.20,
      late_allowed: ['systemic'],
      notes: 'Personal stakes only until final 20%',
    },
    budgets: {
      drama_budget: 2,
      twist_cap: 1,
      big_reveal_cap: 1,
      plot_thread_cap: 3,
      core_character_cap: 5,
      faction_cap: 1,
      coincidence_cap: 1,
    },
    dialogue_rules: {
      subtext_ratio_target: 0.55,
      monologue_max_lines: 6,
      no_speeches: true,
      absolute_words_penalty: true,
    },
    texture_rules: {
      money_time_institution_required: true,
      cost_of_action_required: true,
      admin_violence_preferred: true,
    },
    antagonism_model: {
      primary: 'system',
      legitimacy_required: true,
      no_omnipotence: true,
    },
    forbidden_moves: [...DEFAULT_FORBIDDEN_MOVES],
    signature_devices: [...DEFAULT_SIGNATURE_DEVICES],
    gate_thresholds: {
      melodrama_max: 0.50,
      similarity_max: 0.60,
      complexity_threads_max: 3,
      complexity_factions_max: 1,
      complexity_core_chars_max: 5,
    },
  };

  if (lane === 'vertical_drama') {
    return {
      ...base,
      engine: { ...base.engine, conflict_mode: 'status_reputation' },
      pacing_profile: {
        ...base.pacing_profile,
        cliffhanger_rate: { target: 0.9, max: 1.0 },
        quiet_beats_min: 1,
        subtext_scenes_min: 2,
      },
      stakes_ladder: {
        early_allowed: ['personal', 'social'],
        no_global_before_pct: 0.25,
        late_allowed: ['systemic'],
        notes: 'Allow personal/social early; NO global before final 25%',
      },
      budgets: {
        ...base.budgets,
        drama_budget: 3,
        twist_cap: 2,
        big_reveal_cap: 1,
        core_character_cap: 6,
        faction_cap: 2,
      },
      gate_thresholds: {
        melodrama_max: 0.62,
        similarity_max: 0.70,
        complexity_threads_max: 3,
        complexity_factions_max: 2,
        complexity_core_chars_max: 6,
      },
    };
  }

  if (lane === 'series') {
    return {
      ...base,
      engine: { ...base.engine, conflict_mode: 'family_obligation' },
      pacing_profile: {
        ...base.pacing_profile,
        quiet_beats_min: 2,
        subtext_scenes_min: 3,
      },
      stakes_ladder: {
        early_allowed: ['personal'],
        no_global_before_pct: 0.20,
        late_allowed: ['social', 'systemic'],
        notes: 'Personal until late',
      },
      budgets: { ...base.budgets, drama_budget: 2, twist_cap: 1 },
      gate_thresholds: {
        melodrama_max: 0.35,
        similarity_max: 0.65,
        complexity_threads_max: 3,
        complexity_factions_max: 2,
        complexity_core_chars_max: 5,
      },
    };
  }

  if (lane === 'documentary') {
    return {
      ...base,
      engine: {
        story_engine: 'slow_burn_investigation',
        causal_grammar: 'accumulation',
        conflict_mode: 'legal_procedural',
      },
      pacing_profile: {
        ...base.pacing_profile,
        quiet_beats_min: 3,
        subtext_scenes_min: 2,
      },
      stakes_ladder: {
        early_allowed: ['personal', 'social'],
        no_global_before_pct: 0.80,
        late_allowed: ['systemic'],
        notes: 'Realism constraints required',
      },
      budgets: {
        ...base.budgets,
        drama_budget: 1,
        twist_cap: 0,
        big_reveal_cap: 0,
        faction_cap: 1,
      },
      gate_thresholds: {
        melodrama_max: 0.15,
        similarity_max: 0.70,
        complexity_threads_max: 3,
        complexity_factions_max: 1,
        complexity_core_chars_max: 5,
      },
    };
  }

  // feature_film (base)
  return base;
}
