/**
 * Storyboard Render Queue — React Query hooks + polling worker
 */
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { storyboardRenderApi } from './storyboardRenderApi';
import { toast } from 'sonner';
import { useRef, useEffect, useCallback } from 'react';

export function useRenderRuns(projectId: string | undefined, runId: string | undefined) {
  return useQuery({
    queryKey: ['sb-render-runs', projectId, runId],
    queryFn: () => storyboardRenderApi.listRenderRuns(projectId!, runId),
    enabled: !!projectId,
    refetchInterval: 5000,
  });
}

export function useRenderRun(projectId: string | undefined, renderRunId: string | undefined) {
  return useQuery({
    queryKey: ['sb-render-run', projectId, renderRunId],
    queryFn: () => storyboardRenderApi.getRenderRun(projectId!, renderRunId!),
    enabled: !!projectId && !!renderRunId,
    refetchInterval: 3000,
  });
}

export function useRenderMutations(projectId: string | undefined) {
  const qc = useQueryClient();

  const invalidateAll = () => {
    qc.invalidateQueries({ queryKey: ['sb-render-runs', projectId] });
    qc.invalidateQueries({ queryKey: ['sb-render-run', projectId] });
    qc.invalidateQueries({ queryKey: ['sb-panels', projectId] });
    qc.invalidateQueries({ queryKey: ['sb-panel', projectId] });
  };

  const enqueue = useMutation({
    mutationFn: (params: { runId: string; unitKeys?: string[]; mode?: string; priority?: number }) =>
      storyboardRenderApi.enqueue(projectId!, params.runId, params.unitKeys, params.mode, params.priority),
    onSuccess: (data) => {
      if (data.totalEnqueued === 0) {
        toast.info(data.message || 'All frames already rendered');
      } else {
        toast.success(`Queued ${data.totalEnqueued} frames for rendering`);
      }
      invalidateAll();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const cancel = useMutation({
    mutationFn: (renderRunId: string) => storyboardRenderApi.cancel(projectId!, renderRunId),
    onSuccess: () => { toast.info('Render cancelled'); invalidateAll(); },
    onError: (e: Error) => toast.error(e.message),
  });

  return { enqueue, cancel, invalidateAll };
}

/**
 * Polling worker hook — claims + processes jobs while a render run is active.
 * Only one worker loop runs at a time.
 */
export function useRenderWorker(
  projectId: string | undefined,
  activeRenderRunId: string | undefined,
  isRunning: boolean,
) {
  const qc = useQueryClient();
  const workingRef = useRef(false);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const processNext = useCallback(async () => {
    if (!projectId || !activeRenderRunId || workingRef.current) return;
    workingRef.current = true;
    try {
      const claimResult = await storyboardRenderApi.claimNextJob(projectId, activeRenderRunId);
      if (!claimResult.job) {
        // No more jobs — stop
        return;
      }
      await storyboardRenderApi.processJob(projectId, claimResult.job.id);
      // Refresh data
      qc.invalidateQueries({ queryKey: ['sb-render-run', projectId, activeRenderRunId] });
      qc.invalidateQueries({ queryKey: ['sb-render-runs', projectId] });
      qc.invalidateQueries({ queryKey: ['sb-panels', projectId] });
      qc.invalidateQueries({ queryKey: ['sb-panel', projectId] });
    } catch (e: any) {
      console.error('Render worker error:', e.message);
      // Don't stop on individual errors — the job retry logic handles it
    } finally {
      workingRef.current = false;
    }
  }, [projectId, activeRenderRunId, qc]);

  useEffect(() => {
    if (isRunning && projectId && activeRenderRunId) {
      // Start polling
      processNext(); // immediate first attempt
      intervalRef.current = setInterval(processNext, 3000);
    } else {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
    }
    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
    };
  }, [isRunning, projectId, activeRenderRunId, processNext]);
}
