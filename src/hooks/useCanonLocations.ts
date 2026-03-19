/**
 * useCanonLocations — Structured location canon management.
 * Reads/writes canon_locations table for governed location entities.
 */
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';

export interface CanonLocation {
  id: string;
  project_id: string;
  canonical_name: string;
  normalized_name: string;
  location_type: string;
  interior_or_exterior: string | null;
  geography: string | null;
  era_relevance: string | null;
  story_importance: string;
  recurring: boolean;
  description: string | null;
  associated_characters: string[];
  source_document_ids: string[];
  provenance: string | null;
  active: boolean;
  created_at: string;
  updated_at: string;
}

export function useCanonLocations(projectId: string | undefined) {
  const qc = useQueryClient();

  const locationsQuery = useQuery({
    queryKey: ['canon-locations', projectId],
    queryFn: async () => {
      if (!projectId) return [];
      const { data, error } = await (supabase as any)
        .from('canon_locations')
        .select('*')
        .eq('project_id', projectId)
        .eq('active', true)
        .order('story_importance', { ascending: true })
        .order('canonical_name', { ascending: true });
      if (error) throw error;
      return (data || []) as CanonLocation[];
    },
    enabled: !!projectId,
  });

  const seedFromCanonMutation = useMutation({
    mutationFn: async (params: { canonJson: any; documentSources?: string[] }) => {
      if (!projectId) throw new Error('No project');
      const { canonJson, documentSources = [] } = params;

      const rawLocations: Array<{
        name: string;
        description?: string;
        type?: string;
        interior_or_exterior?: string;
        geography?: string;
        era?: string;
        importance?: string;
        recurring?: boolean;
        characters?: string[];
      }> = [];

      // Extract from locations array
      const locArr = canonJson?.locations || canonJson?.settings || canonJson?.key_locations;
      if (Array.isArray(locArr)) {
        for (const loc of locArr) {
          if (typeof loc === 'string') {
            const name = loc.trim();
            if (name && name !== 'Unknown') {
              rawLocations.push({ name });
            }
          } else if (loc && typeof loc === 'object') {
            const name = (loc.name || loc.location_name || loc.setting || '').trim();
            if (!name || name === 'Unknown') continue;
            rawLocations.push({
              name,
              description: loc.description || loc.visual_description || loc.atmosphere || undefined,
              type: loc.type || loc.location_type || 'location',
              interior_or_exterior: loc.interior_or_exterior || loc.int_ext || undefined,
              geography: loc.geography || undefined,
              era: loc.era || loc.era_relevance || loc.period || undefined,
              importance: loc.importance_level || loc.story_importance || 'secondary',
              recurring: loc.recurring ?? false,
              characters: loc.characters || loc.associated_characters || [],
            });
          }
        }
      }

      // Extract from scene headings / world_description as fallback
      if (rawLocations.length === 0) {
        const worldDesc = canonJson?.world_description || canonJson?.setting;
        if (typeof worldDesc === 'string' && worldDesc.length > 5) {
          rawLocations.push({
            name: 'Primary World',
            description: worldDesc.slice(0, 500),
            importance: 'primary',
          });
        }
      }

      // Extract from scenes if available
      if (Array.isArray(canonJson?.scenes)) {
        const seenNames = new Set(rawLocations.map(l => l.name.toLowerCase()));
        for (const scene of canonJson.scenes) {
          const locName = (scene.location || scene.setting || '').trim();
          if (locName && !seenNames.has(locName.toLowerCase())) {
            seenNames.add(locName.toLowerCase());
            rawLocations.push({
              name: locName,
              interior_or_exterior: scene.int_ext || undefined,
              importance: 'secondary',
            });
          }
        }
      }

      if (rawLocations.length === 0) {
        throw new Error('No locations found in story data');
      }

      // Upsert into canon_locations
      const rows = rawLocations.slice(0, 20).map(loc => ({
        project_id: projectId,
        canonical_name: loc.name,
        normalized_name: loc.name.toLowerCase().replace(/[^a-z0-9]+/g, '_'),
        location_type: loc.type || 'location',
        interior_or_exterior: loc.interior_or_exterior || null,
        geography: loc.geography || null,
        era_relevance: loc.era || null,
        story_importance: loc.importance || 'secondary',
        recurring: loc.recurring || false,
        description: loc.description || null,
        associated_characters: loc.characters || [],
        source_document_ids: documentSources,
        provenance: 'canon_extraction',
        active: true,
      }));

      const { data, error } = await (supabase as any)
        .from('canon_locations')
        .upsert(rows, { onConflict: 'project_id,normalized_name' })
        .select();
      if (error) throw error;
      return (data || []) as CanonLocation[];
    },
    onSuccess: (data) => {
      toast.success(`Seeded ${data.length} location(s) from story`);
      qc.invalidateQueries({ queryKey: ['canon-locations', projectId] });
    },
    onError: (e: Error) => toast.error(`Location seeding failed: ${e.message}`),
  });

  const updateLocationMutation = useMutation({
    mutationFn: async (params: { id: string; updates: Partial<CanonLocation> }) => {
      const { error } = await (supabase as any)
        .from('canon_locations')
        .update(params.updates)
        .eq('id', params.id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['canon-locations', projectId] }),
  });

  return {
    locations: locationsQuery.data || [],
    isLoading: locationsQuery.isLoading,
    seedFromCanon: seedFromCanonMutation,
    updateLocation: updateLocationMutation,
    refetch: () => qc.invalidateQueries({ queryKey: ['canon-locations', projectId] }),
  };
}
