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
      source_text?: string;
      source_url?: string;
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

// ── Reclassify DNA → Engine ──────────────────────────────────────────

export interface EngineClassificationResult {
  primary_engine_key: string;
  secondary_engine_key: string | null;
  candidate_engines: Array<{
    engine_key: string;
    confidence: number;
    matched_traits: string[];
    rejected_traits: string[];
  }>;
  classification_rationale: string;
  ambiguity_flags: string[];
  classification_version: string;
}

export function useReclassifyDna() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const res = await callDna('reclassify', { id });
      return res as {
        success: boolean;
        profile: any;
        classification: EngineClassificationResult;
        diagnostic: any;
      };
    },
    onSuccess: (data, id) => {
      qc.invalidateQueries({ queryKey: ['dna-profile', id] });
      qc.invalidateQueries({ queryKey: ['dna-profiles'] });
      qc.invalidateQueries({ queryKey: ['narrative-engines'] });
      toast.success(`Reclassified → ${data.classification.primary_engine_key}`);
    },
    onError: (err: Error) => {
      toast.error(`Reclassification failed: ${err.message}`);
    },
  });
}

// ── Blueprint Families ───────────────────────────────────────────────

export interface BlueprintFamily {
  id: string;
  engine_key: string;
  family_key: string;
  label: string;
  description: string;
  execution_pattern: Record<string, any>;
  lane_suitability: string[];
  budget_suitability: string[];
  structural_strengths: string[];
  structural_risks: string[];
  when_to_use: string;
  when_not_to_use: string;
  active: boolean;
  created_at: string;
  updated_at: string;
}

export function useBlueprintFamilies(engineKey?: string) {
  return useQuery({
    queryKey: ['blueprint-families', engineKey || 'all'],
    queryFn: async () => {
      const res = await callDna('list_blueprint_families', engineKey ? { engine_key: engineKey } : {});
      return (res.families || []) as BlueprintFamily[];
    },
  });
}

// ── Source Links ──────────────────────────────────────────────────────

export interface DnaSourceLink {
  id: string;
  dna_profile_id: string;
  user_id: string;
  source_label: string;
  source_url: string;
  source_type: string;
  is_primary: boolean;
  notes: string;
  created_at: string;
  updated_at: string;
}

export function useDnaSourceLinks(dnaProfileId: string | undefined) {
  return useQuery({
    queryKey: ['dna-source-links', dnaProfileId],
    queryFn: async () => {
      if (!dnaProfileId) return [];
      const res = await callDna('list_sources', { dna_profile_id: dnaProfileId });
      return (res.links || []) as DnaSourceLink[];
    },
    enabled: !!dnaProfileId,
  });
}

export function useAddDnaSourceLink() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (params: {
      dna_profile_id: string;
      source_label: string;
      source_url: string;
      source_type?: string;
      is_primary?: boolean;
      notes?: string;
    }) => {
      const res = await callDna('add_source', params);
      return res.link as DnaSourceLink;
    },
    onSuccess: (link) => {
      qc.invalidateQueries({ queryKey: ['dna-source-links', link.dna_profile_id] });
      toast.success('Source link added');
    },
    onError: (err: Error) => toast.error(`Add failed: ${err.message}`),
  });
}

export function useUpdateDnaSourceLink() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (params: { id: string; dna_profile_id: string; updates: Record<string, any> }) => {
      const res = await callDna('update_source', { id: params.id, updates: params.updates });
      return { ...res.link, dna_profile_id: params.dna_profile_id } as DnaSourceLink;
    },
    onSuccess: (link) => {
      qc.invalidateQueries({ queryKey: ['dna-source-links', link.dna_profile_id] });
      toast.success('Source link updated');
    },
    onError: (err: Error) => toast.error(`Update failed: ${err.message}`),
  });
}

export function useRemoveDnaSourceLink() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (params: { id: string; dna_profile_id: string }) => {
      await callDna('remove_source', { id: params.id });
      return params;
    },
    onSuccess: (params) => {
      qc.invalidateQueries({ queryKey: ['dna-source-links', params.dna_profile_id] });
      toast.success('Source link removed');
    },
    onError: (err: Error) => toast.error(`Remove failed: ${err.message}`),
  });
}
