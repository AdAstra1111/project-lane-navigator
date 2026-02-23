/**
 * Trailer Clip Generator v1 — React Query hooks
 */
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { clipEngineApi } from './clipApi';
import { toast } from 'sonner';

export function useClipProgress(projectId: string | undefined, blueprintId: string | undefined) {
  return useQuery({
    queryKey: ['trailer-clip-progress', projectId, blueprintId],
    queryFn: () => clipEngineApi.progress(projectId!, blueprintId!),
    enabled: !!projectId && !!blueprintId,
    refetchInterval: (query) => {
      const data = query.state.data as { counts?: { queued: number; running: number } } | undefined;
      if (!data?.counts) return 5000;
      return data.counts.queued > 0 || data.counts.running > 0 ? 5000 : false;
    },
  });
}

export function useClipJobs(projectId: string | undefined, blueprintId: string | undefined) {
  return useQuery({
    queryKey: ['trailer-clip-jobs', projectId, blueprintId],
    queryFn: () => clipEngineApi.listJobs(projectId!, blueprintId!),
    enabled: !!projectId && !!blueprintId,
  });
}

export function useClipsList(projectId: string | undefined, blueprintId: string | undefined) {
  return useQuery({
    queryKey: ['trailer-clips-list', projectId, blueprintId],
    queryFn: () => clipEngineApi.listClips(projectId!, blueprintId!),
    enabled: !!projectId && !!blueprintId,
  });
}

export function useClipEngineMutations(projectId: string | undefined) {
  const qc = useQueryClient();

  const invalidateAll = () => {
    qc.invalidateQueries({ queryKey: ['trailer-clip-progress', projectId] });
    qc.invalidateQueries({ queryKey: ['trailer-clip-jobs', projectId] });
    qc.invalidateQueries({ queryKey: ['trailer-clips-list', projectId] });
    qc.invalidateQueries({ queryKey: ['trailer-clips', projectId] });
  };

  const enqueueForRun = useMutation({
    mutationFn: (params: { blueprintId: string; force?: boolean; enabledProviders?: string[]; beatIndices?: number[] }) =>
      clipEngineApi.enqueueForRun(projectId!, params.blueprintId, params.force, params.enabledProviders, params.beatIndices),
    onSuccess: (data) => {
      toast.success(`Enqueued ${data.totalJobs} clip jobs`);
      invalidateAll();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const processQueue = useMutation({
    mutationFn: (params: { blueprintId: string; maxJobs?: number }) =>
      clipEngineApi.processQueue(projectId!, params.blueprintId, params.maxJobs),
    onSuccess: (data) => {
      toast.success(`Processed ${data.processed} jobs`);
      invalidateAll();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const retryJob = useMutation({
    mutationFn: (jobId: string) => clipEngineApi.retryJob(projectId!, jobId),
    onSuccess: () => {
      toast.success('Job queued for retry');
      invalidateAll();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const cancelJob = useMutation({
    mutationFn: (jobId: string) => clipEngineApi.cancelJob(projectId!, jobId),
    onSuccess: () => {
      toast.success('Job canceled');
      invalidateAll();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const selectClip = useMutation({
    mutationFn: (params: { clipId: string; blueprintId: string; beatIndex: number }) =>
      clipEngineApi.selectClip(projectId!, params.clipId, params.blueprintId, params.beatIndex),
    onSuccess: () => {
      toast.success('Clip selected');
      invalidateAll();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const cancelAll = useMutation({
    mutationFn: (blueprintId: string) =>
      clipEngineApi.cancelAll(projectId!, blueprintId),
    onSuccess: (data) => {
      toast.success(`Stopped — ${data.canceled} jobs canceled`);
      invalidateAll();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const resetFailed = useMutation({
    mutationFn: (blueprintId: string) =>
      clipEngineApi.resetFailed(projectId!, blueprintId),
    onSuccess: (data) => {
      toast.success(`Reset ${data.reset} failed jobs back to queue`);
      invalidateAll();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return { enqueueForRun, processQueue, retryJob, cancelJob, selectClip, cancelAll, resetFailed };
}
