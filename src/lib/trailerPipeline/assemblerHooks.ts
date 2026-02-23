/**
 * Trailer Assembler v2 — React Query hooks
 */
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { assemblerApi } from './trailerApi';
import { toast } from 'sonner';

export function useTrailerCut(projectId: string | undefined, cutId: string | undefined) {
  return useQuery({
    queryKey: ['trailer-cut-detail', projectId, cutId],
    queryFn: () => assemblerApi.getCut(projectId!, cutId!),
    enabled: !!projectId && !!cutId,
  });
}

export function useTrailerCuts(projectId: string | undefined, blueprintId: string | undefined) {
  return useQuery({
    queryKey: ['trailer-cuts-list', projectId, blueprintId],
    queryFn: () => assemblerApi.listCuts(projectId!, blueprintId),
    enabled: !!projectId,
  });
}

export function useRenderManifest(projectId: string | undefined, cutId: string | undefined) {
  return useQuery({
    queryKey: ['trailer-render-manifest', projectId, cutId],
    queryFn: () => assemblerApi.renderManifest(projectId!, cutId!),
    enabled: !!projectId && !!cutId,
    staleTime: 0,
  });
}

export function useAssemblerMutations(projectId: string | undefined) {
  const qc = useQueryClient();

  const invalidateAll = () => {
    qc.invalidateQueries({ queryKey: ['trailer-cut-detail', projectId] });
    qc.invalidateQueries({ queryKey: ['trailer-cuts-list', projectId] });
    qc.invalidateQueries({ queryKey: ['trailer-render-manifest', projectId] });
    qc.invalidateQueries({ queryKey: ['trailer-cuts', projectId] });
  };

  const createCut = useMutation({
    mutationFn: (params: { blueprintId: string; options?: any }) =>
      assemblerApi.createCut(projectId!, params.blueprintId, params.options),
    onSuccess: (data) => {
      toast.success(`Cut created (${Math.round((data.totalDurationMs || 0) / 1000)}s)`);
      invalidateAll();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const updateBeat = useMutation({
    mutationFn: (params: {
      cutId: string; beatIndex: number;
      duration_ms?: number; trim_in_ms?: number; trim_out_ms?: number; clip_id?: string | null;
    }) => assemblerApi.updateBeat(projectId!, params.cutId, params.beatIndex, params),
    onSuccess: () => {
      invalidateAll();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const reorderBeats = useMutation({
    mutationFn: (params: { cutId: string; orderedBeatIndices: number[] }) =>
      assemblerApi.reorderBeats(projectId!, params.cutId, params.orderedBeatIndices),
    onSuccess: () => {
      toast.success('Beats reordered');
      invalidateAll();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const finalizeRun = useMutation({
    mutationFn: (params: { cutId: string; outputPath?: string; publicUrl?: string }) =>
      assemblerApi.finalizeRun(projectId!, params.cutId, params.outputPath, params.publicUrl),
    onSuccess: () => {
      toast.success('Trailer finalized!');
      invalidateAll();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const setCutStatus = useMutation({
    mutationFn: (params: { cutId: string; status: string; error?: string; storagePath?: string; publicUrl?: string }) =>
      assemblerApi.setCutStatus(projectId!, params.cutId, params.status, params),
    onSuccess: () => invalidateAll(),
    onError: (e: Error) => toast.error(e.message),
  });

  const exportBeatlist = useMutation({
    mutationFn: (cutId: string) => assemblerApi.exportBeatlist(projectId!, cutId),
    onError: (e: Error) => toast.error(e.message),
  });

  const fixTrims = useMutation({
    mutationFn: (cutId: string) => assemblerApi.fixTrims(projectId!, cutId),
    onSuccess: (data) => {
      toast.success(`Fixed trims on ${data.fixedCount || 0} beats`);
      invalidateAll();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const validateTrims = useMutation({
    mutationFn: (cutId: string) => assemblerApi.validateTrims(projectId!, cutId),
    onError: (e: Error) => toast.error(e.message),
  });

  return { createCut, updateBeat, reorderBeats, finalizeRun, setCutStatus, exportBeatlist, fixTrims, validateTrims };
}
