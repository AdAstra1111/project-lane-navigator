/**
 * resolveActorIdentity — Identity resolver for project characters.
 *
 * Resolution order (deterministic):
 * 1. project_ai_cast via canonical castResolver (pinned version, NO fallback)
 * 2. Fallback: project_images (is_primary, identity_headshot/identity_full_body) — display only
 * 3. Unresolved if neither source yields anchors
 *
 * This is consumed by display/diagnostic paths.
 * Production generation paths MUST use castResolver directly.
 */
import { supabase } from '@/integrations/supabase/client';
import { resolveFullProjectCast, type CastResolverResult } from './castResolver';
import { normalizeCharacterKey } from './normalizeCharacterKey';

// ── Types ────────────────────────────────────────────────────────────────────

export type IdentitySource = 'actor_bound' | 'fallback_project_images' | 'unresolved';

export interface ActorIdentityAnchors {
  characterName: string;
  source: IdentitySource;
  hasAnchors: boolean;
  /** Primary headshot reference URL (signed or public) */
  headshot: string | null;
  /** Primary full-body reference URL (signed or public) */
  fullBody: string | null;
  /** Additional approved reference images from actor assets */
  additionalRefs: string[];
  /** AI Actor ID if actor-bound */
  aiActorId: string | null;
  /** AI Actor Version ID if actor-bound */
  aiActorVersionId: string | null;
  /** Audit trail */
  audit: string;
}

// ── Resolver ─────────────────────────────────────────────────────────────────

/**
 * Resolve identity anchors for ALL characters in a project.
 * Returns a Map keyed by **lowercased trimmed** character name.
 *
 * Delegates to canonical castResolver for actor-bound resolution,
 * then falls back to project_images for unbound characters.
 */
export async function resolveProjectCastIdentity(
  projectId: string,
): Promise<Map<string, ActorIdentityAnchors>> {
  const map = new Map<string, ActorIdentityAnchors>();
  const actorBoundNames = new Set<string>();

  // ── PHASE 1: Actor-bound resolution via canonical castResolver ───────────
  try {
    const castMap = await resolveFullProjectCast(projectId);

    for (const [charKey, castResult] of Object.entries(castMap)) {
      if (!castResult.bound) continue;

      const r = castResult as CastResolverResult;
      const hasAnchors = !!(r.assets.headshot || r.assets.full_body);

      map.set(charKey, {
        characterName: charKey,
        source: 'actor_bound',
        hasAnchors,
        headshot: r.assets.headshot,
        fullBody: r.assets.full_body,
        additionalRefs: r.assets.references,
        aiActorId: r.actor_id,
        aiActorVersionId: r.actor_version_id,
        audit: hasAnchors
          ? `Actor ${r.actor_id} v${r.actor_version_id}: headshot=${!!r.assets.headshot} fullBody=${!!r.assets.full_body} refs=${r.assets.references.length}`
          : `Actor ${r.actor_id} v${r.actor_version_id} bound but no usable reference assets`,
      });
      actorBoundNames.add(charKey);
    }
  } catch (e) {
    console.warn('[ActorIdentity] Failed to resolve actor bindings via castResolver:', (e as Error).message);
  }

  // ── PHASE 2: Fallback — project_images identity anchors ──────────────────
  // Only for characters NOT already resolved via actor binding
  try {
    const { data: anchorImages } = await (supabase as any)
      .from('project_images')
      .select('subject, shot_type, storage_path, is_primary, curation_state')
      .eq('project_id', projectId)
      .eq('is_primary', true)
      .in('shot_type', ['identity_headshot', 'identity_full_body'])
      .in('curation_state', ['active', 'approved', 'locked']);

    for (const img of anchorImages || []) {
      const name = normalizeCharacterKey(img.subject || '');
      if (!name || actorBoundNames.has(name)) continue;

      if (!map.has(name)) {
        map.set(name, {
          characterName: img.subject,
          source: 'fallback_project_images',
          hasAnchors: false,
          headshot: null,
          fullBody: null,
          additionalRefs: [],
          aiActorId: null,
          aiActorVersionId: null,
          audit: '',
        });
      }

      const entry = map.get(name)!;
      if (img.shot_type === 'identity_headshot' && img.storage_path && !entry.headshot) {
        entry.headshot = img.storage_path;
        entry.hasAnchors = true;
      }
      if (img.shot_type === 'identity_full_body' && img.storage_path && !entry.fullBody) {
        entry.fullBody = img.storage_path;
        entry.hasAnchors = true;
      }
      entry.audit = `project_images fallback: headshot=${!!entry.headshot} fullBody=${!!entry.fullBody}`;
    }
  } catch (e) {
    console.warn('[ActorIdentity] Failed to resolve project_images fallback:', (e as Error).message);
  }

  return map;
}

/**
 * Resolve identity for a SINGLE character.
 * Convenience wrapper that extracts one entry from the project-wide map.
 */
export async function resolveCharacterCastIdentity(
  projectId: string,
  characterName: string,
): Promise<ActorIdentityAnchors> {
  const map = await resolveProjectCastIdentity(projectId);
  const key = normalizeCharacterKey(characterName);
  return map.get(key) || {
    characterName,
    source: 'unresolved',
    hasAnchors: false,
    headshot: null,
    fullBody: null,
    additionalRefs: [],
    aiActorId: null,
    aiActorVersionId: null,
    audit: `No actor binding or project_images anchors found for "${characterName}"`,
  };
}
