/**
 * resolveActorIdentity — Canonical identity resolver for project characters.
 *
 * Resolution order (deterministic):
 * 1. project_ai_cast → ai_actor_versions (approved) → ai_actor_assets (reference_image)
 * 2. Fallback: project_images (is_primary, identity_headshot/identity_full_body)
 * 3. Unresolved if neither source yields anchors
 *
 * This is the SOLE canonical source of identity anchors for all generation pipelines.
 * LookBook, poster, storyboard, and any future pipeline must consume this resolver.
 */
import { supabase } from '@/integrations/supabase/client';

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
 * Checks project_ai_cast first; falls back to project_images identity anchors.
 */
export async function resolveProjectCastIdentity(
  projectId: string,
): Promise<Map<string, ActorIdentityAnchors>> {
  const map = new Map<string, ActorIdentityAnchors>();
  const actorBoundNames = new Set<string>();

  // ── PHASE 1: Actor-bound resolution via project_ai_cast ──────────────────
  try {
    const { data: castRows } = await (supabase as any)
      .from('project_ai_cast')
      .select('character_key, ai_actor_id, ai_actor_version_id')
      .eq('project_id', projectId);

    if (castRows && castRows.length > 0) {
      // For each cast mapping, resolve the approved version + assets
      for (const row of castRows) {
        const charKey = (row.character_key || '').toLowerCase().trim();
        if (!charKey) continue;

        const actorId = row.ai_actor_id as string;
        let versionId = row.ai_actor_version_id as string | null;

        // If no specific version pinned, resolve from Phase 4 canonical approved_version_id
        if (!versionId) {
          const { data: actorRow } = await (supabase as any)
            .from('ai_actors')
            .select('approved_version_id')
            .eq('id', actorId)
            .maybeSingle();
          versionId = actorRow?.approved_version_id || null;
        }

        if (!versionId) {
          // Actor exists but no approved version — record but mark unresolved
          map.set(charKey, {
            characterName: row.character_key,
            source: 'actor_bound',
            hasAnchors: false,
            headshot: null,
            fullBody: null,
            additionalRefs: [],
            aiActorId: actorId,
            aiActorVersionId: null,
            audit: `Actor ${actorId} bound but no approved version found`,
          });
          actorBoundNames.add(charKey);
          continue;
        }

        // Fetch assets for this version
        const { data: assets } = await (supabase as any)
          .from('ai_actor_assets')
          .select('asset_type, storage_path, public_url, meta_json')
          .eq('actor_version_id', versionId);

        const assetList = (assets || []) as Array<{
          asset_type: string;
          storage_path: string;
          public_url: string;
          meta_json: Record<string, unknown>;
        }>;

        // Classify assets into headshot / full-body / additional refs
        let headshot: string | null = null;
        let fullBody: string | null = null;
        const additionalRefs: string[] = [];

        for (const asset of assetList) {
          const url = asset.public_url || asset.storage_path;
          if (!url) continue;

          const assetType = (asset.asset_type || '').toLowerCase();
          const metaShotType = ((asset.meta_json as any)?.shot_type || '').toLowerCase();

          if (
            assetType === 'reference_headshot' ||
            metaShotType === 'identity_headshot' ||
            metaShotType === 'headshot' ||
            (assetType === 'reference_image' && !headshot && metaShotType !== 'full_body')
          ) {
            if (!headshot) headshot = url;
            else additionalRefs.push(url);
          } else if (
            assetType === 'reference_full_body' ||
            metaShotType === 'identity_full_body' ||
            metaShotType === 'full_body'
          ) {
            if (!fullBody) fullBody = url;
            else additionalRefs.push(url);
          } else if (assetType === 'reference_image' || assetType === 'screen_test_still') {
            additionalRefs.push(url);
          }
        }

        // If we have reference_images but couldn't classify, use first as headshot
        if (!headshot && additionalRefs.length > 0) {
          headshot = additionalRefs.shift()!;
        }

        const hasAnchors = !!(headshot || fullBody);

        map.set(charKey, {
          characterName: row.character_key,
          source: 'actor_bound',
          hasAnchors,
          headshot,
          fullBody,
          additionalRefs,
          aiActorId: actorId,
          aiActorVersionId: versionId,
          audit: hasAnchors
            ? `Actor ${actorId} v${versionId}: headshot=${!!headshot} fullBody=${!!fullBody} refs=${additionalRefs.length}`
            : `Actor ${actorId} v${versionId} bound but no usable reference assets`,
        });
        actorBoundNames.add(charKey);
      }
    }
  } catch (e) {
    console.warn('[ActorIdentity] Failed to resolve actor bindings:', (e as Error).message);
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
      const name = (img.subject || '').toLowerCase().trim();
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
  const key = characterName.toLowerCase().trim();
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
