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
  verification: string[];
  rollback_supported: boolean;
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

/* ── Changeset types ── */

export interface ChangesetDiffSummary {
  before_length: number;
  after_length: number;
  length_delta: number;
  length_delta_pct: number;
  affected_scene_count: number;
  affected_scenes: number[];
  changes_applied: number;
}

export interface WritersRoomChangeset {
  id: string;
  project_id: string;
  document_id: string;
  thread_id: string | null;
  plan_id: string | null;
  plan_json: ChangePlan;
  before_version_id: string;
  after_version_id: string;
  diff_summary: ChangesetDiffSummary;
  quality_run_id: string | null;
  rolled_back: boolean;
  rolled_back_at: string | null;
  created_by: string;
  created_at: string;
}

/** Shrink guard threshold: block if text shrinks more than this fraction unless plan has explicit deletions */
export const SHRINK_GUARD_THRESHOLD = 0.3;

/** Validates a change plan has required fields */
export function validateChangePlan(plan: Partial<ChangePlan>): string[] {
  const errors: string[] = [];
  if (!plan.direction_summary) errors.push('Missing direction_summary');
  if (!plan.changes || !Array.isArray(plan.changes) || plan.changes.length === 0) errors.push('No changes defined');
  if (plan.changes) {
    plan.changes.forEach((c, i) => {
      if (!c.id) errors.push(`Change ${i}: missing id`);
      if (!c.type) errors.push(`Change ${i}: missing type`);
      if (!c.instructions) errors.push(`Change ${i}: missing instructions`);
    });
  }
  return errors;
}

/** Check if plan has explicit deletions (scene_delete type or structure changes that remove content) */
export function planHasExplicitDeletions(plan: ChangePlan): boolean {
  return plan.changes.some(c =>
    c.type === 'structure' && c.instructions.toLowerCase().includes('delet') ||
    c.type === 'structure' && c.instructions.toLowerCase().includes('remov') ||
    c.instructions.toLowerCase().includes('cut scene') ||
    c.instructions.toLowerCase().includes('remove scene')
  );
}

/** Compute diff summary deterministically */
export function computeDiffSummary(
  beforeText: string,
  afterText: string,
  enabledChanges: ChangePlanChange[],
): ChangesetDiffSummary {
  const beforeLen = beforeText.length;
  const afterLen = afterText.length;
  const delta = afterLen - beforeLen;
  const deltaPct = beforeLen > 0 ? delta / beforeLen : 0;

  // Collect affected scenes from change targets
  const affectedScenes = new Set<number>();
  enabledChanges.forEach(c => {
    (c.target?.scene_numbers || []).forEach(sn => affectedScenes.add(sn));
  });

  return {
    before_length: beforeLen,
    after_length: afterLen,
    length_delta: delta,
    length_delta_pct: Math.round(deltaPct * 100) / 100,
    affected_scene_count: affectedScenes.size,
    affected_scenes: [...affectedScenes].sort((a, b) => a - b),
    changes_applied: enabledChanges.length,
  };
}
