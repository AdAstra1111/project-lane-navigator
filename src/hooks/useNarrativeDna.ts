/**
 * useNarrativeDna — Hook for Narrative DNA profile CRUD.
 * Phase 1: extract, get, list, update, lock.
 */
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';

export interface DnaProfile {
  id: string;
  user_id: string;
  source_title: string;
  source_type: string;
  source_text_hash: string | null;
  source_text_length: number | null;
  source_ref_json: Record<string, any>;
  spine_json: Record<string, string | null>;
  escalation_architecture: string | null;
  antagonist_pattern: string | null;
  thematic_spine: string | null;
  emotional_cadence: string[];
  world_logic_rules: string[];
  set_piece_grammar: string | null;
  ending_logic: string | null;
  power_dynamic: string | null;
  forbidden_carryovers: string[];
  mutable_variables: string[];
  surface_expression_notes: string | null;
  extraction_json: Record<string, any>;
  extraction_model: string | null;
  extraction_confidence: number | null;
  status: string;
  locked_at: string | null;
  created_at: string;
  updated_at: string;
}

async function callDna(action: string, body: Record<string, any> = {}) {
  const { data, error } = await supabase.functions.invoke('narrative-dna', {
    body: { action, ...body },
  });
  if (error) throw new Error(error.message || 'DNA function call failed');
  if (data?.error) throw new Error(data.error);
  return data;
}

export function useDnaProfiles() {
  return useQuery({
    queryKey: ['dna-profiles'],
    queryFn: async () => {
      const res = await callDna('list');
      return (res.profiles || []) as DnaProfile[];
    },
  });
}

export function useDnaProfile(id: string | undefined) {
  return useQuery({
    queryKey: ['dna-profile', id],
    queryFn: async () => {
      if (!id) return null;
      const res = await callDna('get', { id });
      return res.profile as DnaProfile;
    },
    enabled: !!id,
  });
}

export function useExtractDna() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (params: {
      source_title: string;
      source_type?: string;
      source_text: string;
      source_ref_json?: Record<string, any>;
    }) => {
      const res = await callDna('extract', params);
      return res.profile as DnaProfile;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['dna-profiles'] });
      toast.success('DNA profile extracted');
    },
    onError: (err: Error) => {
      toast.error(`Extraction failed: ${err.message}`);
    },
  });
}

export function useUpdateDna() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (params: { id: string; updates: Record<string, any> }) => {
      const res = await callDna('update', params);
      return res.profile as DnaProfile;
    },
    onSuccess: (_, vars) => {
      qc.invalidateQueries({ queryKey: ['dna-profile', vars.id] });
      qc.invalidateQueries({ queryKey: ['dna-profiles'] });
      toast.success('Profile updated');
    },
    onError: (err: Error) => {
      toast.error(`Update failed: ${err.message}`);
    },
  });
}

export function useLockDna() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const res = await callDna('lock', { id });
      return res.profile as DnaProfile;
    },
    onSuccess: (_, id) => {
      qc.invalidateQueries({ queryKey: ['dna-profile', id] });
      qc.invalidateQueries({ queryKey: ['dna-profiles'] });
      toast.success('Profile locked');
    },
    onError: (err: Error) => {
      toast.error(`Lock failed: ${err.message}`);
    },
  });
}
