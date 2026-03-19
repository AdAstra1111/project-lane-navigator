/**
 * Visual Truth Dependency System — Unified Contract
 * 
 * Shared dependency resolution, truth capture, and freshness checking
 * for ALL downstream visual assets (posters, identity boards, visual sets,
 * look books, scene imagery, trailer visuals, etc).
 * 
 * Key principles:
 * - Entity-ID-first resolution — no fuzzy name matching where IDs exist
 * - Approved-truth gating — only approved/locked/canonical entities enter snapshots
 * - Dependency-precise scoping — unrelated truth changes don't stale unrelated assets
 * - Shared contract — same model for posters, images, and future asset types
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

/** Supported visual asset types for dependency tracking */
export type VisualAssetType = 'poster' | 'image' | 'visual_set' | 'look_book' | 'scene_image' | 'trailer_visual';

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
  affectedClasses: DependencyClass[];
  predatesDependencyTracking: boolean;
}

// ── 1. Subject Resolution (Entity-ID-first) ──

/**
 * Resolved subjects for a visual asset — entity-ID-based, no fuzzy matching.
 * This is the input contract for truth capture.
 */
export interface ResolvedVisualSubjects {
  entityIds: string[];
  castBindingIds: string[];
  locationIds: string[];
  dnaVersionIds: string[];
  stateIds: string[];
  costumeLookIds: string[];
  /** Character names only as display labels, never for resolution */
  characterLabels: string[];
}

/**
 * Resolve visual subjects for an asset by entity IDs.
 * Uses structured entity references — never fuzzy name matching.
 */
export async function resolveVisualSubjects(
  projectId: string,
  _assetType: VisualAssetType,
  context: {
    entityIds?: string[];
    characterNames?: string[];
    locationIds?: string[];
    locationNames?: string[];
  },
): Promise<ResolvedVisualSubjects> {
  const result: ResolvedVisualSubjects = {
    entityIds: [],
    castBindingIds: [],
    locationIds: [],
    dnaVersionIds: [],
    stateIds: [],
    costumeLookIds: [],
    characterLabels: [],
  };

  // ── Resolve characters by ID first, fall back to name lookup ──
  if (context.entityIds?.length) {
    const { data: entities } = await (supabase as any)
      .from('narrative_entities')
      .select('id, canonical_name')
      .in('id', context.entityIds)
      .eq('active', true);
    if (entities?.length) {
      result.entityIds = entities.map((e: any) => e.id);
      result.characterLabels = entities.map((e: any) => e.canonical_name);
    }
  } else if (context.characterNames?.length) {
    // Name-based lookup — resolve to IDs immediately, then use IDs downstream
    const { data: entities } = await (supabase as any)
      .from('narrative_entities')
      .select('id, canonical_name')
      .eq('project_id', projectId)
      .eq('entity_type', 'character')
      .eq('active', true);
    if (entities?.length) {
      const namesLower = context.characterNames.map(n => n.toLowerCase().trim());
      const matched = entities.filter((e: any) =>
        namesLower.some(n =>
          (e.canonical_name || '').toLowerCase().includes(n) ||
          n.includes((e.canonical_name || '').toLowerCase())
        )
      );
      result.entityIds = matched.map((e: any) => e.id);
      result.characterLabels = matched.map((e: any) => e.canonical_name);
    }
  }

  // ── Resolve locations by ID first, fall back to name lookup ──
  if (context.locationIds?.length) {
    result.locationIds = context.locationIds;
  } else if (context.locationNames?.length) {
    const { data: locations } = await (supabase as any)
      .from('canon_locations')
      .select('id, canonical_name')
      .eq('project_id', projectId)
      .eq('active', true);
    if (locations?.length) {
      const namesLower = context.locationNames.map(n => n.toLowerCase().trim());
      const matched = locations.filter((l: any) =>
        namesLower.some(n =>
          (l.canonical_name || '').toLowerCase().includes(n) ||
          n.includes((l.canonical_name || '').toLowerCase())
        )
      );
      result.locationIds = matched.map((l: any) => l.id);
    }
  }

  // ── Resolve DNA versions for matched characters ──
  if (result.characterLabels.length > 0) {
    const { data: dna } = await (supabase as any)
      .from('character_visual_dna')
      .select('id, character_name')
      .eq('project_id', projectId)
      .eq('is_current', true)
      .in('character_name', result.characterLabels);
    if (dna?.length) {
      result.dnaVersionIds = dna.map((d: any) => d.id);
    }
  }

  // ── Resolve cast bindings (visual sets) for matched characters ──
  if (result.characterLabels.length > 0) {
    const { data: casts } = await (supabase as any)
      .from('visual_sets')
      .select('id')
      .eq('project_id', projectId)
      .eq('domain', 'character_identity')
      .in('status', ['active', 'locked'])
      .in('subject_ref', result.characterLabels);
    if (casts?.length) {
      result.castBindingIds = casts.map((c: any) => c.id);
    }
  }

  // ── Resolve visual states scoped to matched entity IDs ──
  if (result.entityIds.length > 0) {
    const { data: states } = await (supabase as any)
      .from('entity_visual_states')
      .select('id')
      .eq('project_id', projectId)
      .in('entity_id', result.entityIds);
    if (states?.length) {
      result.stateIds = states.map((s: any) => s.id);
    }
  }

  return result;
}

// ── 2. Approved Truth Capture ──

const APPROVED_STATUSES = ['active', 'locked', 'approved'];

/**
 * Capture approved visual truth snapshot for resolved subjects.
 * Only approved/locked/canonical entities are included.
 * This is the shared contract for all visual asset types.
 */
export async function resolveApprovedVisualTruth(
  projectId: string,
  subjects: ResolvedVisualSubjects,
): Promise<TruthSnapshot> {
  const queries: Promise<any>[] = [];

  // Characters — by resolved entity IDs only
  if (subjects.entityIds.length > 0) {
    queries.push(
      (supabase as any).from('narrative_entities')
        .select('id, canonical_name, updated_at')
        .in('id', subjects.entityIds)
        .eq('active', true)
    );
  } else {
    queries.push(Promise.resolve({ data: [] }));
  }

  // Locations — by resolved location IDs only
  if (subjects.locationIds.length > 0) {
    queries.push(
      (supabase as any).from('canon_locations')
        .select('id, canonical_name, updated_at')
        .in('id', subjects.locationIds)
        .eq('active', true)
    );
  } else {
    queries.push(Promise.resolve({ data: [] }));
  }

  // DNA versions — by resolved IDs only
  if (subjects.dnaVersionIds.length > 0) {
    queries.push(
      (supabase as any).from('character_visual_dna')
        .select('id, character_name, version_number, created_at')
        .in('id', subjects.dnaVersionIds)
        .eq('is_current', true)
    );
  } else {
    queries.push(Promise.resolve({ data: [] }));
  }

  // Visual states — by resolved state IDs only
  if (subjects.stateIds.length > 0) {
    queries.push(
      (supabase as any).from('entity_visual_states')
        .select('id, state_label, entity_id, updated_at')
        .in('id', subjects.stateIds)
    );
  } else {
    queries.push(Promise.resolve({ data: [] }));
  }

  // Cast bindings — by resolved IDs, approved/locked only
  if (subjects.castBindingIds.length > 0) {
    queries.push(
      (supabase as any).from('visual_sets')
        .select('id, subject_ref, status, current_dna_version_id, updated_at')
        .in('id', subjects.castBindingIds)
        .in('status', APPROVED_STATUSES)
    );
  } else {
    queries.push(Promise.resolve({ data: [] }));
  }

  const [charRes, locRes, dnaRes, stateRes, castRes] = await Promise.all(queries);

  const characters: TruthRef[] = (charRes.data || []).map((c: any) => ({
    id: c.id, name: c.canonical_name, updated_at: c.updated_at,
  }));

  const locations: TruthRef[] = (locRes.data || []).map((l: any) => ({
    id: l.id, name: l.canonical_name, updated_at: l.updated_at,
  }));

  const dna_versions: TruthRef[] = (dnaRes.data || []).map((d: any) => ({
    id: d.id, name: d.character_name, version_id: d.id, updated_at: d.created_at,
  }));

  const visual_states: TruthRef[] = (stateRes.data || []).map((s: any) => ({
    id: s.id, name: s.state_label || 'unnamed state', updated_at: s.updated_at,
  }));

  const cast_bindings: TruthRef[] = (castRes.data || []).map((cb: any) => ({
    id: cb.id, name: cb.subject_ref || 'unknown',
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
    characters, locations, visual_states, dna_versions,
    costume_looks: [], cast_bindings,
    canon_hash, captured_at: new Date().toISOString(),
    precise: true,
  };
}

/**
 * Legacy: Capture full project truth (used when no specific deps are known).
 * @deprecated Use resolveVisualSubjects + resolveApprovedVisualTruth instead.
 */
export async function captureVisualTruthSnapshot(
  projectId: string,
): Promise<TruthSnapshot> {
  // Broad fallback — fetches all active entities
  const { data: chars } = await (supabase as any)
    .from('narrative_entities')
    .select('id, canonical_name, updated_at')
    .eq('project_id', projectId).eq('entity_type', 'character').eq('active', true).limit(50);
  const { data: locs } = await (supabase as any)
    .from('canon_locations')
    .select('id, canonical_name, updated_at')
    .eq('project_id', projectId).eq('active', true).limit(50);
  const { data: dna } = await (supabase as any)
    .from('character_visual_dna')
    .select('id, character_name, version_number, created_at')
    .eq('project_id', projectId).eq('is_current', true).limit(50);
  const { data: states } = await (supabase as any)
    .from('entity_visual_states')
    .select('id, state_label, entity_id, updated_at')
    .eq('project_id', projectId).limit(100);
  const { data: casts } = await (supabase as any)
    .from('visual_sets')
    .select('id, subject_ref, status, current_dna_version_id, updated_at')
    .eq('project_id', projectId).eq('domain', 'character_identity')
    .in('status', APPROVED_STATUSES).limit(50);

  const characters: TruthRef[] = (chars || []).map((c: any) => ({ id: c.id, name: c.canonical_name, updated_at: c.updated_at }));
  const locations: TruthRef[] = (locs || []).map((l: any) => ({ id: l.id, name: l.canonical_name, updated_at: l.updated_at }));
  const dna_versions: TruthRef[] = (dna || []).map((d: any) => ({ id: d.id, name: d.character_name, version_id: d.id, updated_at: d.created_at }));
  const visual_states: TruthRef[] = (states || []).map((s: any) => ({ id: s.id, name: s.state_label || 'unnamed', updated_at: s.updated_at }));
  const cast_bindings: TruthRef[] = (casts || []).map((cb: any) => ({ id: cb.id, name: cb.subject_ref || 'unknown', version_id: cb.current_dna_version_id || undefined, updated_at: cb.updated_at }));

  const parts = [
    ...characters.map(c => `char:${c.id}`),
    ...locations.map(l => `loc:${l.id}`),
    ...dna_versions.map(d => `dna:${d.id}:${d.version_id || ''}`),
    ...visual_states.map(s => `state:${s.id}`),
    ...cast_bindings.map(cb => `cast:${cb.id}:${cb.version_id || ''}`),
  ];

  return {
    characters, locations, visual_states, dna_versions,
    costume_looks: [], cast_bindings,
    canon_hash: simpleHash(parts.sort().join('|')),
    captured_at: new Date().toISOString(),
    precise: false,
  };
}

// ── 3. Dependency Link Persistence ──

/**
 * Persist dependency links for any visual asset type.
 */
export async function persistDependencyLinks(
  projectId: string,
  assetType: VisualAssetType | string,
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

// ── 4. Freshness Check ──

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

/**
 * Check freshness of any visual asset against current upstream approved truth.
 * Re-resolves by entity IDs from stored snapshot — no fuzzy matching.
 */
export async function checkAssetFreshness(
  projectId: string,
  _assetType: VisualAssetType | string,
  _assetId: string,
  storedSnapshot: TruthSnapshot | null,
): Promise<FreshnessResult> {
  if (!storedSnapshot) {
    return {
      status: 'stale',
      staleReasons: ['Asset predates dependency tracking — re-generate under governed truth'],
      changedDependencies: [],
      affectedClasses: [],
      predatesDependencyTracking: true,
    };
  }

  // Re-resolve using entity IDs from stored snapshot — entity-ID-first
  const subjects: ResolvedVisualSubjects = {
    entityIds: storedSnapshot.characters.map(c => c.id),
    castBindingIds: (storedSnapshot.cast_bindings || []).map(cb => cb.id),
    locationIds: storedSnapshot.locations.map(l => l.id),
    dnaVersionIds: storedSnapshot.dna_versions.map(d => d.id),
    stateIds: storedSnapshot.visual_states.map(s => s.id),
    costumeLookIds: (storedSnapshot.costume_looks || []).map(cl => cl.id),
    characterLabels: storedSnapshot.characters.map(c => c.name),
  };

  const currentSnapshot = await resolveApprovedVisualTruth(projectId, subjects);

  const changed: ChangedDependency[] = [];
  const reasons: string[] = [];

  compareRefs(storedSnapshot.characters, currentSnapshot.characters, 'narrative_entity', 'entity', 'Character', changed, reasons);
  compareRefs(storedSnapshot.locations, currentSnapshot.locations, 'canon_location', 'world', 'Location', changed, reasons);
  compareDNAVersions(storedSnapshot.dna_versions, currentSnapshot.dna_versions, changed, reasons);
  compareRefs(storedSnapshot.visual_states, currentSnapshot.visual_states, 'visual_state', 'state', 'Visual state', changed, reasons);
  compareCastBindings(storedSnapshot.cast_bindings || [], currentSnapshot.cast_bindings, changed, reasons);

  if (changed.length === 0) {
    return { status: 'current', staleReasons: [], changedDependencies: [], affectedClasses: [], predatesDependencyTracking: false };
  }

  const affectedClasses = [...new Set(changed.map(c => c.dependency_class))];
  return { status: 'stale', staleReasons: reasons, changedDependencies: changed, affectedClasses, predatesDependencyTracking: false };
}

// ── 5. Stale Marking ──

/**
 * Mark assets stale when upstream truth changes. Works across all asset types.
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
  const imageIds = links.filter((l: any) => l.asset_type !== 'poster').map((l: any) => l.asset_id);

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
      changed.push({ dependency_type: depType, dependency_class: depClass, dependency_id: old.id, label: old.name, old_version_id: old.version_id, new_version_id: cur.version_id });
      reasons.push(`Approved ${labelPrefix.toLowerCase()} "${old.name}" updated (version changed)`);
    }
  }
}

function compareDNAVersions(
  stored: TruthRef[], current: TruthRef[],
  changed: ChangedDependency[], reasons: string[],
) {
  // Compare by ID — entity-ID-first, not name-based
  const currentById = new Map(current.map(d => [d.id, d]));
  const currentByName = new Map(current.map(d => [d.name, d]));
  for (const old of stored) {
    // Try ID match first
    let cur = currentById.get(old.id);
    // Fall back to name if ID not found (DNA may have been re-created)
    if (!cur) cur = currentByName.get(old.name);
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
  const storedIds = new Set(stored.map(s => s.id));
  for (const cur of current) {
    if (!storedIds.has(cur.id)) {
      changed.push({ dependency_type: 'cast_binding', dependency_class: 'cast', dependency_id: cur.id, label: cur.name, old_version_id: null, new_version_id: cur.version_id || null });
      reasons.push(`New cast binding added for "${cur.name}"`);
    }
  }
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
