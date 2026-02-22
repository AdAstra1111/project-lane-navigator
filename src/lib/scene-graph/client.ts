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
  SceneListItem,
  ImpactReport,
  ScriptSnapshot,
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
  return callSceneGraph<{ scene: SceneListItem; impact: ImpactReport }>('scene_graph_insert_scene', input);
}

export async function sceneGraphRemove(input: SceneGraphRemoveInput) {
  return callSceneGraph<{ impact: ImpactReport }>('scene_graph_remove_scene', input);
}

export async function sceneGraphMove(input: SceneGraphMoveInput) {
  return callSceneGraph<{ impact: ImpactReport }>('scene_graph_move_scene', input);
}

export async function sceneGraphSplit(input: SceneGraphSplitInput) {
  return callSceneGraph<{ sceneA: SceneListItem; sceneB: SceneListItem; impact: ImpactReport }>('scene_graph_split_scene', input);
}

export async function sceneGraphMerge(input: SceneGraphMergeInput) {
  return callSceneGraph<{ mergedScene: SceneListItem; impact: ImpactReport }>('scene_graph_merge_scenes', input);
}

export async function sceneGraphUpdate(input: SceneGraphUpdateInput) {
  return callSceneGraph<{ version: any }>('scene_graph_update_scene', input);
}

export async function sceneGraphApproveVersion(input: SceneGraphApproveInput) {
  return callSceneGraph<{ version: any }>('scene_graph_approve_scene_version', input);
}

export async function sceneGraphRebuildSnapshot(input: SceneGraphRebuildSnapshotInput) {
  return callSceneGraph<{ snapshot: ScriptSnapshot }>('scene_graph_rebuild_snapshot', input);
}
