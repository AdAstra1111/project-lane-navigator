/**
 * castPackEngine — Phase 16.8: Project-level cast pack workflow.
 *
 * Builds a reviewable cast pack from Phase 16.7 recommendations,
 * then applies selected actors through canonical binding path.
 *
 * Rules:
 * - Pack is advisory until explicitly applied
 * - Apply uses canonical projectCastBindings (single source of truth)
 * - Default: skip already-bound characters
 * - No silent auto-binding
 * - No second source of cast truth
 */

import {
  buildProjectCastRecommendations,
  type ActorRecommendation,
} from './castRecommendationEngine';
import { bindActorToProjectCharacter } from './projectCastBindings';
import { supabase } from '@/integrations/supabase/client';

// ── Types ────────────────────────────────────────────────────────────────────

export interface CastPackCharacterChoice {
  character_key: string;
  recommendations: ActorRecommendation[];
  selected_actor_id: string | null;
}

export interface ProjectCastPack {
  project_id: string;
  characters: CastPackCharacterChoice[];
  generated_at: string;
}

export interface ApplyCastPackOptions {
  overwriteExisting?: boolean;
  onlyCharacterKeys?: string[];
}

export interface ApplyCastPackResult {
  attempted: number;
  applied: number;
  skipped_existing: number;
  skipped_invalid: number;
  applied_character_keys: string[];
}

// ── Build Pack ───────────────────────────────────────────────────────────────

/**
 * Build a reviewable cast pack for a project.
 * Uses Phase 16.7 recommendation engine. READ-ONLY — no writes.
 */
export async function buildProjectCastPack(
  projectId: string,
): Promise<ProjectCastPack> {
  const recommendations = await buildProjectCastRecommendations(projectId);

  const characters: CastPackCharacterChoice[] = recommendations.characters.map(
    (charRec) => ({
      character_key: charRec.character_key,
      recommendations: charRec.recommendations,
      // Default: select top recommendation if available
      selected_actor_id:
        charRec.recommendations.length > 0
          ? charRec.recommendations[0].actor_id
          : null,
    }),
  );

  return {
    project_id: projectId,
    characters,
    generated_at: new Date().toISOString(),
  };
}

// ── Apply Pack ───────────────────────────────────────────────────────────────

/**
 * Apply selected cast pack choices through canonical binding path.
 *
 * Default behavior: skip already-bound characters.
 * Set overwriteExisting = true to replace existing bindings.
 */
export async function applyProjectCastPack(
  projectId: string,
  selections: Array<{ character_key: string; actor_id: string | null }>,
  options?: ApplyCastPackOptions,
): Promise<ApplyCastPackResult> {
  const overwrite = options?.overwriteExisting ?? false;
  const onlyKeys = options?.onlyCharacterKeys
    ? new Set(options.onlyCharacterKeys)
    : null;

  // Fetch current bindings to check what's already bound
  const { data: existingBindings } = await (supabase as any)
    .from('project_ai_cast')
    .select('character_key')
    .eq('project_id', projectId);

  const boundKeys = new Set(
    (existingBindings || []).map((b: any) => b.character_key),
  );

  const result: ApplyCastPackResult = {
    attempted: 0,
    applied: 0,
    skipped_existing: 0,
    skipped_invalid: 0,
    applied_character_keys: [],
  };

  for (const selection of selections) {
    // Filter by onlyCharacterKeys if provided
    if (onlyKeys && !onlyKeys.has(selection.character_key)) continue;

    // Skip null selections
    if (!selection.actor_id) {
      continue;
    }

    result.attempted++;

    // Skip already-bound unless overwrite enabled
    if (boundKeys.has(selection.character_key) && !overwrite) {
      result.skipped_existing++;
      continue;
    }

    try {
      await bindActorToProjectCharacter({
        projectId,
        characterKey: selection.character_key,
        actorId: selection.actor_id,
      });
      result.applied++;
      result.applied_character_keys.push(selection.character_key);
    } catch (err) {
      console.warn(
        `[CastPack] Failed to bind ${selection.character_key}:`,
        err,
      );
      result.skipped_invalid++;
    }
  }

  return result;
}
