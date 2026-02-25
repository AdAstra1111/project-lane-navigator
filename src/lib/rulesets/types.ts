/**
 * Ruleset Engine — Type definitions
 */

export const INFLUENCE_DIMENSIONS = [
  'pacing', 'stakes_ladder', 'dialogue_style', 'twist_budget',
  'texture_realism', 'antagonism_model',
] as const;
export type InfluenceDimension = typeof INFLUENCE_DIMENSIONS[number];

export const CONFLICT_MODES = [
  'romance_misalignment', 'status_reputation', 'money_time_pressure',
  'family_obligation', 'workplace_power', 'moral_trap',
  'identity_shame', 'legal_procedural',
] as const;
export type ConflictMode = typeof CONFLICT_MODES[number];

export const STORY_ENGINES = [
  'pressure_cooker', 'two_hander', 'slow_burn_investigation',
  'social_realism', 'moral_trap', 'character_spiral', 'rashomon', 'anti_plot',
] as const;
export type StoryEngine = typeof STORY_ENGINES[number];

export const CAUSAL_GRAMMARS = [
  'accumulation', 'erosion', 'exchange', 'mirror',
  'constraint', 'misalignment', 'contagion', 'revelation_without_facts',
] as const;
export type CausalGrammar = typeof CAUSAL_GRAMMARS[number];

export const ANTAGONIST_TYPES = ['system', 'relationship', 'self', 'person'] as const;
export type AntagonistType = typeof ANTAGONIST_TYPES[number];

export type Lane = 'vertical_drama' | 'feature_film' | 'series' | 'documentary';

/** The canonical EngineProfile (rules JSON) shape */
export interface EngineProfile {
  version: string;
  lane: Lane;
  comps: {
    influencers: CompsInfluencer[];
    tags: string[];
  };
  engine: {
    story_engine: StoryEngine;
    causal_grammar: CausalGrammar;
    conflict_mode: ConflictMode;
  };
  pacing_profile: {
    beats_per_minute: { min: number; target: number; max: number };
    cliffhanger_rate: { target: number; max: number };
    quiet_beats_min: number;
    subtext_scenes_min: number;
    meaning_shifts_min_per_act: number;
  };
  stakes_ladder: {
    early_allowed: string[];
    no_global_before_pct: number;
    late_allowed: string[];
    notes: string;
  };
  budgets: {
    drama_budget: number;
    twist_cap: number;
    big_reveal_cap: number;
    plot_thread_cap: number;
    core_character_cap: number;
    faction_cap: number;
    coincidence_cap: number;
  };
  dialogue_rules: {
    subtext_ratio_target: number;
    monologue_max_lines: number;
    no_speeches: boolean;
    absolute_words_penalty: boolean;
  };
  texture_rules: {
    money_time_institution_required: boolean;
    cost_of_action_required: boolean;
    admin_violence_preferred: boolean;
  };
  antagonism_model: {
    primary: AntagonistType;
    legitimacy_required: boolean;
    no_omnipotence: boolean;
  };
  forbidden_moves: string[];
  signature_devices: string[];
  gate_thresholds: {
    melodrama_max: number;
    similarity_max: number;
    complexity_threads_max: number;
    complexity_factions_max: number;
    complexity_core_chars_max: number;
  };
}

export interface CompsInfluencer {
  title: string;
  year?: number;
  format: string;
  weight: number;
  dimensions: InfluenceDimension[];
}

export interface RuleConflict {
  id: string;
  severity: 'info' | 'warn' | 'hard';
  dimension: InfluenceDimension | 'forbidden_moves';
  message: string;
  inferred_value: string;
  expected_value: string;
  suggested_actions: ('honor_comps' | 'honor_overrides' | 'blend')[];
}

export interface OverridePatch {
  op: 'replace' | 'add' | 'remove';
  path: string;
  value?: unknown;
}

export type GateFailure =
  | 'MELODRAMA'
  | 'OVERCOMPLEXITY'
  | 'TEMPLATE_SIMILARITY'
  | 'STAKES_TOO_BIG_TOO_EARLY'
  | 'TWIST_OVERUSE'
  | 'SUBTEXT_MISSING'
  | 'QUIET_BEATS_MISSING'
  | 'MEANING_SHIFT_MISSING'
  | 'FORBIDDEN_MOVE_PRESENT';

export interface GateAttempt {
  pass: boolean;
  failures: GateFailure[];
  melodrama_score: number;
  nuance_score: number;
  metrics: Record<string, number | boolean>;
}

export interface NuanceGateResult {
  attempt0: GateAttempt;
  attempt1?: GateAttempt;
  final: {
    pass: boolean;
    failures: GateFailure[];
    melodrama_score: number;
    nuance_score: number;
  };
  repair_instruction?: string;
}

export interface RulesetFingerprint {
  lane: string;
  story_engine: StoryEngine;
  causal_grammar: CausalGrammar;
  conflict_mode: ConflictMode;
  stakes_type: 'personal' | 'social' | 'systemic' | 'global';
  twist_count_bucket: '0' | '1' | '2+';
  antagonist_type: AntagonistType;
  ending_type: 'reconciliation' | 'acceptance' | 'escape' | 'justice' | 'tragedy' | 'ambiguous';
  inciting_incident_category: 'loss' | 'offer' | 'mistake' | 'arrival' | 'discovery' | 'accusation';
  setting_texture_tags: string[];
}
