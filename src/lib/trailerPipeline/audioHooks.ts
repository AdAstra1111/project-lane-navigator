/**
 * Trailer Audio Intelligence Engine v1 — React Query hooks
 */
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { audioApi } from './audioApi';
import { toast } from 'sonner';

// ─── Legacy hooks (backward compat) ───
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
    qc.invalidateQueries({ queryKey: ['trailer-audio-intelligence', projectId] });
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

// ─── Audio Intelligence hooks ───
export function useTrailerAudioRuns(projectId: string | undefined, cutId: string | undefined) {
  return useQuery({
    queryKey: ['trailer-audio-intelligence', 'run', projectId, cutId],
    queryFn: () => audioApi.getAudioRun(projectId!, cutId!),
    enabled: !!projectId && !!cutId,
  });
}

export function useTrailerAudioProgress(projectId: string | undefined, audioRunId: string | undefined) {
  return useQuery({
    queryKey: ['trailer-audio-intelligence', 'progress', projectId, audioRunId],
    queryFn: () => audioApi.progress(projectId!, audioRunId!),
    enabled: !!projectId && !!audioRunId,
    refetchInterval: (query) => {
      const data = query.state.data as any;
      if (data?.summary?.all_complete) return false;
      return 5000;
    },
  });
}

export function useTrailerAudioAssets(projectId: string | undefined, audioRunId: string | undefined) {
  return useQuery({
    queryKey: ['trailer-audio-intelligence', 'assets', projectId, audioRunId],
    queryFn: () => audioApi.listAudioAssets(projectId!, undefined, audioRunId!),
    enabled: !!projectId && !!audioRunId,
  });
}

export function useAudioIntelligenceMutations(projectId: string | undefined) {
  const qc = useQueryClient();

  const invalidateAll = () => {
    qc.invalidateQueries({ queryKey: ['trailer-audio-intelligence', projectId] });
    qc.invalidateQueries({ queryKey: ['trailer-audio-run', projectId] });
    qc.invalidateQueries({ queryKey: ['trailer-audio-assets', projectId] });
  };

  const createAudioRun = useMutation({
    mutationFn: (params: {
      blueprintRunId?: string;
      trailerCutId?: string;
      inputs?: Record<string, any>;
    }) => audioApi.createAudioRun(projectId!, params),
    onSuccess: () => {
      toast.success('Audio Intelligence run created');
      invalidateAll();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const generatePlan = useMutation({
    mutationFn: (audioRunId: string) =>
      audioApi.generatePlan(projectId!, audioRunId),
    onSuccess: () => {
      toast.success('Audio plan generated — generation started');
      invalidateAll();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const genMusic = useMutation({
    mutationFn: (audioRunId: string) =>
      audioApi.genMusic(projectId!, audioRunId),
    onSuccess: () => {
      toast.success('Music generation complete');
      invalidateAll();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const genVo = useMutation({
    mutationFn: (audioRunId: string) =>
      audioApi.genVo(projectId!, audioRunId),
    onSuccess: (data) => {
      if (data.skipped) {
        toast.info('No VO lines to generate');
      } else {
        toast.success(`VO generated (${data.takes} takes)`);
      }
      invalidateAll();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const selectSfx = useMutation({
    mutationFn: (audioRunId: string) =>
      audioApi.selectSfx(projectId!, audioRunId),
    onSuccess: (data) => {
      toast.success(`SFX: ${data.matched}/${data.total_hits} hits matched`);
      invalidateAll();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const mixAudio = useMutation({
    mutationFn: (audioRunId: string) =>
      audioApi.mix(projectId!, audioRunId),
    onSuccess: (data) => {
      toast.success(data.action === 'existing' ? 'Mix job already exists' : 'Mix job enqueued');
      invalidateAll();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const selectAsset = useMutation({
    mutationFn: (params: { audioRunId: string; assetId: string; assetType: string }) =>
      audioApi.selectAsset(projectId!, params.audioRunId, params.assetId, params.assetType),
    onSuccess: () => {
      toast.success('Asset selected');
      invalidateAll();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const updateMixSettings = useMutation({
    mutationFn: (params: { audioRunId: string; mixSettings: Record<string, any> }) =>
      audioApi.updateMixSettings(projectId!, params.audioRunId, params.mixSettings),
    onSuccess: () => {
      toast.success('Mix settings updated');
      invalidateAll();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return {
    createAudioRun,
    generatePlan,
    genMusic,
    genVo,
    selectSfx,
    mixAudio,
    selectAsset,
    updateMixSettings,
  };
}
