/**
 * Shared types for Selective Scene Rewrite with Full-Arc Alignment.
 */

export interface ArcMilestone {
  scene_number: number;
  must_be_true: string[];
}

export interface KnowledgeState {
  character: string;
  by_scene: Array<{ scene_number: number; knows: string[] }>;
}

export interface SetupPayoff {
  setup_scene: number;
  payoff_scene: number;
  item: string;
}

export interface ScopeContracts {
  arc_milestones: ArcMilestone[];
  canon_rules: string[];
  knowledge_state: KnowledgeState[];
  setup_payoff: SetupPayoff[];
}

export interface RewriteScopePlan {
  target_scene_numbers: number[];
  context_scene_numbers: number[];
  at_risk_scene_numbers: number[];
  reason: string;
  propagation_depth: number;
  note_ids: string[];
  contracts: ScopeContracts;
  debug: {
    selected_notes_count: number;
    anchored_scenes: number[];
    timestamp: string;
  };
}

export interface RewriteVerification {
  pass: boolean;
  failures: Array<{
    type: 'continuity' | 'arc' | 'canon' | 'knowledge' | 'setup_payoff';
    detail: string;
    scene_numbers?: number[];
  }>;
  timestamp: string;
}

export interface RewriteProvenance {
  rewriteModeSelected: 'auto' | 'scene' | 'chunk';
  rewriteModeEffective: 'scene' | 'chunk';
  rewriteModeReason: string;
  rewriteModeDebug?: any;
  rewriteProbe?: { has_scenes: boolean; scenes_count: number; script_chars: number } | null;
  rewriteScopePlan?: RewriteScopePlan | null;
  rewriteScopeExpandedFrom?: number[] | null;
  rewriteVerification?: RewriteVerification | null;
}
