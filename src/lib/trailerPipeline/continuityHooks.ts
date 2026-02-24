/**
 * Continuity Intelligence v1 — React Query hooks
 */
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { continuityApi } from './continuityApi';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';

// ─── Queries ───

export function useContinuityRuns(projectId: string | undefined, trailerCutId: string | undefined) {
  return useQuery({
    queryKey: ['continuity-runs', projectId, trailerCutId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('trailer_continuity_runs')
        .select('*')
        .eq('project_id', projectId!)
        .eq('trailer_cut_id', trailerCutId!)
        .order('created_at', { ascending: false });
      if (error) throw error;
      return data || [];
    },
    enabled: !!projectId && !!trailerCutId,
  });
}

export function useContinuityScores(continuityRunId: string | undefined) {
  return useQuery({
    queryKey: ['continuity-scores', continuityRunId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('trailer_continuity_scores')
        .select('*')
        .eq('continuity_run_id', continuityRunId!)
        .order('from_beat_index');
      if (error) throw error;
      return data || [];
    },
    enabled: !!continuityRunId,
  });
}

// ─── Mutations ───

export function useContinuityMutations(projectId: string | undefined) {
  const qc = useQueryClient();

  const tagClips = useMutation({
    mutationFn: (params: { clipRunId?: string; blueprintId?: string; limit?: number }) =>
      continuityApi.tagClips({ projectId: projectId!, ...params }),
    onSuccess: (data) => {
      toast.success(`Tagged ${data.tagged} clips with continuity metadata`);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const runJudge = useMutation({
    mutationFn: (params: { trailerCutId: string; continuitySettings?: Record<string, any> }) =>
      continuityApi.runJudge({ projectId: projectId!, ...params }),
    onSuccess: (data) => {
      const score = data.avgScore ?? data.avg_score ?? 0;
      if (score >= 0.75) {
        toast.success(`Continuity judge: ${(score * 100).toFixed(0)}% avg score`);
      } else if (score >= 0.6) {
        toast.warning(`Continuity judge: ${(score * 100).toFixed(0)}% — some transitions flagged`);
      } else {
        toast.error(`Continuity judge: ${(score * 100).toFixed(0)}% — significant issues found`);
      }
      qc.invalidateQueries({ queryKey: ['continuity-runs', projectId] });
      qc.invalidateQueries({ queryKey: ['continuity-scores'] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const buildFixPlan = useMutation({
    mutationFn: (params: { trailerCutId: string; continuityRunId: string }) =>
      continuityApi.buildFixPlan({ projectId: projectId!, ...params }),
    onSuccess: (data) => {
      const count = data.actions?.length || 0;
      toast.success(`Fix plan: ${count} action(s), confidence ${((data.confidence || 0) * 100).toFixed(0)}%`);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const applyFixPlan = useMutation({
    mutationFn: (params: { trailerCutId: string; continuityRunId?: string; plan: any; dryRun?: boolean }) =>
      continuityApi.applyFixPlan({ projectId: projectId!, ...params }),
    onSuccess: (data) => {
      if (data.dryRun) {
        toast.info(`Dry run: ${data.diff?.length || 0} changes previewed`);
      } else {
        toast.success(`Applied ${data.applied} continuity fixes`);
        qc.invalidateQueries({ queryKey: ['trailer-cut-detail', projectId] });
        qc.invalidateQueries({ queryKey: ['trailer-cuts-list', projectId] });
      }
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return { tagClips, runJudge, buildFixPlan, applyFixPlan };
}
