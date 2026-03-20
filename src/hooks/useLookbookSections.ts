/**
 * useLookbookSections — Manages canonical lookbook section structure.
 * Handles bootstrap, rebuild, and status tracking.
 */
import { useCallback, useMemo } from 'react';
import { useQuery, useQueryClient, useMutation } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';

export interface LookbookSection {
  id: string;
  project_id: string;
  section_key: string;
  section_label: string;
  display_order: number;
  section_status: string;
  pack_count: number;
  slot_count: number;
  readiness_state: string;
  metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

const CANONICAL_SECTION_KEYS = [
  'character_identity',
  'world_locations',
  'atmosphere_lighting',
  'texture_detail',
  'symbolic_motifs',
  'key_moments',
  'poster_directions',
] as const;

export type CanonicalSectionKey = typeof CANONICAL_SECTION_KEYS[number];

/** Upstream source descriptions per section */
export const SECTION_UPSTREAM_MAP: Record<CanonicalSectionKey, {
  label: string;
  icon: string;
  sources: string[];
  populateCta: string;
}> = {
  character_identity: {
    label: 'Character Identity',
    icon: 'User',
    sources: ['Approved character identity images', 'Headshots & profile angles', 'Full-body anchors', 'Identity lock / DNA status'],
    populateCta: 'Pull from Cast Identity',
  },
  world_locations: {
    label: 'World & Locations',
    icon: 'Globe',
    sources: ['Canon-bound locations', 'Approved world/location refs', 'Location pack readiness'],
    populateCta: 'Pull from World References',
  },
  atmosphere_lighting: {
    label: 'Atmosphere & Lighting',
    icon: 'Sun',
    sources: ['Approved mood/atmospheric images', 'Visual Style Authority profile', 'Temporal/time-of-day refs'],
    populateCta: 'Derive from Visual Pipeline',
  },
  texture_detail: {
    label: 'Texture & Detail',
    icon: 'Layers',
    sources: ['Detail shots', 'Material/prop/surface references', 'Environmental texture frames'],
    populateCta: 'Pull from Detail References',
  },
  symbolic_motifs: {
    label: 'Symbolic Motifs',
    icon: 'Sparkles',
    sources: ['Curated symbolic references', 'Approved imagery with symbolic tags'],
    populateCta: 'Curate from Approved Images',
  },
  key_moments: {
    label: 'Key Moments',
    icon: 'Sparkles',
    sources: ['Tableau compositions', 'Medium shots', 'Close-ups', 'Wide establishing shots'],
    populateCta: 'Generate Key Moment Shots',
  },
  poster_directions: {
    label: 'Poster Directions',
    icon: 'Image',
    sources: ['Poster concepts', 'Primary poster', 'Poster families / selected variants'],
    populateCta: 'Pull from Poster Studio',
  },
};

export function useLookbookSections(projectId: string | undefined) {
  const qc = useQueryClient();
  const queryKey = ['lookbook-sections', projectId];

  const { data: sections, isLoading } = useQuery({
    queryKey,
    queryFn: async () => {
      if (!projectId) return [];
      const { data, error } = await (supabase as any)
        .from('lookbook_sections')
        .select('*')
        .eq('project_id', projectId)
        .order('display_order', { ascending: true });
      if (error) throw error;
      return (data || []) as LookbookSection[];
    },
    enabled: !!projectId,
    staleTime: 60_000,
  });

  const isBootstrapped = (sections?.length || 0) >= CANONICAL_SECTION_KEYS.length;
  const hasAnySections = (sections?.length || 0) > 0;
  const missingCount = CANONICAL_SECTION_KEYS.length - (sections?.length || 0);

  const structureStatus = useMemo(() => {
    if (!sections || sections.length === 0) return 'invalid_structure' as const;
    if (sections.length < CANONICAL_SECTION_KEYS.length) return 'invalid_structure' as const;
    if (sections.every(s => s.section_status === 'fully_populated')) return 'fully_populated' as const;
    if (sections.some(s => s.section_status !== 'empty_but_bootstrapped')) return 'partially_populated' as const;
    return 'empty_but_bootstrapped' as const;
  }, [sections]);

  const bootstrapMutation = useMutation({
    mutationFn: async () => {
      if (!projectId) throw new Error('No project ID');
      const { data, error } = await (supabase as any).rpc('bootstrap_lookbook_sections', {
        p_project_id: projectId,
      });
      if (error) throw error;
      return data;
    },
    onSuccess: (data: any) => {
      qc.invalidateQueries({ queryKey });
      const status = data?.status || 'bootstrapped';
      if (status === 'repaired') {
        toast.success('Lookbook structure repaired — missing sections restored');
      } else if (status === 'bootstrapped') {
        toast.success('Lookbook structure created');
      }
    },
    onError: (e: any) => {
      toast.error(e.message || 'Failed to bootstrap lookbook');
    },
  });

  const bootstrap = useCallback(() => {
    if (!bootstrapMutation.isPending) {
      bootstrapMutation.mutate();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId]);

  const updateSectionStatus = useCallback(async (
    sectionKey: string,
    updates: Partial<Pick<LookbookSection, 'section_status' | 'pack_count' | 'slot_count' | 'readiness_state' | 'metadata'>>,
  ) => {
    if (!projectId) return;
    const { error } = await (supabase as any)
      .from('lookbook_sections')
      .update(updates)
      .eq('project_id', projectId)
      .eq('section_key', sectionKey);
    if (error) {
      console.error('[lookbook_bootstrap_violation] section update failed:', error.message);
      return;
    }
    qc.invalidateQueries({ queryKey });
  }, [projectId, qc, queryKey]);

  return {
    sections: sections || [],
    isLoading,
    isBootstrapped,
    hasAnySections,
    missingCount,
    structureStatus,
    bootstrap,
    isBootstrapping: bootstrapMutation.isPending,
    updateSectionStatus,
  };
}
