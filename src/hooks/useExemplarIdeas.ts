import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { toast } from 'sonner';
import type { PitchIdea } from '@/hooks/usePitchIdeas';

export interface ExemplarFilters {
  search?: string;
  ciMin?: number;
  gpMin?: number;
  format?: string;
  lane?: string;
  genre?: string;
  engine?: string;
  budgetBand?: string;
  approvedOnly?: boolean;
  sortBy?: 'relevance' | 'ci_desc' | 'gp_desc' | 'newest';
}

/** Deterministic similarity score for "find similar" */
export function computeSimilarityScore(source: PitchIdea, candidate: PitchIdea): number {
  let score = 0;
  // Same format bonus
  if (source.production_type === candidate.production_type) score += 25;
  // Same lane bonus
  if (source.recommended_lane === candidate.recommended_lane) score += 20;
  // Same genre bonus
  if (source.genre && candidate.genre && source.genre.toLowerCase() === candidate.genre.toLowerCase()) score += 20;
  // Same engine bonus
  if (source.source_engine_key && candidate.source_engine_key && source.source_engine_key === candidate.source_engine_key) score += 15;
  // CI normalized contribution (0-20)
  score += Math.min(20, (Number(candidate.score_total) || 0) / 5);
  return Math.round(score);
}

export function useExemplarIdeas(filters: ExemplarFilters = {}) {
  const { user } = useAuth();

  const { data: exemplars = [], isLoading, error } = useQuery({
    queryKey: ['exemplar-ideas', filters],
    queryFn: async () => {
      const ciMin = filters.ciMin ?? 95;

      let query = supabase
        .from('pitch_ideas')
        .select('*')
        .gte('score_total', ciMin) as any;

      // Approved-only filter
      if (filters.approvedOnly) {
        query = query.eq('is_exemplar', true);
      }

      // Metadata filters
      if (filters.format) query = query.eq('production_type', filters.format);
      if (filters.lane) query = query.eq('recommended_lane', filters.lane);
      if (filters.genre) query = query.ilike('genre', `%${filters.genre}%`);
      if (filters.engine) query = query.eq('source_engine_key', filters.engine);
      if (filters.budgetBand) query = query.eq('budget_band', filters.budgetBand);

      // Text search on title + logline
      if (filters.search && filters.search.trim()) {
        const term = `%${filters.search.trim()}%`;
        query = query.or(`title.ilike.${term},logline.ilike.${term}`);
      }

      // Sorting
      switch (filters.sortBy) {
        case 'gp_desc':
          query = query.order('score_feasibility', { ascending: false, nullsFirst: false });
          break;
        case 'newest':
          query = query.order('created_at', { ascending: false });
          break;
        case 'ci_desc':
        default:
          query = query.order('score_total', { ascending: false, nullsFirst: false });
          break;
      }

      query = query.limit(100);

      const { data, error } = await query;
      if (error) throw error;
      return (data || []) as PitchIdea[];
    },
    enabled: !!user,
  });

  return { exemplars, isLoading, error };
}

export function useSimilarExemplars(sourceIdea: PitchIdea | null) {
  const { user } = useAuth();

  return useQuery({
    queryKey: ['similar-exemplars', sourceIdea?.id],
    queryFn: async () => {
      if (!sourceIdea) return [];
      // Fetch all high-CI ideas (excluding self)
      const { data, error } = await (supabase
        .from('pitch_ideas')
        .select('*')
        .gte('score_total', 90)
        .neq('id', sourceIdea.id)
        .order('score_total', { ascending: false, nullsFirst: false })
        .limit(200) as any);
      if (error) throw error;
      const candidates = (data || []) as PitchIdea[];
      // Score and rank
      return candidates
        .map(c => ({ ...c, _similarityScore: computeSimilarityScore(sourceIdea, c) }))
        .sort((a, b) => b._similarityScore - a._similarityScore)
        .slice(0, 20);
    },
    enabled: !!user && !!sourceIdea,
  });
}

export function useToggleExemplar() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, is_exemplar }: { id: string; is_exemplar: boolean }) => {
      const { error } = await supabase
        .from('pitch_ideas')
        .update({ is_exemplar } as any)
        .eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['exemplar-ideas'] });
      qc.invalidateQueries({ queryKey: ['pitch-ideas'] });
      toast.success('Exemplar status updated');
    },
  });
}
