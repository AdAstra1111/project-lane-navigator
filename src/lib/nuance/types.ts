/**
 * Nuance Control Stack — Type definitions
 */

export const STORY_ENGINES = [
  'pressure_cooker',
  'two_hander',
  'slow_burn_investigation',
  'social_realism',
  'moral_trap',
  'character_spiral',
  'rashomon',
  'anti_plot',
] as const;
export type StoryEngine = typeof STORY_ENGINES[number];

export const CAUSAL_GRAMMARS = [
  'accumulation',
  'erosion',
  'exchange',
  'mirror',
  'constraint',
  'misalignment',
  'contagion',
  'revelation_without_facts',
] as const;
export type CausalGrammar = typeof CAUSAL_GRAMMARS[number];

export const ANTI_TROPE_OPTIONS = [
  'secret_organization',
  'hidden_bloodline',
  'chosen_one_destiny',
  'kidnapping_as_fuel',
  'sudden_murder_for_stakes',
  'everything_is_connected',
  'villain_monologue',
  'last_minute_double_betrayal',
] as const;
export type AntiTrope = typeof ANTI_TROPE_OPTIONS[number];

export const GATE_FAILURES = [
  'MELODRAMA',
  'OVERCOMPLEXITY',
  'TEMPLATE_SIMILARITY',
  'STAKES_TOO_BIG_TOO_EARLY',
  'TWIST_OVERUSE',
  'SUBTEXT_MISSING',
  'QUIET_BEATS_MISSING',
  'MEANING_SHIFT_MISSING',
] as const;
export type GateFailure = typeof GATE_FAILURES[number];

export interface NuanceProfile {
  restraint: number; // 0–100
  storyEngine: StoryEngine;
  causalGrammar: CausalGrammar;
  dramaBudget: number;
  antiTropes: AntiTrope[];
  diversify: boolean;
}

export interface ConstraintPack {
  money_reality?: string;
  time_reality?: string;
  institution_reality?: string;
  relationship_physics?: string;
  taboo_or_risk?: string;
  routine?: string;
}

export interface NuanceFingerprint {
  lane: string;
  story_engine: StoryEngine;
  causal_grammar: CausalGrammar;
  stakes_type: 'personal' | 'social' | 'systemic' | 'global';
  twist_count_bucket: '0' | '1' | '2+';
  antagonist_type: 'self' | 'relationship' | 'system' | 'person';
  ending_type: 'reconciliation' | 'acceptance' | 'escape' | 'justice' | 'tragedy' | 'ambiguous';
  inciting_incident_category: 'loss' | 'offer' | 'mistake' | 'arrival' | 'discovery' | 'accusation';
  setting_texture_tags: string[];
}

export interface NuanceMetrics {
  absolute_words_rate: number;
  twist_keyword_rate: number;
  conspiracy_markers: number;
  shock_events_early: number;
  speech_length_proxy: number;
  named_factions: number;
  plot_thread_count: number;
  new_character_density: number;
  subtext_scene_count: number;
  quiet_beats_count: number;
  meaning_shift_count: number;
  antagonist_legitimacy: boolean;
  cost_of_action_markers: number;
}

export interface GateAttempt {
  pass: boolean;
  failures: GateFailure[];
  metrics: NuanceMetrics;
  melodrama_score: number;
  nuance_score: number;
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

export interface NuanceRunRow {
  id?: string;
  project_id: string;
  user_id: string;
  document_id?: string | null;
  version_id?: string | null;
  doc_type: string;
  restraint: number;
  story_engine: StoryEngine;
  causal_grammar: CausalGrammar;
  drama_budget: number;
  nuance_score: number;
  melodrama_score: number;
  similarity_risk: number;
  anti_tropes: AntiTrope[];
  constraint_pack: ConstraintPack;
  fingerprint: NuanceFingerprint | Record<string, never>;
  nuance_metrics: NuanceMetrics | Record<string, never>;
  nuance_gate: NuanceGateResult | Record<string, never>;
  attempt: number;
  repaired_from_run_id?: string | null;
}

/** Caps enforced by the gate */
export interface NuanceCaps {
  dramaBudget: number;
  twistCap: number;
  newCharacterCap: number;
  plotThreadCap: number;
  stakesScaleEarly: boolean; // true = penalize global stakes before final 20%
}
