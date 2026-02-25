/**
 * Storyboard Pipeline v1 — React Query hooks
 */
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { storyboardApi } from './storyboardApi';
import { toast } from 'sonner';

export function useCanonicalUnits(projectId: string | undefined, unitKeys?: string[]) {
  return useQuery({
    queryKey: ['sb-canonical-units', projectId, unitKeys],
    queryFn: () => storyboardApi.listCanonicalUnits(projectId!, unitKeys),
    enabled: !!projectId,
  });
}

export function useStoryboardRuns(projectId: string | undefined) {
  return useQuery({
    queryKey: ['sb-runs', projectId],
    queryFn: () => storyboardApi.listRuns(projectId!),
    enabled: !!projectId,
  });
}

export function useStoryboardPanels(projectId: string | undefined, runId: string | undefined) {
  return useQuery({
    queryKey: ['sb-panels', projectId, runId],
    queryFn: () => storyboardApi.listPanels(projectId!, runId!),
    enabled: !!projectId && !!runId,
  });
}

export function useStoryboardPanel(projectId: string | undefined, panelId: string | undefined) {
  return useQuery({
    queryKey: ['sb-panel', projectId, panelId],
    queryFn: () => storyboardApi.getPanel(projectId!, panelId!),
    enabled: !!projectId && !!panelId,
  });
}

export function useStoryboardMutations(projectId: string | undefined) {
  const qc = useQueryClient();

  const invalidateAll = () => {
    qc.invalidateQueries({ queryKey: ['sb-runs', projectId] });
    qc.invalidateQueries({ queryKey: ['sb-panels', projectId] });
    qc.invalidateQueries({ queryKey: ['sb-panel', projectId] });
  };

  const createRunAndPanels = useMutation({
    mutationFn: (params?: { unitKeys?: string[]; stylePreset?: string; aspectRatio?: string; includeDocumentIds?: string[] }) =>
      storyboardApi.createRunAndPanels(projectId!, params?.unitKeys, params?.stylePreset, params?.aspectRatio, params?.includeDocumentIds),
    onSuccess: (data) => {
      toast.success(`Panel plan created: ${data.panelsCount} panels`);
      invalidateAll();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const generateFrame = useMutation({
    mutationFn: (params: { panelId: string; seed?: string; override_prompt?: string; override_negative?: string }) =>
      storyboardApi.generateFrame(projectId!, params.panelId, params),
    onSuccess: () => {
      toast.success('Frame generated');
      invalidateAll();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const regenerateFrame = useMutation({
    mutationFn: (params: { panelId: string; seed?: string; override_prompt?: string; override_negative?: string }) =>
      storyboardApi.regenerateFrame(projectId!, params.panelId, params),
    onSuccess: () => {
      toast.success('Frame regenerated');
      invalidateAll();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return { createRunAndPanels, generateFrame, regenerateFrame };
}
