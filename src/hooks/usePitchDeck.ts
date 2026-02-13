import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';

export interface PitchSlide {
  slide_type: string;
  headline: string;
  subheadline?: string;
  body: string;
  bullet_points?: string[];
  pull_quote?: string;
  project_data?: Record<string, any>;
}

export interface PitchDeck {
  id: string;
  project_id: string;
  user_id: string;
  slides: PitchSlide[];
  tone: string;
  share_token: string;
  status: string;
  created_at: string;
  updated_at: string;
}

export function usePitchDecks(projectId?: string) {
  const queryClient = useQueryClient();

  const { data: decks = [], isLoading } = useQuery({
    queryKey: ['pitch-decks', projectId],
    queryFn: async () => {
      if (!projectId) return [];
      const { data, error } = await supabase
        .from('pitch_decks' as any)
        .select('*')
        .eq('project_id', projectId)
        .order('created_at', { ascending: false });
      if (error) throw error;
      return (data || []) as unknown as PitchDeck[];
    },
    enabled: !!projectId,
  });

  const generate = useMutation({
    mutationFn: async (projectId: string) => {
      const { data, error } = await supabase.functions.invoke('generate-pitch-deck', {
        body: { project_id: projectId },
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      return data as { deck_id: string; share_token: string; slides: PitchSlide[] };
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['pitch-decks', projectId] });
      toast.success('Pitch deck generated');
    },
    onError: (err: any) => {
      toast.error(err.message || 'Failed to generate pitch deck');
    },
  });

  return { decks, isLoading, generate };
}

export function usePitchDeckByToken(token?: string) {
  return useQuery({
    queryKey: ['pitch-deck-shared', token],
    queryFn: async () => {
      if (!token) return null;
      const { data, error } = await supabase
        .from('pitch_decks' as any)
        .select('*')
        .eq('share_token', token)
        .eq('status', 'ready')
        .single();
      if (error) throw error;
      return data as unknown as PitchDeck;
    },
    enabled: !!token,
  });
}
