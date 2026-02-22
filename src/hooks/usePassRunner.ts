import { useState, useCallback } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { runPass, listPassRuns, getPassRun } from '@/lib/scene-graph/client';
import type { PassRun, PassType, PassSettings } from '@/lib/scene-graph/types';

export function usePassRunner(projectId: string | undefined) {
  const qc = useQueryClient();
  const [selectedRunId, setSelectedRunId] = useState<string | null>(null);

  const invalidate = useCallback(() => {
    qc.invalidateQueries({ queryKey: ['pass-runs', projectId] });
  }, [qc, projectId]);

  const runsQuery = useQuery({
    queryKey: ['pass-runs', projectId],
    queryFn: async () => {
      if (!projectId) return [];
      const result = await listPassRuns({ projectId });
      return result.runs || [];
    },
    enabled: !!projectId,
  });

  const runDetailQuery = useQuery({
    queryKey: ['pass-run-detail', projectId, selectedRunId],
    queryFn: async () => {
      if (!projectId || !selectedRunId) return null;
      const result = await getPassRun({ projectId, passRunId: selectedRunId });
      return result;
    },
    enabled: !!projectId && !!selectedRunId,
  });

  const runPassMutation = useMutation({
    mutationFn: async (params: { passType: PassType; mode?: 'approved_prefer' | 'latest'; settings?: PassSettings }) => {
      if (!projectId) throw new Error('No project');
      return runPass({ projectId, ...params });
    },
    onSuccess: (data) => {
      setSelectedRunId(data.pass_run?.id || null);
      invalidate();
      qc.invalidateQueries({ queryKey: ['change-sets', projectId] });
      const count = data.selected_scenes?.length || 0;
      if (data.change_set_id) {
        toast.success(`Pass complete: ${count} scenes rewritten. Change Set created.`);
      } else {
        toast.info('Pass complete: no eligible scenes found.');
      }
    },
    onError: (e: Error) => toast.error(`Pass failed: ${e.message}`),
  });

  return {
    runs: (runsQuery.data || []) as PassRun[],
    isRunsLoading: runsQuery.isLoading,
    selectedRunId,
    setSelectedRunId,
    runDetail: runDetailQuery.data,
    isDetailLoading: runDetailQuery.isLoading,

    runPass: runPassMutation,
  };
}
