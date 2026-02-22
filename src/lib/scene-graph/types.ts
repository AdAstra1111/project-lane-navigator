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

export interface ProjectSceneState {
  project_id: string;
  has_scenes: boolean;
  active_scene_count: number;
  latest_snapshot_id: string | null;
  latest_snapshot_status: string | null;
}
