/**
 * useTeamVoices — CRUD + generation hooks for Team Voice profiles.
 */
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';

export interface TeamVoiceProfile {
  summary: string;
  do: string[];
  dont: string[];
  knobs: {
    dialogue_ratio?: number;
    sentence_len_band?: [number, number];
    description_density?: string;
    subtext_level?: string;
    humor_temperature?: string;
    pace?: string;
    tone_tags?: string[];
  };
  signature_moves?: string[];
  banned_moves?: string[];
  examples?: { micro_example?: string; rewrite_rule_example?: string };
}

export interface TeamVoice {
  id: string;
  owner_user_id: string;
  label: string;
  description: string | null;
  lane_group: string | null;
  profile_json: TeamVoiceProfile;
  created_at: string;
  updated_at: string;
}

export interface TeamVoiceSource {
  docId: string;
  versionId?: string;
  title?: string;
  isCowritten?: boolean;
  cowriterLabels?: string[];
  projectId?: string;
}

const VOICES_KEY = (userId: string) => ['team-voices', userId];

export function useTeamVoices(userId: string | undefined) {
  const qc = useQueryClient();

  const listQuery = useQuery<TeamVoice[]>({
    queryKey: VOICES_KEY(userId || ''),
    queryFn: async () => {
      if (!userId) return [];
      const { data, error } = await (supabase as any)
        .from('team_voices')
        .select('*')
        .eq('owner_user_id', userId)
        .order('updated_at', { ascending: false });
      if (error) throw error;
      return data || [];
    },
    enabled: !!userId,
    staleTime: 60_000,
  });

  const buildMutation = useMutation({
    mutationFn: async (params: {
      label: string;
      description?: string;
      projectId: string;
      lane?: string;
      sources: TeamVoiceSource[];
    }) => {
      const { data, error } = await supabase.functions.invoke('team-voice-engine', {
        body: {
          action: 'build_team_voice',
          ...params,
        },
      });
      if (error) throw new Error(error.message);
      return data.teamVoice as TeamVoice;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: VOICES_KEY(userId || '') });
    },
  });

  const updateMutation = useMutation({
    mutationFn: async (params: {
      teamVoiceId: string;
      description?: string;
      sources?: TeamVoiceSource[];
    }) => {
      const { data, error } = await supabase.functions.invoke('team-voice-engine', {
        body: {
          action: 'update_team_voice',
          ...params,
        },
      });
      if (error) throw new Error(error.message);
      return data.teamVoice as TeamVoice;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: VOICES_KEY(userId || '') });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (teamVoiceId: string) => {
      const { error } = await (supabase as any)
        .from('team_voices')
        .delete()
        .eq('id', teamVoiceId);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: VOICES_KEY(userId || '') });
    },
  });

  return {
    voices: listQuery.data || [],
    isLoading: listQuery.isLoading,
    buildTeamVoice: buildMutation,
    updateTeamVoice: updateMutation,
    deleteTeamVoice: deleteMutation,
  };
}
