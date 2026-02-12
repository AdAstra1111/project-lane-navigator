import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';

export interface FailureContrastEntry {
  id: string;
  title: string;
  year: number | null;
  produced: boolean;
  budget_est: string | null;
  box_office_est: string | null;
  genre: string;
  format: string;
  development_outcome: string;
  primary_weakness: string;
  inciting_incident_page: number | null;
  midpoint_strength: string;
  third_act_strength: string;
  protagonist_agency: string;
  conflict_density: string;
  dialogue_subtext_level: string;
  late_inciting_incident: boolean;
  passive_protagonist: boolean;
  on_the_nose_dialogue: boolean;
  no_midpoint_shift: boolean;
  flat_escalation: boolean;
  costless_climax: boolean;
  notes: string | null;
  dataset_type: string;
  active: boolean;
  created_at: string;
}

export function useFailureContrast(genre?: string) {
  const { user } = useAuth();
  return useQuery({
    queryKey: ['failure-contrast', genre],
    queryFn: async () => {
      let query = supabase
        .from('failure_contrast' as any)
        .select('*')
        .eq('active', true)
        .order('created_at', { ascending: false });
      if (genre) query = query.eq('genre', genre.toLowerCase());
      const { data, error } = await query;
      if (error) throw error;
      return (data || []) as unknown as FailureContrastEntry[];
    },
    enabled: !!user,
  });
}

export function useFailurePatterns() {
  const { data: failures } = useFailureContrast();

  if (!failures?.length) return null;

  const total = failures.length;
  const pctFlag = (field: keyof FailureContrastEntry) =>
    Math.round(failures.filter(f => f[field] === true).length / total * 100);

  return {
    count: total,
    pct_late_inciting: pctFlag('late_inciting_incident'),
    pct_passive_protagonist: pctFlag('passive_protagonist'),
    pct_on_the_nose: pctFlag('on_the_nose_dialogue'),
    pct_no_midpoint: pctFlag('no_midpoint_shift'),
    pct_flat_escalation: pctFlag('flat_escalation'),
    pct_costless_climax: pctFlag('costless_climax'),
    common_weaknesses: [...new Set(failures.map(f => f.primary_weakness).filter(Boolean))],
    by_outcome: {
      flopped: failures.filter(f => f.development_outcome === 'flopped').length,
      critical_failure: failures.filter(f => f.development_outcome === 'critical-failure').length,
      unproduced: failures.filter(f => f.development_outcome === 'unproduced').length,
      development_hell: failures.filter(f => f.development_outcome === 'development-hell').length,
    },
  };
}
