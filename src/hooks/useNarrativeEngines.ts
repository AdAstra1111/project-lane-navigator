/**
 * useNarrativeEngines — Hooks for Narrative Engine Atlas.
 */
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';

export interface NarrativeEngine {
  id: string;
  engine_key: string;
  engine_name: string;
  label: string | null;
  description: string;
  structural_traits: Record<string, string> | null;
  antagonist_topology: string | null;
  escalation_pattern: string | null;
  protagonist_pressure_mode: string | null;
  spatial_logic: string | null;
  failure_modes: string[];
  example_titles: string[];
  structural_pattern: string | null;
  active: boolean;
  taxonomy_version: number | null;
  profile_count: number;
  created_at: string;
  updated_at: string;
}

export interface EngineLinkedProfile {
  id: string;
  source_title: string;
  source_type: string;
  status: string;
  extraction_confidence: number | null;
  primary_engine_key: string | null;
  secondary_engine_key: string | null;
  created_at: string;
}

async function callDna(action: string, body: Record<string, any> = {}) {
  const { data, error } = await supabase.functions.invoke('narrative-dna', {
    body: { action, ...body },
  });
  if (error) throw new Error(error.message || 'DNA function call failed');
  if (data?.error) throw new Error(data.error);
  return data;
}

export function useNarrativeEngines() {
  return useQuery({
    queryKey: ['narrative-engines'],
    queryFn: async () => {
      const res = await callDna('list_engines');
      return (res.engines || []) as NarrativeEngine[];
    },
  });
}

export function useNarrativeEngine(engineKey: string | undefined) {
  return useQuery({
    queryKey: ['narrative-engine', engineKey],
    queryFn: async () => {
      if (!engineKey) return null;
      const res = await callDna('get_engine', { engine_key: engineKey });
      return {
        engine: res.engine as NarrativeEngine,
        profiles: (res.profiles || []) as EngineLinkedProfile[],
      };
    },
    enabled: !!engineKey,
  });
}
