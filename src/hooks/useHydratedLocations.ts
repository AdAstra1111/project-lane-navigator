/**
 * useHydratedLocations — Resolves fully hydrated location rows from:
 *   1. canon_locations (authority)
 *   2. scene_graph_versions (usage stats via canon_location_id)
 *   3. project_images (visual reference counts via canon_location_id)
 *
 * ID-based joins are primary; fuzzy text matching only for unresolved rows.
 * Exposes binding status, readiness state, pack blueprint, and primary scoring.
 */
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useCanonLocations, type CanonLocation } from '@/hooks/useCanonLocations';

// ── Types ──

export type LocationReadiness =
  | 'ready_to_generate'
  | 'missing_canon_data'
  | 'has_existing_refs'
  | 'needs_refresh'
  | 'primary_selected';

export type LocationBindingStatus = 'canon_bound' | 'partially_bound' | 'unresolved';

export interface PackSlotSuggestion {
  slot: string;
  label: string;
  recommended: boolean;
}

export interface HydratedLocation {
  // Canon identity
  id: string;
  canonical_name: string;
  normalized_name: string;
  location_type: string;
  interior_or_exterior: string | null;
  geography: string | null;
  era_relevance: string | null;
  story_importance: string;
  recurring: boolean;
  description: string | null;
  associated_characters: string[];
  provenance: string | null;

  // Scene graph usage
  scene_count: number;
  first_scene_key: string | null;
  scene_ids: string[];
  characters_at_location: string[];
  usage_tier: 'primary' | 'secondary' | 'minor';

  // Visual reference state
  total_images: number;
  active_images: number;
  candidate_images: number;
  has_primary: boolean;
  has_establishing: boolean;

  // Readiness
  readiness: LocationReadiness;
  readiness_reason: string;

  // Scoring for primary suggestion
  hydration_score: number;
  suggested_primary: boolean;

  // Pack blueprint
  pack_blueprint: PackSlotSuggestion[];

  // Binding status
  binding_status: LocationBindingStatus;
  bound_scene_count: number;
  unresolved_scene_count: number;
  bound_image_count: number;
  unresolved_image_count: number;
}

// ── Scene usage resolver (ID-based primary, fuzzy fallback) ──

interface SceneLocationUsage {
  canon_location_id: string | null;
  location_text: string;
  scene_id: string;
  scene_key: string | null;
  characters_present: string[];
}

async function fetchSceneLocationUsage(projectId: string): Promise<SceneLocationUsage[]> {
  const { data, error } = await (supabase as any)
    .from('scene_graph_versions')
    .select('scene_id, location, canon_location_id, characters_present, slugline')
    .eq('project_id', projectId)
    .not('location', 'is', null)
    .order('version_number', { ascending: false });

  if (error || !data) return [];

  // Deduplicate to latest version per scene
  const seen = new Set<string>();
  const results: SceneLocationUsage[] = [];
  for (const row of data) {
    if (seen.has(row.scene_id)) continue;
    seen.add(row.scene_id);
    const loc = (row.location || '').trim();
    if (!loc) continue;

    let chars: string[] = [];
    if (Array.isArray(row.characters_present)) {
      chars = row.characters_present.filter((c: any) => typeof c === 'string');
    }

    results.push({
      canon_location_id: row.canon_location_id || null,
      location_text: loc,
      scene_id: row.scene_id,
      scene_key: row.slugline || null,
      characters_present: chars,
    });
  }
  return results;
}

// ── Image stats resolver (ID-based primary, fuzzy fallback) ──

interface LocationImageStats {
  canon_location_id: string | null;
  subject_ref: string;
  total: number;
  active: number;
  candidate: number;
  has_primary: boolean;
  has_establishing: boolean;
}

async function fetchLocationImageStats(projectId: string): Promise<LocationImageStats[]> {
  const { data, error } = await (supabase as any)
    .from('project_images')
    .select('id, subject_ref, canon_location_id, curation_state, is_primary, shot_type')
    .eq('project_id', projectId)
    .eq('asset_group', 'world');

  if (error || !data) return [];

  // Group by canon_location_id first, then by subject_ref for unbound
  const byKey = new Map<string, LocationImageStats>();

  for (const img of data) {
    // Prefer canon_location_id as grouping key
    const canonId = img.canon_location_id || null;
    const subjectRef = (img.subject_ref || '').toLowerCase().trim();
    const key = canonId ? `id:${canonId}` : `ref:${subjectRef}`;

    if (!key || key === 'ref:') continue;

    if (!byKey.has(key)) {
      byKey.set(key, {
        canon_location_id: canonId,
        subject_ref: subjectRef,
        total: 0, active: 0, candidate: 0,
        has_primary: false, has_establishing: false,
      });
    }
    const s = byKey.get(key)!;
    s.total++;
    if (img.curation_state === 'active') s.active++;
    if (img.curation_state === 'candidate') s.candidate++;
    if (img.is_primary) s.has_primary = true;
    if (img.shot_type === 'wide' || img.shot_type === 'atmospheric') s.has_establishing = true;
  }

  return Array.from(byKey.values());
}

// ── Normalize for fallback matching only ──

function normKey(name: string): string {
  return (name || '').toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');
}

// ── Pack blueprint builder ──

function buildPackBlueprint(loc: { story_importance: string; recurring: boolean; scene_count: number }): PackSlotSuggestion[] {
  const isHigh = loc.story_importance === 'primary' || loc.scene_count >= 5 || loc.recurring;
  const isMid = loc.story_importance === 'secondary' || loc.scene_count >= 2;

  const slots: PackSlotSuggestion[] = [
    { slot: 'establishing', label: 'Establishing Wide', recommended: true },
    { slot: 'atmospheric', label: 'Atmospheric / Mood', recommended: true },
  ];

  if (isHigh) {
    slots.push(
      { slot: 'detail', label: 'Detail / Texture', recommended: true },
      { slot: 'practical', label: 'Practical / Story-Function', recommended: true },
      { slot: 'symbolic', label: 'Symbolic / Thematic', recommended: false },
    );
  } else if (isMid) {
    slots.push(
      { slot: 'detail', label: 'Detail / Texture', recommended: true },
      { slot: 'practical', label: 'Practical / Story-Function', recommended: false },
    );
  }

  return slots;
}

// ── Main hook ──

export function useHydratedLocations(projectId: string | undefined) {
  const { locations: canonLocations, isLoading: canonLoading, seedFromCanon, refetch } = useCanonLocations(projectId);

  const { data: sceneUsage = [], isLoading: scenesLoading } = useQuery({
    queryKey: ['location-scene-usage', projectId],
    queryFn: () => fetchSceneLocationUsage(projectId!),
    enabled: !!projectId,
    staleTime: 30_000,
  });

  const { data: imageStats = [], isLoading: imagesLoading } = useQuery({
    queryKey: ['location-image-stats', projectId],
    queryFn: () => fetchLocationImageStats(projectId!),
    enabled: !!projectId,
    staleTime: 30_000,
  });

  const isLoading = canonLoading || scenesLoading || imagesLoading;

  // Build hydrated rows
  const hydratedLocations: HydratedLocation[] = canonLocations.map(loc => {
    const locNorm = normKey(loc.canonical_name);

    // ── Scene matching: ID-based primary, fuzzy fallback ──
    const boundScenes = sceneUsage.filter(s => s.canon_location_id === loc.id);
    const unboundScenes = boundScenes.length === 0
      ? sceneUsage.filter(s =>
          !s.canon_location_id && normKey(s.location_text) === locNorm
        )
      : [];
    const matchingScenes = [...boundScenes, ...unboundScenes];
    const sceneCount = matchingScenes.length;
    const firstSceneKey = matchingScenes[0]?.scene_key || null;
    const sceneIds = matchingScenes.map(s => s.scene_id);
    const allChars = new Set<string>();
    matchingScenes.forEach(s => s.characters_present.forEach(c => allChars.add(c)));
    loc.associated_characters.forEach(c => allChars.add(c));

    // ── Image matching: ID-based primary, fuzzy fallback ──
    const boundImgStat = imageStats.find(s => s.canon_location_id === loc.id);
    const unboundImgStat = !boundImgStat
      ? imageStats.find(s => !s.canon_location_id && normKey(s.subject_ref) === locNorm)
      : null;
    const imgStat = boundImgStat || unboundImgStat || null;

    // Binding status
    const boundSceneCount = boundScenes.length;
    const unresolvedSceneCount = unboundScenes.length;
    const boundImageCount = boundImgStat?.total || 0;
    const unresolvedImageCount = unboundImgStat?.total || 0;

    let bindingStatus: LocationBindingStatus = 'canon_bound';
    if (unresolvedSceneCount > 0 || unresolvedImageCount > 0) {
      bindingStatus = boundSceneCount > 0 || boundImageCount > 0 ? 'partially_bound' : 'unresolved';
    }
    if (sceneCount === 0 && (imgStat?.total || 0) === 0) {
      // No downstream data yet — canonical entry exists but nothing linked
      bindingStatus = 'canon_bound';
    }

    // Determine usage tier
    let usageTier: 'primary' | 'secondary' | 'minor' = 'minor';
    if (loc.story_importance === 'primary' || sceneCount >= 5) usageTier = 'primary';
    else if (loc.story_importance === 'secondary' || sceneCount >= 2) usageTier = 'secondary';

    // Readiness
    let readiness: LocationReadiness = 'ready_to_generate';
    let readinessReason = 'Ready to generate location pack';
    if (!loc.canonical_name || !loc.location_type) {
      readiness = 'missing_canon_data';
      readinessReason = 'Missing required canon fields';
    } else if (imgStat?.has_primary) {
      readiness = 'primary_selected';
      readinessReason = 'Primary reference selected';
    } else if (imgStat && imgStat.total > 0) {
      readiness = 'has_existing_refs';
      readinessReason = `${imgStat.total} reference(s) exist — select primary`;
    }

    // Hydration score
    const hydrationScore =
      (loc.story_importance === 'primary' ? 50 : loc.story_importance === 'secondary' ? 20 : 5) +
      sceneCount * 3 +
      (loc.recurring ? 15 : 0) +
      (imgStat?.has_primary ? 10 : 0) +
      (imgStat?.total || 0) * 2;

    const suggestedPrimary = usageTier === 'primary' && !imgStat?.has_primary;

    const packBlueprint = buildPackBlueprint({
      story_importance: loc.story_importance,
      recurring: loc.recurring,
      scene_count: sceneCount,
    });

    return {
      id: loc.id,
      canonical_name: loc.canonical_name,
      normalized_name: loc.normalized_name,
      location_type: loc.location_type,
      interior_or_exterior: loc.interior_or_exterior,
      geography: loc.geography,
      era_relevance: loc.era_relevance,
      story_importance: loc.story_importance,
      recurring: loc.recurring,
      description: loc.description,
      associated_characters: loc.associated_characters,
      provenance: loc.provenance,
      scene_count: sceneCount,
      first_scene_key: firstSceneKey,
      scene_ids: sceneIds,
      characters_at_location: Array.from(allChars),
      usage_tier: usageTier,
      total_images: imgStat?.total || 0,
      active_images: imgStat?.active || 0,
      candidate_images: imgStat?.candidate || 0,
      has_primary: imgStat?.has_primary || false,
      has_establishing: imgStat?.has_establishing || false,
      readiness,
      readiness_reason: readinessReason,
      hydration_score: hydrationScore,
      suggested_primary: suggestedPrimary,
      pack_blueprint: packBlueprint,
      binding_status: bindingStatus,
      bound_scene_count: boundSceneCount,
      unresolved_scene_count: unresolvedSceneCount,
      bound_image_count: boundImageCount,
      unresolved_image_count: unresolvedImageCount,
    };
  });

  // Sort by hydration score descending
  hydratedLocations.sort((a, b) => b.hydration_score - a.hydration_score);

  // Unresolved stats
  const unresolvedScenes = sceneUsage.filter(s =>
    !s.canon_location_id &&
    !canonLocations.some(cl => normKey(cl.canonical_name) === normKey(s.location_text))
  );
  const unresolvedImages = imageStats.filter(s =>
    !s.canon_location_id &&
    !canonLocations.some(cl => normKey(cl.canonical_name) === normKey(s.subject_ref))
  );

  return {
    locations: hydratedLocations,
    isLoading,
    canonLocations,
    seedFromCanon,
    refetch,
    stats: {
      total: hydratedLocations.length,
      primary: hydratedLocations.filter(l => l.usage_tier === 'primary').length,
      withRefs: hydratedLocations.filter(l => l.total_images > 0).length,
      withPrimary: hydratedLocations.filter(l => l.has_primary).length,
      readyToGenerate: hydratedLocations.filter(l => l.readiness === 'ready_to_generate').length,
      canonBound: hydratedLocations.filter(l => l.binding_status === 'canon_bound').length,
      unresolvedSceneLocations: unresolvedScenes.length,
      unresolvedWorldRefs: unresolvedImages.length,
    },
  };
}
