import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { toast } from 'sonner';

export interface PitchIdea {
  id: string;
  user_id: string;
  project_id: string | null;
  brief_id: string | null;
  mode: 'greenlight' | 'coverage-transform';
  production_type: string;
  title: string;
  logline: string;
  one_page_pitch: string;
  comps: string[];
  recommended_lane: string;
  lane_confidence: number;
  budget_band: string;
  packaging_suggestions: any[];
  development_sprint: any[];
  risks_mitigations: any[];
  why_us: string;
  genre: string;
  region: string;
  platform_target: string;
  risk_level: string;
  source_coverage_run_id: string | null;
  raw_response: any;
  status: string;
  score_market_heat: number;
  score_feasibility: number;
  score_lane_fit: number;
  score_saturation_risk: number;
  score_company_fit: number;
  score_total: number;
  created_at: string;
  updated_at: string;
}

export interface PitchFeedback {
  id: string;
  pitch_idea_id: string;
  user_id: string;
  rating: 'strong' | 'meh' | 'no';
  direction: 'more' | 'less' | null;
  tags: string[];
  created_at: string;
}

export function usePitchIdeas() {
  const { user } = useAuth();
  const qc = useQueryClient();

  const { data: ideas = [], isLoading } = useQuery({
    queryKey: ['pitch-ideas'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('pitch_ideas')
        .select('*')
        .order('created_at', { ascending: false });
      if (error) throw error;
      return data as PitchIdea[];
    },
    enabled: !!user,
  });

  const saveMutation = useMutation({
    mutationFn: async (idea: Partial<PitchIdea>) => {
      const { data, error } = await supabase
        .from('pitch_ideas')
        .insert({ ...idea, user_id: user!.id } as any)
        .select()
        .single();
      if (error) throw error;
      return data;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['pitch-ideas'] }),
  });

  const updateMutation = useMutation({
    mutationFn: async ({ id, ...updates }: { id: string } & Partial<PitchIdea>) => {
      const { error } = await supabase
        .from('pitch_ideas')
        .update(updates as any)
        .eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['pitch-ideas'] }),
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from('pitch_ideas').delete().eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['pitch-ideas'] });
      toast.success('Idea deleted');
    },
  });

  return { ideas, isLoading, save: saveMutation.mutateAsync, update: updateMutation.mutateAsync, remove: deleteMutation.mutateAsync };
}

export function usePitchFeedback(pitchId: string) {
  const { user } = useAuth();
  const qc = useQueryClient();

  const { data: feedback = [] } = useQuery({
    queryKey: ['pitch-feedback', pitchId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('pitch_feedback')
        .select('*')
        .eq('pitch_idea_id', pitchId);
      if (error) throw error;
      return data as PitchFeedback[];
    },
    enabled: !!user && !!pitchId,
  });

  const submitFeedback = useMutation({
    mutationFn: async (fb: { rating: string; direction?: string; tags: string[] }) => {
      const { error } = await supabase.from('pitch_feedback').insert({
        pitch_idea_id: pitchId,
        user_id: user!.id,
        ...fb,
      } as any);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['pitch-feedback', pitchId] });
      toast.success('Feedback submitted');
    },
  });

  return { feedback, submitFeedback: submitFeedback.mutateAsync };
}
