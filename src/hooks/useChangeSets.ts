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
  changeSetComputeDiffs,
  changeSetGetDiffs,
  changeSetGetSceneDiff,
  changeSetSetReviewDecision,
  changeSetApplyReviewDecisions,
  changeSetAddComment,
  changeSetListComments,
  changeSetResolveComment,
} from '@/lib/scene-graph/client';
import type {
  SceneChangeSet,
  SceneChangeSetOp,
  ChangeSetPreview,
  ChangeSetOpType,
  SceneDiffArtifact,
  SnapshotDiffArtifact,
  ChangeSetReviewState,
  DiffComment,
} from '@/lib/scene-graph/types';

export function useChangeSets(projectId: string | undefined) {
  const qc = useQueryClient();
  const [selectedChangeSetId, setSelectedChangeSetId] = useState<string | null>(null);
  const [preview, setPreview] = useState<ChangeSetPreview | null>(null);
  const [selectedSceneDiff, setSelectedSceneDiff] = useState<{ sceneId: string; artifact: SceneDiffArtifact } | null>(null);

  const invalidate = useCallback(() => {
    qc.invalidateQueries({ queryKey: ['change-sets', projectId] });
    qc.invalidateQueries({ queryKey: ['change-set-detail', projectId, selectedChangeSetId] });
    qc.invalidateQueries({ queryKey: ['change-set-diffs', projectId, selectedChangeSetId] });
    qc.invalidateQueries({ queryKey: ['change-set-comments', projectId, selectedChangeSetId] });
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

  const diffsQuery = useQuery({
    queryKey: ['change-set-diffs', projectId, selectedChangeSetId],
    queryFn: async () => {
      if (!projectId || !selectedChangeSetId) return null;
      return changeSetGetDiffs({ projectId, changeSetId: selectedChangeSetId });
    },
    enabled: !!projectId && !!selectedChangeSetId,
  });

  const commentsQuery = useQuery({
    queryKey: ['change-set-comments', projectId, selectedChangeSetId],
    queryFn: async () => {
      if (!projectId || !selectedChangeSetId) return { comments: [] };
      return changeSetListComments({ projectId, changeSetId: selectedChangeSetId });
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

  const computeDiffsMutation = useMutation({
    mutationFn: async (params: { changeSetId: string; granularity?: 'line' | 'word' }) => {
      if (!projectId) throw new Error('No project');
      return changeSetComputeDiffs({ projectId, ...params });
    },
    onSuccess: () => { invalidate(); toast.success('Diffs computed'); },
    onError: (e: Error) => toast.error(`Compute diffs failed: ${e.message}`),
  });

  const getSceneDiffMutation = useMutation({
    mutationFn: async (params: { sceneId: string; beforeVersionId?: string; afterVersionId?: string }) => {
      if (!projectId || !selectedChangeSetId) throw new Error('No project/changeset');
      return changeSetGetSceneDiff({ projectId, changeSetId: selectedChangeSetId, ...params });
    },
    onSuccess: (data, vars) => {
      if (data.artifact) setSelectedSceneDiff({ sceneId: vars.sceneId, artifact: data.artifact as SceneDiffArtifact });
    },
    onError: (e: Error) => toast.error(`Get scene diff failed: ${e.message}`),
  });

  const setReviewDecisionMutation = useMutation({
    mutationFn: async (params: { sceneId: string; beforeVersionId?: string; afterVersionId?: string; decision: 'accepted' | 'rejected' | 'pending' }) => {
      if (!projectId || !selectedChangeSetId) throw new Error('No project/changeset');
      return changeSetSetReviewDecision({ projectId, changeSetId: selectedChangeSetId, ...params });
    },
    onSuccess: () => { invalidate(); },
    onError: (e: Error) => toast.error(`Review decision failed: ${e.message}`),
  });

  const applyReviewDecisionsMutation = useMutation({
    mutationFn: async () => {
      if (!projectId || !selectedChangeSetId) throw new Error('No project/changeset');
      return changeSetApplyReviewDecisions({ projectId, changeSetId: selectedChangeSetId });
    },
    onSuccess: () => { invalidate(); toast.success('Review decisions applied to ops'); },
    onError: (e: Error) => toast.error(`Apply decisions failed: ${e.message}`),
  });

  const addCommentMutation = useMutation({
    mutationFn: async (params: { sceneId?: string; beforeVersionId?: string; afterVersionId?: string; parentId?: string; comment: string }) => {
      if (!projectId || !selectedChangeSetId) throw new Error('No project/changeset');
      return changeSetAddComment({ projectId, changeSetId: selectedChangeSetId, ...params });
    },
    onSuccess: () => { invalidate(); toast.success('Comment added'); },
    onError: (e: Error) => toast.error(`Add comment failed: ${e.message}`),
  });

  const resolveCommentMutation = useMutation({
    mutationFn: async (params: { commentId: string; status: 'resolved' | 'open' }) => {
      if (!projectId) throw new Error('No project');
      return changeSetResolveComment({ projectId, ...params });
    },
    onSuccess: () => { invalidate(); },
    onError: (e: Error) => toast.error(`Resolve failed: ${e.message}`),
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

    diffs: diffsQuery.data as { snapshot_diff: SnapshotDiffArtifact | null; scene_diffs: Array<{ scene_id: string; before_version_id: string | null; after_version_id: string | null; stats: any }> } | null,
    isDiffsLoading: diffsQuery.isLoading,
    selectedSceneDiff,
    setSelectedSceneDiff,
    comments: (commentsQuery.data?.comments || []) as DiffComment[],
    isCommentsLoading: commentsQuery.isLoading,

    create: createMutation,
    addOp: addOpMutation,
    removeOp: removeOpMutation,
    propose: proposeMutation,
    previewCs: previewMutation,
    apply: applyMutation,
    rollback: rollbackMutation,

    computeDiffs: computeDiffsMutation,
    getSceneDiff: getSceneDiffMutation,
    setReviewDecision: setReviewDecisionMutation,
    applyReviewDecisions: applyReviewDecisionsMutation,
    addComment: addCommentMutation,
    resolveComment: resolveCommentMutation,
  };
}
