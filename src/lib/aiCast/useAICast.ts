/**
 * AI Cast Library — React Query hooks
 */
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { aiCastApi } from './aiCastApi';
import { toast } from 'sonner';

export function useAIActors() {
  return useQuery({
    queryKey: ['ai-actors'],
    queryFn: () => aiCastApi.listActors(),
  });
}

export function useAIActor(actorId: string | undefined) {
  return useQuery({
    queryKey: ['ai-actor', actorId],
    queryFn: () => aiCastApi.getActor(actorId!),
    enabled: !!actorId,
  });
}

export function useCastContext(projectId: string | undefined) {
  return useQuery({
    queryKey: ['cast-context', projectId],
    queryFn: () => aiCastApi.getCastContext(projectId!),
    enabled: !!projectId,
  });
}

export function useAICastMutations() {
  const qc = useQueryClient();
  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ['ai-actors'] });
    qc.invalidateQueries({ queryKey: ['ai-actor'] });
  };

  const createActor = useMutation({
    mutationFn: (params: { name: string; description?: string; negative_prompt?: string; tags?: string[] }) =>
      aiCastApi.createActor(params),
    onSuccess: (data) => {
      toast.success(`Actor "${data.actor.name}" created`);
      invalidate();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const updateActor = useMutation({
    mutationFn: (params: { actorId: string } & Partial<{ name: string; description: string; negative_prompt: string; tags: string[]; status: string }>) => {
      const { actorId, ...rest } = params;
      return aiCastApi.updateActor(actorId, rest);
    },
    onSuccess: () => { toast.success('Actor updated'); invalidate(); },
    onError: (e: Error) => toast.error(e.message),
  });

  const createVersion = useMutation({
    mutationFn: (params: { actorId: string; recipe_json?: any }) =>
      aiCastApi.createVersion(params.actorId, params.recipe_json),
    onSuccess: () => { toast.success('Version created'); invalidate(); },
    onError: (e: Error) => toast.error(e.message),
  });

  const approveVersion = useMutation({
    mutationFn: (params: { actorId: string; versionId: string }) =>
      aiCastApi.approveVersion(params.actorId, params.versionId),
    onSuccess: () => { toast.success('Version approved'); invalidate(); },
    onError: (e: Error) => toast.error(e.message),
  });

  const addAsset = useMutation({
    mutationFn: (params: { versionId: string; asset_type?: string; storage_path?: string; public_url?: string; meta_json?: any }) => {
      const { versionId, ...rest } = params;
      return aiCastApi.addAsset(versionId, rest);
    },
    onSuccess: () => { toast.success('Asset added'); invalidate(); },
    onError: (e: Error) => toast.error(e.message),
  });

  const deleteAsset = useMutation({
    mutationFn: (assetId: string) => aiCastApi.deleteAsset(assetId),
    onSuccess: () => { toast.success('Asset removed'); invalidate(); },
    onError: (e: Error) => toast.error(e.message),
  });

  const generateScreenTest = useMutation({
    mutationFn: (params: { actorId: string; versionId: string; count?: number }) =>
      aiCastApi.generateScreenTest(params.actorId, params.versionId, params.count),
    onSuccess: (data) => {
      if (data.code === 'SCREEN_TEST_NOT_CONFIGURED') {
        toast.info('Screen test generation not available — upload reference images manually.');
      } else {
        toast.success(`Generated ${data.generated} screen test stills`);
      }
      invalidate();
    },
    onError: (e: Error) => {
      if (e.message?.includes('not configured')) {
        toast.info('Screen test generation not available — upload reference images manually.');
      } else {
        toast.error(e.message);
      }
    },
  });

  return { createActor, updateActor, createVersion, approveVersion, addAsset, deleteAsset, generateScreenTest };
}
