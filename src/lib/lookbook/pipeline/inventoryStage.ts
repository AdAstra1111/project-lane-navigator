/**
 * inventoryStage — Resolves all canonical images per section,
 * builds section pools, injects working-set overlays, and expands thin pools.
 *
 * INPUT: projectId, lane info, working set
 * OUTPUT: InventoryResult (section pools, allUniqueImages, diagnostics)
 * SIDE EFFECTS: Supabase reads (image resolution + signed URLs)
 */
import { resolveAllCanonImages } from '../resolveCanonImages';
import type { ProjectImage } from '@/lib/images/types';
import { classifyOrientation } from '@/lib/images/orientationUtils';
import type { BuildWorkingSet } from '@/lib/images/lookbookImageOrchestrator';
import { scoreImageForSlide } from './lookbookScorer';
import type { PoolKey } from './lookbookSlotRegistry';
import { SLIDE_TO_POOL } from './lookbookSlotRegistry';
import type { InventoryResult } from './types';
import { resolveProjectCastIdentity } from '@/lib/aiCast/resolveActorIdentity';

// ── Pool expansion helper ────────────────────────────────────────────────────

/**
 * Deterministically expand a pool from fallback sources when it's below minSize.
 * Preserves existing pool, adds non-duplicate images ranked by scoreImageForSlide.
 * Pure function — no side effects.
 */
export function ensurePoolSize(
  pool: ProjectImage[],
  fallbackPools: ProjectImage[][],
  minSize: number,
  slideType: string,
  poolName: string,
): ProjectImage[] {
  if (pool.length >= minSize) return pool;
  const existingIds = new Set(pool.map(i => i.id));
  const existingUrls = new Set(pool.map(i => i.signedUrl).filter(Boolean));
  const expanded = [...pool];

  for (const fb of fallbackPools) {
    if (expanded.length >= minSize) break;
    const candidates = fb
      .filter(img => !existingIds.has(img.id) && img.signedUrl && !existingUrls.has(img.signedUrl!))
      .map(img => ({ img, score: scoreImageForSlide(img, slideType, false) }))
      .sort((a, b) => b.score - a.score);
    for (const { img } of candidates) {
      if (expanded.length >= minSize) break;
      existingIds.add(img.id);
      existingUrls.add(img.signedUrl!);
      expanded.push(img);
    }
  }

  if (expanded.length > pool.length) {
    console.log(`[LookBook:pool-expand] ${poolName}: ${pool.length} → ${expanded.length} (+${expanded.length - pool.length} from fallback)`);
  }
  return expanded;
}

// ── Working-set injection ────────────────────────────────────────────────────

export interface WorkingSetOverride {
  url: string;
  source: string;
  imageId: string;
}

/**
 * Inject working-set images into section pools.
 * Working-set images participate in election equally — no post-election bypass.
 */
export function injectWorkingSet(
  sectionPools: Record<PoolKey, ProjectImage[]>,
  workingSet: BuildWorkingSet,
  characterImageMap: Map<string, string>,
  characterNameImageMap: Map<string, string>,
): void {
  const poolMapping: Record<string, PoolKey> = {
    cover: 'poster', closing: 'poster',
    world: 'world',
    themes: 'atmosphere', creative_statement: 'atmosphere',
    visual_language: 'texture',
    key_moments: 'keyMoments', story_engine: 'keyMoments',
  };

  console.log(`[LookBook:inventory] Injecting working set (${workingSet.bySlotKey.size} entries) into pools`);

  for (const [, entry] of workingSet.bySlotKey) {
    const syntheticImg: ProjectImage = {
      ...entry.image,
      signedUrl: entry.signedUrl,
      _workingSetSource: entry.source as any,
    } as any;

    const slideType = entry.slideType || entry.slideId.split(':')[0];
    const poolKey = poolMapping[slideType] || 'atmosphere';
    if (sectionPools[poolKey]) {
      sectionPools[poolKey].push(syntheticImg);
    }

    // Character map injection
    if (entry.image.subject && entry.image.entity_id) {
      const charKey = entry.image.subject.toLowerCase();
      if (!characterNameImageMap.has(charKey)) {
        characterNameImageMap.set(charKey, entry.signedUrl);
      }
      if (!characterImageMap.has(entry.image.entity_id)) {
        characterImageMap.set(entry.image.entity_id, entry.signedUrl);
      }
    }
  }
}

// ── Main inventory stage ─────────────────────────────────────────────────────

export interface InventoryInput {
  projectId: string;
  effectiveLane: string | null;
  strictDeckMode: boolean;
  format: string;
  assignedLane: string;
  workingSet?: BuildWorkingSet | null;
}

export async function runInventoryStage(input: InventoryInput): Promise<InventoryResult> {
  const { projectId, effectiveLane, strictDeckMode, format, assignedLane, workingSet } = input;

  // 1. Resolve canonical images per section
  const canonImages = await resolveAllCanonImages(
    projectId,
    effectiveLane,
    strictDeckMode,
    format,
    assignedLane,
  );
  console.log(`[LookBook:inventory] ✓ images resolved (strictDeckMode=${strictDeckMode})`);

  // 2. Build section pools
  const sectionPools: Record<PoolKey, ProjectImage[]> = {
    world: [...canonImages.world_locations.images],
    atmosphere: [...canonImages.atmosphere_lighting.images],
    texture: [...canonImages.texture_detail.images],
    motifs: [...canonImages.symbolic_motifs.images],
    keyMoments: [...canonImages.key_moments.images],
    poster: [...canonImages.poster_directions.images],
  };

  console.log('[LookBook:inventory] initial pool sizes:',
    Object.entries(sectionPools).map(([k, v]) => `${k}=${v.length}`).join(' '));

  // 3. Build character maps
  const characterImageMap = new Map<string, string>();
  const characterNameImageMap = new Map<string, string>();
  const charNameScoreMap = new Map<string, number>();
  const charImages = canonImages.character_identity.images;
  const PREFERRED_CARD_SHOTS = ['close_up', 'medium', 'full_body', 'emotional_variant', 'profile'];

  for (const img of charImages) {
    if (img.entity_id && img.signedUrl && !characterImageMap.has(img.entity_id)) {
      characterImageMap.set(img.entity_id, img.signedUrl);
    }
  }
  for (const img of charImages) {
    if (!img.subject || !img.signedUrl) continue;
    const key = img.subject.toLowerCase();
    let score = 0;
    if (img.is_primary) score += 5;
    const gc = img.generation_config as Record<string, unknown> | null;
    if (gc?.identity_locked) score += 10;
    if (img.entity_id) score += 5;
    if (PREFERRED_CARD_SHOTS.includes(img.shot_type || '')) score += 3;
    if (classifyOrientation(img.width, img.height) === 'portrait') score += 2;
    const charAgeDays = (Date.now() - new Date(img.created_at || 0).getTime()) / (1000 * 60 * 60 * 24);
    if (charAgeDays < 1) score += 8;
    else if (charAgeDays < 3) score += 5;
    else if (charAgeDays < 7) score += 2;
    const prev = charNameScoreMap.get(key) ?? -1;
    if (score > prev) {
      characterNameImageMap.set(key, img.signedUrl);
      charNameScoreMap.set(key, score);
    }
  }

  // 3b. Actor-aware character image fallback
  // If any characters from the canon have actor bindings but no images in the inventory,
  // resolve their actor reference URLs as character card images
  try {
    const actorIdentities = await resolveProjectCastIdentity(projectId);
    for (const [charKey, anchors] of actorIdentities) {
      if (!characterNameImageMap.has(charKey) && anchors.hasAnchors) {
        // Use headshot as character card image, fallback to fullBody
        const url = anchors.headshot || anchors.fullBody;
        if (url) {
          characterNameImageMap.set(charKey, url);
          console.log(`[LookBook:inventory] Actor-bound character card: "${anchors.characterName}" source=${anchors.source}${anchors.aiActorId ? ` actor=${anchors.aiActorId}` : ''}`);
        }
      }
    }
  } catch (e) {
    console.warn('[LookBook:inventory] Actor identity fallback failed:', (e as Error).message);
  }

  // 4. Inject working set into pools
  if (workingSet && workingSet.bySlotKey.size > 0) {
    injectWorkingSet(sectionPools, workingSet, characterImageMap, characterNameImageMap);
  }

  // 5. Pool expansion
  sectionPools.keyMoments = ensurePoolSize(
    sectionPools.keyMoments,
    [sectionPools.motifs, sectionPools.atmosphere, sectionPools.world],
    3, 'key_moments', 'keyMoments',
  );
  sectionPools.world = ensurePoolSize(
    sectionPools.world,
    [sectionPools.atmosphere],
    2, 'world', 'world',
  );
  sectionPools.atmosphere = ensurePoolSize(
    sectionPools.atmosphere,
    [sectionPools.world, sectionPools.texture],
    2, 'themes', 'atmosphere',
  );
  sectionPools.poster = ensurePoolSize(
    sectionPools.poster,
    [sectionPools.world, sectionPools.keyMoments],
    1, 'cover', 'poster',
  );

  console.log('[LookBook:inventory] post-expansion:',
    Object.entries(sectionPools).map(([k, v]) => `${k}=${v.length}`).join(' '));

  // 6. Deduplicate all images
  const allAvailable: ProjectImage[] = [];
  const seenIds = new Set<string>();
  for (const pool of Object.values(sectionPools)) {
    for (const img of pool) {
      if (!seenIds.has(img.id)) {
        seenIds.add(img.id);
        allAvailable.push(img);
      }
    }
  }
  // Add character images
  for (const img of charImages) {
    if (!seenIds.has(img.id)) {
      seenIds.add(img.id);
      allAvailable.push(img);
    }
  }

  return {
    canonImages,
    sectionPools,
    allUniqueImages: allAvailable,
    diagnostics: canonImages._diagnostics || {
      totalActivePool: allAvailable.length,
      totalCandidatePool: 0,
      totalResolved: allAvailable.length,
      sectionsWithZeroActive: [],
      resolvedImageIds: allAvailable.map(i => i.id),
    },
    characterImageMap,
    characterNameImageMap,
  };
}
