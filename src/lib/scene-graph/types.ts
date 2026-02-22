// ============================================================
// IFFY Scene Graph — TypeScript types
// ============================================================

export interface ScriptScene {
  id: string;
  project_id: string;
  scene_kind: string;
  created_at: string;
  created_by: string | null;
  deprecated_at: string | null;
  provenance: Record<string, any>;
}

export interface ScriptSceneVersion {
  id: string;
  scene_id: string;
  project_id: string;
  version_number: number;
  status: 'draft' | 'proposed' | 'approved' | 'deprecated';
  created_at: string;
  created_by: string | null;
  slugline: string | null;
  location: string | null;
  time_of_day: string | null;
  characters_present: string[];
  purpose: string | null;
  beats: any[];
  summary: string | null;
  content: string;
  continuity_facts_emitted: any[];
  continuity_facts_required: any[];
  setup_payoff_emitted: any[];
  setup_payoff_required: any[];
  metadata: Record<string, any>;
}

export interface ScriptSceneOrder {
  id: string;
  project_id: string;
  scene_id: string;
  order_key: string;
  act: number | null;
  sequence: number | null;
  is_active: boolean;
  inserted_reason: string | null;
  inserted_intent: Record<string, any>;
  created_at: string;
}

export interface ScriptSnapshot {
  id: string;
  project_id: string;
  created_at: string;
  created_by: string | null;
  label: string | null;
  assembly: {
    scene_order?: Array<{
      scene_id: string;
      version_id: string;
      order_key: string;
      act: number | null;
      sequence: number | null;
    }>;
    generated_at?: string;
    mode?: 'latest' | 'approved_prefer';
  };
  content: string;
  status: 'draft' | 'approved' | 'deprecated';
}

export interface ImpactWarning {
  type: 'continuity' | 'setup_payoff' | 'thread' | 'pacing';
  severity: 'low' | 'med' | 'high';
  message: string;
  relatedSceneIds: string[];
}

export interface SuggestedPatch {
  targetSceneId: string;
  suggestion: string;
  rationale: string;
}

export interface ImpactReport {
  warnings: ImpactWarning[];
  suggested_patches: SuggestedPatch[];
}

/** Scene with derived display info for the UI */
export interface SceneListItem {
  scene_id: string;
  display_number: number;
  order_key: string;
  act: number | null;
  sequence: number | null;
  is_active: boolean;
  scene_kind: string;
  latest_version: ScriptSceneVersion | null;
  approval_status: string;
}

// ---- Action Payloads ----

export interface SceneGraphExtractInput {
  projectId: string;
  sourceDocumentId?: string;
  sourceVersionId?: string;
  mode?: 'from_script_doc' | 'from_text';
  text?: string;
}

export interface SceneGraphListInput {
  projectId: string;
}

export interface SceneGraphInsertInput {
  projectId: string;
  position: { beforeSceneId?: string; afterSceneId?: string };
  intent?: { type: string; notes: string };
  sceneDraft?: { slugline?: string; content?: string; summary?: string };
}

export interface SceneGraphRemoveInput {
  projectId: string;
  sceneId: string;
}

export interface SceneGraphMoveInput {
  projectId: string;
  sceneId: string;
  position: { beforeSceneId?: string; afterSceneId?: string };
}

export interface SceneGraphSplitInput {
  projectId: string;
  sceneId: string;
  splitAt?: { type: 'line' | 'beat' | 'marker'; value: any };
  drafts?: { partA: string; partB: string };
}

export interface SceneGraphMergeInput {
  projectId: string;
  sceneIds: [string, string];
  mergedDraft?: { content: string; slugline?: string };
}

export interface SceneGraphUpdateInput {
  projectId: string;
  sceneId: string;
  patch: {
    slugline?: string;
    content?: string;
    beats?: any[];
    summary?: string;
    characters_present?: string[];
  };
  propose?: boolean;
}

export interface SceneGraphApproveInput {
  projectId: string;
  sceneVersionId: string;
}

export interface SceneGraphRebuildSnapshotInput {
  projectId: string;
  mode?: 'latest' | 'approved_prefer';
  label?: string;
}

// Phase 2 inputs
export interface SceneGraphListInactiveInput {
  projectId: string;
}

export interface SceneGraphRestoreInput {
  projectId: string;
  sceneId: string;
  position?: { beforeSceneId?: string; afterSceneId?: string };
}

export interface SceneGraphUndoInput {
  projectId: string;
  actionId: string;
}

export interface SceneGraphApplyPatchInput {
  projectId: string;
  patchQueueId: string;
  mode?: 'draft' | 'propose';
}

export interface SceneGraphPatchStatusInput {
  projectId: string;
  patchQueueId: string;
}

export interface SceneGraphRebalanceInput {
  projectId: string;
}

export interface SceneGraphListPatchQueueInput {
  projectId: string;
}

// Phase 2 response types
export interface SceneGraphAction {
  id: string;
  project_id: string;
  action_type: string;
  actor_id: string | null;
  created_at: string;
  payload: Record<string, any>;
  inverse: Record<string, any>;
}

export interface PatchQueueItem {
  id: string;
  project_id: string;
  created_at: string;
  created_by: string | null;
  status: 'open' | 'accepted' | 'rejected' | 'applied';
  source_action_id: string | null;
  target_scene_id: string | null;
  target_scene_version_id: string | null;
  suggestion: string;
  rationale: string | null;
  patch: Record<string, any>;
}

export interface InactiveSceneItem {
  scene_id: string;
  order_key: string;
  scene_kind: string;
  latest_version: ScriptSceneVersion | null;
}

export interface ProjectSceneState {
  project_id: string;
  has_scenes: boolean;
  active_scene_count: number;
  latest_snapshot_id: string | null;
  latest_snapshot_status: string | null;
}

// ── Phase 3 Types ──

export interface ProjectSpine {
  id: string;
  project_id: string;
  created_at: string;
  created_by: string | null;
  mode: string;
  source_snapshot_id: string | null;
  status: string;
  spine: {
    logline?: string;
    central_question?: string;
    act_turning_points?: Array<{ act: number; scene_id: string; label: string }>;
    main_arcs?: Array<{ character: string; arc_type: string; steps: string[] }>;
    open_threads?: Array<{ thread: string; status: string; scenes: string[] }>;
    setups_payoffs?: Array<{ setup: string; payoff: string; setup_scene_id?: string; payoff_scene_id?: string; status: string }>;
    tone?: string;
    genre?: string;
  };
  stats: Record<string, any>;
}

export interface CanonFact {
  id: string;
  project_id: string;
  fact_type: string;
  subject: string;
  predicate: string;
  object: string;
  value: Record<string, any>;
  confidence: number;
  first_scene_id: string | null;
  last_scene_id: string | null;
  first_order_key: string | null;
  last_order_key: string | null;
  sources: Array<{ scene_id: string; version_id?: string; order_key?: string; quote?: string }>;
  is_active: boolean;
  created_at: string;
}

export interface CanonOverride {
  id: string;
  project_id: string;
  created_at: string;
  created_by: string | null;
  status: string;
  override: Record<string, any>;
}

export interface SceneSpineLink {
  id: string;
  project_id: string;
  scene_id: string;
  order_key: string;
  act: number | null;
  sequence: number | null;
  roles: string[];
  threads: string[];
  arc_steps: Array<{ character: string; step: string }>;
  updated_at: string;
}

export type NarrativeRepairProblemType =
  | 'motivation_unclear'
  | 'act2_sag'
  | 'missing_payoff'
  | 'weak_escalation'
  | 'exposition_heavy'
  | 'continuity_hole'
  | 'reveal_unearned'
  | 'pacing_issue'
  | 'character_arc_jump';

export interface NarrativeRepairProblem {
  type: NarrativeRepairProblemType;
  notes?: string;
  targetSceneId?: string;
  severity?: 'low' | 'med' | 'high';
}

export interface NarrativeRepairOption {
  id: string;
  action_type: 'insert_new_scene' | 'rewrite_scene' | 'move_scene' | 'split_scene' | 'merge_scenes';
  summary: string;
  rationale: string;
  risk: string;
  predicted_impact: { warnings: ImpactWarning[] };
  cascading_effects: string[];
  payload: Record<string, any>;
}

// Phase 3 inputs
export interface SpineRebuildInput {
  projectId: string;
  mode?: 'latest' | 'approved_prefer';
  snapshotLabel?: string;
}

export interface SpineGetCurrentInput {
  projectId: string;
}

export interface CanonListInput {
  projectId: string;
  filters?: { fact_type?: string; subject?: string; is_active?: boolean };
}

export interface CanonOverrideUpsertInput {
  projectId: string;
  override: Record<string, any>;
}

export interface NarrativeRepairSuggestInput {
  projectId: string;
  problem: NarrativeRepairProblem;
  mode?: 'latest' | 'approved_prefer';
}

export interface NarrativeRepairQueueOptionInput {
  projectId: string;
  option: NarrativeRepairOption;
}
