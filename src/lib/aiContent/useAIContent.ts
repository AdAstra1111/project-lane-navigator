/**
 * AI Content — React Query hooks
 */
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { aiContentApi, type ContentMode, type ContentPreset } from './aiContentApi';
import { toast } from 'sonner';

export function useAIContentRuns(projectId: string | undefined) {
  return useQuery({
    queryKey: ['ai-content-runs', projectId],
    queryFn: () => aiContentApi.status(projectId!),
    enabled: !!projectId,
    refetchInterval: 5000,
  });
}

export function useAIContentRunStatus(projectId: string | undefined, runId: string | undefined) {
  return useQuery({
    queryKey: ['ai-content-run', projectId, runId],
    queryFn: () => aiContentApi.status(projectId!, runId),
    enabled: !!projectId && !!runId,
    refetchInterval: 3000,
  });
}

export function useAIContentMutations(projectId: string | undefined) {
  const qc = useQueryClient();

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ['ai-content-runs', projectId] });
    qc.invalidateQueries({ queryKey: ['ai-content-run', projectId] });
  };

  const start = useMutation({
    mutationFn: (params: { mode: ContentMode; preset: ContentPreset; storyboardRunId?: string; blueprintId?: string }) =>
      aiContentApi.start(projectId!, params.mode, params.preset, params),
    onSuccess: (data) => {
      toast.success(`AI Content run started (${data.mode})`);
      invalidate();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const tick = useMutation({
    mutationFn: (runId: string) => aiContentApi.tick(projectId!, runId),
    onSuccess: invalidate,
    onError: (e: Error) => toast.error(e.message),
  });

  const pause = useMutation({
    mutationFn: (runId: string) => aiContentApi.pause(projectId!, runId),
    onSuccess: () => { toast.info('Run paused'); invalidate(); },
    onError: (e: Error) => toast.error(e.message),
  });

  const resume = useMutation({
    mutationFn: (runId: string) => aiContentApi.resume(projectId!, runId),
    onSuccess: () => { toast.info('Run resumed'); invalidate(); },
    onError: (e: Error) => toast.error(e.message),
  });

  const stop = useMutation({
    mutationFn: (runId: string) => aiContentApi.stop(projectId!, runId),
    onSuccess: () => { toast.info('Run stopped'); invalidate(); },
    onError: (e: Error) => toast.error(e.message),
  });

  return { start, tick, pause, resume, stop };
}
