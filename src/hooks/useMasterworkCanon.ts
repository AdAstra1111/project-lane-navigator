import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';

export interface MasterworkEntry {
  id: string;
  title: string;
  year: number;
  format: string;
  genre: string;
  budget_tier: string;
  monetisation_lane: string;
  awards_recognition: string;
  box_office_tier: string;
  structural_model: string;
  dialogue_density: string;
  thematic_depth: string;
  escalation_pattern: string;
  third_act_type: string;
  act1_break_pct: number | null;
  midpoint_pct: number | null;
  act2_break_pct: number | null;
  inciting_incident_pct: number | null;
  escalation_velocity: string | null;
  scene_purpose_density: string | null;
  character_objective_clarity: string | null;
  dialogue_compression: string | null;
  emotional_layering: string | null;
  dataset_type: string;
  weight: string;
  active: boolean;
  created_at: string;
}

export function useMasterworkCanon(genre?: string) {
  const { user } = useAuth();
  return useQuery({
    queryKey: ['masterwork-canon', genre],
    queryFn: async () => {
      let query = supabase
        .from('masterwork_canon' as any)
        .select('*')
        .eq('active', true)
        .order('year', { ascending: false });
      if (genre) query = query.eq('genre', genre.toLowerCase());
      const { data, error } = await query;
      if (error) throw error;
      return (data || []) as unknown as MasterworkEntry[];
    },
    enabled: !!user,
  });
}

export function useMasterworkBenchmarks(genre?: string, format?: string) {
  const { data: canon } = useMasterworkCanon();
  
  if (!canon?.length) return null;
  
  const scriptFormat = (format || 'film').includes('tv') ? 'tv-pilot' : 'film';
  const g = (genre || '').toLowerCase();
  
  // Filter by genre + format, fall back to format only
  let matched = canon.filter(m => m.genre === g && m.format === scriptFormat);
  if (matched.length < 3) matched = canon.filter(m => m.format === scriptFormat);
  if (!matched.length) matched = canon;
  
  const avg = (key: keyof MasterworkEntry) => {
    const vals = matched.map(m => m[key] as number).filter(v => v != null && !isNaN(v));
    return vals.length ? Math.round(vals.reduce((a, b) => a + b, 0) / vals.length) : null;
  };
  
  return {
    count: matched.length,
    avg_act1_break: avg('act1_break_pct'),
    avg_midpoint: avg('midpoint_pct'),
    avg_act2_break: avg('act2_break_pct'),
    avg_inciting_incident: avg('inciting_incident_pct'),
    common_escalation: [...new Set(matched.map(m => m.escalation_pattern).filter(Boolean))],
    common_third_act: [...new Set(matched.map(m => m.third_act_type).filter(Boolean))],
    common_dialogue_density: [...new Set(matched.map(m => m.dialogue_density).filter(Boolean))],
    scripts: matched,
  };
}
