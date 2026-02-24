/**
 * Look Bible React Query hooks
 */
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { fetchLookBible, upsertLookBible, type LookBible } from './lookBibleApi';
import { toast } from 'sonner';

export function useLookBible(projectId: string | undefined, scopeRefId?: string) {
  return useQuery({
    queryKey: ['look-bible', projectId, scopeRefId],
    queryFn: () => fetchLookBible(projectId!, scopeRefId),
    enabled: !!projectId,
  });
}

export function useLookBibleMutation(projectId: string | undefined) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (lb: Partial<LookBible>) =>
      upsertLookBible({ ...lb, project_id: projectId! }),
    onSuccess: () => {
      toast.success('Look Bible saved');
      qc.invalidateQueries({ queryKey: ['look-bible', projectId] });
    },
    onError: (e: Error) => toast.error(e.message),
  });
}
