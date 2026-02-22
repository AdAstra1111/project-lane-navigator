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

// ── Phase 3 Types (original) ──

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
  | 'character_arc_jump'
  | 'pacing_sag'
  | 'twist_unearned'
  | 'arc_jump'
  | 'tone_inconsistent'
  | 'confusing_transition';

export interface NarrativeRepairProblem {
  type: NarrativeRepairProblemType;
  notes?: string;
  targetSceneId?: string;
  severity?: 'low' | 'med' | 'high';
  description?: string;
  constraints?: { preserveApproved?: boolean; maxNewScenes?: number };
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
  threads_affected?: string[];
  expected_outcome?: string;
}

// Phase 3 inputs (original)
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

// ── Phase 3 Story-Smart Types ──

export interface StorySpine {
  logline: string;
  genre: string;
  tone: string;
  premise: string;
  acts: Array<{
    act: number;
    goal: string;
    turning_points: Array<{ name: string; description: string; target_scene_hint: string | null }>;
    pacing_notes: string | null;
  }>;
  character_arcs: Array<{ name: string; start_state: string; end_state: string; key_steps: string[] }>;
  rules: {
    world_rules: string[];
    tone_rules: string[];
    forbidden_changes: string[];
  };
}

export interface StorySpineRecord {
  id: string;
  project_id: string;
  created_at: string;
  created_by: string | null;
  status: string;
  source: string;
  spine: StorySpine;
  summary: string | null;
  version: number;
}

export interface ThreadItem {
  thread_id: string;
  type: 'mystery' | 'relationship' | 'goal' | 'lie' | 'clue' | 'setup_payoff' | 'theme';
  title: string;
  status: 'open' | 'paid' | 'moved' | 'removed';
  introduced_in_scene_id: string | null;
  resolved_in_scene_id: string | null;
  beats: string[];
  dependencies: string[];
  notes: string | null;
}

export interface ThreadLedger {
  threads: ThreadItem[];
}

export interface ThreadLedgerRecord {
  id: string;
  project_id: string;
  created_at: string;
  created_by: string | null;
  status: string;
  ledger: ThreadLedger;
  summary: string | null;
  version: number;
}

export interface SceneRoleTag {
  role_key: string;
  confidence: number;
  note: string | null;
}

export interface SceneThreadLink {
  thread_id: string;
  relation: 'introduces' | 'advances' | 'complicates' | 'resolves' | 'references';
  note: string | null;
}

export interface NarrativeRepairResponse {
  options: [NarrativeRepairOption, NarrativeRepairOption, NarrativeRepairOption];
  recommended_option_index: number;
}

export interface ApplyRepairRequest {
  projectId: string;
  option: NarrativeRepairOption;
  applyMode?: 'draft' | 'propose';
  mode?: 'latest' | 'approved_prefer';
}

export interface ApplyRepairResponse {
  scenes: SceneListItem[];
  impact: ImpactReport;
  action_id: string;
  patch_queue_ids: string[];
}

// Story-Smart inputs
export interface BuildSpineInput {
  projectId: string;
  mode?: 'latest' | 'approved_prefer';
  force?: boolean;
}

export interface BuildThreadLedgerInput {
  projectId: string;
  mode?: 'latest' | 'approved_prefer';
  force?: boolean;
}

export interface TagSceneRolesInput {
  projectId: string;
  sceneId: string;
  versionId?: string;
  mode?: 'latest' | 'approved_prefer';
}

export interface TagAllSceneRolesInput {
  projectId: string;
  mode?: 'latest' | 'approved_prefer';
}

export interface NarrativeRepairInput {
  projectId: string;
  problem: NarrativeRepairProblem;
  mode?: 'latest' | 'approved_prefer';
}

export interface ApplyRepairOptionInput {
  projectId: string;
  option: NarrativeRepairOption;
  applyMode?: 'draft' | 'propose';
  mode?: 'latest' | 'approved_prefer';
}

// ── Phase 4 Types ──

export interface StoryMetricsRun {
  id: string;
  project_id: string;
  created_at: string;
  created_by: string | null;
  mode: string;
  source_snapshot_id: string | null;
  metrics: {
    act_balance_score?: number;
    escalation_curve_score?: number;
    conflict_density?: number;
    exposition_ratio?: number;
    character_focus_entropy?: number;
    thread_resolution_ratio?: number;
    setup_payoff_health?: number;
    continuity_risk_score?: number;
    coverage?: number;
    confidence?: number;
  };
  per_scene: Array<{
    scene_id: string;
    order_key: string;
    metrics: Record<string, number>;
  }>;
  charts: {
    tension_over_time?: Array<{ x: number; y: number }>;
    exposition_over_time?: Array<{ x: number; y: number }>;
    character_presence_over_time?: Array<{ character: string; data: Array<{ x: number; y: number }> }>;
    open_threads_over_time?: Array<{ x: number; y: number }>;
  };
  status: string;
}

export interface CoherenceFinding {
  id: string;
  project_id: string;
  run_id: string;
  created_at: string;
  severity: 'low' | 'med' | 'high';
  finding_type: 'canon_conflict' | 'character_conflict' | 'format_conflict' | 'market_conflict' | 'blueprint_conflict';
  title: string;
  detail: string;
  related_scene_ids: string[];
  related_doc_refs: Array<{ doc_type: string; document_id: string; version_id: string }>;
  suggested_repairs: FindingRepairSuggestion[];
  is_open: boolean;
}

export interface FindingRepairSuggestion {
  repair_kind: string;
  patch: Record<string, any>;
  rationale: string;
}

export interface CoherenceRun {
  id: string;
  project_id: string;
  created_at: string;
  created_by: string | null;
  mode: string;
  inputs: Record<string, any>;
  findings: any[];
  status: string;
}

// Phase 4 inputs
export interface MetricsRunInput {
  projectId: string;
  mode?: 'latest' | 'approved_prefer';
}

export interface MetricsGetLatestInput {
  projectId: string;
}

export interface CoherenceRunInput {
  projectId: string;
  mode?: 'latest' | 'approved_prefer';
  docSet?: { blueprint?: boolean; character_bible?: boolean; format_rules?: boolean; market_sheet?: boolean };
}

export interface CoherenceGetLatestInput {
  projectId: string;
}

export interface CoherenceCloseFindingInput {
  projectId: string;
  findingId: string;
  resolution?: { note: string; actionTaken?: string };
}

// ── Phase 5 Types ──

export interface ShotSet {
  id: string;
  project_id: string;
  scene_id: string;
  scene_version_id: string;
  created_at: string;
  created_by: string | null;
  mode: string;
  aspect_ratio: string;
  status: 'draft' | 'approved' | 'stale' | 'needs_review';
  notes: string | null;
  provenance: Record<string, any>;
}

export interface SceneShot {
  id: string;
  project_id: string;
  shot_set_id: string;
  scene_id: string;
  scene_version_id: string;
  order_key: string;
  shot_number: number | null;
  shot_type: string;
  coverage_role: string | null;
  framing: string | null;
  lens_mm: number | null;
  camera_support: string | null;
  camera_movement: string | null;
  angle: string | null;
  composition_notes: string | null;
  blocking_notes: string | null;
  emotional_intent: string | null;
  narrative_function: string | null;
  characters_in_frame: string[];
  props_required: string[];
  sfx_vfx_flags: Record<string, boolean>;
  est_duration_seconds: number | null;
  est_setup_complexity: number | null;
  lighting_style: string | null;
  location_hint: string | null;
  time_of_day_hint: string | null;
  status: 'draft' | 'approved' | 'stale' | 'needs_review';
  created_at: string;
}

export interface ShotVersion {
  id: string;
  project_id: string;
  shot_id: string;
  version_number: number;
  created_at: string;
  created_by: string | null;
  status: 'draft' | 'proposed' | 'approved' | 'superseded';
  supersedes_version_id: string | null;
  superseded_at: string | null;
  data: Record<string, any>;
}

export interface StoryboardFrame {
  id: string;
  project_id: string;
  scene_id: string;
  scene_version_id: string;
  shot_id: string;
  shot_version_id: string | null;
  frame_index: number;
  aspect_ratio: string;
  prompt: string;
  style_preset: string;
  image_url: string | null;
  thumb_url: string | null;
  notes: string | null;
  status: 'draft' | 'approved' | 'stale' | 'needs_review';
  is_stale: boolean;
  created_at: string;
}

export interface ProductionBreakdown {
  id: string;
  project_id: string;
  created_at: string;
  created_by: string | null;
  mode: string;
  source_snapshot_id: string | null;
  per_scene: Array<{
    scene_id: string;
    order_key: string;
    est_setup_count: number;
    est_time: number;
    complexity: number;
    cast: string[];
    locations: string[];
    day_night: string;
    flags: Record<string, boolean>;
  }>;
  totals: Record<string, any>;
  suggestions: Array<{
    type: string;
    rationale: string;
    payload: Record<string, any>;
  }>;
}

// Phase 5 inputs
export interface ShotsGenerateInput {
  projectId: string;
  sceneId: string;
  mode?: 'coverage' | 'cinematic' | 'efficiency';
  aspectRatio?: string;
  preferApprovedScene?: boolean;
}

export interface ShotsListInput {
  projectId: string;
  sceneId: string;
  sceneVersionId?: string;
  mode?: string;
}

export interface ShotsUpdateInput {
  projectId: string;
  shotId: string;
  patch: Record<string, any>;
  propose?: boolean;
}

export interface ShotsApproveVersionInput {
  projectId: string;
  shotVersionId: string;
}

export interface ShotsApproveShotSetInput {
  projectId: string;
  shotSetId: string;
}

export interface StoryboardGenerateInput {
  projectId: string;
  shotId: string;
  shotVersionId?: string;
  frameCount?: number;
  stylePreset?: string;
  aspectRatio?: string;
}

export interface StoryboardListInput {
  projectId: string;
  sceneId: string;
  sceneVersionId?: string;
}

export interface StoryboardApproveFrameInput {
  projectId: string;
  frameId: string;
}

export interface ProductionBreakdownInput {
  projectId: string;
  mode?: 'latest' | 'approved_prefer';
}

export interface ProductionGetLatestInput {
  projectId: string;
}

// ── Phase 4 Change Sets Types ──

export interface SceneChangeSet {
  id: string;
  project_id: string;
  created_at: string;
  created_by: string | null;
  title: string;
  description: string | null;
  goal_type: string | null;
  status: 'draft' | 'proposed' | 'applied' | 'rolled_back' | 'abandoned';
  base_snapshot_id: string | null;
  applied_snapshot_id: string | null;
  metadata: Record<string, any>;
  ops_count?: number;
}

export type ChangeSetOpType = 'insert' | 'remove' | 'move' | 'restore' | 'update_scene' | 'split' | 'merge' | 'rebalance' | 'apply_patch';

export interface SceneChangeSetOp {
  id: string;
  change_set_id: string;
  project_id: string;
  created_at: string;
  op_index: number;
  op_type: ChangeSetOpType;
  payload: Record<string, any>;
  inverse: Record<string, any>;
  status: 'pending' | 'executed' | 'failed' | 'reverted';
  error: string | null;
}

export interface SceneDiffRow {
  scene_id: string;
  before_version_id: string | null;
  after_version_id: string | null;
  change_type: 'added' | 'removed' | 'moved' | 'edited' | 'unchanged';
  before_excerpt: string | null;
  after_excerpt: string | null;
}

export interface SnapshotDiffSummary {
  added: number;
  removed: number;
  edited: number;
  moved: number;
  unchanged: number;
  impacted_scene_ids: string[];
}

export interface ChangeSetPreview {
  preview_snapshot_content: string;
  scene_diff: SceneDiffRow[];
  snapshot_diff: SnapshotDiffSummary;
}

// Change Set inputs
export interface ChangeSetCreateInput {
  projectId: string;
  title: string;
  description?: string;
  goal_type?: string;
  baseSnapshotMode?: 'latest' | 'approved_prefer';
}

export interface ChangeSetListInput {
  projectId: string;
  limit?: number;
}

export interface ChangeSetGetInput {
  projectId: string;
  changeSetId: string;
}

export interface ChangeSetAddOpInput {
  projectId: string;
  changeSetId: string;
  op: { op_type: ChangeSetOpType; payload: Record<string, any> };
}

export interface ChangeSetRemoveOpInput {
  projectId: string;
  changeSetId: string;
  opId: string;
}

export interface ChangeSetProposeInput {
  projectId: string;
  changeSetId: string;
}

export interface ChangeSetPreviewInput {
  projectId: string;
  changeSetId: string;
  previewMode?: 'simulate';
}

export interface ChangeSetApplyInput {
  projectId: string;
  changeSetId: string;
  applyMode?: 'draft' | 'propose';
}

export interface ChangeSetRollbackInput {
  projectId: string;
  changeSetId: string;
}

// ── Phase 5 Diff + Review + Comments Types ──

export interface DiffOp {
  t: 'eq' | 'ins' | 'del';
  text: string;
}

export interface DiffHunk {
  before_start: number;
  before_len: number;
  after_start: number;
  after_len: number;
  ops: DiffOp[];
}

export interface DiffStats {
  insertions: number;
  deletions: number;
  unchanged: number;
}

export interface SceneDiffArtifact {
  format: 'iffi_diff_v1';
  granularity: 'line' | 'word';
  before: { scene_id: string; version_id: string; text: string };
  after: { scene_id: string; version_id: string; text: string };
  hunks: DiffHunk[];
  stats: DiffStats;
}

export interface SnapshotDiffArtifactBlock {
  scene_id: string;
  change_type: 'added' | 'removed' | 'moved' | 'edited' | 'unchanged';
  before_version_id: string | null;
  after_version_id: string | null;
  before_excerpt: string | null;
  after_excerpt: string | null;
}

export interface SnapshotDiffArtifact {
  format: 'iffi_snapshot_diff_v1';
  before_snapshot_id: string | null;
  after_snapshot_id: string | null;
  scene_blocks: SnapshotDiffArtifactBlock[];
  stats: { added: number; removed: number; moved: number; edited: number; unchanged: number };
}

export interface ChangeSetReviewState {
  id: string;
  project_id: string;
  change_set_id: string;
  scene_id: string;
  before_version_id: string | null;
  after_version_id: string | null;
  decision: 'pending' | 'accepted' | 'rejected';
  decided_at: string | null;
  decided_by: string | null;
}

export interface DiffComment {
  id: string;
  project_id: string;
  change_set_id: string;
  scene_id: string | null;
  before_version_id: string | null;
  after_version_id: string | null;
  created_at: string;
  created_by: string | null;
  parent_id: string | null;
  status: 'open' | 'resolved';
  comment: string;
  children?: DiffComment[];
}

// Phase 5 Diff inputs
export interface ComputeDiffsInput {
  projectId: string;
  changeSetId: string;
  granularity?: 'line' | 'word';
}

export interface GetDiffsInput {
  projectId: string;
  changeSetId: string;
}

export interface GetSceneDiffInput {
  projectId: string;
  changeSetId: string;
  sceneId: string;
  beforeVersionId?: string;
  afterVersionId?: string;
}

export interface SetReviewDecisionInput {
  projectId: string;
  changeSetId: string;
  sceneId: string;
  beforeVersionId?: string;
  afterVersionId?: string;
  decision: 'accepted' | 'rejected' | 'pending';
}

export interface ApplyReviewDecisionsInput {
  projectId: string;
  changeSetId: string;
}

export interface AddDiffCommentInput {
  projectId: string;
  changeSetId: string;
  sceneId?: string;
  beforeVersionId?: string;
  afterVersionId?: string;
  parentId?: string;
  comment: string;
}

export interface ListDiffCommentsInput {
  projectId: string;
  changeSetId: string;
  sceneId?: string;
}

export interface ResolveDiffCommentInput {
  projectId: string;
  commentId: string;
  status: 'resolved' | 'open';
}

// ── Phase 6 QC Engine Types ──

export type QCPassType = 'continuity' | 'setup_payoff' | 'pacing' | 'arc' | 'tone';
export type QCIssueSeverity = 'low' | 'medium' | 'high' | 'critical';

export interface QCEvidenceItem {
  scene_id: string;
  excerpt: string;
  note: string;
}

export interface QCIssue {
  id: string;
  qc_run_id: string;
  project_id: string;
  created_at: string;
  category: QCPassType;
  severity: QCIssueSeverity;
  title: string;
  description: string;
  evidence: QCEvidenceItem[];
  related_scene_ids: string[];
  related_thread_ids: string[];
  status: 'open' | 'acknowledged' | 'fixed' | 'dismissed';
  linked_change_set_id: string | null;
}

export interface QCRun {
  id: string;
  project_id: string;
  created_at: string;
  created_by: string | null;
  snapshot_id: string;
  mode: string;
  summary: string | null;
  metadata: Record<string, any>;
}

export interface QCFixPlan {
  strategy: 'insert' | 'rewrite' | 'move' | 'split' | 'merge';
  target_scene_id: string | null;
  details: Record<string, any>;
  rationale: string;
}

// Phase 6 QC inputs

export interface QCRunInput {
  projectId: string;
  mode?: 'latest' | 'approved_prefer';
  passes?: QCPassType[];
  forceRebuildSpine?: boolean;
  forceRebuildLedger?: boolean;
}

export interface QCListRunsInput {
  projectId: string;
  limit?: number;
}

export interface QCListIssuesInput {
  projectId: string;
  qcRunId?: string;
  severity?: QCIssueSeverity;
  category?: QCPassType;
  status?: string;
}

export interface QCUpdateIssueStatusInput {
  projectId: string;
  issueId: string;
  status: 'open' | 'acknowledged' | 'fixed' | 'dismissed';
}

export interface QCGenerateFixInput {
  projectId: string;
  qcRunId: string;
  issueIds?: string[];
  goalLabel?: string;
}

// ── Phase 7 Pass Runner Types ──

export type PassType = 'dialogue_sharpen' | 'exposition_compress' | 'escalation_lift' | 'tone_consistency';

export interface PassSettings {
  preserveApproved?: boolean;
  maxScenesTouched?: number;
  includeActs?: number[] | null;
  excludeSceneIds?: string[] | null;
  intensity?: 'light' | 'medium' | 'strong';
  notes?: string | null;
}

export interface PassRun {
  id: string;
  project_id: string;
  created_at: string;
  created_by: string | null;
  snapshot_id: string;
  pass_type: PassType;
  mode: string;
  status: 'queued' | 'running' | 'completed' | 'failed';
  settings: PassSettings;
  summary: string | null;
  created_change_set_id: string | null;
  metadata: Record<string, any>;
}

export interface PassPatchPlan {
  scene_id: string;
  strategy: 'rewrite';
  patch: {
    content?: string;
    summary?: string;
    beats?: any[];
    scene_roles?: any[];
  };
  rationale: string;
  risks: string[];
}

export interface PassRunInput {
  projectId: string;
  passType: PassType;
  mode?: 'approved_prefer' | 'latest';
  settings?: PassSettings;
}

export interface PassListRunsInput {
  projectId: string;
  limit?: number;
}

export interface PassGetRunInput {
  projectId: string;
  passRunId: string;
}

// ── Canon OS Types ──

export interface CanonOSData {
  title?: string;
  format?: string;
  episode_count?: number | null;
  episode_length_seconds_min?: number | null;
  episode_length_seconds_max?: number | null;
  genre?: string | null;
  tone?: string | null;
  world_rules?: string[];
  characters?: Array<{
    id: string;
    name: string;
    description: string;
    traits: string[];
    relationships: Array<{ character_id: string; description: string }>;
  }>;
  locations?: Array<{ id: string; name: string; description: string }>;
  timeline_notes?: string[];
  forbidden_changes?: string[];
  [key: string]: unknown;
}

export interface CanonOSVersion {
  id: string;
  project_id: string;
  canon_json: CanonOSData;
  created_at: string;
  created_by: string | null;
  is_approved: boolean;
  approved_at: string | null;
  status: 'draft' | 'approved' | 'superseded';
  version_number: number;
  summary: string | null;
}

export interface CanonInitializeInput {
  projectId: string;
}

export interface CanonOSUpdateInput {
  projectId: string;
  patch: Partial<CanonOSData>;
}

export interface CanonApproveInput {
  projectId: string;
  canonId: string;
}

export interface CanonOSGetInput {
  projectId: string;
}

export interface ProjectRenameInput {
  projectId: string;
  newTitle: string;
}

export interface SetPrimaryDocumentInput {
  projectId: string;
  documentId: string;
  scope?: 'script';
}

export interface DocsBackfillDisplayNamesInput {
  projectId: string;
}
