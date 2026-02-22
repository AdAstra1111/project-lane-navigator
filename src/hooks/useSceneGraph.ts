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
} from '@/lib/scene-graph/client';
import type {
  SceneListItem,
  ImpactReport,
  ProjectSceneState,
} from '@/lib/scene-graph/types';

export function useSceneGraph(projectId: string | undefined) {
  const qc = useQueryClient();
  const [selectedSceneId, setSelectedSceneId] = useState<string | null>(null);
  const [lastImpact, setLastImpact] = useState<ImpactReport | null>(null);

  const invalidate = useCallback(() => {
    qc.invalidateQueries({ queryKey: ['scene-graph', projectId] });
    qc.invalidateQueries({ queryKey: ['scene-graph-state', projectId] });
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

  // List scenes
  const scenesQuery = useQuery({
    queryKey: ['scene-graph', projectId],
    queryFn: async () => {
      if (!projectId) return [];
      const result = await sceneGraphList({ projectId });
      return result.scenes || [];
    },
    enabled: !!projectId && (stateQuery.data?.has_scenes ?? false),
  });

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
    onSuccess: () => {
      invalidate();
      toast.success('Scenes extracted successfully');
    },
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
    onSuccess: (data) => {
      invalidate();
      setLastImpact(data.impact);
      toast.success('Scene inserted');
    },
    onError: (e: Error) => toast.error(`Insert failed: ${e.message}`),
  });

  // Remove scene
  const removeMutation = useMutation({
    mutationFn: async (sceneId: string) => {
      if (!projectId) throw new Error('No project');
      return sceneGraphRemove({ projectId, sceneId });
    },
    onSuccess: (data) => {
      invalidate();
      setLastImpact(data.impact);
      toast.success('Scene removed');
    },
    onError: (e: Error) => toast.error(`Remove failed: ${e.message}`),
  });

  // Move scene
  const moveMutation = useMutation({
    mutationFn: async (params: { sceneId: string; position: { beforeSceneId?: string; afterSceneId?: string } }) => {
      if (!projectId) throw new Error('No project');
      return sceneGraphMove({ projectId, ...params });
    },
    onSuccess: (data) => {
      invalidate();
      setLastImpact(data.impact);
    },
    onError: (e: Error) => toast.error(`Move failed: ${e.message}`),
  });

  // Split scene
  const splitMutation = useMutation({
    mutationFn: async (params: { sceneId: string; drafts?: { partA: string; partB: string } }) => {
      if (!projectId) throw new Error('No project');
      return sceneGraphSplit({ projectId, ...params });
    },
    onSuccess: (data) => {
      invalidate();
      setLastImpact(data.impact);
      toast.success('Scene split');
    },
    onError: (e: Error) => toast.error(`Split failed: ${e.message}`),
  });

  // Merge scenes
  const mergeMutation = useMutation({
    mutationFn: async (params: { sceneIds: [string, string]; mergedDraft?: { content: string; slugline?: string } }) => {
      if (!projectId) throw new Error('No project');
      return sceneGraphMerge({ projectId, ...params });
    },
    onSuccess: (data) => {
      invalidate();
      setLastImpact(data.impact);
      toast.success('Scenes merged');
    },
    onError: (e: Error) => toast.error(`Merge failed: ${e.message}`),
  });

  // Update scene
  const updateMutation = useMutation({
    mutationFn: async (params: {
      sceneId: string;
      patch: { slugline?: string; content?: string; beats?: any[]; summary?: string; characters_present?: string[] };
      propose?: boolean;
    }) => {
      if (!projectId) throw new Error('No project');
      return sceneGraphUpdate({ projectId, ...params });
    },
    onSuccess: () => {
      invalidate();
      toast.success('Scene updated');
    },
    onError: (e: Error) => toast.error(`Update failed: ${e.message}`),
  });

  // Approve version
  const approveMutation = useMutation({
    mutationFn: async (sceneVersionId: string) => {
      if (!projectId) throw new Error('No project');
      return sceneGraphApproveVersion({ projectId, sceneVersionId });
    },
    onSuccess: () => {
      invalidate();
      toast.success('Version approved');
    },
    onError: (e: Error) => toast.error(`Approve failed: ${e.message}`),
  });

  // Rebuild snapshot
  const rebuildMutation = useMutation({
    mutationFn: async (params?: { mode?: 'latest' | 'approved_prefer'; label?: string }) => {
      if (!projectId) throw new Error('No project');
      return sceneGraphRebuildSnapshot({ projectId, ...params });
    },
    onSuccess: () => {
      invalidate();
      toast.success('Snapshot rebuilt');
    },
    onError: (e: Error) => toast.error(`Rebuild failed: ${e.message}`),
  });

  return {
    // State
    projectState: stateQuery.data,
    scenes: (scenesQuery.data || []) as SceneListItem[],
    isLoading: stateQuery.isLoading || scenesQuery.isLoading,
    selectedSceneId,
    setSelectedSceneId,
    lastImpact,
    setLastImpact,

    // Mutations
    extract: extractMutation,
    insert: insertMutation,
    remove: removeMutation,
    move: moveMutation,
    split: splitMutation,
    merge: mergeMutation,
    update: updateMutation,
    approve: approveMutation,
    rebuild: rebuildMutation,
  };
}
