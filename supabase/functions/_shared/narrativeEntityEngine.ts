/**
 * narrativeEntityEngine.ts — NIT v1: Narrative Identity Tracking
 *
 * Deterministic canon-synced entity registry for narrative identity.
 * No LLM. No fuzzy discovery. No speculative inference.
 *
 * Entity keys are stable and do NOT rotate on canonical_name changes.
 * Arc and conflict entities use slot-stable keys (ARC_PROTAGONIST, CONFLICT_PRIMARY),
 * never derived from spine text.
 *
 * Constraint: dormant canon_units / canon_unit_mentions / canon_unit_relations tables
 * must NOT be used by this module. NIT uses narrative_entities exclusively.
 *
 * Sync triggers:
 *   T1 — syncCanonEntities()  — project_canon.canon_json.characters[]
 *   T2/T3 — syncSpineEntities() — narrative_spine_json.protagonist_arc + central_conflict
 *   T4 — markEntitiesStaleOnAmendment() — called from spine-amendment on confirm
 */

import { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";
import { parseSections }  from "./sectionRepairEngine.ts";
import { isSectionRepairSupported } from "./deliverableSectionRegistry.ts";

// ── Types ──────────────────────────────────────────────────────────────────

export type NITEntityType   = "character" | "arc" | "conflict";
export type NITSourceKind   = "project_canon" | "spine_axis" | "manual";
export type NITEntityStatus = "active" | "stale" | "retired";

export interface NarrativeEntityRow {
  project_id:     string;
  entity_key:     string;
  canonical_name: string;
  entity_type:    NITEntityType;
  source_kind:    NITSourceKind;
  source_key:     string | null;
  status:         NITEntityStatus;
  meta_json:      Record<string, any>;
  updated_at:     string;   // always set on upsert; created_at uses DB DEFAULT
}

export interface NITSyncResult {
  synced:  number;
  error?:  string;
}

export interface NITStaleResult {
  marked:  number;
  error?:  string;
}

// ── Slot key constants ─────────────────────────────────────────────────────

/**
 * Slot-stable keys for structural entities.
 * These are NEVER derived from spine text — they are fixed slot identifiers.
 * One arc and one primary conflict per project in NIT v1.
 */
export const ARC_PROTAGONIST_KEY   = "ARC_PROTAGONIST";
export const CONFLICT_PRIMARY_KEY  = "CONFLICT_PRIMARY";

// ── Entity key generation ─────────────────────────────────────────────────

/**
 * Generates a deterministic entity key from a type prefix + label.
 *
 * KEY STABILITY CONTRACT:
 *   - entity_key is computed once at FIRST creation and then frozen.
 *   - canonical_name changes do NOT regenerate the key.
 *   - Diacritics are normalised; non-alphanumeric chars → underscore.
 *   - This function should only be called for CHARACTER entities.
 *   - For arc and conflict, use ARC_PROTAGONIST_KEY / CONFLICT_PRIMARY_KEY directly.
 *
 * Examples:
 *   toEntityKey('CHAR', 'Elara Vance')         → CHAR_ELARA_VANCE
 *   toEntityKey('CHAR', 'The Alternate Elara') → CHAR_THE_ALTERNATE_ELARA
 *   toEntityKey('CHAR', 'Dr. Eleanor Ramsay')  → CHAR_DR_ELEANOR_RAMSAY
 */
export function toEntityKey(prefix: "CHAR" | "ARC" | "CONFLICT", label: string): string {
  const slug = label
    .toUpperCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")  // strip diacritics
    .replace(/[^A-Z0-9]+/g, "_")     // non-alphanum → underscore
    .replace(/^_|_$/g, "");          // trim leading/trailing underscores
  return `${prefix}_${slug}`;
}

// ── Internal helpers ───────────────────────────────────────────────────────

/**
 * Deterministically identifies a protagonist from a canon role string.
 * Returns true if the role string contains 'protagonist' (case-insensitive).
 * No fuzzy logic. No LLM.
 */
function isProtagonistRole(role: string | null | undefined): boolean {
  return /protagonist/i.test(role ?? "");
}

// ── T1: Canon entity sync ─────────────────────────────────────────────────

/**
 * T1 — Upsert character entities from project_canon.canon_json.characters[].
 *
 * Called after project_canon is written or updated.
 * Reads structured {name, role, description} per character.
 *
 * Upsert semantics (ON CONFLICT project_id, entity_key):
 *   - If entity_key already exists → updates canonical_name, meta_json, updated_at
 *   - entity_key is NOT updated (it's part of the conflict clause, matches itself)
 *   - created_at is NOT in the row object → preserved from original insert
 *
 * Fail-safe: characters[] absent, null, or empty → returns { synced: 0 }, no error.
 *
 * Note: if a character is renamed in canon (slug changes), a new entity is created
 * and the old one is orphaned. Explicit character retirement is NIT v1.1 scope.
 */
export async function syncCanonEntities(
  supabase: SupabaseClient,
  projectId: string,
  canonJson: Record<string, any> | null | undefined,
): Promise<NITSyncResult> {
  const characters = canonJson?.characters;
  if (!Array.isArray(characters) || characters.length === 0) {
    return { synced: 0 };
  }

  const now = new Date().toISOString();
  const rows: NarrativeEntityRow[] = characters
    .filter((c): c is { name: string; role?: string; description?: string } =>
      !!c && typeof c.name === "string" && c.name.trim().length > 0
    )
    .map((char, i) => ({
      project_id:     projectId,
      entity_key:     toEntityKey("CHAR", char.name),
      canonical_name: char.name,
      entity_type:    "character" as NITEntityType,
      source_kind:    "project_canon" as NITSourceKind,
      source_key:     `characters[${i}]`,
      status:         "active" as NITEntityStatus,
      meta_json: {
        canon_role:     char.role        ?? null,
        description:    char.description ?? null,
        is_protagonist: isProtagonistRole(char.role),
        aliases:        [],
      },
      updated_at: now,
    }));

  if (rows.length === 0) return { synced: 0 };

  const { error } = await supabase
    .from("narrative_entities")
    .upsert(rows, {
      onConflict:       "project_id,entity_key",
      ignoreDuplicates: false,  // always update canonical_name + meta_json on conflict
    });

  if (error) {
    console.warn("[NIT:T1] syncCanonEntities error:", error.message);
    return { synced: 0, error: error.message };
  }

  console.log(`[NIT:T1] synced ${rows.length} character entity/entities for project ${projectId}`);
  return { synced: rows.length };
}

// ── T2+T3: Spine entity sync ──────────────────────────────────────────────

/**
 * T2+T3 — Upsert arc and conflict entities from narrative_spine_json.
 *
 * Uses slot-stable keys (ARC_PROTAGONIST, CONFLICT_PRIMARY) that never
 * rotate regardless of spine value changes.
 *
 * On each upsert:
 *   - meta_json.spine_value is updated to the current value
 *   - entity_key is NOT changed (part of conflict clause)
 *   - status is set to 'active' (T4 may follow to mark stale if this is post-amendment)
 *
 * linked_character_key for ARC_PROTAGONIST is null in v1. NIT v1.1 will derive
 * this from canon roles once entity registry is stable.
 *
 * Fail-safe: protagonist_arc absent → no arc row. central_conflict absent → no conflict row.
 */
export async function syncSpineEntities(
  supabase: SupabaseClient,
  projectId: string,
  spineJson: Record<string, any> | null | undefined,
): Promise<NITSyncResult> {
  const protagonistArc  = spineJson?.protagonist_arc;
  const centralConflict = spineJson?.central_conflict;

  const now  = new Date().toISOString();
  const rows: NarrativeEntityRow[] = [];

  if (typeof protagonistArc === "string" && protagonistArc.trim().length > 0) {
    rows.push({
      project_id:     projectId,
      entity_key:     ARC_PROTAGONIST_KEY,      // slot-stable — never derived from text
      canonical_name: "Protagonist Arc",
      entity_type:    "arc",
      source_kind:    "spine_axis",
      source_key:     "protagonist_arc",
      status:         "active",
      meta_json: {
        arc_slot:             "protagonist",
        spine_axis:           "protagonist_arc",
        spine_value:          protagonistArc,
        linked_character_key: null,              // NIT v1.1: derive from canon roles
      },
      updated_at: now,
    });
  }

  if (typeof centralConflict === "string" && centralConflict.trim().length > 0) {
    rows.push({
      project_id:     projectId,
      entity_key:     CONFLICT_PRIMARY_KEY,     // slot-stable — never derived from text
      canonical_name: "Primary Conflict",
      entity_type:    "conflict",
      source_kind:    "spine_axis",
      source_key:     "central_conflict",
      status:         "active",
      meta_json: {
        conflict_slot: "primary",
        spine_axis:    "central_conflict",
        spine_value:   centralConflict,
      },
      updated_at: now,
    });
  }

  if (rows.length === 0) return { synced: 0 };

  const { error } = await supabase
    .from("narrative_entities")
    .upsert(rows, {
      onConflict:       "project_id,entity_key",
      ignoreDuplicates: false,
    });

  if (error) {
    console.warn("[NIT:T2/T3] syncSpineEntities error:", error.message);
    return { synced: 0, error: error.message };
  }

  console.log(`[NIT:T2/T3] synced ${rows.length} arc/conflict entity/entities for project ${projectId}`);
  return { synced: rows.length };
}

// ── T4: Entity staleness on spine amendment ────────────────────────────────

/**
 * T4 — Mark NIT entities stale when protagonist_arc or central_conflict is amended.
 *
 * Only fires for the two axes that have entity counterparts in NIT v1.
 * All other axis amendments are ignored (no-op, returns { marked: 0 }).
 *
 * Semantics:
 *   - status → 'stale'
 *   - meta_json.stale_reason appended (preserves existing meta_json)
 *   - entity_key is NOT rotated (frozen by design)
 *   - Only marks 'active' entities (idempotent — already-stale entities unaffected)
 *
 * Called AFTER syncSpineEntities() within the same spine-amendment request
 * so the entity first gets the updated spine_value, then receives the stale flag.
 *
 * Fail-safe: no matching active entities → no-op, returns { marked: 0 }.
 */
// ── NIT v1.1: Protagonist linkage + relations ─────────────────────────────

/**
 * Derives the single protagonist character entity for a project.
 *
 * Returns the entity_key and id of the character where is_protagonist=true.
 * If zero or multiple protagonists found → returns null (fail-safe — do not guess).
 * Deterministic: result is always canon-derived, never inferred.
 */
export async function deriveProtagonistCharacter(
  supabase: SupabaseClient,
  projectId: string,
): Promise<{ entity_key: string; id: string } | null> {
  const { data: chars, error } = await supabase
    .from("narrative_entities")
    .select("id, entity_key, meta_json")
    .eq("project_id", projectId)
    .eq("entity_type", "character")
    .eq("status", "active");

  if (error || !chars) {
    console.warn("[NIT:v1.1] deriveProtagonistCharacter fetch error:", error?.message);
    return null;
  }

  const protagonists = chars.filter(c => c.meta_json?.is_protagonist === true);
  if (protagonists.length !== 1) {
    // Zero or multiple — fail-safe: do not guess
    if (protagonists.length > 1) {
      console.warn(`[NIT:v1.1] ${protagonists.length} protagonists found — skipping linkage`);
    }
    return null;
  }

  return { entity_key: protagonists[0].entity_key, id: protagonists[0].id };
}

/**
 * Derives the single antagonist character entity for a project.
 *
 * Returns entity where role contains 'antagonist' (case-insensitive).
 * If zero or multiple → returns null (fail-safe).
 */
async function deriveAntagonistCharacter(
  supabase: SupabaseClient,
  projectId: string,
): Promise<{ entity_key: string; id: string } | null> {
  const { data: chars, error } = await supabase
    .from("narrative_entities")
    .select("id, entity_key, meta_json")
    .eq("project_id", projectId)
    .eq("entity_type", "character")
    .eq("status", "active");

  if (error || !chars) return null;

  const antagonists = chars.filter(c =>
    /antagonist/i.test(c.meta_json?.canon_role ?? "")
  );
  if (antagonists.length !== 1) return null;

  return { entity_key: antagonists[0].entity_key, id: antagonists[0].id };
}

/**
 * Links ARC_PROTAGONIST to the protagonist character by updating
 * meta_json.linked_character_key.
 *
 * Idempotent: calling multiple times with the same protagonist has no effect.
 * Fail-safe: if protagonist is null → no-op.
 */
export async function linkProtagonistArc(
  supabase: SupabaseClient,
  projectId: string,
): Promise<{ linked: boolean; character_key?: string }> {
  const protagonist = await deriveProtagonistCharacter(supabase, projectId);
  if (!protagonist) return { linked: false };

  // Fetch ARC_PROTAGONIST to get current meta_json
  const { data: arc, error: arcErr } = await supabase
    .from("narrative_entities")
    .select("id, meta_json")
    .eq("project_id", projectId)
    .eq("entity_key", ARC_PROTAGONIST_KEY)
    .maybeSingle();

  if (arcErr || !arc) {
    console.warn("[NIT:v1.1] linkProtagonistArc: ARC_PROTAGONIST not found");
    return { linked: false };
  }

  // Already linked to same key — idempotent, no write needed
  if (arc.meta_json?.linked_character_key === protagonist.entity_key) {
    return { linked: true, character_key: protagonist.entity_key };
  }

  const { error: upErr } = await supabase
    .from("narrative_entities")
    .update({
      meta_json: { ...arc.meta_json, linked_character_key: protagonist.entity_key },
      updated_at: new Date().toISOString(),
    })
    .eq("id", arc.id);

  if (upErr) {
    console.warn("[NIT:v1.1] linkProtagonistArc update error:", upErr.message);
    return { linked: false };
  }

  console.log(`[NIT:v1.1] ARC_PROTAGONIST linked → ${protagonist.entity_key}`);
  return { linked: true, character_key: protagonist.entity_key };
}

/**
 * Upserts a single relation between two entities.
 * Idempotent: ON CONFLICT (source_entity_id, target_entity_id, relation_type) DO NOTHING.
 */
async function upsertRelation(
  supabase: SupabaseClient,
  projectId: string,
  sourceId: string,
  targetId: string,
  relationType: "drives_arc" | "subject_of_conflict" | "opposes",
): Promise<boolean> {
  const { error } = await supabase
    .from("narrative_entity_relations")
    .upsert(
      {
        project_id:       projectId,
        source_entity_id: sourceId,
        target_entity_id: targetId,
        relation_type:    relationType,
        source_kind:      "canon_sync",
        confidence:       1.0,
        updated_at:       new Date().toISOString(),
      },
      { onConflict: "source_entity_id,target_entity_id,relation_type", ignoreDuplicates: true },
    );

  if (error) {
    console.warn(`[NIT:v1.1] upsertRelation ${relationType} error:`, error.message);
    return false;
  }
  return true;
}

/**
 * Derives and upserts the minimal deterministic entity relations.
 *
 * Relations derived from canon only:
 *   drives_arc          protagonist CHAR → ARC_PROTAGONIST
 *   subject_of_conflict protagonist CHAR → CONFLICT_PRIMARY
 *   opposes             antagonist CHAR  → protagonist CHAR
 *
 * All relations: source_kind='canon_sync', confidence=1.0.
 *
 * Fail-safes:
 *   - protagonist missing → skip all three relations
 *   - antagonist missing  → skip 'opposes' only
 *   - ARC_PROTAGONIST missing → skip drives_arc
 *   - CONFLICT_PRIMARY missing → skip subject_of_conflict
 */
export async function deriveEntityRelations(
  supabase: SupabaseClient,
  projectId: string,
): Promise<{ relations_created: number; skipped_reason?: string }> {
  const protagonist = await deriveProtagonistCharacter(supabase, projectId);
  if (!protagonist) {
    return { relations_created: 0, skipped_reason: "no_unambiguous_protagonist" };
  }

  // Fetch ARC and CONFLICT entity ids
  const { data: structural, error: structErr } = await supabase
    .from("narrative_entities")
    .select("id, entity_key")
    .eq("project_id", projectId)
    .in("entity_key", [ARC_PROTAGONIST_KEY, CONFLICT_PRIMARY_KEY]);

  if (structErr) {
    console.warn("[NIT:v1.1] deriveEntityRelations fetch structural error:", structErr.message);
    return { relations_created: 0, skipped_reason: "fetch_error" };
  }

  const arcEntity      = structural?.find(e => e.entity_key === ARC_PROTAGONIST_KEY);
  const conflictEntity = structural?.find(e => e.entity_key === CONFLICT_PRIMARY_KEY);
  const antagonist     = await deriveAntagonistCharacter(supabase, projectId);

  let created = 0;

  // drives_arc: protagonist → ARC_PROTAGONIST
  if (arcEntity) {
    const ok = await upsertRelation(supabase, projectId, protagonist.id, arcEntity.id, "drives_arc");
    if (ok) created++;
  }

  // subject_of_conflict: protagonist → CONFLICT_PRIMARY
  if (conflictEntity) {
    const ok = await upsertRelation(supabase, projectId, protagonist.id, conflictEntity.id, "subject_of_conflict");
    if (ok) created++;
  }

  // opposes: antagonist → protagonist
  if (antagonist) {
    const ok = await upsertRelation(supabase, projectId, antagonist.id, protagonist.id, "opposes");
    if (ok) created++;
  }

  if (created > 0) {
    console.log(`[NIT:v1.1] derived ${created} relation(s) for project ${projectId}`);
  }

  return { relations_created: created };
}

// ── T1 with v1.1 enrichment ───────────────────────────────────────────────

/**
 * Full NIT sync: T1 (characters) + T2/T3 (spine) + protagonist linkage + relations.
 * Convenience wrapper for call sites that want the complete sync in one call.
 * Idempotent. Fail-safe throughout.
 */
export async function syncAllEntities(
  supabase: SupabaseClient,
  projectId: string,
  canonJson: Record<string, any> | null | undefined,
  spineJson: Record<string, any> | null | undefined,
): Promise<{
  characters_synced: number;
  arc_conflict_synced: number;
  protagonist_linked: boolean;
  protagonist_character_key: string | null;
  relations_created: number;
}> {
  const t1   = await syncCanonEntities(supabase, projectId, canonJson);
  const t2t3 = await syncSpineEntities(supabase, projectId, spineJson);
  const link = await linkProtagonistArc(supabase, projectId);
  const rels = await deriveEntityRelations(supabase, projectId);

  return {
    characters_synced:         t1.synced,
    arc_conflict_synced:       t2t3.synced,
    protagonist_linked:        link.linked,
    protagonist_character_key: link.character_key ?? null,
    relations_created:         rels.relations_created,
  };
}

// ── T4 ────────────────────────────────────────────────────────────────────

export async function markEntitiesStaleOnAmendment(
  supabase: SupabaseClient,
  projectId: string,
  axis: string,
  previousValue: string | null,
  newValue: string,
  amendmentEntryId: string | null,
): Promise<NITStaleResult> {
  // NIT v1 only covers these two axes
  if (axis !== "protagonist_arc" && axis !== "central_conflict") {
    return { marked: 0 };
  }

  // Fetch active entities for this axis (by source_key) to preserve meta_json
  const { data: entities, error: fetchErr } = await supabase
    .from("narrative_entities")
    .select("id, meta_json")
    .eq("project_id", projectId)
    .eq("source_key", axis)
    .eq("status", "active");

  if (fetchErr) {
    console.warn("[NIT:T4] fetch error:", fetchErr.message);
    return { marked: 0, error: fetchErr.message };
  }

  if (!entities || entities.length === 0) {
    return { marked: 0 };
  }

  const now    = new Date().toISOString();
  let   marked = 0;

  for (const entity of entities) {
    const { error: upErr } = await supabase
      .from("narrative_entities")
      .update({
        status: "stale",
        meta_json: {
          ...entity.meta_json,
          stale_reason: {
            type:               "spine_amendment",
            axis,
            previous_value:     previousValue,
            new_value:          newValue,
            amendment_entry_id: amendmentEntryId,
            flagged_at:         now,
          },
        },
        updated_at: now,
      })
      .eq("id", entity.id);

    if (upErr) {
      console.warn(`[NIT:T4] update error for entity ${entity.id}:`, upErr.message);
    } else {
      marked++;
    }
  }

  if (marked > 0) {
    console.log(`[NIT:T4] marked ${marked} NIT entity/entities stale for ${axis} amendment`);
  }

  return { marked };
}

// ── NIT v2: Entity Mention Extraction ─────────────────────────────────────

/**
 * Escapes special regex characters in a string for safe use in RegExp constructor.
 */
function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export interface MentionExtractResult {
  mentions_upserted: number;
  skipped_reason?:   string;
}

export interface ProjectMentionSyncResult {
  versions_processed: number;
  total_mentions:     number;
  per_version:        Array<{ version_id: string; doc_type: string; mentions: number; skipped?: string }>;
}

/**
 * Extracts and upserts entity mentions for a single document version.
 *
 * Rules:
 *   - Characters only (entity_type='character'). Arc/conflict canonical names
 *     ('Protagonist Arc', 'Primary Conflict') are slot labels, not narrative text.
 *   - Exact canonical_name case-insensitive substring match within each section.
 *   - One row per (entity, version, section_key, start_line) — first occurrence in section.
 *   - match_method = 'exact_name', confidence = 1.0.
 *   - Aliases not used in v2 (all aliases[] are empty in current canon).
 *
 * Fail-closed:
 *   - Unsupported doc type     → { mentions_upserted: 0, skipped_reason: 'unsupported_doc_type:...' }
 *   - No/empty plaintext       → { mentions_upserted: 0, skipped_reason: 'no_plaintext' }
 *   - parseSections yields []  → { mentions_upserted: 0, skipped_reason: 'no_sections_parsed' }
 *   - No active char entities  → { mentions_upserted: 0, skipped_reason: 'no_active_character_entities' }
 *   - No exact matches found   → { mentions_upserted: 0, skipped_reason: 'no_exact_matches_found' }
 *
 * Idempotent: ON CONFLICT ignoreDuplicates=true on (entity_id,version_id,section_key,start_line,match_method).
 */
export async function extractEntityMentionsForVersion(
  supabase:          SupabaseClient,
  projectId:         string,
  documentId:        string,
  versionId:         string,
  docType:           string,
  /** Optional: pass plaintext directly to skip an extra DB round-trip (used by doc-os hook). */
  plaintextOverride?: string | null,
): Promise<MentionExtractResult> {

  // ── 1. Fail-closed: unsupported doc type ──
  if (!isSectionRepairSupported(docType)) {
    return { mentions_upserted: 0, skipped_reason: `unsupported_doc_type:${docType}` };
  }

  // ── 2. Load plaintext (skip DB fetch if caller already has it) ──
  let plaintext: string | null = plaintextOverride ?? null;
  if (!plaintext) {
    const { data: ver, error: vErr } = await supabase
      .from("project_document_versions")
      .select("plaintext")
      .eq("id", versionId)
      .maybeSingle();

    if (vErr) {
      console.warn("[NIT:v2] version fetch error:", vErr.message);
      return { mentions_upserted: 0, skipped_reason: "version_fetch_error" };
    }
    plaintext = ver?.plaintext ?? null;
  }

  if (!plaintext || plaintext.trim().length === 0) {
    return { mentions_upserted: 0, skipped_reason: "no_plaintext" };
  }

  // ── 3. Parse sections (one pass for all entities) ──
  const sections = parseSections(plaintext, docType);
  if (sections.length === 0) {
    return { mentions_upserted: 0, skipped_reason: "no_sections_parsed" };
  }

  // ── 4. Load active character entities only ──
  // Arc/conflict canonical names are slot labels ("Protagonist Arc", "Primary Conflict")
  // that do not appear literally in narrative documents. Skip them in v2.
  const { data: entities, error: eErr } = await supabase
    .from("narrative_entities")
    .select("id, entity_key, canonical_name")
    .eq("project_id", projectId)
    .eq("entity_type", "character")
    .eq("status", "active");

  if (eErr) {
    console.warn("[NIT:v2] entities fetch error:", eErr.message);
    return { mentions_upserted: 0, skipped_reason: "entities_fetch_error" };
  }
  if (!entities || entities.length === 0) {
    return { mentions_upserted: 0, skipped_reason: "no_active_character_entities" };
  }

  // ── 5. Split plaintext into lines (0-indexed, matches SectionBoundary.start_line) ──
  const lines = plaintext.split("\n");

  // Pre-compile regex per entity (case-insensitive exact name)
  const entityPatterns = entities.map(e => ({
    id:      e.id,
    name:    e.canonical_name,
    regex:   new RegExp(escapeRegex(e.canonical_name), "i"),
  }));

  // ── 6. Scan: one mention row per (entity × section) — first occurrence only ──
  type MentionRow = {
    project_id:   string;
    entity_id:    string;
    document_id:  string;
    version_id:   string;
    section_key:  string | null;
    start_line:   number | null;
    end_line:     number | null;
    mention_text: string;
    match_method: string;
    confidence:   number;
  };

  const mentions: MentionRow[] = [];

  for (const section of sections) {
    const secStart = section.start_line;
    const secEnd   = section.end_line ?? lines.length - 1;
    // Safe guard against inverted or out-of-range boundaries
    if (secStart > secEnd || secStart < 0 || secStart >= lines.length) continue;

    const sectionLines = lines.slice(secStart, secEnd + 1);

    for (const ep of entityPatterns) {
      // Find first line within this section that contains the canonical name
      let matchLine: number | null = null;
      for (let i = 0; i < sectionLines.length; i++) {
        if (ep.regex.test(sectionLines[i])) {
          matchLine = secStart + i;  // absolute 0-indexed line number
          break;
        }
      }
      if (matchLine === null) continue;

      mentions.push({
        project_id:   projectId,
        entity_id:    ep.id,
        document_id:  documentId,
        version_id:   versionId,
        section_key:  section.section_key,
        start_line:   matchLine,
        end_line:     matchLine,
        mention_text: ep.name,
        match_method: "exact_name",
        confidence:   1.0,
      });
    }
  }

  if (mentions.length === 0) {
    return { mentions_upserted: 0, skipped_reason: "no_exact_matches_found" };
  }

  // ── 7. Upsert idempotently ──
  const { error: uErr } = await supabase
    .from("narrative_entity_mentions")
    .upsert(mentions, {
      onConflict:       "entity_id,version_id,section_key,start_line,match_method",
      ignoreDuplicates: true,
    });

  if (uErr) {
    console.warn("[NIT:v2] upsert mentions error:", uErr.message);
    return { mentions_upserted: 0, skipped_reason: uErr.message };
  }

  console.log(`[NIT:v2] upserted ${mentions.length} mention(s) for version ${versionId} (${docType})`);
  return { mentions_upserted: mentions.length };
}

/**
 * Extracts entity mentions across all current supported document versions for a project.
 *
 * Finds all project_document_versions where:
 *   - is_current = true
 *   - deliverable_type is in the supported section-repair doc types
 *   - plaintext is non-empty
 *
 * Runs extractEntityMentionsForVersion for each. Idempotent.
 */
export async function extractEntityMentionsForProject(
  supabase:  SupabaseClient,
  projectId: string,
): Promise<ProjectMentionSyncResult> {

  // NIT v2.5: fetch project documents WITH doc_type so we can build a fallback map.
  // Older versions have deliverable_type=null; we fall back to parent doc_type.
  const { data: docs, error: docsErr } = await supabase
    .from("project_documents")
    .select("id, doc_type")
    .eq("project_id", projectId);

  if (docsErr || !docs) {
    console.warn("[NIT:v2] project documents fetch error:", docsErr?.message);
    return { versions_processed: 0, total_mentions: 0, per_version: [] };
  }

  // Map document_id → doc_type (used as fallback when deliverable_type is null)
  const docTypeMap = new Map<string, string>(
    (docs as Array<{ id: string; doc_type: string }>).map(d => [d.id, d.doc_type])
  );

  // Load all current versions with non-empty plaintext for this project
  const { data: versions, error: vErr } = await supabase
    .from("project_document_versions")
    .select("id, document_id, deliverable_type")
    .eq("is_current", true)
    .filter("plaintext", "not.is", null)
    .in("document_id", docs.map((d: any) => d.id));

  if (vErr || !versions) {
    console.warn("[NIT:v2] project version fetch error:", vErr?.message);
    return { versions_processed: 0, total_mentions: 0, per_version: [] };
  }

  const per_version: ProjectMentionSyncResult["per_version"] = [];
  let total = 0;

  for (const v of versions) {
    // NIT v2.5: COALESCE — use deliverable_type when present, fall back to parent doc_type.
    // Preserves fail-closed: null effective type → skip; unsupported type → skip.
    const effectiveDocType: string | null =
      (v.deliverable_type as string | null) ?? docTypeMap.get(v.document_id) ?? null;

    // Skip unsupported doc types deterministically (isSectionRepairSupported is the gate)
    if (!effectiveDocType || !isSectionRepairSupported(effectiveDocType)) continue;

    const docType = effectiveDocType;

    const result = await extractEntityMentionsForVersion(
      supabase, projectId, v.document_id, v.id, docType,
    );
    total += result.mentions_upserted;
    per_version.push({
      version_id: v.id,
      doc_type:   docType,
      mentions:   result.mentions_upserted,
      skipped:    result.skipped_reason,
    });
  }

  return {
    versions_processed: per_version.filter(v => !v.skipped).length,
    total_mentions:     total,
    per_version,
  };
}
