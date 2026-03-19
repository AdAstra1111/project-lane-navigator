/**
 * useEntityVisualStates — Story-aware visual state variant management.
 * Manages entity_visual_states: age, injury, costume, time-of-day, damage, etc.
 */
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';

export interface EntityVisualState {
  id: string;
  project_id: string;
  entity_type: 'character' | 'location' | 'object';
  entity_name: string;
  entity_id: string | null;
  state_key: string;
  state_label: string;
  state_category: string;
  parent_state_id: string | null;
  canonical_description: string | null;
  source_reason: string | null;
  story_phase: string | null;
  confidence: string;
  approved_by: string | null;
  approved_at: string | null;
  active: boolean;
  created_at: string;
  updated_at: string;
}

/** Categories for character state variants */
export const CHARACTER_STATE_CATEGORIES = [
  { key: 'age', label: 'Age / Life Stage', examples: 'child, teen, adult, older, elderly' },
  { key: 'injury', label: 'Injury / Damage', examples: 'wounded, scarred, bandaged, healed' },
  { key: 'transformation', label: 'Transformation', examples: 'corrupted, empowered, evolved, cursed' },
  { key: 'costume', label: 'Costume / Wardrobe', examples: 'formal, combat, disguised, ceremonial' },
  { key: 'social_state', label: 'Social State', examples: 'prisoner, wealthy, impoverished, exiled' },
  { key: 'emotional', label: 'Emotional Extreme', examples: 'grief, rage, euphoria, despair' },
] as const;

/** Categories for location state variants */
export const LOCATION_STATE_CATEGORIES = [
  { key: 'time_of_day', label: 'Time of Day', examples: 'day, night, dawn, dusk, golden_hour' },
  { key: 'season', label: 'Season / Weather', examples: 'winter, summer, storm, fog' },
  { key: 'damage', label: 'Damage State', examples: 'intact, damaged, destroyed, rebuilt' },
  { key: 'occupation', label: 'Occupation', examples: 'occupied, abandoned, under_siege, liberated' },
  { key: 'event', label: 'Event / Dressed', examples: 'festival, ceremony, market_day, battle' },
  { key: 'temporal', label: 'Temporal', examples: 'flashback, present, future, alternate' },
] as const;

export function useEntityVisualStates(projectId: string | undefined) {
  const qc = useQueryClient();

  const statesQuery = useQuery({
    queryKey: ['entity-visual-states', projectId],
    queryFn: async () => {
      if (!projectId) return [];
      const { data, error } = await (supabase as any)
        .from('entity_visual_states')
        .select('*')
        .eq('project_id', projectId)
        .eq('active', true)
        .order('entity_type')
        .order('entity_name')
        .order('state_category')
        .order('state_key');
      if (error) throw error;
      return (data || []) as EntityVisualState[];
    },
    enabled: !!projectId,
  });

  const createStateMutation = useMutation({
    mutationFn: async (params: {
      entityType: 'character' | 'location' | 'object';
      entityName: string;
      entityId?: string | null;
      stateKey: string;
      stateLabel: string;
      stateCategory: string;
      parentStateId?: string | null;
      canonicalDescription?: string;
      sourceReason?: string;
      storyPhase?: string;
      confidence?: string;
    }) => {
      if (!projectId) throw new Error('No project');
      const { data, error } = await (supabase as any)
        .from('entity_visual_states')
        .upsert({
          project_id: projectId,
          entity_type: params.entityType,
          entity_name: params.entityName,
          entity_id: params.entityId || null,
          state_key: params.stateKey,
          state_label: params.stateLabel,
          state_category: params.stateCategory,
          parent_state_id: params.parentStateId || null,
          canonical_description: params.canonicalDescription || null,
          source_reason: params.sourceReason || null,
          story_phase: params.storyPhase || null,
          confidence: params.confidence || 'proposed',
          active: true,
        }, { onConflict: 'project_id,entity_type,entity_name,state_key' })
        .select()
        .single();
      if (error) throw error;
      return data as EntityVisualState;
    },
    onSuccess: () => {
      toast.success('Visual state created');
      qc.invalidateQueries({ queryKey: ['entity-visual-states', projectId] });
    },
    onError: (e: Error) => toast.error(`Failed: ${e.message}`),
  });

  const approveStateMutation = useMutation({
    mutationFn: async (params: { stateId: string; userId: string }) => {
      const { error } = await (supabase as any)
        .from('entity_visual_states')
        .update({
          confidence: 'approved',
          approved_by: params.userId,
          approved_at: new Date().toISOString(),
        })
        .eq('id', params.stateId);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success('State approved');
      qc.invalidateQueries({ queryKey: ['entity-visual-states', projectId] });
    },
  });

  const archiveStateMutation = useMutation({
    mutationFn: async (stateId: string) => {
      const { error } = await (supabase as any)
        .from('entity_visual_states')
        .update({ active: false })
        .eq('id', stateId);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['entity-visual-states', projectId] });
    },
  });

  // Get states for a specific entity
  const getStatesForEntity = (entityType: string, entityName: string): EntityVisualState[] => {
    return (statesQuery.data || []).filter(
      s => s.entity_type === entityType && s.entity_name === entityName
    );
  };

  // Get baseline state for entity (always exists implicitly)
  const hasBaseline = (entityType: string, entityName: string): boolean => {
    return getStatesForEntity(entityType, entityName).some(s => s.state_key === 'baseline');
  };

  return {
    states: statesQuery.data || [],
    isLoading: statesQuery.isLoading,
    getStatesForEntity,
    hasBaseline,
    createState: createStateMutation,
    approveState: approveStateMutation,
    archiveState: archiveStateMutation,
    refetch: () => qc.invalidateQueries({ queryKey: ['entity-visual-states', projectId] }),
  };
}
