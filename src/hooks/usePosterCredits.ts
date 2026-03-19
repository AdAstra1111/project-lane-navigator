/**
 * usePosterCredits — Manage structured poster billing credits per project.
 * Credits are stored in poster_credits table and used by PosterCompositor.
 */
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';

export interface PosterCredits {
  id: string;
  project_id: string;
  title_override: string | null;
  tagline: string | null;
  written_by: string[];
  produced_by: string[];
  company_name: string;
  created_by_credit: string | null;
  based_on_credit: string | null;
}

const DEFAULT_CREDITS: Omit<PosterCredits, 'id' | 'project_id'> = {
  title_override: null,
  tagline: null,
  written_by: ['Sebastian Street'],
  produced_by: ['Sebastian Street', 'Merlin Merton', 'Alex Chang', 'Greer Ellison'],
  company_name: 'Paradox House',
  created_by_credit: null,
  based_on_credit: null,
};

export function usePosterCredits(projectId: string | undefined) {
  return useQuery({
    queryKey: ['poster-credits', projectId],
    queryFn: async (): Promise<PosterCredits> => {
      if (!projectId) throw new Error('No project ID');

      const { data, error } = await (supabase as any)
        .from('poster_credits')
        .select('*')
        .eq('project_id', projectId)
        .maybeSingle();

      if (error) throw error;

      if (data) {
        return {
          id: data.id,
          project_id: data.project_id,
          title_override: data.title_override,
          tagline: data.tagline,
          written_by: data.written_by || [],
          produced_by: data.produced_by || [],
          company_name: data.company_name || '',
          created_by_credit: data.created_by_credit,
          based_on_credit: data.based_on_credit,
        };
      }

      // Auto-create with defaults
      const { data: user } = await supabase.auth.getUser();
      if (!user?.user?.id) throw new Error('Not authenticated');

      const { data: created, error: createErr } = await (supabase as any)
        .from('poster_credits')
        .insert({
          project_id: projectId,
          user_id: user.user.id,
          ...DEFAULT_CREDITS,
        })
        .select('*')
        .single();

      if (createErr) throw createErr;

      return {
        id: created.id,
        project_id: created.project_id,
        title_override: created.title_override,
        tagline: created.tagline,
        written_by: created.written_by || [],
        produced_by: created.produced_by || [],
        company_name: created.company_name || '',
        created_by_credit: created.created_by_credit,
        based_on_credit: created.based_on_credit,
      };
    },
    enabled: !!projectId,
    staleTime: 10 * 60 * 1000,
  });
}

export function useUpdatePosterCredits(projectId: string | undefined) {
  const qc = useQueryClient();

  return useMutation({
    mutationFn: async (updates: Partial<Omit<PosterCredits, 'id' | 'project_id'>>) => {
      if (!projectId) throw new Error('No project ID');

      const { error } = await (supabase as any)
        .from('poster_credits')
        .update({ ...updates, updated_at: new Date().toISOString() })
        .eq('project_id', projectId);

      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['poster-credits', projectId] });
      toast.success('Poster credits updated');
    },
    onError: (e: any) => {
      toast.error(e.message || 'Failed to update credits');
    },
  });
}
