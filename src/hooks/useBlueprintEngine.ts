import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { toast } from 'sonner';

export interface BlueprintRun {
  id: string;
  user_id: string;
  status: string;
  config: Record<string, any>;
  exemplar_ids: string[];
  trend_signal_ids: string[];
  source_idea_ids: string[];
  blueprint_count: number;
  candidate_count: number;
  error: string | null;
  created_at: string;
  updated_at: string;
}

export interface Blueprint {
  id: string;
  run_id: string;
  user_id: string;
  format: string;
  lane: string;
  genre: string;
  engine: string | null;
  budget_band: string;
  structural_patterns: Record<string, any>;
  market_design: Record<string, any>;
  derived_from_idea_ids: string[];
  trend_inputs: any[];
  exemplar_inputs: any[];
  score_pattern: Record<string, any>;
  status: string;
  created_at: string;
}

export interface BlueprintCandidate {
  id: string;
  blueprint_id: string;
  run_id: string;
  user_id: string;
  pitch_idea_id: string | null;
  title: string;
  logline: string;
  one_page_pitch: string;
  genre: string;
  format: string;
  lane: string;
  engine: string | null;
  budget_band: string;
  score_market_heat: number;
  score_feasibility: number;
  score_lane_fit: number;
  score_saturation_risk: number;
  score_company_fit: number;
  score_total: number;
  raw_response: Record<string, any>;
  promotion_status: string;
  promotion_source: string | null;
  promoted_at: string | null;
  promoted_pitch_idea_id: string | null;
  provenance: Record<string, any>;
  created_at: string;
}

export interface BuildConfig {
  format: string;
  lane: string;
  genre: string;
  engine: string;
  budgetBand: string;
  candidateCount: number;
  useTrends: boolean;
  useExemplars: boolean;
  ciMin: number;
}

export function useBlueprintRuns() {
  const { user } = useAuth();
  return useQuery({
    queryKey: ['blueprint-runs'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('idea_blueprint_runs')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(50);
      if (error) throw error;
      return (data || []) as unknown as BlueprintRun[];
    },
    enabled: !!user,
  });
}

export function useBlueprintCandidates(runId: string | null) {
  const { user } = useAuth();
  return useQuery({
    queryKey: ['blueprint-candidates', runId],
    queryFn: async () => {
      if (!runId) return [];
      const { data, error } = await supabase
        .from('idea_blueprint_candidates')
        .select('*')
        .eq('run_id', runId)
        .order('score_total', { ascending: false });
      if (error) throw error;
      return (data || []) as unknown as BlueprintCandidate[];
    },
    enabled: !!user && !!runId,
  });
}

export function useBlueprints(runId: string | null) {
  const { user } = useAuth();
  return useQuery({
    queryKey: ['blueprints', runId],
    queryFn: async () => {
      if (!runId) return [];
      const { data, error } = await supabase
        .from('idea_blueprints')
        .select('*')
        .eq('run_id', runId)
        .order('created_at', { ascending: false });
      if (error) throw error;
      return (data || []) as unknown as Blueprint[];
    },
    enabled: !!user && !!runId,
  });
}

export function useBuildBlueprint() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (config: BuildConfig) => {
      const { data, error } = await supabase.functions.invoke('ci-blueprint-engine', {
        body: { action: 'build', ...config },
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      return data as { run_id: string; blueprint_id: string; candidates: BlueprintCandidate[]; source_idea_count: number; trend_count: number };
    },
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: ['blueprint-runs'] });
      qc.invalidateQueries({ queryKey: ['blueprint-candidates', data.run_id] });
      qc.invalidateQueries({ queryKey: ['blueprints', data.run_id] });
      toast.success(`Generated ${data.candidates.length} candidates from ${data.source_idea_count} elite ideas`);
    },
    onError: (e: any) => toast.error(e.message || 'Blueprint generation failed'),
  });
}

export function usePromoteCandidate() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (candidateId: string) => {
      const { data, error } = await supabase.functions.invoke('ci-blueprint-engine', {
        body: { action: 'promote', candidateId },
      });
      if (error) throw error;
      if (data?.error) {
        const msg = data.failures?.length
          ? `${data.error}: ${data.failures.join(', ')}`
          : data.error;
        throw new Error(msg);
      }
      return data as { pitch_idea_id: string; candidate_id: string };
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['blueprint-candidates'] });
      qc.invalidateQueries({ queryKey: ['pitch-ideas'] });
      toast.success('Candidate promoted to Pitch Idea');
    },
    onError: (e: any) => toast.error(e.message || 'Promotion failed'),
  });
}
