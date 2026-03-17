/**
 * usePlateauDiagnosis — Fetches and manages plateau diagnosis data for a project/job.
 */
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';

export interface PlateauDiagnosisRow {
  id: string;
  user_id: string;
  project_id: string;
  auto_run_job_id: string | null;
  pitch_idea_id: string | null;
  source_dna_profile_id: string | null;
  source_blueprint_id: string | null;
  source_blueprint_run_id: string | null;
  generation_mode: string | null;
  optimizer_mode: string | null;
  final_ci: number | null;
  final_gp: number | null;
  target_ci: number;
  target_gp: number;
  best_ci_seen: number | null;
  halted_doc_type: string | null;
  halted_reason: string | null;
  diagnosis_version: string;
  primary_cause: string;
  secondary_causes: string[];
  rewriteable: boolean;
  seed_limited: boolean;
  confidence: string;
  evidence_summary: string[];
  recommendation_bundle: any;
  created_at: string;
}

export function usePlateauDiagnosis(projectId: string | undefined, jobId?: string | null) {
  return useQuery<PlateauDiagnosisRow | null>({
    queryKey: ['plateau-diagnosis', projectId, jobId],
    enabled: !!projectId,
    staleTime: 30_000,
    queryFn: async () => {
      let query = (supabase as any)
        .from('devseed_plateau_diagnoses')
        .select('*')
        .eq('project_id', projectId)
        .order('created_at', { ascending: false })
        .limit(1);

      if (jobId) {
        query = query.eq('auto_run_job_id', jobId);
      }

      const { data, error } = await query.maybeSingle();
      if (error) {
        console.warn('[usePlateauDiagnosis] fetch error:', error.message);
        return null;
      }
      return data ?? null;
    },
  });
}
