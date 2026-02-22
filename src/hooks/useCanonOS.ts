/**
 * useCanonOS — Hook for Canon OS operations.
 * Wraps the canon edge function actions with react-query.
 */
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import {
  canonInitialize,
  canonOSUpdate,
  canonApprove,
  canonOSGet,
  projectRename,
} from '@/lib/scene-graph/client';
import type { CanonOSData, CanonOSVersion } from '@/lib/scene-graph/types';

const CANON_OS_KEY = (pid: string) => ['canon-os', pid];

export function useCanonOS(projectId: string | undefined) {
  const qc = useQueryClient();

  const { data: currentCanon, isLoading } = useQuery({
    queryKey: CANON_OS_KEY(projectId!),
    queryFn: async () => {
      const result = await canonOSGet({ projectId: projectId! });
      return result.canon;
    },
    enabled: !!projectId,
    staleTime: 10_000,
  });

  const initializeMutation = useMutation({
    mutationFn: async () => {
      return canonInitialize({ projectId: projectId! });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: CANON_OS_KEY(projectId!) });
      toast.success('Canon initialized');
    },
    onError: (err: any) => toast.error('Init failed: ' + err.message),
  });

  const updateMutation = useMutation({
    mutationFn: async (patch: Partial<CanonOSData>) => {
      return canonOSUpdate({ projectId: projectId!, patch });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: CANON_OS_KEY(projectId!) });
    },
    onError: (err: any) => toast.error('Update failed: ' + err.message),
  });

  const approveMutation = useMutation({
    mutationFn: async (canonId: string) => {
      return canonApprove({ projectId: projectId!, canonId });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: CANON_OS_KEY(projectId!) });
      qc.invalidateQueries({ queryKey: ['project-canon-versions', projectId!] });
      toast.success('Canon version approved');
    },
    onError: (err: any) => toast.error('Approve failed: ' + err.message),
  });

  const renameMutation = useMutation({
    mutationFn: async (newTitle: string) => {
      return projectRename({ projectId: projectId!, newTitle });
    },
    onSuccess: (result) => {
      qc.invalidateQueries({ queryKey: CANON_OS_KEY(projectId!) });
      qc.invalidateQueries({ queryKey: ['project-canon', projectId!] });
      toast.success(`Renamed. ${result.updated_documents} documents updated.`);
    },
    onError: (err: any) => toast.error('Rename failed: ' + err.message),
  });

  return {
    currentCanon,
    isLoading,
    initialize: initializeMutation.mutateAsync,
    isInitializing: initializeMutation.isPending,
    update: updateMutation.mutate,
    updateAsync: updateMutation.mutateAsync,
    isUpdating: updateMutation.isPending,
    approve: approveMutation.mutateAsync,
    isApproving: approveMutation.isPending,
    rename: renameMutation.mutateAsync,
    isRenaming: renameMutation.isPending,
  };
}
