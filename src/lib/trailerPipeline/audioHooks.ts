/**
 * Trailer Audio Engine v1.1 — React Query hooks
 */
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { audioApi } from './audioApi';
import { toast } from 'sonner';

export function useAudioAssets(projectId: string | undefined, kind?: string) {
  return useQuery({
    queryKey: ['trailer-audio-assets', projectId, kind],
    queryFn: () => audioApi.listAudioAssets(projectId!, kind),
    enabled: !!projectId,
  });
}

export function useAudioRun(projectId: string | undefined, cutId: string | undefined) {
  return useQuery({
    queryKey: ['trailer-audio-run', projectId, cutId],
    queryFn: () => audioApi.getAudioRun(projectId!, cutId!),
    enabled: !!projectId && !!cutId,
  });
}

export function useRenderProgress(projectId: string | undefined, cutId: string | undefined) {
  return useQuery({
    queryKey: ['trailer-render-progress', projectId, cutId],
    queryFn: () => audioApi.renderProgress(projectId!, cutId!),
    enabled: !!projectId && !!cutId,
    refetchInterval: 5000,
  });
}

export function useAudioMutations(projectId: string | undefined) {
  const qc = useQueryClient();

  const invalidateAll = () => {
    qc.invalidateQueries({ queryKey: ['trailer-audio-run', projectId] });
    qc.invalidateQueries({ queryKey: ['trailer-audio-assets', projectId] });
    qc.invalidateQueries({ queryKey: ['trailer-render-progress', projectId] });
  };

  const upsertAudioRun = useMutation({
    mutationFn: (params: {
      cutId: string;
      blueprintId?: string;
      musicBedAssetId?: string | null;
      sfxPackTag?: string | null;
      mixOverrides?: Record<string, any>;
    }) => audioApi.upsertAudioRun(projectId!, params.cutId, params),
    onSuccess: () => {
      toast.success('Audio settings saved');
      invalidateAll();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const generateAudioPlan = useMutation({
    mutationFn: (audioRunId: string) =>
      audioApi.generateAudioPlan(projectId!, audioRunId),
    onSuccess: () => {
      toast.success('Audio plan generated');
      invalidateAll();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const enqueueRender = useMutation({
    mutationFn: (params: {
      cutId: string;
      audioRunId?: string;
      force?: boolean;
      preset?: '720p' | '1080p';
    }) => audioApi.enqueueRender(projectId!, params.cutId, params),
    onSuccess: (data) => {
      toast.success(data.action === 'existing' ? 'Render job already exists' : 'Render job enqueued');
      invalidateAll();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const retryRender = useMutation({
    mutationFn: (renderJobId: string) =>
      audioApi.retryRender(projectId!, renderJobId),
    onSuccess: () => {
      toast.success('Render job retried');
      invalidateAll();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const cancelRender = useMutation({
    mutationFn: (renderJobId: string) =>
      audioApi.cancelRender(projectId!, renderJobId),
    onSuccess: () => {
      toast.success('Render job canceled');
      invalidateAll();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return { upsertAudioRun, generateAudioPlan, enqueueRender, retryRender, cancelRender };
}
