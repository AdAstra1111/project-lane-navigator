/** Writers' Room for Notes — frontend types */

export type NoteThreadStatus = 'open' | 'chosen' | 'applied' | 'discarded';
export type ChangePlanStatus = 'draft' | 'confirmed' | 'applied' | 'superseded';

export interface NoteThread {
  id: string;
  project_id: string;
  document_id: string;
  version_id: string | null;
  note_hash: string;
  note_snapshot: any;
  status: NoteThreadStatus;
  created_by: string;
  created_at: string;
  updated_at: string;
}

export interface NoteThreadMessage {
  id: string;
  thread_id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  meta: any;
  created_by: string;
  created_at: string;
}

export interface NoteOption {
  id: string;
  pitch: string;
  what_changes: string[];
  pros: string[];
  cons: string[];
  scope_estimate: string;
  cost_flags: string[];
  risk_flags: string[];
  rewrite_instructions: string[];
}

export interface NoteOptionSet {
  id: string;
  thread_id: string;
  option_set_index: number;
  direction: any;
  pinned_constraints: any;
  options: NoteOption[];
  created_by: string;
  created_at: string;
}

export interface NoteThreadSynthesis {
  chosen_option_id: string;
  direction_summary: string;
  locked_constraints_used: string[];
  rewrite_plan: string[];
  verification_checks: string[];
}

export interface NoteThreadState {
  thread_id: string;
  direction: Record<string, any>;
  pinned_constraints: string[];
  selected_option: NoteOption | null;
  synthesis: NoteThreadSynthesis | null;
  last_generated_set: number | null;
  updated_at: string;
  updated_by: string;
}

export interface WritersRoomData {
  thread: NoteThread;
  state: NoteThreadState;
  messages: NoteThreadMessage[];
  optionSets: NoteOptionSet[];
}

/* ── Change Plan types ── */

export interface ChangePlanChange {
  id: string;
  title: string;
  type: 'dialogue' | 'action' | 'character' | 'plot' | 'structure' | 'tone' | 'setup_payoff' | 'world' | 'other';
  scope: 'micro' | 'scene' | 'sequence' | 'act' | 'global';
  target: {
    scene_numbers?: number[];
    characters?: string[];
    locations?: string[];
    beats?: string[];
    lines?: { from?: number; to?: number };
  };
  instructions: string;
  rationale: string;
  risk_flags?: string[];
  cost_flags?: string[];
  acceptance_criteria?: string[];
  enabled?: boolean;
}

export interface ChangePlanImpact {
  area: 'continuity' | 'character_arc' | 'theme' | 'budget' | 'schedule' | 'rating' | 'format_rules';
  note: string;
}

export interface ChangePlanRewritePayload {
  mode: 'selective' | 'full';
  target_scene_numbers?: number[];
  patch_strategy: 'surgical' | 'rewrite_scene' | 'rewrite_sequence';
  prompt: string;
}

export interface ChangePlan {
  id: string;
  thread_id: string;
  created_at: string;
  status: ChangePlanStatus;
  direction_summary: string;
  changes: ChangePlanChange[];
  impacts: ChangePlanImpact[];
  rewrite_payload: ChangePlanRewritePayload;
}

export interface ChangePlanRow {
  id: string;
  thread_id: string;
  project_id: string;
  document_id: string;
  version_id: string;
  status: ChangePlanStatus;
  plan: ChangePlan;
  created_by: string;
  created_at: string;
  updated_at: string;
}
