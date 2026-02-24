/**
 * Studio Finishing Layer — React Query hooks
 */
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { studioFinishApi } from './studioFinishApi';
import { toast } from 'sonner';

export function useFinishingProfiles(projectId: string | undefined) {
  return useQuery({
    queryKey: ['finishing-profiles', projectId],
    queryFn: () => studioFinishApi.listProfiles(projectId!),
    enabled: !!projectId,
  });
}

export function useRenderVariants(projectId: string | undefined, cutId: string | undefined) {
  return useQuery({
    queryKey: ['render-variants', projectId, cutId],
    queryFn: () => studioFinishApi.getRenderVariants(projectId!, cutId!),
    enabled: !!projectId && !!cutId,
  });
}

export function useStudioFinishMutations(projectId: string | undefined) {
  const qc = useQueryClient();

  const createProfile = useMutation({
    mutationFn: (profile: Record<string, any>) =>
      studioFinishApi.createProfile(projectId!, profile),
    onSuccess: () => {
      toast.success('Finishing profile created');
      qc.invalidateQueries({ queryKey: ['finishing-profiles', projectId] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const createRenderVariants = useMutation({
    mutationFn: (params: {
      cutId: string;
      audioRunId?: string;
      finishingProfileId?: string;
      variantKeys?: string[];
    }) => studioFinishApi.createRenderVariants(projectId!, params),
    onSuccess: (data) => {
      toast.success(`${data.variantCount} render variant(s) queued`);
      qc.invalidateQueries({ queryKey: ['render-variants', projectId] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return { createProfile, createRenderVariants };
}
