import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';

export interface CommercialProofEntry {
  id: string;
  title: string;
  year: number;
  format: string;
  genre: string;
  budget_tier: string;
  production_budget_est: string | null;
  worldwide_gross_est: string | null;
  roi_tier: string;
  franchise_potential: string;
  audience_target: string;
  streamer_appeal: string;
  hook_clarity: string;
  concept_simplicity: string;
  trailer_moment_density: string;
  international_travelability: string;
  dataset_type: string;
  weight: string;
  active: boolean;
  created_at: string;
}

export function useCommercialProof(genre?: string) {
  const { user } = useAuth();
  return useQuery({
    queryKey: ['commercial-proof', genre],
    queryFn: async () => {
      let query = supabase
        .from('commercial_proof' as any)
        .select('*')
        .eq('active', true)
        .order('year', { ascending: false });
      if (genre) query = query.eq('genre', genre.toLowerCase());
      const { data, error } = await query;
      if (error) throw error;
      return (data || []) as unknown as CommercialProofEntry[];
    },
    enabled: !!user,
  });
}

export function useCommercialBenchmarks(genre?: string, format?: string) {
  const { data: proof } = useCommercialProof();

  if (!proof?.length) return null;

  const scriptFormat = (format || 'film').includes('tv') ? 'tv-pilot' : 'film';
  const g = (genre || '').toLowerCase();

  let matched = proof.filter(m => m.genre === g && m.format === scriptFormat);
  if (matched.length < 3) matched = proof.filter(m => m.format === scriptFormat);
  if (!matched.length) matched = proof;

  const pctHigh = (field: keyof CommercialProofEntry) =>
    Math.round(matched.filter(m => m[field] === 'high').length / matched.length * 100);

  return {
    count: matched.length,
    pct_high_hook_clarity: pctHigh('hook_clarity'),
    pct_high_concept_simplicity: pctHigh('concept_simplicity'),
    pct_high_trailer_moments: pctHigh('trailer_moment_density'),
    pct_high_travelability: pctHigh('international_travelability'),
    pct_high_streamer_appeal: pctHigh('streamer_appeal'),
    common_roi: [...new Set(matched.map(m => m.roi_tier).filter(Boolean))],
    common_franchise: [...new Set(matched.map(m => m.franchise_potential).filter(Boolean))],
    common_audience: [...new Set(matched.map(m => m.audience_target).filter(Boolean))],
    scripts: matched,
  };
}
