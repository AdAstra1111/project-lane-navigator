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
