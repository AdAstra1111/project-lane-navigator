/**
 * Visual Truth Dependency System
 * 
 * Resolves, persists, and checks freshness of upstream visual truth
 * for all generated visual assets (posters, images, etc).
 */

import { supabase } from '@/integrations/supabase/client';

// ── Types ──

export type FreshnessStatus = 'current' | 'stale' | 'needs_refresh' | 'historical_locked';

export type DependencyType =
  | 'narrative_entity'
  | 'cast_binding'
  | 'visual_identity'
  | 'visual_state'
  | 'costume_look'
  | 'canon_location'
  | 'dna_version'
  | 'engine_selection';

export interface VisualDependencyLink {
  id: string;
  project_id: string;
  asset_type: string;
  asset_id: string;
  dependency_type: DependencyType;
  dependency_id: string;
  dependency_version_id: string | null;
  active: boolean;
  created_at: string;
}

export interface TruthSnapshot {
  characters: TruthRef[];
  locations: TruthRef[];
  visual_states: TruthRef[];
  dna_versions: TruthRef[];
  costume_looks: TruthRef[];
  canon_hash: string;
  captured_at: string;
}

export interface TruthRef {
  id: string;
  name: string;
  version_id?: string;
  updated_at?: string;
}

export interface FreshnessResult {
  status: FreshnessStatus;
  staleReasons: string[];
  changedDependencies: ChangedDependency[];
}

export interface ChangedDependency {
  dependency_type: DependencyType;
  dependency_id: string;
  label: string;
  old_version_id: string | null;
  new_version_id: string | null;
}

// ── Snapshot Capture ──

/**
 * Capture current visual truth snapshot for a project.
 * Used at generation time to record what truth was consumed.
 */
export async function captureVisualTruthSnapshot(
  projectId: string,
): Promise<TruthSnapshot> {
  const [characters, locations, visualStates, dnaVersions] = await Promise.all([
    fetchCanonCharacters(projectId),
    fetchCanonLocations(projectId),
    fetchActiveVisualStates(projectId),
    fetchCurrentDNAVersions(projectId),
  ]);

  const parts = [
    ...characters.map(c => `char:${c.id}:${c.version_id || ''}`),
    ...locations.map(l => `loc:${l.id}:${l.version_id || ''}`),
    ...visualStates.map(s => `state:${s.id}:${s.version_id || ''}`),
    ...dnaVersions.map(d => `dna:${d.id}:${d.version_id || ''}`),
  ];
  const canon_hash = simpleHash(parts.sort().join('|'));

  return {
    characters,
    locations,
    visual_states: visualStates,
    dna_versions: dnaVersions,
    costume_looks: [],
    canon_hash,
    captured_at: new Date().toISOString(),
  };
}

/**
 * Persist dependency links for a generated asset.
 */
export async function persistDependencyLinks(
  projectId: string,
  assetType: string,
  assetId: string,
  snapshot: TruthSnapshot,
): Promise<void> {
  const links: Array<{
    project_id: string;
    asset_type: string;
    asset_id: string;
    dependency_type: DependencyType;
    dependency_id: string;
    dependency_version_id: string | null;
  }> = [];

  for (const c of snapshot.characters) {
    links.push({
      project_id: projectId,
      asset_type: assetType,
      asset_id: assetId,
      dependency_type: 'narrative_entity',
      dependency_id: c.id,
      dependency_version_id: c.version_id || null,
    });
  }

  for (const l of snapshot.locations) {
    links.push({
      project_id: projectId,
      asset_type: assetType,
      asset_id: assetId,
      dependency_type: 'canon_location',
      dependency_id: l.id,
      dependency_version_id: l.version_id || null,
    });
  }

  for (const d of snapshot.dna_versions) {
    links.push({
      project_id: projectId,
      asset_type: assetType,
      asset_id: assetId,
      dependency_type: 'dna_version',
      dependency_id: d.id,
      dependency_version_id: d.version_id || null,
    });
  }

  for (const s of snapshot.visual_states) {
    links.push({
      project_id: projectId,
      asset_type: assetType,
      asset_id: assetId,
      dependency_type: 'visual_state',
      dependency_id: s.id,
      dependency_version_id: s.version_id || null,
    });
  }

  if (links.length > 0) {
    await (supabase as any).from('visual_dependency_links').insert(links);
  }
}

// ── Freshness Check ──

/**
 * Check freshness of a visual asset against current upstream truth.
 */
export async function checkAssetFreshness(
  projectId: string,
  assetType: string,
  assetId: string,
  storedSnapshot: TruthSnapshot | null,
): Promise<FreshnessResult> {
  if (!storedSnapshot) {
    return { status: 'current', staleReasons: [], changedDependencies: [] };
  }

  const currentSnapshot = await captureVisualTruthSnapshot(projectId);
  const changed: ChangedDependency[] = [];
  const reasons: string[] = [];

  // Compare characters
  const currentCharMap = new Map(currentSnapshot.characters.map(c => [c.id, c]));
  for (const old of storedSnapshot.characters) {
    const cur = currentCharMap.get(old.id);
    if (!cur) {
      changed.push({ dependency_type: 'narrative_entity', dependency_id: old.id, label: old.name, old_version_id: old.version_id || null, new_version_id: null });
      reasons.push(`Character "${old.name}" removed from canon`);
    } else if (cur.updated_at !== old.updated_at) {
      changed.push({ dependency_type: 'narrative_entity', dependency_id: old.id, label: old.name, old_version_id: old.version_id || null, new_version_id: cur.version_id || null });
      reasons.push(`Character "${old.name}" updated`);
    }
  }

  // Compare locations
  const currentLocMap = new Map(currentSnapshot.locations.map(l => [l.id, l]));
  for (const old of storedSnapshot.locations) {
    const cur = currentLocMap.get(old.id);
    if (!cur) {
      changed.push({ dependency_type: 'canon_location', dependency_id: old.id, label: old.name, old_version_id: null, new_version_id: null });
      reasons.push(`Location "${old.name}" removed`);
    } else if (cur.updated_at !== old.updated_at) {
      changed.push({ dependency_type: 'canon_location', dependency_id: old.id, label: old.name, old_version_id: null, new_version_id: null });
      reasons.push(`Location "${old.name}" updated`);
    }
  }

  // Compare DNA versions
  const currentDnaMap = new Map(currentSnapshot.dna_versions.map(d => [d.id, d]));
  for (const old of storedSnapshot.dna_versions) {
    const cur = currentDnaMap.get(old.id);
    if (!cur) {
      changed.push({ dependency_type: 'dna_version', dependency_id: old.id, label: old.name, old_version_id: old.version_id || null, new_version_id: null });
      reasons.push(`DNA for "${old.name}" no longer current`);
    } else if (cur.version_id !== old.version_id) {
      changed.push({ dependency_type: 'dna_version', dependency_id: old.id, label: old.name, old_version_id: old.version_id || null, new_version_id: cur.version_id || null });
      reasons.push(`DNA for "${old.name}" updated to new version`);
    }
  }

  if (changed.length === 0) {
    return { status: 'current', staleReasons: [], changedDependencies: [] };
  }

  return {
    status: 'stale',
    staleReasons: reasons,
    changedDependencies: changed,
  };
}

/**
 * Mark assets stale when upstream truth changes.
 */
export async function markDependentAssetsStale(
  projectId: string,
  dependencyType: DependencyType,
  dependencyId: string,
  reason: string,
): Promise<{ posters_marked: number; images_marked: number }> {
  // Find all assets that depend on this
  const { data: links } = await (supabase as any)
    .from('visual_dependency_links')
    .select('asset_type, asset_id')
    .eq('project_id', projectId)
    .eq('dependency_type', dependencyType)
    .eq('dependency_id', dependencyId)
    .eq('active', true);

  if (!links?.length) return { posters_marked: 0, images_marked: 0 };

  let posters_marked = 0;
  let images_marked = 0;

  const posterIds = links.filter((l: any) => l.asset_type === 'poster').map((l: any) => l.asset_id);
  const imageIds = links.filter((l: any) => l.asset_type === 'image').map((l: any) => l.asset_id);

  if (posterIds.length > 0) {
    const { count } = await (supabase as any)
      .from('project_posters')
      .update({ freshness_status: 'stale', stale_reason: reason })
      .in('id', posterIds)
      .eq('freshness_status', 'current');
    posters_marked = count || posterIds.length;
  }

  if (imageIds.length > 0) {
    const { count } = await (supabase as any)
      .from('project_images')
      .update({ freshness_status: 'stale', stale_reason: reason })
      .in('id', imageIds)
      .eq('freshness_status', 'current');
    images_marked = count || imageIds.length;
  }

  return { posters_marked, images_marked };
}

// ── Data Fetchers ──

async function fetchCanonCharacters(projectId: string): Promise<TruthRef[]> {
  const { data } = await (supabase as any)
    .from('narrative_entities')
    .select('id, canonical_name, updated_at')
    .eq('project_id', projectId)
    .eq('entity_type', 'character')
    .eq('active', true)
    .limit(50);

  return (data || []).map((c: any) => ({
    id: c.id,
    name: c.canonical_name,
    updated_at: c.updated_at,
  }));
}

async function fetchCanonLocations(projectId: string): Promise<TruthRef[]> {
  const { data } = await (supabase as any)
    .from('canon_locations')
    .select('id, canonical_name, updated_at')
    .eq('project_id', projectId)
    .eq('active', true)
    .limit(50);

  return (data || []).map((l: any) => ({
    id: l.id,
    name: l.canonical_name,
    updated_at: l.updated_at,
  }));
}

async function fetchActiveVisualStates(projectId: string): Promise<TruthRef[]> {
  const { data } = await (supabase as any)
    .from('entity_visual_states')
    .select('id, state_label, updated_at')
    .eq('project_id', projectId)
    .limit(100);

  return (data || []).map((s: any) => ({
    id: s.id,
    name: s.state_label || 'unnamed state',
    updated_at: s.updated_at,
  }));
}

async function fetchCurrentDNAVersions(projectId: string): Promise<TruthRef[]> {
  const { data } = await (supabase as any)
    .from('character_visual_dna')
    .select('id, character_name, version_number, created_at')
    .eq('project_id', projectId)
    .eq('is_current', true)
    .limit(50);

  return (data || []).map((d: any) => ({
    id: d.id,
    name: d.character_name,
    version_id: d.id,
    updated_at: d.created_at,
  }));
}

// ── Utility ──

function simpleHash(input: string): string {
  let hash = 0;
  for (let i = 0; i < input.length; i++) {
    const char = input.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash |= 0;
  }
  return Math.abs(hash).toString(36);
}
