/**
 * Trailer Clip Generator v1 — React Query hooks
 */
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { clipEngineApi } from './clipApi';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';

export function useClipProgress(projectId: string | undefined, blueprintId: string | undefined) {
  return useQuery({
    queryKey: ['trailer-clip-progress', projectId, blueprintId],
    queryFn: () => clipEngineApi.progress(projectId!, blueprintId!),
    enabled: !!projectId && !!blueprintId,
    refetchInterval: (query) => {
      const data = query.state.data as { counts?: { queued: number; running: number; polling?: number } } | undefined;
      if (!data?.counts) return 5000;
      return (data.counts.queued > 0 || data.counts.running > 0 || (data.counts.polling || 0) > 0) ? 5000 : false;
    },
  });
}

/**
 * Auto-process queued jobs. When there are queued jobs and no active processing,
 * periodically kicks the queue to keep jobs flowing (handles rate-limit pauses).
 */
export function useAutoProcessQueue(projectId: string | undefined, blueprintId: string | undefined, queuedCount: number, runningCount: number) {
  const qc = useQueryClient();
  return useQuery({
    queryKey: ['trailer-clip-auto-process', projectId, blueprintId],
    queryFn: async () => {
      if (!projectId || !blueprintId) return null;
      try {
        const result = await clipEngineApi.processQueue(projectId, blueprintId, 3);
        if (result.processed > 0) {
          qc.invalidateQueries({ queryKey: ['trailer-clip-progress', projectId] });
          qc.invalidateQueries({ queryKey: ['trailer-clips-list', projectId] });
        }
        return result;
      } catch {
        return null;
      }
    },
    enabled: !!projectId && !!blueprintId && queuedCount > 0,
    // Process every 30s when jobs are queued but pipeline seems stalled (nothing running)
    refetchInterval: queuedCount > 0 ? (runningCount === 0 ? 15000 : 30000) : false,
  });
}

export function useClipPolling(projectId: string | undefined, blueprintId: string | undefined, hasPollingJobs: boolean) {
  const qc = useQueryClient();
  return useQuery({
    queryKey: ['trailer-clip-polling', projectId, blueprintId],
    queryFn: async () => {
      const result = await clipEngineApi.pollPendingJobs(projectId!, blueprintId!);
      if (result.completed > 0 || result.failed > 0) {
        qc.invalidateQueries({ queryKey: ['trailer-clip-progress', projectId] });
        qc.invalidateQueries({ queryKey: ['trailer-clips-list', projectId] });
        qc.invalidateQueries({ queryKey: ['trailer-clips', projectId] });
      }
      return result;
    },
    enabled: !!projectId && !!blueprintId && hasPollingJobs,
    refetchInterval: hasPollingJobs ? 10000 : false,
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

  const runTechnicalJudge = useMutation({
    mutationFn: (params: { blueprintId: string; clipRunId?: string }) =>
      clipEngineApi.runTechnicalJudge(projectId!, params.blueprintId, params.clipRunId),
    onSuccess: (data) => {
      toast.success(`Technical judge: ${data.passed} passed, ${data.rejected} rejected`);
      invalidateAll();
      qc.invalidateQueries({ queryKey: ['trailer-clip-scores'] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const regenerateLowQuality = useMutation({
    mutationFn: (params: { blueprintId: string; threshold?: number }) =>
      clipEngineApi.regenerateLowQuality(projectId!, params.blueprintId, params.threshold),
    onSuccess: () => {
      toast.success('Re-enqueued low-quality beats for regeneration');
      invalidateAll();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return { enqueueForRun, processQueue, retryJob, cancelJob, selectClip, cancelAll, resetFailed, runTechnicalJudge, regenerateLowQuality };
}

/** Query clip scores for a blueprint */
export function useClipScores(projectId: string | undefined, blueprintId: string | undefined) {
  return useQuery({
    queryKey: ['trailer-clip-scores', projectId, blueprintId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('trailer_clip_scores')
        .select('*')
        .eq('project_id', projectId!)
        .eq('blueprint_id', blueprintId!);
      if (error) throw error;
      // Index by clip_id for fast lookup
      const byClip: Record<string, any> = {};
      for (const s of (data || [])) {
        byClip[s.clip_id] = s;
      }
      return byClip;
    },
    enabled: !!projectId && !!blueprintId,
  });
}
