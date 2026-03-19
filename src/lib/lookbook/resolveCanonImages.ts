/**
 * resolveCanonImages — Resolves active canonical images per lookbook section.
 * Uses the SAME query logic as useLookbookSectionContent (workspace)
 * to ensure presentation and workspace share a single source of truth.
 */
import { supabase } from '@/integrations/supabase/client';
import type { ProjectImage } from '@/lib/images/types';

type CanonicalSectionKey =
  | 'character_identity'
  | 'world_locations'
  | 'atmosphere_lighting'
  | 'texture_detail'
  | 'symbolic_motifs'
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
};

export interface SectionImageResult {
  sectionKey: CanonicalSectionKey;
  images: ProjectImage[];
  imageIds: string[];
}

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
  } else if (mapping.fallback_roles?.length) {
    q = q.in('role', mapping.fallback_roles);
  }

  if (mapping.asset_groups.length > 0) {
    q = q.in('asset_group', mapping.asset_groups);
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

  // Last resort: try is_active=true (legacy) if still empty
  if (images.length === 0) {
    let lq = (supabase as any)
      .from('project_images')
      .select('*')
      .eq('project_id', projectId)
      .eq('is_active', true);

    if (mapping.strategy_keys.length > 0) {
      lq = lq.in('strategy_key', mapping.strategy_keys);
    } else if (mapping.fallback_roles?.length) {
      lq = lq.in('role', mapping.fallback_roles);
    }
    if (mapping.asset_groups.length > 0) {
      lq = lq.in('asset_group', mapping.asset_groups);
    }
    if (shotFilter?.length) {
      lq = lq.in('shot_type', shotFilter);
    }

    lq = lq
      .order('is_primary', { ascending: false })
      .order('created_at', { ascending: false })
      .limit(limit);

    const { data: legacyRows } = await lq;
    if (legacyRows?.length) {
      console.warn(`[LookBook:resolveCanonImages] ${sectionKey}: using legacy is_active fallback (${legacyRows.length} images)`);
      images = legacyRows as ProjectImage[];
    }
  }

  await hydrateSignedUrls(images);

  console.log(`[LookBook:resolveCanonImages] ${sectionKey}: resolved ${images.length} images`, images.map(i => i.id));

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
  poster_directions: SectionImageResult;
}

/**
 * Resolves all canonical lookbook section images in parallel.
 * Uses identical query logic to the workspace panels.
 */
export async function resolveAllCanonImages(projectId: string): Promise<ResolvedCanonImages> {
  const sections: CanonicalSectionKey[] = [
    'character_identity',
    'world_locations',
    'atmosphere_lighting',
    'texture_detail',
    'symbolic_motifs',
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
