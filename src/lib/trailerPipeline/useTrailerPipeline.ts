/**
 * Trailer Pipeline v2 — React Query hooks
 */
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { blueprintApi, clipApi, assemblerApi } from './trailerApi';
import { clipEngineApi } from './clipApi';
import { toast } from 'sonner';

// ─── Blueprint hooks ───

export function useArcTemplates() {
  return useQuery({
    queryKey: ['trailer-arc-templates'],
    queryFn: () => blueprintApi.getArcTemplates(),
    staleTime: Infinity,
  });
}

export function useBlueprints(projectId: string | undefined) {
  return useQuery({
    queryKey: ['trailer-blueprints', projectId],
    queryFn: () => blueprintApi.listBlueprints(projectId!),
    enabled: !!projectId,
  });
}

export function useBlueprint(projectId: string | undefined, blueprintId: string | undefined) {
  return useQuery({
    queryKey: ['trailer-blueprint', projectId, blueprintId],
    queryFn: () => blueprintApi.getBlueprint(projectId!, blueprintId!),
    enabled: !!projectId && !!blueprintId,
  });
}

export function useBlueprintMutations(projectId: string | undefined) {
  const qc = useQueryClient();

  const createBlueprint = useMutation({
    mutationFn: (params: { storyboardRunId?: string; arcType?: string; options?: any }) =>
      blueprintApi.createBlueprint(projectId!, params.storyboardRunId, params.arcType, params.options),
    onSuccess: (data) => {
      toast.success(`Blueprint created with ${data.beatCount} beats`);
      qc.invalidateQueries({ queryKey: ['trailer-blueprints', projectId] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return { createBlueprint };
}

// ─── Clip hooks ───

export function useClips(projectId: string | undefined, blueprintId: string | undefined) {
  return useQuery({
    queryKey: ['trailer-clips', projectId, blueprintId],
    queryFn: () => clipApi.listClips(projectId!, blueprintId!),
    enabled: !!projectId && !!blueprintId,
  });
}

export function useClipMutations(projectId: string | undefined) {
  const qc = useQueryClient();

  const generateClips = useMutation({
    mutationFn: async (params: { blueprintId: string; provider?: string; beatIndices?: number[]; candidateCount?: number }) => {
      // Step 1: Enqueue jobs
      const enqueueResult = await clipApi.generateClips(projectId!, params.blueprintId, params.provider, params.beatIndices, params.candidateCount);
      // Step 2: Auto-process the queue
      const processResult = await clipEngineApi.processQueue(projectId!, params.blueprintId, 50);
      return { ...enqueueResult, processed: processResult.processed || 0 };
    },
    onSuccess: (data) => {
      toast.success(`Enqueued ${data.totalJobs || 0} jobs, processed ${data.processed}`);
      qc.invalidateQueries({ queryKey: ['trailer-clips', projectId] });
      qc.invalidateQueries({ queryKey: ['trailer-clip-progress', projectId] });
      qc.invalidateQueries({ queryKey: ['trailer-clip-jobs', projectId] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const rateClip = useMutation({
    mutationFn: ({ clipId, rating }: { clipId: string; rating: number }) =>
      clipApi.rateClip(projectId!, clipId, rating),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['trailer-clips', projectId] }),
    onError: (e: Error) => toast.error(e.message),
  });

  const selectClip = useMutation({
    mutationFn: ({ clipId, blueprintId, beatIndex }: { clipId: string; blueprintId: string; beatIndex: number }) =>
      clipApi.selectClip(projectId!, clipId, blueprintId, beatIndex),
    onSuccess: () => {
      toast.success('Clip selected for cut');
      qc.invalidateQueries({ queryKey: ['trailer-clips', projectId] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return { generateClips, rateClip, selectClip };
}

// ─── Cut / Assembler hooks ───

export function useCuts(projectId: string | undefined, blueprintId: string | undefined) {
  return useQuery({
    queryKey: ['trailer-cuts', projectId, blueprintId],
    queryFn: () => assemblerApi.listCuts(projectId!, blueprintId),
    enabled: !!projectId,
  });
}

export function useCut(projectId: string | undefined, cutId: string | undefined) {
  return useQuery({
    queryKey: ['trailer-cut', projectId, cutId],
    queryFn: () => assemblerApi.getCut(projectId!, cutId!),
    enabled: !!projectId && !!cutId,
  });
}

export function useTimeline(projectId: string | undefined, blueprintId: string | undefined) {
  return useQuery({
    queryKey: ['trailer-timeline', projectId, blueprintId],
    queryFn: () => assemblerApi.getTimeline(projectId!, blueprintId!),
    enabled: !!projectId && !!blueprintId,
  });
}

export function useCutMutations(projectId: string | undefined) {
  const qc = useQueryClient();

  const createCut = useMutation({
    mutationFn: (params: { blueprintId: string; options?: any }) =>
      assemblerApi.createCut(projectId!, params.blueprintId, params.options),
    onSuccess: (data) => {
      toast.success(`Cut created (${Math.round((data.totalDurationMs || 0) / 1000)}s)`);
      qc.invalidateQueries({ queryKey: ['trailer-cuts', projectId] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const setCutStatus = useMutation({
    mutationFn: (params: { cutId: string; status: string; error?: string; storagePath?: string; publicUrl?: string }) =>
      assemblerApi.setCutStatus(projectId!, params.cutId, params.status, params),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['trailer-cuts', projectId] }),
    onError: (e: Error) => toast.error(e.message),
  });

  return { createCut, setCutStatus };
}
