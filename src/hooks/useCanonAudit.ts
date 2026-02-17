/**
 * useCanonAudit — Hook for Series Writer canon audit pipeline.
 * Manages continuity runs, issues, fix applications, and polling.
 */
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { useEffect, useRef } from 'react';
import { recordCanonFix } from '@/lib/decisions/client';

export interface ContinuityIssue {
  id: string;
  run_id: string;
  project_id: string;
  episode_number: number;
  severity: 'BLOCKER' | 'MAJOR' | 'MINOR' | 'NIT';
  issue_type: string;
  title: string;
  claim_in_episode: string | null;
  conflicts_with: any[];
  why_it_conflicts: string | null;
  fix_options: string[];
  proposed_patch: any;
  status: 'open' | 'applied' | 'dismissed';
  created_at: string;
}

export interface ContinuityRun {
  id: string;
  project_id: string;
  episode_number: number;
  episode_version_id: string;
  status: 'running' | 'completed' | 'completed_with_blockers' | 'failed';
  summary: string | null;
  results_json: any;
  created_at: string;
  finished_at: string | null;
}

export function useCanonAudit(projectId: string, episodeNumber: number | null) {
  const qc = useQueryClient();
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const runKey = ['canon-audit-run', projectId, episodeNumber];
  const issuesKey = ['canon-audit-issues', projectId, episodeNumber];

  // ── Latest run for this episode ──
  const { data: latestRun, isLoading: runLoading } = useQuery({
    queryKey: runKey,
    queryFn: async () => {
      if (!episodeNumber) return null;
      const { data } = await (supabase as any)
        .from('series_continuity_runs')
        .select('*')
        .eq('project_id', projectId)
        .eq('episode_number', episodeNumber)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      return (data as ContinuityRun) || null;
    },
    enabled: !!projectId && !!episodeNumber,
  });

  // ── Issues for latest run ──
  const { data: issues = [], isLoading: issuesLoading } = useQuery({
    queryKey: issuesKey,
    queryFn: async () => {
      if (!latestRun?.id) return [];
      const { data } = await (supabase as any)
        .from('series_continuity_issues')
        .select('*')
        .eq('run_id', latestRun.id)
        .order('created_at');
      return (data as ContinuityIssue[]) || [];
    },
    enabled: !!latestRun?.id,
  });

  // ── Poll while running ──
  const runStatus = latestRun?.status as string | undefined;
  useEffect(() => {
    if (runStatus === 'running') {
      pollRef.current = setInterval(() => {
        qc.invalidateQueries({ queryKey: runKey });
      }, 5000);
    } else {
      if (pollRef.current) clearInterval(pollRef.current);
      // Also refresh issues when run completes
      if (runStatus && runStatus !== 'running') {
        qc.invalidateQueries({ queryKey: issuesKey });
      }
    }
    return () => { if (pollRef.current) clearInterval(pollRef.current); };
  }, [runStatus, latestRun?.id]);

  // ── Start audit ──
  const startAudit = useMutation({
    mutationFn: async (params: { episodeVersionId?: string }) => {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) throw new Error('Not authenticated');

      const resp = await supabase.functions.invoke('series-continuity-audit', {
        body: {
          projectId,
          episodeNumber,
          episodeVersionId: params.episodeVersionId || null,
        },
      });
      if (resp.error) throw new Error(resp.error.message || 'Audit failed');
      return resp.data;
    },
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: runKey });
      qc.invalidateQueries({ queryKey: issuesKey });
      if (data?.status === 'completed_with_blockers') {
        toast.warning(`Audit found BLOCKERS — resolve before publishing`);
      } else if (data?.status === 'completed') {
        toast.success(`Canon audit passed ✓`);
      }
    },
    onError: (e: Error) => toast.error(`Audit failed: ${e.message}`),
  });

  // ── Apply fix ──
  const applyFix = useMutation({
    mutationFn: async (params: { issueId: string; selectedFixOption?: string }) => {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) throw new Error('Not authenticated');

      const resp = await supabase.functions.invoke('series-apply-continuity-fix', {
        body: {
          projectId,
          runId: latestRun?.id,
          issueId: params.issueId,
          episodeNumber,
          episodeVersionId: latestRun?.episode_version_id,
          selectedFixOption: params.selectedFixOption || undefined,
        },
      });
      if (resp.error) throw new Error(resp.error.message || 'Fix failed');
      return resp.data;
    },
    onSuccess: (data, variables) => {
      toast.success(data?.message || 'Fix applied');
      qc.invalidateQueries({ queryKey: runKey });
      qc.invalidateQueries({ queryKey: issuesKey });
      qc.invalidateQueries({ queryKey: ['series-episodes', projectId] });
      // Record canon fix to decision ledger
      recordCanonFix({
        projectId,
        runId: latestRun?.id,
        issueId: variables.issueId,
        episodeNumber: episodeNumber || undefined,
        selectedFixOption: variables.selectedFixOption,
      }).catch(e => console.warn('[decisions] canon fix record failed:', e));
      // Auto re-audit after fix
      setTimeout(() => {
        startAudit.mutate({ episodeVersionId: data?.newScriptId });
      }, 1000);
    },
    onError: (e: Error) => toast.error(`Fix failed: ${e.message}`),
  });

  // ── Dismiss issue ──
  const dismissIssue = useMutation({
    mutationFn: async (issueId: string) => {
      await (supabase as any).from('series_continuity_issues')
        .update({ status: 'dismissed' })
        .eq('id', issueId);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: issuesKey });
      toast.info('Issue dismissed');
    },
  });

  // ── Derived state ──
  const openIssues = issues.filter((i: ContinuityIssue) => i.status === 'open');
  const hasBlockers = openIssues.some((i: ContinuityIssue) => i.severity === 'BLOCKER');
  const blockerCount = openIssues.filter((i: ContinuityIssue) => i.severity === 'BLOCKER').length;
  const majorCount = openIssues.filter((i: ContinuityIssue) => i.severity === 'MAJOR').length;
  const isRunning = latestRun?.status === 'running' || startAudit.isPending;

  return {
    latestRun,
    issues,
    openIssues,
    hasBlockers,
    blockerCount,
    majorCount,
    isRunning,
    isApplyingFix: applyFix.isPending,
    startAudit,
    applyFix,
    dismissIssue,
    runLoading,
    issuesLoading,
  };
}
