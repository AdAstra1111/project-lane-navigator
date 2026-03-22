/**
 * projectCastBindings — Canonical binding helper for project_ai_cast.
 *
 * SINGLE SOURCE OF TRUTH for all binding mutations.
 * Both direct UI casts and cast pack apply MUST use this.
 *
 * Rules:
 * - actor must be roster_ready
 * - actor must have approved_version_id
 * - binding pins approved_version_id at time of cast
 * - upsert on (project_id, character_key)
 */

import { supabase } from '@/integrations/supabase/client';

// ── Types ────────────────────────────────────────────────────────────────────

export interface BindActorParams {
  projectId: string;
  characterKey: string;
  actorId: string;
  /** Optional override; if omitted, resolved from actor's approved_version_id */
  actorVersionId?: string;
}

export interface BindActorResult {
  success: boolean;
  characterKey: string;
  actorId: string;
  actorVersionId: string;
}

// ── Binding Function ─────────────────────────────────────────────────────────

/**
 * Bind an actor to a project character using canonical rules.
 * Validates roster readiness and approved version before writing.
 *
 * @throws Error if actor is not roster-ready or has no approved version.
 */
export async function bindActorToProjectCharacter(
  params: BindActorParams,
  /** Pass the actors array to avoid a re-fetch if already loaded */
  actorsCache?: any[],
): Promise<BindActorResult> {
  const { projectId, characterKey, actorId, actorVersionId } = params;

  // Resolve actor metadata
  let actor: any = actorsCache?.find((a: any) => a.id === actorId);

  if (!actor) {
    const { data, error } = await (supabase as any)
      .from('ai_actors')
      .select('id, roster_ready, approved_version_id')
      .eq('id', actorId)
      .maybeSingle();
    if (error) throw new Error(`Failed to fetch actor: ${error.message}`);
    actor = data;
  }

  if (!actor) throw new Error(`Actor ${actorId} not found`);

  const resolvedVersionId = actorVersionId || actor.approved_version_id;

  // IEL: roster-ready + approved version enforcement
  if (!actor.roster_ready) {
    throw new Error('Only roster-ready actors with an approved version can be cast');
  }
  if (!resolvedVersionId) {
    throw new Error('Actor has no approved version — cannot bind');
  }

  // Upsert canonical binding
  const { error: upsertError } = await (supabase as any)
    .from('project_ai_cast')
    .upsert(
      {
        project_id: projectId,
        character_key: characterKey,
        ai_actor_id: actorId,
        ai_actor_version_id: resolvedVersionId,
      },
      { onConflict: 'project_id,character_key' },
    );

  if (upsertError) throw new Error(`Binding failed: ${upsertError.message}`);

  return {
    success: true,
    characterKey,
    actorId,
    actorVersionId: resolvedVersionId,
  };
}
