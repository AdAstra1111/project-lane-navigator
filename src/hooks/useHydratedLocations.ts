/**
 * useHydratedLocations — Resolves fully hydrated location rows from:
 *   1. canon_locations (authority)
 *   2. scene_graph_versions (usage stats)
 *   3. project_images (visual reference counts)
 *
 * Exposes readiness state, pack blueprint suggestions, and primary scoring.
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
}

// ── Scene usage resolver ──

interface SceneLocationUsage {
  location: string;
  scene_id: string;
  scene_key: string | null;
  characters_present: string[];
}

async function fetchSceneLocationUsage(projectId: string): Promise<SceneLocationUsage[]> {
  // Get latest version per scene with location data
  const { data, error } = await (supabase as any)
    .from('scene_graph_versions')
    .select('scene_id, location, characters_present, slugline, metadata')
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

    // Extract scene key from slugline or metadata
    const sceneKey = row.slugline || null;

    results.push({
      location: loc,
      scene_id: row.scene_id,
      scene_key: sceneKey,
      characters_present: chars,
    });
  }
  return results;
}

// ── Image count resolver ──

interface LocationImageStats {
  subject: string;
  total: number;
  active: number;
  candidate: number;
  has_primary: boolean;
  has_establishing: boolean;
}

async function fetchLocationImageStats(projectId: string): Promise<LocationImageStats[]> {
  const { data, error } = await (supabase as any)
    .from('project_images')
    .select('id, subject_ref, curation_state, is_primary, shot_type')
    .eq('project_id', projectId)
    .eq('asset_group', 'world')
    .not('subject_ref', 'is', null);

  if (error || !data) return [];

  const bySubject = new Map<string, {
    total: number;
    active: number;
    candidate: number;
    has_primary: boolean;
    has_establishing: boolean;
  }>();

  for (const img of data) {
    const subj = (img.subject_ref || '').toLowerCase().trim();
    if (!subj) continue;
    if (!bySubject.has(subj)) {
      bySubject.set(subj, { total: 0, active: 0, candidate: 0, has_primary: false, has_establishing: false });
    }
    const s = bySubject.get(subj)!;
    s.total++;
    if (img.curation_state === 'active') s.active++;
    if (img.curation_state === 'candidate') s.candidate++;
    if (img.is_primary) s.has_primary = true;
    if (img.shot_type === 'wide' || img.shot_type === 'atmospheric') s.has_establishing = true;
  }

  return Array.from(bySubject.entries()).map(([subject, stats]) => ({ subject, ...stats }));
}

// ── Normalize for matching ──

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

    // Match scene usage
    const matchingScenes = sceneUsage.filter(s =>
      normKey(s.location) === locNorm ||
      normKey(s.location).includes(locNorm) ||
      locNorm.includes(normKey(s.location))
    );
    const sceneCount = matchingScenes.length;
    const firstSceneKey = matchingScenes[0]?.scene_key || null;
    const sceneIds = matchingScenes.map(s => s.scene_id);
    const allChars = new Set<string>();
    matchingScenes.forEach(s => s.characters_present.forEach(c => allChars.add(c)));
    // Merge canon-listed characters
    loc.associated_characters.forEach(c => allChars.add(c));

    // Match image stats
    const imgStat = imageStats.find(s =>
      normKey(s.subject) === locNorm ||
      s.subject === loc.canonical_name.toLowerCase()
    );

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

    // Hydration score for primary suggestion ranking
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
    };
  });

  // Sort by hydration score descending
  hydratedLocations.sort((a, b) => b.hydration_score - a.hydration_score);

  return {
    locations: hydratedLocations,
    isLoading,
    canonLocations,
    seedFromCanon,
    refetch,
    // Coverage stats
    stats: {
      total: hydratedLocations.length,
      primary: hydratedLocations.filter(l => l.usage_tier === 'primary').length,
      withRefs: hydratedLocations.filter(l => l.total_images > 0).length,
      withPrimary: hydratedLocations.filter(l => l.has_primary).length,
      readyToGenerate: hydratedLocations.filter(l => l.readiness === 'ready_to_generate').length,
    },
  };
}
