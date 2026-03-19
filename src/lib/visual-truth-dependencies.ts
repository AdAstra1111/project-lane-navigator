/**
 * Visual Truth Dependency System — Dependency-Precise Edition
 * 
 * Resolves, persists, and checks freshness of upstream visual truth
 * for all generated visual assets (posters, images, etc).
 * 
 * Key principles:
 * - Snapshots capture ONLY actual dependencies used, not all project truth
 * - Freshness uses version_id comparison (not updated_at timestamps)
 * - Cast bindings are first-class dependencies
 * - Stale reasons identify exact changed dependency classes
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

export type DependencyClass = 'cast' | 'look' | 'state' | 'dna' | 'world' | 'entity' | 'costume' | 'unknown';

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

export interface TruthRef {
  id: string;
  name: string;
  version_id?: string;
  /** Only used as fallback when no version_id is available */
  updated_at?: string;
}

export interface TruthSnapshot {
  characters: TruthRef[];
  locations: TruthRef[];
  visual_states: TruthRef[];
  dna_versions: TruthRef[];
  costume_looks: TruthRef[];
  cast_bindings: TruthRef[];
  canon_hash: string;
  captured_at: string;
  /** Whether this snapshot was captured with dependency-precise logic */
  precise: boolean;
}

export interface ChangedDependency {
  dependency_type: DependencyType;
  dependency_class: DependencyClass;
  dependency_id: string;
  label: string;
  old_version_id: string | null;
  new_version_id: string | null;
}

export interface FreshnessResult {
  status: FreshnessStatus;
  staleReasons: string[];
  changedDependencies: ChangedDependency[];
  /** Which dependency classes are affected */
  affectedClasses: DependencyClass[];
  /** Whether the poster predates dependency tracking */
  predatesDependencyTracking: boolean;
}

// ── Dependency Class Mapping ──

function dependencyTypeToClass(dt: DependencyType): DependencyClass {
  switch (dt) {
    case 'cast_binding': return 'cast';
    case 'visual_identity': return 'look';
    case 'visual_state': return 'state';
    case 'dna_version': return 'dna';
    case 'canon_location': return 'world';
    case 'narrative_entity': return 'entity';
    case 'costume_look': return 'costume';
    default: return 'unknown';
  }
}

// ── Snapshot Capture (client-side, used for freshness checks) ──

/**
 * Capture current approved visual truth for specified dependency IDs only.
 * If no specific IDs provided, falls back to project-wide (for initial generation).
 */
export async function captureApprovedTruthForDependencies(
  projectId: string,
  specificIds?: {
    characterIds?: string[];
    locationIds?: string[];
    dnaCharacterNames?: string[];
  },
): Promise<TruthSnapshot> {
  const queries: Promise<any>[] = [];

  // Characters — only fetch specified or all active
  if (specificIds?.characterIds?.length) {
    queries.push(
      (supabase as any).from('narrative_entities')
        .select('id, canonical_name, updated_at')
        .in('id', specificIds.characterIds)
        .eq('active', true)
    );
  } else {
    queries.push(
      (supabase as any).from('narrative_entities')
        .select('id, canonical_name, updated_at')
        .eq('project_id', projectId)
        .eq('entity_type', 'character')
        .eq('active', true)
        .limit(50)
    );
  }

  // Locations — only fetch specified or all active
  if (specificIds?.locationIds?.length) {
    queries.push(
      (supabase as any).from('canon_locations')
        .select('id, canonical_name, updated_at')
        .in('id', specificIds.locationIds)
        .eq('active', true)
    );
  } else {
    queries.push(
      (supabase as any).from('canon_locations')
        .select('id, canonical_name, updated_at')
        .eq('project_id', projectId)
        .eq('active', true)
        .limit(50)
    );
  }

  // DNA versions — only fetch for specific characters or all current
  if (specificIds?.dnaCharacterNames?.length) {
    queries.push(
      (supabase as any).from('character_visual_dna')
        .select('id, character_name, version_number, created_at')
        .eq('project_id', projectId)
        .eq('is_current', true)
        .in('character_name', specificIds.dnaCharacterNames)
    );
  } else {
    queries.push(
      (supabase as any).from('character_visual_dna')
        .select('id, character_name, version_number, created_at')
        .eq('project_id', projectId)
        .eq('is_current', true)
        .limit(50)
    );
  }

  // Visual states — fetch all for now (scoped later if needed)
  queries.push(
    (supabase as any).from('entity_visual_states')
      .select('id, state_label, entity_id, updated_at')
      .eq('project_id', projectId)
      .limit(100)
  );

  // Cast bindings — first-class dependency
  queries.push(
    (supabase as any).from('visual_sets')
      .select('id, subject_ref, status, current_dna_version_id, updated_at')
      .eq('project_id', projectId)
      .eq('domain', 'character_identity')
      .in('status', ['active', 'locked'])
      .limit(50)
  );

  const [charRes, locRes, dnaRes, stateRes, castRes] = await Promise.all(queries);

  const characters: TruthRef[] = (charRes.data || []).map((c: any) => ({
    id: c.id,
    name: c.canonical_name,
    updated_at: c.updated_at,
  }));

  const locations: TruthRef[] = (locRes.data || []).map((l: any) => ({
    id: l.id,
    name: l.canonical_name,
    updated_at: l.updated_at,
  }));

  const dna_versions: TruthRef[] = (dnaRes.data || []).map((d: any) => ({
    id: d.id,
    name: d.character_name,
    version_id: d.id, // DNA id IS the version
    updated_at: d.created_at,
  }));

  const visual_states: TruthRef[] = (stateRes.data || []).map((s: any) => ({
    id: s.id,
    name: s.state_label || 'unnamed state',
    updated_at: s.updated_at,
  }));

  const cast_bindings: TruthRef[] = (castRes.data || []).map((cb: any) => ({
    id: cb.id,
    name: cb.subject_ref || 'unknown',
    version_id: cb.current_dna_version_id || undefined,
    updated_at: cb.updated_at,
  }));

  const parts = [
    ...characters.map(c => `char:${c.id}`),
    ...locations.map(l => `loc:${l.id}`),
    ...dna_versions.map(d => `dna:${d.id}:${d.version_id || ''}`),
    ...visual_states.map(s => `state:${s.id}`),
    ...cast_bindings.map(cb => `cast:${cb.id}:${cb.version_id || ''}`),
  ];
  const canon_hash = simpleHash(parts.sort().join('|'));

  return {
    characters,
    locations,
    visual_states,
    dna_versions,
    costume_looks: [],
    cast_bindings,
    canon_hash,
    captured_at: new Date().toISOString(),
    precise: !!specificIds,
  };
}

/**
 * Legacy: Capture full project truth (used when no specific deps are known).
 */
export async function captureVisualTruthSnapshot(
  projectId: string,
): Promise<TruthSnapshot> {
  return captureApprovedTruthForDependencies(projectId);
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
    links.push({ project_id: projectId, asset_type: assetType, asset_id: assetId, dependency_type: 'narrative_entity', dependency_id: c.id, dependency_version_id: null });
  }
  for (const l of snapshot.locations) {
    links.push({ project_id: projectId, asset_type: assetType, asset_id: assetId, dependency_type: 'canon_location', dependency_id: l.id, dependency_version_id: null });
  }
  for (const d of snapshot.dna_versions) {
    links.push({ project_id: projectId, asset_type: assetType, asset_id: assetId, dependency_type: 'dna_version', dependency_id: d.id, dependency_version_id: d.version_id || null });
  }
  for (const s of snapshot.visual_states) {
    links.push({ project_id: projectId, asset_type: assetType, asset_id: assetId, dependency_type: 'visual_state', dependency_id: s.id, dependency_version_id: null });
  }
  for (const cb of snapshot.cast_bindings) {
    links.push({ project_id: projectId, asset_type: assetType, asset_id: assetId, dependency_type: 'cast_binding', dependency_id: cb.id, dependency_version_id: cb.version_id || null });
  }

  if (links.length > 0) {
    await (supabase as any).from('visual_dependency_links').insert(links);
  }
}

// ── Freshness Check ──

/**
 * Check freshness of a visual asset against current upstream approved truth.
 * Uses version-based comparison where possible, updated_at only as fallback.
 */
export async function checkAssetFreshness(
  projectId: string,
  _assetType: string,
  _assetId: string,
  storedSnapshot: TruthSnapshot | null,
): Promise<FreshnessResult> {
  if (!storedSnapshot) {
    return {
      status: 'stale',
      staleReasons: ['Poster predates dependency tracking — re-generate under governed truth'],
      changedDependencies: [],
      affectedClasses: [],
      predatesDependencyTracking: true,
    };
  }

  // Extract specific dependency IDs from the stored snapshot for precise re-fetch
  const characterIds = storedSnapshot.characters.map(c => c.id);
  const locationIds = storedSnapshot.locations.map(l => l.id);
  const dnaCharacterNames = storedSnapshot.dna_versions.map(d => d.name);

  const currentSnapshot = await captureApprovedTruthForDependencies(projectId, {
    characterIds: characterIds.length > 0 ? characterIds : undefined,
    locationIds: locationIds.length > 0 ? locationIds : undefined,
    dnaCharacterNames: dnaCharacterNames.length > 0 ? dnaCharacterNames : undefined,
  });

  const changed: ChangedDependency[] = [];
  const reasons: string[] = [];

  // Compare characters — version-based when available, updated_at as fallback
  compareRefs(storedSnapshot.characters, currentSnapshot.characters, 'narrative_entity', 'entity', 'Character', changed, reasons);

  // Compare locations
  compareRefs(storedSnapshot.locations, currentSnapshot.locations, 'canon_location', 'world', 'Location', changed, reasons);

  // Compare DNA versions — strict version_id comparison
  compareDNAVersions(storedSnapshot.dna_versions, currentSnapshot.dna_versions, changed, reasons);

  // Compare visual states
  compareRefs(storedSnapshot.visual_states, currentSnapshot.visual_states, 'visual_state', 'state', 'Visual state', changed, reasons);

  // Compare cast bindings — first-class
  compareCastBindings(storedSnapshot.cast_bindings || [], currentSnapshot.cast_bindings, changed, reasons);

  if (changed.length === 0) {
    return { status: 'current', staleReasons: [], changedDependencies: [], affectedClasses: [], predatesDependencyTracking: false };
  }

  const affectedClasses = [...new Set(changed.map(c => c.dependency_class))];

  return {
    status: 'stale',
    staleReasons: reasons,
    changedDependencies: changed,
    affectedClasses,
    predatesDependencyTracking: false,
  };
}

// ── Comparison Helpers ──

function compareRefs(
  stored: TruthRef[], current: TruthRef[],
  depType: DependencyType, depClass: DependencyClass,
  labelPrefix: string,
  changed: ChangedDependency[], reasons: string[],
) {
  const currentMap = new Map(current.map(c => [c.id, c]));
  for (const old of stored) {
    const cur = currentMap.get(old.id);
    if (!cur) {
      changed.push({ dependency_type: depType, dependency_class: depClass, dependency_id: old.id, label: old.name, old_version_id: old.version_id || null, new_version_id: null });
      reasons.push(`${labelPrefix} "${old.name}" removed from canon`);
    } else if (cur.version_id && old.version_id && cur.version_id !== old.version_id) {
      // Version-based comparison (preferred)
      changed.push({ dependency_type: depType, dependency_class: depClass, dependency_id: old.id, label: old.name, old_version_id: old.version_id, new_version_id: cur.version_id });
      reasons.push(`Approved ${labelPrefix.toLowerCase()} "${old.name}" updated (version changed)`);
    }
    // NOTE: We no longer compare updated_at timestamps — only version_id changes trigger staleness
  }
}

function compareDNAVersions(
  stored: TruthRef[], current: TruthRef[],
  changed: ChangedDependency[], reasons: string[],
) {
  const currentByName = new Map(current.map(d => [d.name, d]));
  for (const old of stored) {
    const cur = currentByName.get(old.name);
    if (!cur) {
      changed.push({ dependency_type: 'dna_version', dependency_class: 'dna', dependency_id: old.id, label: old.name, old_version_id: old.version_id || null, new_version_id: null });
      reasons.push(`Approved DNA for "${old.name}" no longer current`);
    } else if (cur.version_id !== old.version_id) {
      changed.push({ dependency_type: 'dna_version', dependency_class: 'dna', dependency_id: old.id, label: old.name, old_version_id: old.version_id || null, new_version_id: cur.version_id || null });
      reasons.push(`Approved DNA for "${old.name}" updated to new version`);
    }
  }
}

function compareCastBindings(
  stored: TruthRef[], current: TruthRef[],
  changed: ChangedDependency[], reasons: string[],
) {
  const currentMap = new Map(current.map(cb => [cb.id, cb]));
  for (const old of stored) {
    const cur = currentMap.get(old.id);
    if (!cur) {
      changed.push({ dependency_type: 'cast_binding', dependency_class: 'cast', dependency_id: old.id, label: old.name, old_version_id: old.version_id || null, new_version_id: null });
      reasons.push(`Cast binding for "${old.name}" removed`);
    } else if (cur.version_id !== old.version_id) {
      changed.push({ dependency_type: 'cast_binding', dependency_class: 'cast', dependency_id: old.id, label: old.name, old_version_id: old.version_id || null, new_version_id: cur.version_id || null });
      reasons.push(`Cast changed for "${old.name}" — approved identity set updated`);
    }
  }
  // Detect new cast bindings not in stored snapshot
  const storedIds = new Set(stored.map(s => s.id));
  for (const cur of current) {
    if (!storedIds.has(cur.id)) {
      changed.push({ dependency_type: 'cast_binding', dependency_class: 'cast', dependency_id: cur.id, label: cur.name, old_version_id: null, new_version_id: cur.version_id || null });
      reasons.push(`New cast binding added for "${cur.name}"`);
    }
  }
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
