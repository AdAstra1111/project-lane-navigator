import { useState, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { matchBuyersToProject, type BuyerMatch } from '@/lib/buyer-matcher';
import { useProjectCast } from '@/hooks/useProjectAttachments';

export function useBuyerMatches(project: {
  id: string;
  format: string;
  genres: string[];
  budget_range: string;
  tone: string;
  target_audience: string;
  assigned_lane: string | null;
} | null) {
  const { cast } = useProjectCast(project?.id);

  const { data: buyers = [], isLoading: buyersLoading } = useQuery({
    queryKey: ['market-buyers'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('market_buyers')
        .select('*')
        .eq('status', 'active');
      if (error) throw error;
      return data as any[];
    },
    enabled: !!project,
  });

  const matches = useMemo(() => {
    if (!project || buyers.length === 0) return [];
    const castTerritories = [...new Set(cast.flatMap(c => c.territory_tags))];
    return matchBuyersToProject(buyers, {
      format: project.format,
      genres: project.genres,
      budget_range: project.budget_range,
      tone: project.tone,
      target_audience: project.target_audience,
      assigned_lane: project.assigned_lane,
      cast_territories: castTerritories,
    });
  }, [project, buyers, cast]);

  return { matches, buyersLoading, hasBuyers: buyers.length > 0 };
}

export function useResearchBuyers() {
  const [isResearching, setIsResearching] = useState(false);

  const research = async (project: {
    format: string;
    genres: string[];
    budget_range: string;
    tone: string;
    target_audience: string;
  }) => {
    setIsResearching(true);
    try {
      const { data, error } = await supabase.functions.invoke('research-buyers', {
        body: {
          format: project.format,
          genres: project.genres,
          budget_range: project.budget_range,
          tone: project.tone,
          target_audience: project.target_audience,
          territories: [],
        },
      });
      if (error) throw error;
      return data;
    } finally {
      setIsResearching(false);
    }
  };

  return { research, isResearching };
}
