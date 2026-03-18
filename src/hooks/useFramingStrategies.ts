/**
 * useFramingStrategies — CRUD hooks for Creative Framing Engine.
 */
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import type { FramingStrategy, ContentType } from '@/lib/framing/types';
import { mapRowToStrategy } from '@/lib/framing/types';

const QUERY_KEY = 'framing-strategies';

export function useFramingStrategies(projectId: string | undefined, contentType: ContentType = 'poster') {
  return useQuery({
    queryKey: [QUERY_KEY, projectId, contentType],
    queryFn: async (): Promise<FramingStrategy[]> => {
      if (!projectId) return [];
      const { data, error } = await (supabase as any)
        .from('creative_framing_strategies')
        .select('*')
        .eq('project_id', projectId)
        .eq('content_type', contentType)
        .order('generated_at', { ascending: true });
      if (error) throw error;
      return (data || []).map(mapRowToStrategy);
    },
    enabled: !!projectId,
  });
}

export function useSelectedFraming(projectId: string | undefined, contentType: ContentType = 'poster') {
  return useQuery({
    queryKey: [QUERY_KEY, projectId, contentType, 'selected'],
    queryFn: async (): Promise<FramingStrategy | null> => {
      if (!projectId) return null;
      const { data, error } = await (supabase as any)
        .from('creative_framing_strategies')
        .select('*')
        .eq('project_id', projectId)
        .eq('content_type', contentType)
        .eq('is_selected', true)
        .limit(1)
        .maybeSingle();
      if (error) throw error;
      return data ? mapRowToStrategy(data) : null;
    },
    enabled: !!projectId,
  });
}

export function useGenerateFraming(projectId: string | undefined) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (contentType: ContentType) => {
      const { data, error } = await supabase.functions.invoke('generate-framing', {
        body: { projectId, contentType },
      });
      if (error) throw error;
      return data;
    },
    onSuccess: (_data, contentType) => {
      toast.success('Framing strategies generated');
      qc.invalidateQueries({ queryKey: [QUERY_KEY, projectId, contentType] });
    },
    onError: (e: Error) => {
      if (e.message?.includes('429') || e.message?.includes('Rate limit')) {
        toast.error('Rate limit reached. Please try again in a moment.');
      } else if (e.message?.includes('402')) {
        toast.error('Usage credits exhausted. Please add credits.');
      } else {
        toast.error(e.message || 'Failed to generate strategies');
      }
    },
  });
}

export function useSelectFraming(projectId: string | undefined) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ strategyId, contentType }: { strategyId: string; contentType: ContentType }) => {
      // Deselect all for this content type
      await (supabase as any)
        .from('creative_framing_strategies')
        .update({ is_selected: false })
        .eq('project_id', projectId)
        .eq('content_type', contentType);

      // Select chosen
      const { error } = await (supabase as any)
        .from('creative_framing_strategies')
        .update({ is_selected: true })
        .eq('id', strategyId);
      if (error) throw error;
    },
    onSuccess: (_, { contentType }) => {
      toast.success('Strategy selected');
      qc.invalidateQueries({ queryKey: [QUERY_KEY, projectId, contentType] });
    },
    onError: (e: Error) => toast.error(e.message),
  });
}
