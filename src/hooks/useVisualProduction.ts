/**
 * useVisualProduction — Hook for Phase 5 Visual Production Engine
 */
import { useState, useCallback } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import {
  shotsGenerateForScene,
  shotsListForScene,
  shotsUpdateShot,
  shotsApproveShotVersion,
  shotsApproveShotSet,
  storyboardGenerateFrames,
  storyboardListForScene,
  storyboardApproveFrame,
  productionComputeBreakdown,
  productionGetLatest,
} from '@/lib/scene-graph/client';
import type {
  ShotSet,
  SceneShot,
  ShotVersion,
  StoryboardFrame,
  ProductionBreakdown,
} from '@/lib/scene-graph/types';

// Helper to call scene graph actions directly
async function callSceneGraphDirect(action: string, payload: Record<string, any>) {
  const { supabase } = await import('@/integrations/supabase/client');
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
  if (!resp.ok) {
    const text = await resp.text();
    let msg = 'Engine error';
    try { msg = JSON.parse(text).error || msg; } catch {}
    throw new Error(msg);
  }
  return resp.json();
}

export function useVisualProduction(projectId: string | undefined, sceneId?: string | null) {
  const qc = useQueryClient();

  const invalidate = useCallback(() => {
    qc.invalidateQueries({ queryKey: ['vp-shots', projectId, sceneId] });
    qc.invalidateQueries({ queryKey: ['vp-frames', projectId, sceneId] });
    qc.invalidateQueries({ queryKey: ['vp-breakdown', projectId] });
  }, [qc, projectId, sceneId]);

  // Shots for selected scene
  const shotsQuery = useQuery({
    queryKey: ['vp-shots', projectId, sceneId],
    queryFn: async () => {
      if (!projectId || !sceneId) return { shot_sets: [], shots: [], stale_sets: [] };
      return shotsListForScene({ projectId, sceneId });
    },
    enabled: !!projectId && !!sceneId,
  });

  // Frames for selected scene
  const framesQuery = useQuery({
    queryKey: ['vp-frames', projectId, sceneId],
    queryFn: async () => {
      if (!projectId || !sceneId) return { frames: [] };
      return storyboardListForScene({ projectId, sceneId });
    },
    enabled: !!projectId && !!sceneId,
  });

  // Latest breakdown
  const breakdownQuery = useQuery({
    queryKey: ['vp-breakdown', projectId],
    queryFn: async () => {
      if (!projectId) return null;
      const result = await productionGetLatest({ projectId });
      return result.breakdown;
    },
    enabled: !!projectId,
  });

  // Generate shots
  const generateShotsMutation = useMutation({
    mutationFn: async (params: { mode?: 'coverage' | 'cinematic' | 'efficiency'; aspectRatio?: string; preferApprovedScene?: boolean }) => {
      if (!projectId || !sceneId) throw new Error('No project/scene');
      return shotsGenerateForScene({ projectId, sceneId, ...params });
    },
    onSuccess: () => { invalidate(); toast.success('Shot plan generated'); },
    onError: (e: Error) => toast.error(`Shot generation failed: ${e.message}`),
  });

  // Update shot
  const updateShotMutation = useMutation({
    mutationFn: async (params: { shotId: string; patch: Record<string, any>; propose?: boolean }) => {
      if (!projectId) throw new Error('No project');
      return shotsUpdateShot({ projectId, ...params });
    },
    onSuccess: () => { invalidate(); },
    onError: (e: Error) => toast.error(`Update failed: ${e.message}`),
  });

  // Approve shot version
  const approveShotVersionMutation = useMutation({
    mutationFn: async (shotVersionId: string) => {
      if (!projectId) throw new Error('No project');
      return shotsApproveShotVersion({ projectId, shotVersionId });
    },
    onSuccess: () => { invalidate(); toast.success('Shot version approved'); },
    onError: (e: Error) => toast.error(`Approve failed: ${e.message}`),
  });

  // Approve shot set
  const approveShotSetMutation = useMutation({
    mutationFn: async (shotSetId: string) => {
      if (!projectId) throw new Error('No project');
      return shotsApproveShotSet({ projectId, shotSetId });
    },
    onSuccess: () => { invalidate(); toast.success('Shot set approved'); },
    onError: (e: Error) => toast.error(`Approve failed: ${e.message}`),
  });

  // Generate frames
  const generateFramesMutation = useMutation({
    mutationFn: async (params: { shotId: string; shotVersionId?: string; frameCount?: number; stylePreset?: string; aspectRatio?: string }) => {
      if (!projectId) throw new Error('No project');
      return storyboardGenerateFrames({ projectId, ...params });
    },
    onSuccess: () => { invalidate(); toast.success('Frames generated'); },
    onError: (e: Error) => toast.error(`Frame generation failed: ${e.message}`),
  });

  // Approve frame
  const approveFrameMutation = useMutation({
    mutationFn: async (frameId: string) => {
      if (!projectId) throw new Error('No project');
      return storyboardApproveFrame({ projectId, frameId });
    },
    onSuccess: () => { invalidate(); toast.success('Frame approved'); },
    onError: (e: Error) => toast.error(`Approve failed: ${e.message}`),
  });

  // Delete frame (soft delete)
  const deleteFrameMutation = useMutation({
    mutationFn: async (frameId: string) => {
      if (!projectId) throw new Error('No project');
      return callSceneGraphDirect('delete_storyboard_frame', { projectId, frameId });
    },
    onSuccess: () => { invalidate(); },
    onError: (e: Error) => toast.error(`Delete failed: ${e.message}`),
  });

  // Restore frame
  const restoreFrameMutation = useMutation({
    mutationFn: async (frameId: string) => {
      if (!projectId) throw new Error('No project');
      return callSceneGraphDirect('restore_storyboard_frame', { projectId, frameId });
    },
    onSuccess: () => { invalidate(); },
    onError: (e: Error) => toast.error(`Restore failed: ${e.message}`),
  });

  // Compute breakdown
  const computeBreakdownMutation = useMutation({
    mutationFn: async (params?: { mode?: 'latest' | 'approved_prefer' }) => {
      if (!projectId) throw new Error('No project');
      return productionComputeBreakdown({ projectId, ...(params || {}) });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['vp-breakdown', projectId] });
      toast.success('Production breakdown computed');
    },
    onError: (e: Error) => toast.error(`Breakdown failed: ${e.message}`),
  });

  return {
    // Data
    shotSets: (shotsQuery.data?.shot_sets || []) as ShotSet[],
    shots: (shotsQuery.data?.shots || []) as SceneShot[],
    staleSets: (shotsQuery.data?.stale_sets || []) as ShotSet[],
    frames: (framesQuery.data?.frames || []) as StoryboardFrame[],
    breakdown: breakdownQuery.data as ProductionBreakdown | null,
    isLoadingShots: shotsQuery.isLoading,
    isLoadingFrames: framesQuery.isLoading,
    isLoadingBreakdown: breakdownQuery.isLoading,

    // Mutations
    generateShots: generateShotsMutation,
    updateShot: updateShotMutation,
    approveShotVersion: approveShotVersionMutation,
    approveShotSet: approveShotSetMutation,
    generateFrames: generateFramesMutation,
    approveFrame: approveFrameMutation,
    deleteFrame: deleteFrameMutation,
    restoreFrame: restoreFrameMutation,
    computeBreakdown: computeBreakdownMutation,
  };
}
