import { useState, useCallback } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import {
  qcRun,
  qcListRuns,
  qcListIssues,
  qcUpdateIssueStatus,
  qcGenerateFixChangeSet,
} from '@/lib/scene-graph/client';
import type { QCRun, QCIssue, QCPassType, QCIssueSeverity } from '@/lib/scene-graph/types';

export function useQCEngine(projectId: string | undefined) {
  const qc = useQueryClient();
  const [selectedRunId, setSelectedRunId] = useState<string | null>(null);
  const [severityFilter, setSeverityFilter] = useState<QCIssueSeverity | null>(null);
  const [categoryFilter, setCategoryFilter] = useState<QCPassType | null>(null);
  const [statusFilter, setStatusFilter] = useState<string | null>(null);

  const invalidate = useCallback(() => {
    qc.invalidateQueries({ queryKey: ['qc-runs', projectId] });
    qc.invalidateQueries({ queryKey: ['qc-issues', projectId, selectedRunId] });
  }, [qc, projectId, selectedRunId]);

  const runsQuery = useQuery({
    queryKey: ['qc-runs', projectId],
    queryFn: async () => {
      if (!projectId) return [];
      const result = await qcListRuns({ projectId });
      return result.runs || [];
    },
    enabled: !!projectId,
  });

  const issuesQuery = useQuery({
    queryKey: ['qc-issues', projectId, selectedRunId, severityFilter, categoryFilter, statusFilter],
    queryFn: async () => {
      if (!projectId || !selectedRunId) return [];
      const result = await qcListIssues({
        projectId,
        qcRunId: selectedRunId,
        severity: severityFilter || undefined,
        category: categoryFilter || undefined,
        status: statusFilter || undefined,
      });
      return result.issues || [];
    },
    enabled: !!projectId && !!selectedRunId,
  });

  const runMutation = useMutation({
    mutationFn: async (params: { mode?: 'latest' | 'approved_prefer'; passes?: QCPassType[]; forceRebuildSpine?: boolean; forceRebuildLedger?: boolean }) => {
      if (!projectId) throw new Error('No project');
      return qcRun({ projectId, ...params });
    },
    onSuccess: (data) => {
      setSelectedRunId(data.qc_run_id);
      invalidate();
      const s = data.summary;
      toast.success(`QC complete: ${s.total} issues (${s.critical} critical, ${s.high} high)`);
    },
    onError: (e: Error) => toast.error(`QC run failed: ${e.message}`),
  });

  const updateStatusMutation = useMutation({
    mutationFn: async (params: { issueId: string; status: 'open' | 'acknowledged' | 'fixed' | 'dismissed' }) => {
      if (!projectId) throw new Error('No project');
      return qcUpdateIssueStatus({ projectId, ...params });
    },
    onSuccess: () => { invalidate(); },
    onError: (e: Error) => toast.error(`Update failed: ${e.message}`),
  });

  const generateFixMutation = useMutation({
    mutationFn: async (params: { issueIds?: string[]; goalLabel?: string }) => {
      if (!projectId || !selectedRunId) throw new Error('No project/run');
      return qcGenerateFixChangeSet({ projectId, qcRunId: selectedRunId, ...params });
    },
    onSuccess: (data) => {
      invalidate();
      qc.invalidateQueries({ queryKey: ['change-sets', projectId] });
      toast.success(`Fix change set created`);
    },
    onError: (e: Error) => toast.error(`Generate fix failed: ${e.message}`),
  });

  return {
    runs: (runsQuery.data || []) as QCRun[],
    isRunsLoading: runsQuery.isLoading,
    selectedRunId,
    setSelectedRunId,
    issues: (issuesQuery.data || []) as QCIssue[],
    isIssuesLoading: issuesQuery.isLoading,

    severityFilter,
    setSeverityFilter,
    categoryFilter,
    setCategoryFilter,
    statusFilter,
    setStatusFilter,

    runQC: runMutation,
    updateIssueStatus: updateStatusMutation,
    generateFix: generateFixMutation,
  };
}
