/**
 * resolveCanonImages — Resolves active canonical images per lookbook section.
 * Uses the SAME query logic as useLookbookSectionContent (workspace)
 * to ensure presentation and workspace share a single source of truth.
 *
 * CVBE Phase 2: Bound images are preferred over unbound images within each tier.
 *
 * STRICT DECK MODE (vertical-drama):
 * When strictDeckMode=true, ONLY active primary winners are resolved.
 * No candidate fallback, no role fallback, no asset_group-only fallback.
 * Slots without a compliant primary winner remain UNRESOLVED.
 */
import { supabase } from '@/integrations/supabase/client';
import type { ProjectImage } from '@/lib/images/types';
import { classifyVerticalCompliance } from '@/lib/images/verticalCompliance';

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

/** Debug provenance per resolved image */
export interface ResolvedImageProvenance {
  imageId: string;
  source: 'winner_primary' | 'active_non_primary' | 'candidate_fallback' | 'unresolved';
  complianceClass: string;
  actualWidth: number | null;
  actualHeight: number | null;
  isPrimary: boolean;
  curationState: string;
}

export interface SectionImageResult {
  sectionKey: CanonicalSectionKey;
  images: ProjectImage[];
  imageIds: string[];
  /** Per-image provenance for deck debug proof */
  provenance: ResolvedImageProvenance[];
  /** Count of unresolved slots (images needed but not found) */
  unresolvedCount: number;
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
 * Narrative truth rank — how strongly this image is anchored to actual
 * script/canon entities vs being generic atmospheric imagery.
 *
 * Images bound to real canon entities (characters, locations, moments)
 * are preferred over beautiful but narratively unanchored images.
 */
function getNarrativeTruthRank(img: ProjectImage): number {
  const hasEntity = !!img.entity_id;
  const hasLocation = !!img.location_ref;
  const hasMoment = !!img.moment_ref;
  const hasSubject = !!img.subject;
  const hasSubjectRef = !!img.subject_ref;

  if (hasEntity && hasLocation) return 0;  // strongest: entity + location
  if (hasEntity || (hasSubjectRef && hasLocation)) return 1;
  if (hasLocation || hasMoment) return 2;
  if (hasSubjectRef || hasSubject) return 3;
  return 4;  // no narrative binding — generic mood imagery
}

/**
 * Sort images: primary > narrative truth > exact-bound > derived-bound >
 * heuristic-bound > partial > unbound > recency.
 *
 * Narrative truth is ranked BEFORE visual binding because a narratively
 * accurate image with weaker binding is more useful than a beautiful
 * but misleading one.
 */
function sortWithBindingPreference(images: ProjectImage[]): ProjectImage[] {
  return [...images].sort((a, b) => {
    const pa = a.is_primary ? 0 : 1;
    const pb = b.is_primary ? 0 : 1;
    if (pa !== pb) return pa - pb;
    // Narrative truth — prefer images bound to actual story entities
    const na = getNarrativeTruthRank(a);
    const nb = getNarrativeTruthRank(b);
    if (na !== nb) return na - nb;
    const ba = getBindingRank(a);
    const bb = getBindingRank(b);
    if (ba !== bb) return ba - bb;
    const ta = getTargetingRank(a);
    const tb = getTargetingRank(b);
    if (ta !== tb) return ta - tb;
    return (b.created_at || '').localeCompare(a.created_at || '');
  });
}

/**
 * CVBE Phase 2+3 — Canonical exclusion gate.
 */
function applyCanonicalExclusionGate(images: ProjectImage[]): ProjectImage[] {
  if (images.length <= 1) return images;
  const hasBound = images.some(i => getBindingRank(i) === 0);
  const hasPartial = images.some(i => getBindingRank(i) === 1);
  let filtered = images;
  if (hasBound || hasPartial) {
    const withoutUnbound = images.filter(i => getBindingRank(i) <= 1);
    if (withoutUnbound.length > 0) filtered = withoutUnbound;
  }
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

function buildProvenance(img: ProjectImage, isVDStrict: boolean, projectFormat: string, projectLane: string): ResolvedImageProvenance {
  const isPrimary = !!(img as any).is_primary;
  const curationState = (img as any).curation_state || 'unknown';
  const source: ResolvedImageProvenance['source'] =
    isPrimary && curationState === 'active' ? 'winner_primary'
    : curationState === 'active' ? 'active_non_primary'
    : curationState === 'candidate' ? 'candidate_fallback'
    : 'unresolved';

  let complianceClass = 'n/a';
  if (isVDStrict) {
    const result = classifyVerticalCompliance(
      { width: img.width, height: img.height, shot_type: img.shot_type },
      img.shot_type || '',
      projectFormat,
      projectLane,
    );
    complianceClass = result.level;
  }

  return {
    imageId: img.id,
    source,
    complianceClass,
    actualWidth: img.width || null,
    actualHeight: img.height || null,
    isPrimary,
    curationState,
  };
}

/**
 * Fetch section images.
 *
 * strictDeckMode=true (vertical-drama final deck):
 *   - ONLY active + is_primary images
 *   - NO candidate fallback
 *   - NO role/asset_group-only fallback
 *   - Unresolved slots stay empty
 *
 * strictDeckMode=false (workspace, non-VD decks):
 *   - Full fallback chain as before
 */
async function fetchSectionImages(
  projectId: string,
  sectionKey: CanonicalSectionKey,
  laneKey: string | null = null,
  limit = 12,
  strictDeckMode = false,
  projectFormat = '',
  projectLane = '',
): Promise<SectionImageResult> {
  // Character identity needs a higher limit to ensure all characters are represented
  const effectiveLimit = sectionKey === 'character_identity' ? Math.max(limit, 40) : limit;
  const mapping = SECTION_QUERY_MAP[sectionKey];
  const shotFilter = SECTION_SHOT_FILTER[sectionKey];
  const isVDStrict = strictDeckMode;

  // ── Primary query: active curation_state ──
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
    .limit(effectiveLimit);

  const { data: rows, error } = await q;
  if (error) {
    console.warn(`[LookBook:resolveCanonImages] ${sectionKey} query error:`, error.message);
  }

  let images = (rows || []) as ProjectImage[];

  // ── STRICT DECK MODE: winners only ──
  if (strictDeckMode) {
    // Filter to primary winners only
    const primaries = images.filter((img: any) => img.is_primary === true);
    
    // For VD, also filter to compliant images only
    if (isVDStrict && primaries.length > 0) {
      const compliant = primaries.filter(img => {
        const result = classifyVerticalCompliance(
          { width: img.width, height: img.height, shot_type: img.shot_type },
          img.shot_type || '',
          projectFormat,
          projectLane,
        );
        return result.eligibleForWinnerSelection;
      });
      images = compliant;
    } else {
      images = primaries;
    }

    // NO fallback chain in strict mode
    const provenance = images.map(img => buildProvenance(img, isVDStrict, projectFormat, projectLane));
    await hydrateSignedUrls(images);

    console.log(`[LookBook:resolveCanonImages:STRICT] ${sectionKey}: ${images.length} winners (${primaries.length} primaries found, ${images.length} compliant)`);

    return {
      sectionKey,
      images,
      imageIds: images.map(i => i.id),
      provenance,
      unresolvedCount: images.length === 0 ? 1 : 0,
    };
  }

  // ── NON-STRICT MODE: full fallback chain (workspace, non-VD decks) ──
  
  // Fallback 1: fallback_roles with active curation
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

  // Fallback 2: active asset_group without strategy_key filter
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
      images = assetRows as ProjectImage[];
    }
  }

  // Fallback 3: candidate images — ONLY in non-strict mode
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

  // ── Binding/sorting ──
  images = applyCanonicalExclusionGate(images);
  images = sortWithBindingPreference(images);

  await hydrateSignedUrls(images);

  const provenance = images.map(img => buildProvenance(img, false, projectFormat, projectLane));

  console.log(`[LookBook:resolveCanonImages] ${sectionKey}: resolved ${images.length} images (lane=${laneKey || 'none'})`);

  return {
    sectionKey,
    images,
    imageIds: images.map(i => i.id),
    provenance,
    unresolvedCount: images.length === 0 ? 1 : 0,
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
 *
 * @param strictDeckMode — When true (vertical-drama final deck), resolves
 *   ONLY active primary compliant winners. No candidate/fallback leakage.
 */
export async function resolveAllCanonImages(
  projectId: string,
  laneKey: string | null = null,
  strictDeckMode = false,
  projectFormat = '',
  projectLane = '',
): Promise<ResolvedCanonImages> {
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
    sections.map(key => fetchSectionImages(projectId, key, laneKey, 12, strictDeckMode, projectFormat, projectLane)),
  );

  const map: Record<string, SectionImageResult> = {};
  let totalUnresolved = 0;
  for (const r of results) {
    map[r.sectionKey] = r;
    totalUnresolved += r.unresolvedCount;
  }

  const mode = strictDeckMode ? 'STRICT' : 'standard';
  console.log(`[LookBook:resolveCanonImages] summary (mode=${mode}, lane=${laneKey || 'generic'}):`,
    Object.entries(map).map(([k, v]) => `${k}=${v.images.length}`).join(', '),
    strictDeckMode ? `| unresolved=${totalUnresolved}` : '',
  );

  return map as unknown as ResolvedCanonImages;
}
