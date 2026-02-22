// ============================================================
// IFFY Scene Graph — API Client wrappers
// ============================================================

import { supabase } from '@/integrations/supabase/client';
import type {
  SceneGraphExtractInput,
  SceneGraphListInput,
  SceneGraphInsertInput,
  SceneGraphRemoveInput,
  SceneGraphMoveInput,
  SceneGraphSplitInput,
  SceneGraphMergeInput,
  SceneGraphUpdateInput,
  SceneGraphApproveInput,
  SceneGraphRebuildSnapshotInput,
  SceneGraphListInactiveInput,
  SceneGraphRestoreInput,
  SceneGraphUndoInput,
  SceneGraphApplyPatchInput,
  SceneGraphPatchStatusInput,
  SceneGraphRebalanceInput,
  SceneGraphListPatchQueueInput,
  SceneListItem,
  InactiveSceneItem,
  ImpactReport,
  ScriptSnapshot,
  SceneGraphAction,
  PatchQueueItem,
  // Phase 3
  SpineRebuildInput,
  SpineGetCurrentInput,
  CanonListInput,
  CanonOverrideUpsertInput,
  NarrativeRepairSuggestInput,
  NarrativeRepairQueueOptionInput,
  ProjectSpine,
  CanonFact,
  NarrativeRepairOption,
  // Phase 3 Story-Smart
  BuildSpineInput,
  BuildThreadLedgerInput,
  TagSceneRolesInput,
  TagAllSceneRolesInput,
  NarrativeRepairInput,
  ApplyRepairOptionInput,
  StorySpineRecord,
  ThreadLedgerRecord,
  NarrativeRepairResponse,
  ApplyRepairResponse,
  // Phase 4
  MetricsRunInput,
  MetricsGetLatestInput,
  CoherenceRunInput,
  CoherenceGetLatestInput,
  CoherenceCloseFindingInput,
  StoryMetricsRun,
  CoherenceRun,
  CoherenceFinding,
  // Phase 5
  ShotsGenerateInput,
  ShotsListInput,
  ShotsUpdateInput,
  ShotsApproveVersionInput,
  ShotsApproveShotSetInput,
  StoryboardGenerateInput,
  StoryboardListInput,
  StoryboardApproveFrameInput,
  ProductionBreakdownInput,
  ProductionGetLatestInput,
  ShotSet,
  SceneShot,
  ShotVersion,
  StoryboardFrame,
  ProductionBreakdown,
  // Phase 4 Change Sets
  ChangeSetCreateInput,
  ChangeSetListInput,
  ChangeSetGetInput,
  ChangeSetAddOpInput,
  ChangeSetRemoveOpInput,
  ChangeSetProposeInput,
  ChangeSetPreviewInput,
  ChangeSetApplyInput,
  ChangeSetRollbackInput,
  SceneChangeSet,
  SceneChangeSetOp,
  ChangeSetPreview,
  // Phase 5 Diff + Review + Comments
  ComputeDiffsInput,
  GetDiffsInput,
  GetSceneDiffInput,
  SetReviewDecisionInput,
  ApplyReviewDecisionsInput,
  AddDiffCommentInput,
  ListDiffCommentsInput,
  ResolveDiffCommentInput,
  SceneDiffArtifact,
  SnapshotDiffArtifact,
  ChangeSetReviewState,
  DiffComment,
  // Phase 6 QC
  QCRunInput,
  QCListRunsInput,
  QCListIssuesInput,
  QCUpdateIssueStatusInput,
  QCGenerateFixInput,
  QCRun,
  // Phase 7 Passes
  PassRunInput,
  PassListRunsInput,
  PassGetRunInput,
  PassRun,
  QCIssue,
  // Canon OS
  CanonInitializeInput,
  CanonOSUpdateInput,
  CanonApproveInput,
  CanonOSGetInput,
  CanonOSVersion,
  ProjectRenameInput,
  SetPrimaryDocumentInput,
  DocsBackfillDisplayNamesInput,
} from './types';

async function callSceneGraph<T = any>(action: string, payload: Record<string, any>): Promise<T> {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) throw new Error('Not authenticated');

  const resp = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/dev-engine-v2`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${session.access_token}`,
    },
    body: JSON.stringify({ action, ...payload }),
  });

  const text = await resp.text();
  if (!text || text.trim().length === 0) throw new Error('Empty response from engine');

  let result: any;
  try {
    result = JSON.parse(text);
  } catch {
    const lastBrace = text.lastIndexOf('}');
    if (lastBrace > 0) {
      try { result = JSON.parse(text.substring(0, lastBrace + 1)); } catch {
        throw new Error('Invalid response from engine');
      }
    } else throw new Error('Invalid response from engine');
  }

  if (resp.status === 402) throw new Error('AI credits exhausted. Please add funds to your workspace under Settings → Usage.');
  if (resp.status === 429) throw new Error('Rate limit reached. Please try again in a moment.');
  if (!resp.ok) throw new Error(result.error || 'Engine error');
  return result as T;
}

export async function sceneGraphExtract(input: SceneGraphExtractInput) {
  return callSceneGraph<{ scenes: SceneListItem[]; snapshotId: string; content: string }>('scene_graph_extract', input);
}

export async function sceneGraphList(input: SceneGraphListInput) {
  return callSceneGraph<{ scenes: SceneListItem[] }>('scene_graph_list', input);
}

export async function sceneGraphInsert(input: SceneGraphInsertInput) {
  return callSceneGraph<{ scene: SceneListItem; impact: ImpactReport; action_id: string }>('scene_graph_insert_scene', input);
}

export async function sceneGraphRemove(input: SceneGraphRemoveInput) {
  return callSceneGraph<{ impact: ImpactReport; action_id: string }>('scene_graph_remove_scene', input);
}

export async function sceneGraphMove(input: SceneGraphMoveInput) {
  return callSceneGraph<{ impact: ImpactReport; action_id: string }>('scene_graph_move_scene', input);
}

export async function sceneGraphSplit(input: SceneGraphSplitInput) {
  return callSceneGraph<{ sceneA: SceneListItem; sceneB: SceneListItem; impact: ImpactReport; action_id: string }>('scene_graph_split_scene', input);
}

export async function sceneGraphMerge(input: SceneGraphMergeInput) {
  return callSceneGraph<{ mergedScene: SceneListItem; impact: ImpactReport; action_id: string }>('scene_graph_merge_scenes', input);
}

export async function sceneGraphUpdate(input: SceneGraphUpdateInput) {
  return callSceneGraph<{ version: any; action_id: string }>('scene_graph_update_scene', input);
}

export async function sceneGraphApproveVersion(input: SceneGraphApproveInput) {
  return callSceneGraph<{ version: any }>('scene_graph_approve_scene_version', input);
}

export async function sceneGraphRebuildSnapshot(input: SceneGraphRebuildSnapshotInput) {
  return callSceneGraph<{ snapshot: ScriptSnapshot }>('scene_graph_rebuild_snapshot', input);
}

// Phase 2 actions

export async function sceneGraphListInactive(input: SceneGraphListInactiveInput) {
  return callSceneGraph<{ scenes: InactiveSceneItem[] }>('scene_graph_list_inactive', input);
}

export async function sceneGraphRestore(input: SceneGraphRestoreInput) {
  return callSceneGraph<{ impact: ImpactReport; action_id: string }>('scene_graph_restore_scene', input);
}

export async function sceneGraphUndo(input: SceneGraphUndoInput) {
  return callSceneGraph<{ impact: ImpactReport; scenes: SceneListItem[] }>('scene_graph_undo', input);
}

export async function sceneGraphListPatchQueue(input: SceneGraphListPatchQueueInput) {
  return callSceneGraph<{ patches: PatchQueueItem[] }>('scene_graph_list_patch_queue', input);
}

export async function sceneGraphAcceptPatch(input: SceneGraphPatchStatusInput) {
  return callSceneGraph<{ patch: PatchQueueItem }>('scene_graph_accept_patch_suggestion', input);
}

export async function sceneGraphRejectPatch(input: SceneGraphPatchStatusInput) {
  return callSceneGraph<{ patch: PatchQueueItem }>('scene_graph_reject_patch_suggestion', input);
}

export async function sceneGraphApplyPatch(input: SceneGraphApplyPatchInput) {
  return callSceneGraph<{ version: any; patch: PatchQueueItem; action_id: string }>('scene_graph_apply_patch_suggestion', input);
}

export async function sceneGraphRebalance(input: SceneGraphRebalanceInput) {
  return callSceneGraph<{ action_id: string }>('scene_graph_rebalance_order_keys', input);
}

export async function sceneGraphListActions(projectId: string) {
  return callSceneGraph<{ actions: SceneGraphAction[] }>('scene_graph_list_actions', { projectId });
}

// Phase 3 actions

export async function spineRebuild(input: SpineRebuildInput) {
  return callSceneGraph<{ spineId: string; spine: any; stats: any; canonStats: any }>('spine_rebuild', input);
}

export async function spineGetCurrent(input: SpineGetCurrentInput) {
  return callSceneGraph<{ spine: ProjectSpine | null }>('spine_get_current', input);
}

export async function canonList(input: CanonListInput) {
  return callSceneGraph<{ facts: CanonFact[]; overrides_count: number }>('canon_list', input);
}

export async function canonOverrideUpsert(input: CanonOverrideUpsertInput) {
  return callSceneGraph<{ facts: CanonFact[]; spine_summary: any }>('canon_override_upsert', input);
}

export async function narrativeRepairSuggest(input: NarrativeRepairSuggestInput) {
  return callSceneGraph<{ options: NarrativeRepairOption[] }>('narrative_repair_suggest', input);
}

export async function narrativeRepairQueueOption(input: NarrativeRepairQueueOptionInput) {
  return callSceneGraph<{ queued_items: PatchQueueItem[] }>('narrative_repair_queue_option', input);
}

// Phase 3 Story-Smart actions

export async function buildStorySpine(input: BuildSpineInput) {
  return callSceneGraph<{ spine: StorySpineRecord; summary: string }>('scene_graph_build_spine', input);
}

export async function buildThreadLedger(input: BuildThreadLedgerInput) {
  return callSceneGraph<{ ledger: ThreadLedgerRecord; summary: string }>('scene_graph_build_thread_ledger', input);
}

export async function tagSceneRoles(input: TagSceneRolesInput) {
  return callSceneGraph<{ version: any }>('scene_graph_tag_scene_roles', input);
}

export async function tagAllSceneRoles(input: TagAllSceneRolesInput) {
  return callSceneGraph<{ tagged_count: number; skipped_count: number }>('scene_graph_tag_all_scene_roles', input);
}

export async function narrativeRepair(input: NarrativeRepairInput) {
  return callSceneGraph<NarrativeRepairResponse>('scene_graph_narrative_repair', input);
}

export async function applyRepairOption(input: ApplyRepairOptionInput) {
  return callSceneGraph<ApplyRepairResponse>('scene_graph_apply_repair_option', input);
}

// Phase 4 actions

export async function metricsRun(input: MetricsRunInput) {
  return callSceneGraph<{ runId: string; metrics: StoryMetricsRun['metrics']; charts: StoryMetricsRun['charts'] }>('metrics_run', input);
}

export async function metricsGetLatest(input: MetricsGetLatestInput) {
  return callSceneGraph<{ run: StoryMetricsRun | null }>('metrics_get_latest', input);
}

export async function coherenceRun(input: CoherenceRunInput) {
  return callSceneGraph<{ runId: string; findings: CoherenceFinding[] }>('coherence_run', input);
}

export async function coherenceGetLatest(input: CoherenceGetLatestInput) {
  return callSceneGraph<{ run: CoherenceRun | null; findings: CoherenceFinding[] }>('coherence_get_latest', input);
}

export async function coherenceCloseFinding(input: CoherenceCloseFindingInput) {
  return callSceneGraph<{ finding: CoherenceFinding }>('coherence_close_finding', input);
}

// Phase 5 actions

export async function shotsGenerateForScene(input: ShotsGenerateInput) {
  return callSceneGraph<{ shot_set: ShotSet; shots: SceneShot[]; versions: ShotVersion[] }>('shots_generate_for_scene', input);
}

export async function shotsListForScene(input: ShotsListInput) {
  return callSceneGraph<{ shot_sets: ShotSet[]; shots: SceneShot[]; stale_sets: ShotSet[] }>('shots_list_for_scene', input);
}

export async function shotsUpdateShot(input: ShotsUpdateInput) {
  return callSceneGraph<{ version: ShotVersion }>('shots_update_shot', input);
}

export async function shotsApproveShotVersion(input: ShotsApproveVersionInput) {
  return callSceneGraph<{ version: ShotVersion }>('shots_approve_shot_version', input);
}

export async function shotsApproveShotSet(input: ShotsApproveShotSetInput) {
  return callSceneGraph<{ shot_set: ShotSet }>('shots_approve_shot_set', input);
}

export async function storyboardGenerateFrames(input: StoryboardGenerateInput) {
  return callSceneGraph<{ frames: StoryboardFrame[] }>('storyboard_generate_frames', input);
}

export async function storyboardListForScene(input: StoryboardListInput) {
  return callSceneGraph<{ frames: StoryboardFrame[] }>('storyboard_list_for_scene', input);
}

export async function storyboardApproveFrame(input: StoryboardApproveFrameInput) {
  return callSceneGraph<{ frame: StoryboardFrame }>('storyboard_approve_frame', input);
}

export async function productionComputeBreakdown(input: ProductionBreakdownInput) {
  return callSceneGraph<{ breakdown: ProductionBreakdown }>('production_compute_breakdown', input);
}

export async function productionGetLatest(input: ProductionGetLatestInput) {
  return callSceneGraph<{ breakdown: ProductionBreakdown | null }>('production_get_latest', input);
}

// Phase 4 Change Set actions

export async function changeSetCreate(input: ChangeSetCreateInput) {
  return callSceneGraph<{ change_set: SceneChangeSet }>('change_set_create', input);
}

export async function changeSetList(input: ChangeSetListInput) {
  return callSceneGraph<{ change_sets: SceneChangeSet[] }>('change_set_list', input);
}

export async function changeSetGet(input: ChangeSetGetInput) {
  return callSceneGraph<{ change_set: SceneChangeSet; ops: SceneChangeSetOp[] }>('change_set_get', input);
}

export async function changeSetAddOp(input: ChangeSetAddOpInput) {
  return callSceneGraph<{ ops: SceneChangeSetOp[] }>('change_set_add_op', input);
}

export async function changeSetRemoveOp(input: ChangeSetRemoveOpInput) {
  return callSceneGraph<{ ops: SceneChangeSetOp[] }>('change_set_remove_op', input);
}

export async function changeSetPropose(input: ChangeSetProposeInput) {
  return callSceneGraph<{ change_set: SceneChangeSet }>('change_set_propose', input);
}

export async function changeSetPreview(input: ChangeSetPreviewInput) {
  return callSceneGraph<ChangeSetPreview>('change_set_preview', input);
}

export async function changeSetApply(input: ChangeSetApplyInput) {
  return callSceneGraph<{ change_set: SceneChangeSet; snapshot: any; impact: any; ops: SceneChangeSetOp[] }>('change_set_apply', input);
}

export async function changeSetRollback(input: ChangeSetRollbackInput) {
  return callSceneGraph<{ change_set: SceneChangeSet; snapshot: any }>('change_set_rollback', input);
}

// Phase 5 Diff + Review + Comments actions

export async function changeSetComputeDiffs(input: ComputeDiffsInput) {
  return callSceneGraph<{ artifact_ids: string[]; stats: any }>('change_set_compute_diffs', input);
}

export async function changeSetGetDiffs(input: GetDiffsInput) {
  return callSceneGraph<{ snapshot_diff: SnapshotDiffArtifact | null; scene_diffs: Array<{ scene_id: string; before_version_id: string | null; after_version_id: string | null; stats: any }> }>('change_set_get_diffs', input);
}

export async function changeSetGetSceneDiff(input: GetSceneDiffInput) {
  return callSceneGraph<{ artifact: SceneDiffArtifact | null }>('change_set_get_scene_diff', input);
}

export async function changeSetSetReviewDecision(input: SetReviewDecisionInput) {
  return callSceneGraph<{ review: ChangeSetReviewState }>('change_set_set_review_decision', input);
}

export async function changeSetApplyReviewDecisions(input: ApplyReviewDecisionsInput) {
  return callSceneGraph<{ ops: SceneChangeSetOp[] }>('change_set_apply_review_decisions', input);
}

export async function changeSetAddComment(input: AddDiffCommentInput) {
  return callSceneGraph<{ comment: DiffComment; thread: DiffComment[] }>('change_set_add_comment', input);
}

export async function changeSetListComments(input: ListDiffCommentsInput) {
  return callSceneGraph<{ comments: DiffComment[] }>('change_set_list_comments', input);
}

export async function changeSetResolveComment(input: ResolveDiffCommentInput) {
  return callSceneGraph<{ comment: DiffComment }>('change_set_resolve_comment', input);
}

// Phase 6 QC Engine actions

export async function qcRun(input: QCRunInput) {
  return callSceneGraph<{ qc_run_id: string; summary: { low: number; medium: number; high: number; critical: number; total: number } }>('qc_run', input);
}

export async function qcListRuns(input: QCListRunsInput) {
  return callSceneGraph<{ runs: QCRun[] }>('qc_list_runs', input);
}

export async function qcListIssues(input: QCListIssuesInput) {
  return callSceneGraph<{ issues: QCIssue[] }>('qc_list_issues', input);
}

export async function qcUpdateIssueStatus(input: QCUpdateIssueStatusInput) {
  return callSceneGraph<{ issue: QCIssue }>('qc_update_issue_status', input);
}

export async function qcGenerateFixChangeSet(input: QCGenerateFixInput) {
  return callSceneGraph<{ change_set_id: string }>('qc_generate_fix_change_set', input);
}

// Phase 7 Pass Runner actions

export async function runPass(input: PassRunInput) {
  return callSceneGraph<{ pass_run: PassRun; change_set_id: string; selected_scenes: string[] }>('pass_run', input);
}

export async function listPassRuns(input: PassListRunsInput) {
  return callSceneGraph<{ runs: PassRun[] }>('pass_list_runs', input);
}

export async function getPassRun(input: PassGetRunInput) {
  return callSceneGraph<{ run: PassRun; selected_scenes: any[] }>('pass_get_run', input);
}

// Canon OS actions

export async function canonInitialize(input: CanonInitializeInput) {
  return callSceneGraph<{ canon: CanonOSVersion }>('canon_os_initialize', input);
}

export async function canonOSUpdate(input: CanonOSUpdateInput) {
  return callSceneGraph<{ canon: CanonOSVersion }>('canon_os_update', input);
}

export async function canonApprove(input: CanonApproveInput) {
  return callSceneGraph<{ canon: CanonOSVersion }>('canon_os_approve', input);
}

export async function canonOSGet(input: CanonOSGetInput) {
  return callSceneGraph<{ canon: CanonOSVersion | null }>('canon_os_get', input);
}

export async function projectRename(input: ProjectRenameInput) {
  return callSceneGraph<{ success: boolean; updated_documents: number }>('project_rename', input);
}

export async function setPrimaryDocument(input: SetPrimaryDocumentInput) {
  return callSceneGraph<{ success: boolean }>('set_primary_document', input);
}

export async function docsBackfillDisplayNames(input: DocsBackfillDisplayNamesInput) {
  return callSceneGraph<{ success: boolean; updated: number }>('docs_backfill_display_names', input);
}
