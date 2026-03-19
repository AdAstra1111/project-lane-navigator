/**
 * useVisualDecision — Unified recommend → choose → lock → propagate hook.
 * 
 * Every visual decision in IFFY follows this model:
 * - recommended_value: system-generated, can update when new assets appear
 * - selected_value: user-chosen, persists until explicitly cleared
 * - effective_value: selected_value ?? recommended_value
 * 
 * Decisions are persisted in visual_decisions table, project-scoped.
 */
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useCallback } from 'react';
import { toast } from 'sonner';

// ── Decision Domains ─────────────────────────────────────────────────────────

export type DecisionDomain =
  | 'poster_style'
  | 'poster_primary'
  | 'lookbook_section_image'
  | 'curated_asset_choice'
  | 'buyer_package_slot_image';

export interface VisualDecision {
  id: string;
  project_id: string;
  decision_domain: DecisionDomain;
  target_scope: string;
  target_key: string | null;
  recommended_value: string | null;
  recommended_reason: string | null;
  recommended_at: string | null;
  selected_value: string | null;
  selected_at: string | null;
  is_locked: boolean;
  updated_at: string;
}

export interface DecisionState {
  recommended: string | null;
  recommendedReason: string | null;
  selected: string | null;
  effective: string | null;
  isUserSelected: boolean;
  isLocked: boolean;
  decision: VisualDecision | null;
  isLoading: boolean;
}

// ── Recommendation Engines ───────────────────────────────────────────────────

export type RecommendFn = (projectId: string) => Promise<{
  value: string;
  reason: string;
} | null>;

/**
 * Poster style recommender — picks based on project lane/genre.
 */
export async function recommendPosterStyle(projectId: string): Promise<{ value: string; reason: string } | null> {
  const { data: project } = await (supabase as any)
    .from('projects')
    .select('assigned_lane, genre, format')
    .eq('id', projectId)
    .maybeSingle();

  if (!project) return null;

  const lane = (project.assigned_lane || '').toLowerCase();
  const genre = (project.genre || '').toLowerCase();

  if (lane === 'prestige' || genre.includes('drama') || genre.includes('arthouse')) {
    return { value: 'prestige', reason: 'Prestige lane / drama genre — minimal, festival-style poster works best for awards positioning' };
  }
  if (lane === 'mainstream' || genre.includes('thriller') || genre.includes('action') || genre.includes('horror')) {
    return { value: 'commercial', reason: 'Mainstream lane / commercial genre — bold typography and high contrast for wide audience appeal' };
  }
  if (genre.includes('sci-fi') || genre.includes('fantasy')) {
    return { value: 'cinematic-dark', reason: 'Genre film — cinematic dark template provides dramatic depth for world-building genres' };
  }
  return { value: 'cinematic-dark', reason: 'Default recommendation — cinematic dark is the most versatile theatrical template' };
}

/**
 * Primary poster recommender — picks the best poster variant.
 */
export async function recommendPrimaryPoster(projectId: string): Promise<{ value: string; reason: string } | null> {
  const { data: posters } = await (supabase as any)
    .from('project_posters')
    .select('id, layout_variant, version_number, status')
    .eq('project_id', projectId)
    .eq('status', 'ready')
    .order('version_number', { ascending: false });

  if (!posters?.length) return null;

  // Prefer character or prestige strategies as they tend to be strongest
  const preferred = ['character', 'prestige', 'conflict', 'world', 'commercial', 'genre'];
  for (const strategy of preferred) {
    const match = posters.find((p: any) => p.layout_variant === strategy);
    if (match) {
      return {
        value: match.id,
        reason: `"${strategy}" poster direction recommended — typically strongest for sales and pitch materials`,
      };
    }
  }

  return { value: posters[0].id, reason: 'Most recent poster version' };
}

/**
 * Lookbook section image recommender — picks the best image for a section slot.
 */
export async function recommendLookbookSectionImage(
  projectId: string,
  sectionKey: string,
): Promise<{ value: string; reason: string } | null> {
  const strategyMap: Record<string, string> = {
    world: 'lookbook_world',
    character: 'lookbook_character',
    key_moment: 'lookbook_key_moment',
    visual_language: 'lookbook_visual_language',
  };
  const strategyKey = strategyMap[sectionKey];
  if (!strategyKey) return null;

  const { data: images } = await (supabase as any)
    .from('project_images')
    .select('id, curation_state, is_primary, created_at')
    .eq('project_id', projectId)
    .eq('strategy_key', strategyKey)
    .in('curation_state', ['active', 'candidate'])
    .order('is_primary', { ascending: false })
    .order('created_at', { ascending: false });

  if (!images?.length) return null;

  // Prefer already-curated active, then most recent candidate
  const active = images.find((i: any) => i.curation_state === 'active');
  if (active) {
    return { value: active.id, reason: 'Already curated as active in image repository' };
  }
  return { value: images[0].id, reason: 'Most recent candidate image for this section' };
}

// Registry of all recommenders
const RECOMMENDERS: Partial<Record<DecisionDomain, RecommendFn>> = {
  poster_style: recommendPosterStyle,
  poster_primary: recommendPrimaryPoster,
};

// ── Core Hook ────────────────────────────────────────────────────────────────

/**
 * useVisualDecision — Single decision point with recommend/select/effective.
 */
export function useVisualDecision(
  projectId: string | undefined,
  domain: DecisionDomain,
  targetScope: string = 'project',
  targetKey: string | null = null,
): DecisionState & {
  select: (value: string) => void;
  clearSelection: () => void;
  refreshRecommendation: () => void;
  isMutating: boolean;
} {
  const qc = useQueryClient();
  const queryKey = ['visual-decision', projectId, domain, targetScope, targetKey];

  const { data: decision, isLoading } = useQuery({
    queryKey,
    queryFn: async (): Promise<VisualDecision | null> => {
      if (!projectId) return null;

      let query = (supabase as any)
        .from('visual_decisions')
        .select('*')
        .eq('project_id', projectId)
        .eq('decision_domain', domain)
        .eq('target_scope', targetScope);

      if (targetKey) {
        query = query.eq('target_key', targetKey);
      } else {
        query = query.is('target_key', null);
      }

      const { data, error } = await query.maybeSingle();
      if (error) throw error;
      return data as VisualDecision | null;
    },
    enabled: !!projectId,
    staleTime: 5 * 60 * 1000,
  });

  const recommended = decision?.recommended_value || null;
  const selected = decision?.selected_value || null;
  const effective = selected || recommended;
  const isUserSelected = !!selected;
  const isLocked = decision?.is_locked || false;

  const upsertMutation = useMutation({
    mutationFn: async (updates: Record<string, unknown>) => {
      if (!projectId) throw new Error('No project');
      const { data: user } = await supabase.auth.getUser();
      if (!user?.user?.id) throw new Error('Not authenticated');

      const { error } = await (supabase as any)
        .from('visual_decisions')
        .upsert({
          project_id: projectId,
          user_id: user.user.id,
          decision_domain: domain,
          target_scope: targetScope,
          target_key: targetKey,
          ...updates,
        }, {
          onConflict: 'project_id,decision_domain,target_scope,target_key',
        });
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey });
    },
    onError: (e: Error) => {
      toast.error(e.message || 'Decision update failed');
    },
  });

  const select = useCallback((value: string) => {
    upsertMutation.mutate({
      selected_value: value,
      selected_at: new Date().toISOString(),
      is_locked: true,
    });
  }, [upsertMutation]);

  const clearSelection = useCallback(() => {
    upsertMutation.mutate({
      selected_value: null,
      selected_at: null,
      is_locked: false,
    });
    toast.success('Returned to recommended selection');
  }, [upsertMutation]);

  const refreshRecommendation = useCallback(async () => {
    if (!projectId) return;
    const recommender = RECOMMENDERS[domain];
    if (!recommender) return;

    try {
      const result = await recommender(projectId);
      if (result) {
        upsertMutation.mutate({
          recommended_value: result.value,
          recommended_reason: result.reason,
          recommended_at: new Date().toISOString(),
        });
      }
    } catch (e) {
      console.warn(`[useVisualDecision] Recommendation failed for ${domain}:`, e);
    }
  }, [projectId, domain, upsertMutation]);

  return {
    recommended,
    recommendedReason: decision?.recommended_reason || null,
    selected,
    effective,
    isUserSelected,
    isLocked,
    decision,
    isLoading,
    select,
    clearSelection,
    refreshRecommendation,
    isMutating: upsertMutation.isPending,
  };
}

/**
 * useVisualDecisions — Batch fetch all decisions for a project.
 * Useful for downstream consumers that need multiple effective values.
 */
export function useVisualDecisions(projectId: string | undefined) {
  return useQuery({
    queryKey: ['visual-decisions-all', projectId],
    queryFn: async (): Promise<Map<string, VisualDecision>> => {
      if (!projectId) return new Map();
      const { data, error } = await (supabase as any)
        .from('visual_decisions')
        .select('*')
        .eq('project_id', projectId);
      if (error) throw error;
      const map = new Map<string, VisualDecision>();
      for (const d of (data || [])) {
        const key = `${d.decision_domain}::${d.target_scope}::${d.target_key || ''}`;
        map.set(key, d as VisualDecision);
      }
      return map;
    },
    enabled: !!projectId,
    staleTime: 5 * 60 * 1000,
  });
}

/**
 * Resolve effective value from a decisions map.
 */
export function resolveEffective(
  decisions: Map<string, VisualDecision> | undefined,
  domain: DecisionDomain,
  targetScope: string = 'project',
  targetKey: string | null = null,
): string | null {
  if (!decisions) return null;
  const key = `${domain}::${targetScope}::${targetKey || ''}`;
  const d = decisions.get(key);
  if (!d) return null;
  return d.selected_value || d.recommended_value || null;
}
