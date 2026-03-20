/**
 * resolveCanonImages — Resolves active canonical images per lookbook section.
 * Uses the SAME query logic as useLookbookSectionContent (workspace)
 * to ensure presentation and workspace share a single source of truth.
 *
 * CVBE Phase 2: Bound images are preferred over unbound images within each tier.
 */
import { supabase } from '@/integrations/supabase/client';
import type { ProjectImage } from '@/lib/images/types';

type CanonicalSectionKey =
  | 'character_identity'
  | 'world_locations'
  | 'atmosphere_lighting'
  | 'texture_detail'
  | 'symbolic_motifs'
  | 'key_moments'
  | 'poster_directions';

/** Mirrors SECTION_QUERY_MAP from useLookbookSectionContent */
const SECTION_QUERY_MAP: Record<CanonicalSectionKey, {
  strategy_keys: string[];
  asset_groups: string[];
  fallback_roles?: string[];
}> = {
  character_identity: {
    strategy_keys: ['lookbook_character'],
    asset_groups: ['character'],
    fallback_roles: ['character_primary', 'character_variant'],
  },
  world_locations: {
    strategy_keys: ['lookbook_world'],
    asset_groups: ['world'],
    fallback_roles: ['world_establishing', 'world_detail'],
  },
  atmosphere_lighting: {
    strategy_keys: ['lookbook_visual_language'],
    asset_groups: ['visual_language'],
  },
  texture_detail: {
    strategy_keys: ['lookbook_visual_language'],
    asset_groups: ['visual_language'],
  },
  symbolic_motifs: {
    strategy_keys: ['lookbook_key_moment'],
    asset_groups: ['key_moment'],
  },
  key_moments: {
    strategy_keys: ['lookbook_key_moment'],
    asset_groups: ['key_moment'],
  },
  poster_directions: {
    strategy_keys: [],
    asset_groups: ['poster'],
    fallback_roles: ['poster_primary', 'poster_variant'],
  },
};

/** Mirrors SECTION_SHOT_FILTER from useLookbookSectionContent */
const SECTION_SHOT_FILTER: Partial<Record<CanonicalSectionKey, string[]>> = {
  atmosphere_lighting: ['atmospheric', 'time_variant', 'lighting_ref'],
  texture_detail: ['texture_ref', 'detail', 'composition_ref', 'color_ref'],
  key_moments: ['tableau', 'medium', 'close_up', 'wide'],
};

export interface SectionImageResult {
  sectionKey: CanonicalSectionKey;
  images: ProjectImage[];
  imageIds: string[];
}

// ── Canonical Binding Preference ─────────────────────────────────────────────

type BindingStatus = 'bound' | 'partially_bound' | 'unbound' | undefined;
type TargetingMode = 'exact' | 'derived' | 'heuristic' | undefined;

function getBindingRank(img: ProjectImage): number {
  const gc = img.generation_config as Record<string, unknown> | null;
  const status = gc?.canonical_binding_status as BindingStatus;
  if (status === 'bound') return 0;
  if (status === 'partially_bound') return 1;
  return 2; // unbound or no provenance
}

function getTargetingRank(img: ProjectImage): number {
  const gc = img.generation_config as Record<string, unknown> | null;
  const mode = gc?.targeting_mode as TargetingMode;
  if (mode === 'exact') return 0;
  if (mode === 'derived') return 1;
  return 2; // heuristic or no provenance
}

/**
 * Sort images: primary > exact-bound > derived-bound > heuristic-bound > partial > unbound > recency.
 */
function sortWithBindingPreference(images: ProjectImage[]): ProjectImage[] {
  return [...images].sort((a, b) => {
    // 1. Primary first
    const pa = a.is_primary ? 0 : 1;
    const pb = b.is_primary ? 0 : 1;
    if (pa !== pb) return pa - pb;
    // 2. Binding status (bound > partially_bound > unbound)
    const ba = getBindingRank(a);
    const bb = getBindingRank(b);
    if (ba !== bb) return ba - bb;
    // 3. Targeting precision (exact > derived > heuristic) within same binding tier
    const ta = getTargetingRank(a);
    const tb = getTargetingRank(b);
    if (ta !== tb) return ta - tb;
    // 4. Recency
    return (b.created_at || '').localeCompare(a.created_at || '');
  });
}

// ── Lane-Aware Presentation Ranking ─────────────────────────────────────────

/** Shot types that are emotionally dominant / hook-forward for vertical drama */
const VERTICAL_DRAMA_PREFERRED_SHOTS = new Set([
  'close_up', 'medium', 'emotional_variant', 'profile', 'identity_headshot',
  'identity_profile', 'tableau',
]);

/** Shot types that are weaker for vertical drama (landscape-native) */
const VERTICAL_DRAMA_DEPRIORITIZED_SHOTS = new Set([
  'wide', 'establishing', 'atmospheric', 'detail',
]);

/**
 * Compute a presentation score for an image given the project lane and section context.
 * Higher score = better for this lane's presentation.
 * Only active for vertical_drama; other lanes get neutral (0) scores.
 */
function computeLanePresentationScore(
  img: ProjectImage,
  laneKey: string | null,
  sectionKey: CanonicalSectionKey,
): number {
  if (!laneKey || laneKey !== 'vertical_drama') return 0;

  let score = 0;

  // 1. Lane compliance score from generation (if available) — strongest signal
  if (typeof img.lane_compliance_score === 'number') {
    // Normalize: compliance is 0-100, map to 0-30 bonus
    score += Math.round((img.lane_compliance_score / 100) * 30);
  }

  // 2. Portrait orientation bonus (h > w = portrait-friendly)
  if (img.width && img.height) {
    const ratio = img.height / img.width;
    if (ratio >= 1.3) score += 25;       // strong portrait (9:16 or taller)
    else if (ratio >= 1.0) score += 12;  // square-ish, still ok
    else if (ratio < 0.75) score -= 15;  // wide landscape, penalize
  }

  // 3. Shot type affinity (section-aware)
  const shotType = img.shot_type || '';
  if (sectionKey === 'world_locations') {
    // World slides SHOULD have establishing/wide — don't penalize landscape here
    // But still mildly prefer atmospheric character-in-world over empty landscape
    if (shotType === 'atmospheric') score += 5;
  } else {
    // For character, key_moments, poster, themes — prefer emotional/close shots
    if (VERTICAL_DRAMA_PREFERRED_SHOTS.has(shotType)) score += 20;
    if (VERTICAL_DRAMA_DEPRIORITIZED_SHOTS.has(shotType)) score -= 10;
  }

  // 4. Lane tag match bonus
  if (img.lane_key === 'vertical_drama') score += 10;

  return score;
}

/**
 * Apply lane-aware presentation ranking on top of binding-sorted images.
 * Within each binding tier, re-sort by presentation score.
 * This ensures bound images still rank above unbound, but within bound,
 * the most presentation-effective images surface first.
 */
function applyLanePresentationRanking(
  images: ProjectImage[],
  laneKey: string | null,
  sectionKey: CanonicalSectionKey,
): ProjectImage[] {
  if (!laneKey || laneKey !== 'vertical_drama' || images.length <= 1) return images;

  return [...images].sort((a, b) => {
    // Preserve primary-first
    const pa = a.is_primary ? 0 : 1;
    const pb = b.is_primary ? 0 : 1;
    if (pa !== pb) return pa - pb;

    // Preserve binding tier
    const ba = getBindingRank(a);
    const bb = getBindingRank(b);
    if (ba !== bb) return ba - bb;

    // Within same tier: presentation score (higher = better)
    const sa = computeLanePresentationScore(a, laneKey, sectionKey);
    const sb = computeLanePresentationScore(b, laneKey, sectionKey);
    if (sa !== sb) return sb - sa;

    // Tiebreak: recency
    return (b.created_at || '').localeCompare(a.created_at || '');
  });
}

/**
 * CVBE Phase 2+3 — Canonical exclusion gate.
 * If ANY bound images exist, exclude unbound entirely.
 * Within bound tier, exact-target images exclude heuristic-only when exact alternatives exist.
 */
function applyCanonicalExclusionGate(images: ProjectImage[]): ProjectImage[] {
  if (images.length <= 1) return images;
  const hasBound = images.some(i => getBindingRank(i) === 0);
  const hasPartial = images.some(i => getBindingRank(i) === 1);

  let filtered = images;

  // Exclude unbound when bound/partial exist
  if (hasBound || hasPartial) {
    const withoutUnbound = images.filter(i => getBindingRank(i) <= 1);
    if (withoutUnbound.length > 0) filtered = withoutUnbound;
  }

  // Within bound tier, prefer exact over heuristic if exact alternatives exist
  const hasExact = filtered.some(i => getBindingRank(i) === 0 && getTargetingRank(i) === 0);
  if (hasExact) {
    const exactOrDerived = filtered.filter(i => getTargetingRank(i) <= 1);
    if (exactOrDerived.length > 0) filtered = exactOrDerived;
  }

  return filtered;
}

// ── Helpers ──────────────────────────────────────────────────────────────────

async function hydrateSignedUrls(images: ProjectImage[]): Promise<void> {
  const bucketGroups = new Map<string, ProjectImage[]>();
  for (const img of images) {
    const bucket = img.storage_bucket || 'project-posters';
    if (!bucketGroups.has(bucket)) bucketGroups.set(bucket, []);
    bucketGroups.get(bucket)!.push(img);
  }
  await Promise.all(
    Array.from(bucketGroups.entries()).map(async ([bucket, imgs]) => {
      await Promise.all(
        imgs.map(async (img) => {
          try {
            const { data: signed } = await supabase.storage
              .from(bucket)
              .createSignedUrl(img.storage_path, 3600);
            img.signedUrl = signed?.signedUrl || undefined;
          } catch {
            img.signedUrl = undefined;
          }
        }),
      );
    }),
  );
}

async function fetchSectionImages(
  projectId: string,
  sectionKey: CanonicalSectionKey,
  limit = 12,
): Promise<SectionImageResult> {
  const mapping = SECTION_QUERY_MAP[sectionKey];
  const shotFilter = SECTION_SHOT_FILTER[sectionKey];

  // Primary query: active curation_state, matching strategy_key/asset_group
  let q = (supabase as any)
    .from('project_images')
    .select('*')
    .eq('project_id', projectId)
    .eq('curation_state', 'active');

  if (mapping.strategy_keys.length > 0) {
    q = q.in('strategy_key', mapping.strategy_keys);
  }

  if (mapping.asset_groups.length > 0) {
    if (mapping.strategy_keys.length > 0) {
      q = q.in('asset_group', mapping.asset_groups);
    } else if (mapping.fallback_roles?.length) {
      q = q.or(
        `asset_group.in.(${mapping.asset_groups.join(',')}),role.in.(${mapping.fallback_roles.join(',')})`
      );
    } else {
      q = q.in('asset_group', mapping.asset_groups);
    }
  } else if (mapping.fallback_roles?.length) {
    q = q.in('role', mapping.fallback_roles);
  }

  if (shotFilter?.length) {
    q = q.in('shot_type', shotFilter);
  }

  q = q
    .order('is_primary', { ascending: false })
    .order('created_at', { ascending: false })
    .limit(limit);

  const { data: rows, error } = await q;
  if (error) {
    console.warn(`[LookBook:resolveCanonImages] ${sectionKey} query error:`, error.message);
  }

  let images = (rows || []) as ProjectImage[];

  // Fallback: if no active images found with strategy_key, try fallback_roles with active curation
  if (images.length === 0 && mapping.fallback_roles?.length && mapping.strategy_keys.length > 0) {
    const { data: fallbackRows } = await (supabase as any)
      .from('project_images')
      .select('*')
      .eq('project_id', projectId)
      .eq('curation_state', 'active')
      .in('role', mapping.fallback_roles)
      .order('is_primary', { ascending: false })
      .order('created_at', { ascending: false })
      .limit(limit);
    images = (fallbackRows || []) as ProjectImage[];
  }

  // Fallback 2: if still empty, try active asset_group without strategy_key filter
  if (images.length === 0 && mapping.asset_groups.length > 0) {
    let aq = (supabase as any)
      .from('project_images')
      .select('*')
      .eq('project_id', projectId)
      .eq('curation_state', 'active')
      .in('asset_group', mapping.asset_groups);

    if (shotFilter?.length) {
      aq = aq.in('shot_type', shotFilter);
    }

    aq = aq
      .order('is_primary', { ascending: false })
      .order('created_at', { ascending: false })
      .limit(limit);

    const { data: assetRows } = await aq;
    if (assetRows?.length) {
      console.log(`[LookBook:resolveCanonImages] ${sectionKey}: using asset_group-only fallback (${assetRows.length} images)`);
      images = assetRows as ProjectImage[];
    }
  }

  // Fallback 3: candidate images (user may not have promoted to active yet)
  if (images.length === 0) {
    let cq = (supabase as any)
      .from('project_images')
      .select('*')
      .eq('project_id', projectId)
      .eq('curation_state', 'candidate');

    if (mapping.strategy_keys.length > 0) {
      cq = cq.in('strategy_key', mapping.strategy_keys);
    } else if (mapping.fallback_roles?.length) {
      cq = cq.in('role', mapping.fallback_roles);
    }
    if (mapping.asset_groups.length > 0) {
      cq = cq.in('asset_group', mapping.asset_groups);
    }
    if (shotFilter?.length) {
      cq = cq.in('shot_type', shotFilter);
    }

    cq = cq
      .order('is_primary', { ascending: false })
      .order('created_at', { ascending: false })
      .limit(limit);

    const { data: candidateRows } = await cq;
    if (candidateRows?.length) {
      console.warn(`[LookBook:resolveCanonImages] ${sectionKey}: using candidate fallback (${candidateRows.length} images — promote to active for best results)`);
      images = candidateRows as ProjectImage[];
    }
  }

  // NOTE: Legacy is_active fallback removed — archived/reset images must not
  // re-enter canonical resolution. Only active and candidate curation states
  // are eligible for lookbook builds.

  // ── CVBE Phase 2: exclude unbound when bound alternatives exist, then sort ──
  images = applyCanonicalExclusionGate(images);
  images = sortWithBindingPreference(images);

  await hydrateSignedUrls(images);

  console.log(`[LookBook:resolveCanonImages] ${sectionKey}: resolved ${images.length} images`,
    images.map(i => ({
      id: i.id,
      curation: (i as any).curation_state,
      primary: (i as any).is_primary,
      binding: (i.generation_config as any)?.canonical_binding_status || 'unknown',
    })));

  return {
    sectionKey,
    images,
    imageIds: images.map(i => i.id),
  };
}

export interface ResolvedCanonImages {
  character_identity: SectionImageResult;
  world_locations: SectionImageResult;
  atmosphere_lighting: SectionImageResult;
  texture_detail: SectionImageResult;
  symbolic_motifs: SectionImageResult;
  key_moments: SectionImageResult;
  poster_directions: SectionImageResult;
}

/**
 * Resolves all canonical lookbook section images in parallel.
 * Uses identical query logic to the workspace panels.
 * Bound images are sorted ahead of unbound within each curation tier.
 */
export async function resolveAllCanonImages(projectId: string): Promise<ResolvedCanonImages> {
  const sections: CanonicalSectionKey[] = [
    'character_identity',
    'world_locations',
    'atmosphere_lighting',
    'texture_detail',
    'symbolic_motifs',
    'key_moments',
    'poster_directions',
  ];

  const results = await Promise.all(
    sections.map(key => fetchSectionImages(projectId, key)),
  );

  const map: Record<string, SectionImageResult> = {};
  for (const r of results) map[r.sectionKey] = r;

  console.log('[LookBook:resolveCanonImages] summary:', Object.entries(map).map(([k, v]) => `${k}=${v.images.length}`).join(', '));

  return map as unknown as ResolvedCanonImages;
}
