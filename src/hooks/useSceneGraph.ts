import { useState, useCallback } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import {
  sceneGraphExtract,
  sceneGraphList,
  sceneGraphInsert,
  sceneGraphRemove,
  sceneGraphMove,
  sceneGraphSplit,
  sceneGraphMerge,
  sceneGraphUpdate,
  sceneGraphApproveVersion,
  sceneGraphRebuildSnapshot,
  sceneGraphListInactive,
  sceneGraphRestore,
  sceneGraphUndo,
  sceneGraphListPatchQueue,
  sceneGraphAcceptPatch,
  sceneGraphRejectPatch,
  sceneGraphApplyPatch,
  sceneGraphRebalance,
  sceneGraphListActions,
  metricsRun,
  metricsGetLatest,
  coherenceRun,
  coherenceGetLatest,
  coherenceCloseFinding,
  buildStorySpine,
  buildThreadLedger,
  tagSceneRoles,
  tagAllSceneRoles,
  narrativeRepair,
  applyRepairOption,
} from '@/lib/scene-graph/client';
import type {
  SceneListItem,
  ImpactReport,
  ProjectSceneState,
  PatchQueueItem,
  SceneGraphAction,
  InactiveSceneItem,
  StoryMetricsRun,
  CoherenceRun,
  CoherenceFinding,
  StorySpineRecord,
  ThreadLedgerRecord,
  NarrativeRepairResponse,
} from '@/lib/scene-graph/types';

export function useSceneGraph(projectId: string | undefined) {
  const qc = useQueryClient();
  const [selectedSceneId, setSelectedSceneId] = useState<string | null>(null);
  const [lastImpact, setLastImpact] = useState<ImpactReport | null>(null);
  const [lastActionId, setLastActionId] = useState<string | null>(null);

  const invalidate = useCallback(() => {
    qc.invalidateQueries({ queryKey: ['scene-graph', projectId] });
    qc.invalidateQueries({ queryKey: ['scene-graph-state', projectId] });
    qc.invalidateQueries({ queryKey: ['scene-graph-inactive', projectId] });
    qc.invalidateQueries({ queryKey: ['scene-graph-patches', projectId] });
    qc.invalidateQueries({ queryKey: ['scene-graph-actions-list', projectId] });
  }, [qc, projectId]);

  // Check if project has scenes
  const stateQuery = useQuery({
    queryKey: ['scene-graph-state', projectId],
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from('project_script_scene_state')
        .select('*')
        .eq('project_id', projectId)
        .single();
      if (error) throw error;
      return data as ProjectSceneState;
    },
    enabled: !!projectId,
  });

  // List active scenes
  const scenesQuery = useQuery({
    queryKey: ['scene-graph', projectId],
    queryFn: async () => {
      if (!projectId) return [];
      const result = await sceneGraphList({ projectId });
      return result.scenes || [];
    },
    enabled: !!projectId && (stateQuery.data?.has_scenes ?? false),
  });

  // List inactive scenes
  const inactiveQuery = useQuery({
    queryKey: ['scene-graph-inactive', projectId],
    queryFn: async () => {
      if (!projectId) return [];
      const result = await sceneGraphListInactive({ projectId });
      return result.scenes || [];
    },
    enabled: !!projectId && (stateQuery.data?.has_scenes ?? false),
  });

  // List patch queue
  const patchQueueQuery = useQuery({
    queryKey: ['scene-graph-patches', projectId],
    queryFn: async () => {
      if (!projectId) return [];
      const result = await sceneGraphListPatchQueue({ projectId });
      return result.patches || [];
    },
    enabled: !!projectId && (stateQuery.data?.has_scenes ?? false),
  });

  // List recent actions
  const actionsQuery = useQuery({
    queryKey: ['scene-graph-actions-list', projectId],
    queryFn: async () => {
      if (!projectId) return [];
      const result = await sceneGraphListActions(projectId);
      return result.actions || [];
    },
    enabled: !!projectId && (stateQuery.data?.has_scenes ?? false),
  });

  // Phase 4: Metrics
  const metricsQuery = useQuery({
    queryKey: ['scene-graph-metrics', projectId],
    queryFn: async () => {
      if (!projectId) return null;
      const result = await metricsGetLatest({ projectId });
      return result.run || null;
    },
    enabled: !!projectId && (stateQuery.data?.has_scenes ?? false),
  });

  // Phase 4: Coherence
  const coherenceQuery = useQuery({
    queryKey: ['scene-graph-coherence', projectId],
    queryFn: async () => {
      if (!projectId) return { run: null, findings: [] };
      const result = await coherenceGetLatest({ projectId });
      return { run: result.run, findings: result.findings || [] };
    },
    enabled: !!projectId && (stateQuery.data?.has_scenes ?? false),
  });

  // Phase 3 Story-Smart: Spine
  const storySpineQuery = useQuery({
    queryKey: ['scene-graph-story-spine', projectId],
    queryFn: async () => {
      if (!projectId) return null;
      const { data } = await supabase.from('project_story_spines' as any)
        .select('*').eq('project_id', projectId)
        .order('created_at', { ascending: false }).limit(1).maybeSingle();
      return data || null;
    },
    enabled: !!projectId && (stateQuery.data?.has_scenes ?? false),
  });

  // Phase 3 Story-Smart: Thread Ledger
  const threadLedgerQuery = useQuery({
    queryKey: ['scene-graph-thread-ledger', projectId],
    queryFn: async () => {
      if (!projectId) return null;
      const { data } = await supabase.from('project_thread_ledgers' as any)
        .select('*').eq('project_id', projectId)
        .order('created_at', { ascending: false }).limit(1).maybeSingle();
      return data || null;
    },
    enabled: !!projectId && (stateQuery.data?.has_scenes ?? false),
  });

  const handleActionResult = (data: any) => {
    if (data.impact) setLastImpact(data.impact);
    if (data.action_id) setLastActionId(data.action_id);
    invalidate();
  };

  // Extract scenes from existing script
  const extractMutation = useMutation({
    mutationFn: async (params: { sourceDocumentId?: string; sourceVersionId?: string; text?: string }) => {
      if (!projectId) throw new Error('No project');
      return sceneGraphExtract({
        projectId,
        sourceDocumentId: params.sourceDocumentId,
        sourceVersionId: params.sourceVersionId,
        mode: params.text ? 'from_text' : 'from_script_doc',
        text: params.text,
      });
    },
    onSuccess: () => { invalidate(); toast.success('Scenes extracted successfully'); },
    onError: (e: Error) => toast.error(`Extract failed: ${e.message}`),
  });

  // Insert scene
  const insertMutation = useMutation({
    mutationFn: async (params: {
      position: { beforeSceneId?: string; afterSceneId?: string };
      intent?: { type: string; notes: string };
      sceneDraft?: { slugline?: string; content?: string; summary?: string };
    }) => {
      if (!projectId) throw new Error('No project');
      return sceneGraphInsert({ projectId, ...params });
    },
    onSuccess: (data) => { handleActionResult(data); toast.success('Scene inserted'); },
    onError: (e: Error) => toast.error(`Insert failed: ${e.message}`),
  });

  // Remove scene
  const removeMutation = useMutation({
    mutationFn: async (sceneId: string) => {
      if (!projectId) throw new Error('No project');
      return sceneGraphRemove({ projectId, sceneId });
    },
    onSuccess: (data) => { handleActionResult(data); toast.success('Scene removed'); },
    onError: (e: Error) => toast.error(`Remove failed: ${e.message}`),
  });

  // Move scene
  const moveMutation = useMutation({
    mutationFn: async (params: { sceneId: string; position: { beforeSceneId?: string; afterSceneId?: string } }) => {
      if (!projectId) throw new Error('No project');
      return sceneGraphMove({ projectId, ...params });
    },
    onSuccess: (data) => handleActionResult(data),
    onError: (e: Error) => toast.error(`Move failed: ${e.message}`),
  });

  // Split scene
  const splitMutation = useMutation({
    mutationFn: async (params: { sceneId: string; drafts?: { partA: string; partB: string } }) => {
      if (!projectId) throw new Error('No project');
      return sceneGraphSplit({ projectId, ...params });
    },
    onSuccess: (data) => { handleActionResult(data); toast.success('Scene split'); },
    onError: (e: Error) => toast.error(`Split failed: ${e.message}`),
  });

  // Merge scenes
  const mergeMutation = useMutation({
    mutationFn: async (params: { sceneIds: [string, string]; mergedDraft?: { content: string; slugline?: string } }) => {
      if (!projectId) throw new Error('No project');
      return sceneGraphMerge({ projectId, ...params });
    },
    onSuccess: (data) => { handleActionResult(data); toast.success('Scenes merged'); },
    onError: (e: Error) => toast.error(`Merge failed: ${e.message}`),
  });

  // Update scene (concurrency-safe)
  const updateMutation = useMutation({
    mutationFn: async (params: {
      sceneId: string;
      patch: { slugline?: string; content?: string; beats?: any[]; summary?: string; characters_present?: string[] };
      propose?: boolean;
    }) => {
      if (!projectId) throw new Error('No project');
      return sceneGraphUpdate({ projectId, ...params });
    },
    onSuccess: (data) => { handleActionResult(data); toast.success('Scene updated'); },
    onError: (e: Error) => toast.error(`Update failed: ${e.message}`),
  });

  // Approve version
  const approveMutation = useMutation({
    mutationFn: async (sceneVersionId: string) => {
      if (!projectId) throw new Error('No project');
      return sceneGraphApproveVersion({ projectId, sceneVersionId });
    },
    onSuccess: () => { invalidate(); toast.success('Version approved'); },
    onError: (e: Error) => toast.error(`Approve failed: ${e.message}`),
  });

  // Rebuild snapshot
  const rebuildMutation = useMutation({
    mutationFn: async (params?: { mode?: 'latest' | 'approved_prefer'; label?: string }) => {
      if (!projectId) throw new Error('No project');
      return sceneGraphRebuildSnapshot({ projectId, ...params });
    },
    onSuccess: () => { invalidate(); toast.success('Snapshot rebuilt'); },
    onError: (e: Error) => toast.error(`Rebuild failed: ${e.message}`),
  });

  // Restore inactive scene
  const restoreMutation = useMutation({
    mutationFn: async (params: { sceneId: string; position?: { beforeSceneId?: string; afterSceneId?: string } }) => {
      if (!projectId) throw new Error('No project');
      return sceneGraphRestore({ projectId, ...params });
    },
    onSuccess: (data) => { handleActionResult(data); toast.success('Scene restored'); },
    onError: (e: Error) => toast.error(`Restore failed: ${e.message}`),
  });

  // Undo action
  const undoMutation = useMutation({
    mutationFn: async (actionId: string) => {
      if (!projectId) throw new Error('No project');
      return sceneGraphUndo({ projectId, actionId });
    },
    onSuccess: () => { invalidate(); setLastActionId(null); toast.success('Action undone'); },
    onError: (e: Error) => toast.error(`Undo failed: ${e.message}`),
  });

  // Accept patch
  const acceptPatchMutation = useMutation({
    mutationFn: async (patchQueueId: string) => {
      if (!projectId) throw new Error('No project');
      return sceneGraphAcceptPatch({ projectId, patchQueueId });
    },
    onSuccess: () => { invalidate(); toast.success('Patch accepted'); },
    onError: (e: Error) => toast.error(`Accept failed: ${e.message}`),
  });

  // Reject patch
  const rejectPatchMutation = useMutation({
    mutationFn: async (patchQueueId: string) => {
      if (!projectId) throw new Error('No project');
      return sceneGraphRejectPatch({ projectId, patchQueueId });
    },
    onSuccess: () => { invalidate(); toast.success('Patch rejected'); },
    onError: (e: Error) => toast.error(`Reject failed: ${e.message}`),
  });

  // Apply patch
  const applyPatchMutation = useMutation({
    mutationFn: async (params: { patchQueueId: string; mode?: 'draft' | 'propose' }) => {
      if (!projectId) throw new Error('No project');
      return sceneGraphApplyPatch({ projectId, ...params });
    },
    onSuccess: (data) => { handleActionResult(data); toast.success('Patch applied'); },
    onError: (e: Error) => toast.error(`Apply failed: ${e.message}`),
  });

  // Rebalance order keys
  const rebalanceMutation = useMutation({
    mutationFn: async () => {
      if (!projectId) throw new Error('No project');
      return sceneGraphRebalance({ projectId });
    },
    onSuccess: () => { invalidate(); toast.success('Order keys rebalanced'); },
    onError: (e: Error) => toast.error(`Rebalance failed: ${e.message}`),
  });

  // Phase 4: Run metrics
  const runMetricsMutation = useMutation({
    mutationFn: async (params: { mode?: 'latest' | 'approved_prefer' } | void) => {
      if (!projectId) throw new Error('No project');
      return metricsRun({ projectId, ...(params || {}) });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['scene-graph-metrics', projectId] });
      toast.success('Diagnostics complete');
    },
    onError: (e: Error) => toast.error(`Metrics failed: ${e.message}`),
  });

  // Phase 4: Run coherence
  const runCoherenceMutation = useMutation({
    mutationFn: async (params: { mode?: 'latest' | 'approved_prefer'; docSet?: any } | void) => {
      if (!projectId) throw new Error('No project');
      return coherenceRun({ projectId, ...(params || {}) });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['scene-graph-coherence', projectId] });
      invalidate(); // Also refresh patches
      toast.success('Coherence check complete');
    },
    onError: (e: Error) => toast.error(`Coherence failed: ${e.message}`),
  });

  // Phase 4: Close finding
  const closeCoherenceFindingMutation = useMutation({
    mutationFn: async (params: { findingId: string; resolution?: { note: string; actionTaken?: string } }) => {
      if (!projectId) throw new Error('No project');
      return coherenceCloseFinding({ projectId, ...params });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['scene-graph-coherence', projectId] });
      toast.success('Finding resolved');
    },
    onError: (e: Error) => toast.error(`Close failed: ${e.message}`),
  });

  // Phase 3 Story-Smart mutations
  const buildSpineMutation = useMutation({
    mutationFn: async (params?: { mode?: 'latest' | 'approved_prefer'; force?: boolean }) => {
      if (!projectId) throw new Error('No project');
      return buildStorySpine({ projectId, ...(params || {}) });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['scene-graph-story-spine', projectId] });
      toast.success('Story spine built');
    },
    onError: (e: Error) => toast.error(`Spine failed: ${e.message}`),
  });

  const buildLedgerMutation = useMutation({
    mutationFn: async (params?: { mode?: 'latest' | 'approved_prefer'; force?: boolean }) => {
      if (!projectId) throw new Error('No project');
      return buildThreadLedger({ projectId, ...(params || {}) });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['scene-graph-thread-ledger', projectId] });
      toast.success('Thread ledger built');
    },
    onError: (e: Error) => toast.error(`Ledger failed: ${e.message}`),
  });

  const tagRolesMutation = useMutation({
    mutationFn: async (params: { sceneId: string; versionId?: string }) => {
      if (!projectId) throw new Error('No project');
      return tagSceneRoles({ projectId, ...params });
    },
    onSuccess: () => { invalidate(); toast.success('Scene roles tagged'); },
    onError: (e: Error) => toast.error(`Tag failed: ${e.message}`),
  });

  const tagAllRolesMutation = useMutation({
    mutationFn: async () => {
      if (!projectId) throw new Error('No project');
      return tagAllSceneRoles({ projectId });
    },
    onSuccess: () => { invalidate(); toast.success('All scenes tagged'); },
    onError: (e: Error) => toast.error(`Tag all failed: ${e.message}`),
  });

  const narrativeRepairMutation = useMutation({
    mutationFn: async (params: { problem: any; mode?: 'latest' | 'approved_prefer' }) => {
      if (!projectId) throw new Error('No project');
      return narrativeRepair({ projectId, ...params });
    },
    onError: (e: Error) => toast.error(`Repair failed: ${e.message}`),
  });

  const applyRepairMutation = useMutation({
    mutationFn: async (params: { option: any; applyMode?: 'draft' | 'propose' }) => {
      if (!projectId) throw new Error('No project');
      return applyRepairOption({ projectId, ...params });
    },
    onSuccess: (data) => { handleActionResult(data); invalidate(); toast.success('Repair option queued'); },
    onError: (e: Error) => toast.error(`Apply repair failed: ${e.message}`),
  });

  return {
    // State
    projectState: stateQuery.data,
    scenes: (scenesQuery.data || []) as SceneListItem[],
    inactiveScenes: (inactiveQuery.data || []) as InactiveSceneItem[],
    patchQueue: (patchQueueQuery.data || []) as PatchQueueItem[],
    recentActions: (actionsQuery.data || []) as SceneGraphAction[],
    isLoading: stateQuery.isLoading || scenesQuery.isLoading,
    selectedSceneId,
    setSelectedSceneId,
    lastImpact,
    setLastImpact,
    lastActionId,

    // Phase 3 Story-Smart state
    storySpine: storySpineQuery.data as StorySpineRecord | null,
    threadLedger: threadLedgerQuery.data as ThreadLedgerRecord | null,
    isSpineLoading: storySpineQuery.isLoading,
    isLedgerLoading: threadLedgerQuery.isLoading,

    // Phase 4 state
    latestMetrics: metricsQuery.data as StoryMetricsRun | null,
    coherenceData: coherenceQuery.data as { run: CoherenceRun | null; findings: CoherenceFinding[] },
    isMetricsLoading: metricsQuery.isLoading,
    isCoherenceLoading: coherenceQuery.isLoading,

    // Phase 1 Mutations
    extract: extractMutation,
    insert: insertMutation,
    remove: removeMutation,
    move: moveMutation,
    split: splitMutation,
    merge: mergeMutation,
    update: updateMutation,
    approve: approveMutation,
    rebuild: rebuildMutation,

    // Phase 2 Mutations
    restore: restoreMutation,
    undo: undoMutation,
    acceptPatch: acceptPatchMutation,
    rejectPatch: rejectPatchMutation,
    applyPatch: applyPatchMutation,
    rebalance: rebalanceMutation,

    // Phase 3 Story-Smart Mutations
    buildSpine: buildSpineMutation,
    buildLedger: buildLedgerMutation,
    tagRoles: tagRolesMutation,
    tagAllRoles: tagAllRolesMutation,
    narrativeRepairSuggest: narrativeRepairMutation,
    applyRepair: applyRepairMutation,

    // Phase 4 Mutations
    runMetrics: runMetricsMutation,
    runCoherence: runCoherenceMutation,
    closeCoherenceFinding: closeCoherenceFindingMutation,
  };
}
