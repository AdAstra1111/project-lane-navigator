import { useState, useCallback } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import {
  changeSetCreate,
  changeSetList,
  changeSetGet,
  changeSetAddOp,
  changeSetRemoveOp,
  changeSetPropose,
  changeSetPreview,
  changeSetApply,
  changeSetRollback,
} from '@/lib/scene-graph/client';
import type {
  SceneChangeSet,
  SceneChangeSetOp,
  ChangeSetPreview,
  ChangeSetOpType,
} from '@/lib/scene-graph/types';

export function useChangeSets(projectId: string | undefined) {
  const qc = useQueryClient();
  const [selectedChangeSetId, setSelectedChangeSetId] = useState<string | null>(null);
  const [preview, setPreview] = useState<ChangeSetPreview | null>(null);

  const invalidate = useCallback(() => {
    qc.invalidateQueries({ queryKey: ['change-sets', projectId] });
    qc.invalidateQueries({ queryKey: ['change-set-detail', projectId, selectedChangeSetId] });
  }, [qc, projectId, selectedChangeSetId]);

  const listQuery = useQuery({
    queryKey: ['change-sets', projectId],
    queryFn: async () => {
      if (!projectId) return [];
      const result = await changeSetList({ projectId });
      return result.change_sets || [];
    },
    enabled: !!projectId,
  });

  const detailQuery = useQuery({
    queryKey: ['change-set-detail', projectId, selectedChangeSetId],
    queryFn: async () => {
      if (!projectId || !selectedChangeSetId) return null;
      return changeSetGet({ projectId, changeSetId: selectedChangeSetId });
    },
    enabled: !!projectId && !!selectedChangeSetId,
  });

  const createMutation = useMutation({
    mutationFn: async (params: { title: string; description?: string; goal_type?: string; baseSnapshotMode?: 'latest' | 'approved_prefer' }) => {
      if (!projectId) throw new Error('No project');
      return changeSetCreate({ projectId, ...params });
    },
    onSuccess: (data) => {
      invalidate();
      setSelectedChangeSetId(data.change_set.id);
      toast.success('Change set created');
    },
    onError: (e: Error) => toast.error(`Create failed: ${e.message}`),
  });

  const addOpMutation = useMutation({
    mutationFn: async (params: { changeSetId: string; op: { op_type: ChangeSetOpType; payload: Record<string, any> } }) => {
      if (!projectId) throw new Error('No project');
      return changeSetAddOp({ projectId, ...params });
    },
    onSuccess: () => { invalidate(); toast.success('Operation added'); },
    onError: (e: Error) => toast.error(`Add op failed: ${e.message}`),
  });

  const removeOpMutation = useMutation({
    mutationFn: async (params: { changeSetId: string; opId: string }) => {
      if (!projectId) throw new Error('No project');
      return changeSetRemoveOp({ projectId, ...params });
    },
    onSuccess: () => { invalidate(); toast.success('Operation removed'); },
    onError: (e: Error) => toast.error(`Remove op failed: ${e.message}`),
  });

  const proposeMutation = useMutation({
    mutationFn: async (changeSetId: string) => {
      if (!projectId) throw new Error('No project');
      return changeSetPropose({ projectId, changeSetId });
    },
    onSuccess: () => { invalidate(); toast.success('Change set proposed'); },
    onError: (e: Error) => toast.error(`Propose failed: ${e.message}`),
  });

  const previewMutation = useMutation({
    mutationFn: async (changeSetId: string) => {
      if (!projectId) throw new Error('No project');
      return changeSetPreview({ projectId, changeSetId });
    },
    onSuccess: (data) => { setPreview(data); toast.success('Preview generated'); },
    onError: (e: Error) => toast.error(`Preview failed: ${e.message}`),
  });

  const applyMutation = useMutation({
    mutationFn: async (params: { changeSetId: string; applyMode?: 'draft' | 'propose' }) => {
      if (!projectId) throw new Error('No project');
      return changeSetApply({ projectId, ...params });
    },
    onSuccess: () => {
      invalidate();
      qc.invalidateQueries({ queryKey: ['scene-graph', projectId] });
      qc.invalidateQueries({ queryKey: ['scene-graph-state', projectId] });
      toast.success('Change set applied');
    },
    onError: (e: Error) => toast.error(`Apply failed: ${e.message}`),
  });

  const rollbackMutation = useMutation({
    mutationFn: async (changeSetId: string) => {
      if (!projectId) throw new Error('No project');
      return changeSetRollback({ projectId, changeSetId });
    },
    onSuccess: () => {
      invalidate();
      qc.invalidateQueries({ queryKey: ['scene-graph', projectId] });
      qc.invalidateQueries({ queryKey: ['scene-graph-state', projectId] });
      toast.success('Change set rolled back');
    },
    onError: (e: Error) => toast.error(`Rollback failed: ${e.message}`),
  });

  return {
    changeSets: (listQuery.data || []) as SceneChangeSet[],
    isLoading: listQuery.isLoading,
    selectedChangeSetId,
    setSelectedChangeSetId,
    selectedDetail: detailQuery.data as { change_set: SceneChangeSet; ops: SceneChangeSetOp[] } | null,
    isDetailLoading: detailQuery.isLoading,
    preview,
    setPreview,

    create: createMutation,
    addOp: addOpMutation,
    removeOp: removeOpMutation,
    propose: proposeMutation,
    previewCs: previewMutation,
    apply: applyMutation,
    rollback: rollbackMutation,
  };
}
