/**
 * Storyboard Export — React Query hooks
 */
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { storyboardExportApi } from './storyboardExportApi';
import { toast } from 'sonner';

export function useExports(projectId: string | undefined, runId: string | undefined) {
  return useQuery({
    queryKey: ['sb-exports', projectId, runId],
    queryFn: () => storyboardExportApi.getExports(projectId!, runId),
    enabled: !!projectId && !!runId,
    refetchInterval: 5000,
  });
}

export function useExportMutations(projectId: string | undefined) {
  const qc = useQueryClient();

  const createExport = useMutation({
    mutationFn: (params: { runId: string; exportType: string; options?: any }) =>
      storyboardExportApi.createExport(projectId!, params.runId, params.exportType, params.options),
    onSuccess: (data) => {
      if (data.publicUrl) {
        toast.success('Export ready!');
        window.open(data.publicUrl, '_blank');
      } else {
        toast.success('Export created');
      }
      qc.invalidateQueries({ queryKey: ['sb-exports', projectId] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const deleteExport = useMutation({
    mutationFn: (exportId: string) => storyboardExportApi.deleteExport(projectId!, exportId),
    onSuccess: () => {
      toast.info('Export deleted');
      qc.invalidateQueries({ queryKey: ['sb-exports', projectId] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return { createExport, deleteExport };
}
