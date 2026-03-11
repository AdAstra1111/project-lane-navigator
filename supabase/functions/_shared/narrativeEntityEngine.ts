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

// ── Scene Identity v1.1 ────────────────────────────────────────────────────

export interface SceneEntityLinkResult {
  scenes_processed: number;
  links_upserted:   number;
  per_scene: Array<{
    scene_id:   string;
    scene_key:  string | null;
    slugline:   string | null;
    links:      number;
    skipped?:   string;
  }>;
}

/**
 * Scene Identity v1.1 — Deterministic character presence sync.
 *
 * For each latest active scene version, scans scene content for exact NIT
 * character entity names and upserts narrative_scene_entity_links rows.
 *
 * Source of truth: scene_graph_versions.content
 * Matching: exact canonical_name search, case-insensitive, whole-string scan
 *
 * WHY content not characters_present:
 *   characters_present is always [] on initially extracted scenes —
 *   scene_graph_extract does not populate it. Content is the only reliable
 *   deterministic source for v1.1. This matches the NIT v2 section-mention
 *   exact-name extraction pattern.
 *
 * relation_type: 'character_present'
 * confidence: 'deterministic'
 * entity_type filter: 'character' only (no arc/conflict in v1.1)
 */
export async function syncSceneEntityLinksForProject(
  supabase: any,
  projectId: string,
): Promise<SceneEntityLinkResult> {
  const per_scene: SceneEntityLinkResult["per_scene"] = [];
  let totalLinks = 0;

  // 1. Load active character entities for this project
  const { data: entities, error: entErr } = await supabase
    .from("narrative_entities")
    .select("id, entity_key, canonical_name, entity_type, status")
    .eq("project_id", projectId)
    .eq("entity_type", "character")
    .eq("status", "active");

  if (entErr || !entities || entities.length === 0) {
    console.log("[NIT:scene-v1.1] no active character entities for project — no-op");
    return { scenes_processed: 0, links_upserted: 0, per_scene: [] };
  }

  // 2. Check for scenes
  const { data: scenes, error: sceneErr } = await supabase
    .from("scene_graph_scenes")
    .select("id, scene_key")
    .eq("project_id", projectId)
    .is("deprecated_at", null);

  if (sceneErr || !scenes || scenes.length === 0) {
    console.log("[NIT:scene-v1.1] no active scenes for project — no-op");
    return { scenes_processed: 0, links_upserted: 0, per_scene: [] };
  }

  // 3. Load all scene versions — dedupe to latest per scene_id in TypeScript
  //    (version_number DESC, take first per scene_id)
  const sceneIds = (scenes as any[]).map((s: any) => s.id);
  const { data: versions, error: verErr } = await supabase
    .from("scene_graph_versions")
    .select("id, scene_id, content, slugline, version_number")
    .in("scene_id", sceneIds)
    .order("version_number", { ascending: false });

  if (verErr || !versions) {
    console.warn("[NIT:scene-v1.1] scene version fetch error:", verErr?.message);
    return { scenes_processed: 0, links_upserted: 0, per_scene: [] };
  }

  // Dedupe: keep only latest version per scene_id
  const latestByScene = new Map<string, any>();
  for (const v of (versions as any[])) {
    if (!latestByScene.has(v.scene_id)) {
      latestByScene.set(v.scene_id, v);
    }
  }

  // Build scene_id → scene_key map
  const sceneKeyMap = new Map<string, string | null>(
    (scenes as any[]).map((s: any) => [s.id, s.scene_key])
  );

  // 4. Process each scene
  for (const scene of (scenes as any[])) {
    const ver = latestByScene.get(scene.id);
    if (!ver) {
      per_scene.push({ scene_id: scene.id, scene_key: scene.scene_key, slugline: null, links: 0, skipped: "no_version" });
      continue;
    }

    const content = (ver.content as string | null) || "";
    if (!content.trim()) {
      per_scene.push({ scene_id: scene.id, scene_key: scene.scene_key, slugline: ver.slugline, links: 0, skipped: "empty_content" });
      continue;
    }

    // 5. Exact-name scan: for each character entity, check if canonical_name appears in content
    const linkRows: Array<{
      project_id:        string;
      scene_id:          string;
      entity_id:         string;
      relation_type:     string;
      confidence:        string;
      source_version_id: string;
    }> = [];

    for (const entity of (entities as any[])) {
      const name = (entity.canonical_name as string) || "";
      if (!name) continue;
      // Case-insensitive exact-string search (no word boundary — handles "Dr. Eleanor Ramsay" etc.)
      if (content.toLowerCase().includes(name.toLowerCase())) {
        linkRows.push({
          project_id:        projectId,
          scene_id:          scene.id,
          entity_id:         entity.id,
          relation_type:     "character_present",
          confidence:        "deterministic",
          source_version_id: ver.id,
        });
      }
    }

    if (linkRows.length > 0) {
      const { error: upsErr } = await supabase
        .from("narrative_scene_entity_links")
        .upsert(linkRows, { onConflict: "scene_id,entity_id,relation_type", ignoreDuplicates: true });
      if (upsErr) {
        console.warn("[NIT:scene-v1.1] upsert error for scene", scene.id, upsErr.message);
      }
    }

    totalLinks += linkRows.length;
    per_scene.push({
      scene_id:  scene.id,
      scene_key: scene.scene_key,
      slugline:  ver.slugline,
      links:     linkRows.length,
    });
  }

  return {
    scenes_processed: per_scene.filter(s => !s.skipped).length,
    links_upserted:   totalLinks,
    per_scene,
  };
}

// ── Phase 2: Dialogue Character Detection ────────────────────────────────
//
// Supplementary character detection via screenplay dialogue heading analysis.
//
// WHY this is needed:
//   syncSceneEntityLinksForProject() scans scene content for exact canonical names
//   (e.g., "Elara Vance"). Screenplay dialogue headings use uppercase abbreviated
//   forms ("ELARA", "DR. RAMSAY", "MR. CALDWELL") that don't contain the full
//   canonical name and are therefore missed by the canonical name scan.
//
// This pass: extracts uppercase dialogue headings → normalises → resolves to
//   NIT entity via deterministic shorthand derivation → upserts character_present links.
//
// Architecture:
//   - No fuzzy matching. All mappings are deterministic derivations from canonical names.
//   - Fail-closed: ambiguous headings (two entities share a shorthand) are excluded.
//   - Idempotent: ON CONFLICT (scene_id, entity_id, relation_type) ignoreDuplicates.
//   - Additive to syncSceneEntityLinksForProject (same table, same relation_type).
//   - Does NOT modify NIT schema (narrative_entities / narrative_entity_relations).

/**
 * Dialogue heading regex.
 * Matches screenplay character name lines:
 *   "ELARA"  "ELARA (V.O.)"  "DR. RAMSAY"  "MR. CALDWELL (CONT'D)"
 *
 * Constraints:
 *   - 0–30 leading spaces (screenplay headings are indented)
 *   - 2–42 uppercase chars including spaces, periods, hyphens, apostrophes
 *   - Optional trailing parenthetical extension (V.O., O.S., CONT'D, etc.)
 *   - Anchored at line boundaries (applied per-line after split)
 */
const DIALOGUE_HEADING_RE = /^\s{0,30}([A-Z][A-Z\s\.\-']{1,40}?)(?:\s*\([^)]{1,30}\))?\s*$/;

/** Slugline prefix pattern — these lines are NOT dialogue headings */
const SLUGLINE_RE = /^\s*(INT\.|EXT\.|INT\/EXT\.|I\/E\.)/i;

/** Transition line pattern — these lines are NOT dialogue headings */
const TRANSITION_RE = /^\s*(FADE\s+(IN|OUT|TO)|CUT\s+TO|DISSOLVE\s+TO|SMASH\s+CUT|MATCH\s+CUT|JUMP\s+CUT|WIPE\s+TO|IRIS\s+(IN|OUT)|TITLE\s*:)/i;

/**
 * Extracts candidate dialogue headings from raw screenplay scene content.
 * Returns a deduplicated Set of normalised uppercase heading strings (without parentheticals).
 *
 * Heuristic validation: a line is accepted as a dialogue heading only when:
 *   1. Matches DIALOGUE_HEADING_RE
 *   2. Is not a slugline or transition line
 *   3. Contains at least two consecutive uppercase letters (not just "DR." or "-")
 *   4. The next non-empty line contains lowercase letters (indicates it is dialogue text)
 *
 * Fail-closed: returns empty Set when content is null/empty.
 */
export function extractDialogueHeadings(content: string | null): Set<string> {
  const result = new Set<string>();
  if (!content || content.trim().length === 0) return result;

  const lines = content.split("\n");

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    if (SLUGLINE_RE.test(line) || TRANSITION_RE.test(line)) continue;

    const match = DIALOGUE_HEADING_RE.exec(line);
    if (!match) continue;

    const raw = match[1].trim();
    if (raw.length < 2) continue;

    // Must contain at least 2 consecutive uppercase letters (not just "A." etc.)
    if (!/[A-Z]{2}/.test(raw.replace(/[\s\.\-']/g, ""))) continue;

    // Validate: next non-empty line should look like dialogue (contains lowercase)
    let nextIdx = i + 1;
    while (nextIdx < lines.length && lines[nextIdx].trim() === "") nextIdx++;
    if (nextIdx < lines.length) {
      const nextLine = lines[nextIdx];
      // Next line must have lowercase letters → it is dialogue, not another action line
      if (!/[a-z]/.test(nextLine)) continue;
    }

    result.add(raw);
  }

  return result;
}

/**
 * Builds a deterministic lookup map: dialogue_heading_uppercase → entity_id.
 *
 * For each canonical character name, derives the following shorthand forms
 * that a screenwriter would use as a dialogue heading:
 *
 *   1. FULL NAME UPPERCASE:    "ELARA VANCE"      → entity
 *   2. FIRST NAME ONLY:        "ELARA"            → entity  (if title-free and unique)
 *   3. LAST NAME ONLY:         "VANCE"            → entity  (if unique)
 *   4. TITLE + LAST NAME:      "DR. RAMSAY"       → entity  (if has title prefix)
 *   5. TITLE + FULL SURNAME:   "MR. CALDWELL"     → entity
 *   6. THE + SECOND WORD:      "THE ALTERNATE"    → entity  (for "The Alternate Elara" style)
 *
 * Conflict resolution: if two entities share a shorthand form, that form is
 * excluded from the map (ambiguous → fail-closed, never guess).
 *
 * Does NOT produce fuzzy matches. All mappings are exact string lookups.
 */
export function buildDialogueHeadingMap(
  entities: Array<{ id: string; canonical_name: string }>,
): Map<string, string> {
  // heading (uppercase) → [entity_id, ...] (for conflict detection)
  const candidates = new Map<string, string[]>();

  const add = (heading: string, entityId: string) => {
    const h = heading.toUpperCase().trim();
    if (!h || h.length < 2) return;
    if (!candidates.has(h)) candidates.set(h, []);
    candidates.get(h)!.push(entityId);
  };

  const TITLE_PREFIXES = [
    "Dr.", "Mr.", "Mrs.", "Ms.", "Prof.", "Sgt.", "Det.", "Capt.", "Lt.", "Cpl.",
  ];

  for (const entity of entities) {
    const name = (entity.canonical_name || "").trim();
    if (!name) continue;

    const parts = name.split(/\s+/).filter(Boolean);
    if (parts.length === 0) continue;

    // 1. Full name uppercase
    add(name, entity.id);

    // Detect title prefix (e.g., "Dr.", "Mr.")
    const titlePrefix = TITLE_PREFIXES.find(t =>
      name.toLowerCase().startsWith(t.toLowerCase())
    );

    const nameParts  = titlePrefix ? parts.slice(1) : parts;   // parts after title
    const lastName   = nameParts.length > 0 ? nameParts[nameParts.length - 1] : null;
    const firstName  = nameParts.length > 0 ? nameParts[0] : null;

    if (titlePrefix) {
      // 4+5. Title + last name: "DR. RAMSAY", "MR. CALDWELL"
      if (lastName) {
        add(`${titlePrefix.toUpperCase()} ${lastName}`, entity.id);
        // Also without dot: "DR RAMSAY"
        add(`${titlePrefix.replace(".", "").toUpperCase()} ${lastName}`, entity.id);
      }
    } else if (parts[0].toLowerCase() === "the") {
      // "The X" composite names (e.g. "The Alternate Elara"):
      //   - Do NOT produce first-name ("THE") or last-name ("ELARA") shorthands.
      //     First-name "THE" is generic and would collide across multiple The-names.
      //     Last-name (the final word) is a real character name and WOULD create
      //     an ambiguity conflict with other entities (e.g. "ELARA" ↔ Elara Vance).
      //   - The "THE X" rule below handles the useful shorthand deterministically.
    } else {
      // 2. First name only (title-free entities)
      if (firstName && firstName.length >= 2) {
        add(firstName, entity.id);
      }
      // 3. Last name only (multi-word names)
      if (lastName && lastName !== firstName && lastName.length >= 2) {
        add(lastName, entity.id);
      }
    }

    // 6. "THE X" shorthand for "The Alternate Elara" style composite names:
    //    "THE ALTERNATE" → The Alternate Elara
    //    Also add "THE X Y" variant (second + third word) for three-word The-names:
    //    "THE ALTERNATE ELARA" is already covered by the full-name entry above.
    if (
      parts[0].toLowerCase() === "the" &&
      parts.length >= 2 &&
      parts[1].length >= 3
    ) {
      add(`THE ${parts[1]}`, entity.id);
      // For "The Alternate Elara" also add "ALTERNATE ELARA" (without THE)
      // — matches scripts that drop the article in dialogue headings
      if (parts.length >= 3) {
        add(`${parts[1].toUpperCase()} ${parts[2].toUpperCase()}`, entity.id);
      }
    }
  }

  // Resolve conflicts: exclude headings that map to more than one entity
  const finalMap = new Map<string, string>();
  for (const [heading, entityIds] of candidates.entries()) {
    const unique = [...new Set(entityIds)];
    if (unique.length === 1) {
      finalMap.set(heading, unique[0]);
    }
    // else: ambiguous — omit (fail-closed)
  }

  return finalMap;
}

// ── Phase 2 public surface ────────────────────────────────────────────────

export interface DialogueCharacterSyncResult {
  scenes_processed:      number;
  links_upserted:        number;
  characters_written:    number;   // scenes that got a characters_present write-back
  per_scene: Array<{
    scene_id:             string;
    scene_key:            string | null;
    slugline:             string | null;
    dialogue_links:       number;
    headings_found:       number;
    skipped?:             string;
    unresolved_headings?: string[];  // headings detected but not mapped to any entity
  }>;
}

/**
 * Phase 2 — Dialogue Character Detection sync.
 *
 * For each active scene in the project:
 *   1. Extract uppercase dialogue headings from scene content
 *   2. Resolve headings to NIT character entities via buildDialogueHeadingMap
 *   3. Upsert into narrative_scene_entity_links (relation_type='character_present')
 *
 * This is ADDITIVE to syncSceneEntityLinksForProject() (canonical name scan).
 * Both mechanisms populate the same table; together they give complete coverage.
 *
 * Idempotent: ON CONFLICT (scene_id, entity_id, relation_type) ignoreDuplicates.
 * Fail-closed: empty entities, empty scenes, empty content → no-op, no crash.
 * Does NOT modify NIT schema.
 */
export async function syncDialogueCharactersForProject(
  supabase: SupabaseClient,
  projectId: string,
): Promise<DialogueCharacterSyncResult> {
  const per_scene: DialogueCharacterSyncResult["per_scene"] = [];
  let totalLinks = 0;

  // 1. Load active character entities
  const { data: entities, error: entErr } = await supabase
    .from("narrative_entities")
    .select("id, entity_key, canonical_name")
    .eq("project_id", projectId)
    .eq("entity_type", "character")
    .eq("status", "active");

  if (entErr || !entities || (entities as any[]).length === 0) {
    console.log("[NIT:Phase2] no active character entities — no-op");
    return { scenes_processed: 0, links_upserted: 0, characters_written: 0, per_scene: [] };
  }

  // 2. Build heading → entity_id lookup map
  const headingMap = buildDialogueHeadingMap(entities as any[]);
  if (headingMap.size === 0) {
    console.log("[NIT:Phase2] heading map empty (no derivable shorthand forms) — no-op");
    return { scenes_processed: 0, links_upserted: 0, characters_written: 0, per_scene: [] };
  }

  // 3. Load active scenes
  const { data: scenes, error: sceneErr } = await supabase
    .from("scene_graph_scenes")
    .select("id, scene_key")
    .eq("project_id", projectId)
    .is("deprecated_at", null);

  if (sceneErr || !scenes || (scenes as any[]).length === 0) {
    console.log("[NIT:Phase2] no active scenes — no-op");
    return { scenes_processed: 0, links_upserted: 0, characters_written: 0, per_scene: [] };
  }

  // 4. Load latest version per scene
  const sceneIds = (scenes as any[]).map((s: any) => s.id);
  const { data: versions, error: verErr } = await supabase
    .from("scene_graph_versions")
    .select("id, scene_id, content, slugline, version_number")
    .in("scene_id", sceneIds)
    .order("version_number", { ascending: false });

  if (verErr || !versions) {
    console.warn("[NIT:Phase2] version fetch error:", verErr?.message);
    return { scenes_processed: 0, links_upserted: 0, characters_written: 0, per_scene: [] };
  }

  // Dedupe: latest version per scene
  const latestByScene = new Map<string, any>();
  for (const v of (versions as any[])) {
    if (!latestByScene.has(v.scene_id)) latestByScene.set(v.scene_id, v);
  }

  // 5. Process each scene
  for (const scene of (scenes as any[])) {
    const ver = latestByScene.get(scene.id);
    if (!ver) {
      per_scene.push({
        scene_id: scene.id, scene_key: scene.scene_key, slugline: null,
        dialogue_links: 0, headings_found: 0, skipped: "no_version",
      });
      continue;
    }

    const content = (ver.content as string | null) || "";
    if (!content.trim()) {
      per_scene.push({
        scene_id: scene.id, scene_key: scene.scene_key, slugline: ver.slugline,
        dialogue_links: 0, headings_found: 0, skipped: "empty_content",
      });
      continue;
    }

    // Extract dialogue headings from scene content
    const headings = extractDialogueHeadings(content);

    if (headings.size === 0) {
      per_scene.push({
        scene_id: scene.id, scene_key: scene.scene_key, slugline: ver.slugline,
        dialogue_links: 0, headings_found: 0, skipped: "no_headings_detected",
      });
      continue;
    }

    // Resolve headings → entity ids, track unresolved for diagnostics
    const resolvedEntityIds = new Set<string>();
    const unresolvedHeadings: string[] = [];
    for (const heading of headings) {
      const entityId = headingMap.get(heading);
      if (entityId) {
        resolvedEntityIds.add(entityId);
      } else {
        unresolvedHeadings.push(heading);
      }
    }

    if (resolvedEntityIds.size === 0) {
      per_scene.push({
        scene_id:             scene.id,
        scene_key:            scene.scene_key,
        slugline:             ver.slugline,
        dialogue_links:       0,
        headings_found:       headings.size,
        skipped:              "no_headings_resolved",
        unresolved_headings:  unresolvedHeadings,
      });
      continue;
    }

    // Upsert links
    const linkRows = [...resolvedEntityIds].map(entityId => ({
      project_id:        projectId,
      scene_id:          scene.id,
      entity_id:         entityId,
      relation_type:     "character_present",
      confidence:        "deterministic",
      source_version_id: ver.id,
    }));

    const { error: upsErr } = await supabase
      .from("narrative_scene_entity_links")
      .upsert(linkRows, {
        onConflict:       "scene_id,entity_id,relation_type",
        ignoreDuplicates: true,
      });

    if (upsErr) {
      console.warn("[NIT:Phase2] upsert error for scene", scene.id, upsErr.message);
      per_scene.push({
        scene_id: scene.id, scene_key: scene.scene_key, slugline: ver.slugline,
        dialogue_links: 0, headings_found: headings.size,
        skipped: `upsert_error:${upsErr.message}`,
      });
      continue;
    }

    totalLinks += linkRows.length;
    per_scene.push({
      scene_id:            scene.id,
      scene_key:           scene.scene_key,
      slugline:            ver.slugline,
      dialogue_links:      linkRows.length,
      headings_found:      headings.size,
      unresolved_headings: unresolvedHeadings.length > 0 ? unresolvedHeadings : undefined,
    });
  }

  // ── characters_present write-back ────────────────────────────────────────
  // After all link upserts, write back characters_present to scene_graph_versions.
  //
  // Source of truth: narrative_scene_entity_links (relation_type='character_present').
  // This pass queries the full link set for each scene (not just this run's additions)
  // so the write-back reflects BOTH name-scan and dialogue-heading contributions.
  //
  // Implementation: direct UPDATE on scene_graph_versions.id (latest version).
  // Does NOT create a new version (avoids version number churn).
  // Idempotent: same links → same canonical name array → same result on every run.
  //
  // Write-back is scoped to scenes that have at least one version row.
  // Scenes with no version, empty content, or no links are skipped — fail-closed.

  // Build entity_id → canonical_name lookup from the already-loaded entities array
  const entityNameMap = new Map<string, string>();
  for (const e of (entities as any[])) {
    entityNameMap.set(e.id, e.canonical_name);
  }

  // Collect all scene_ids for which we have a latest version in memory
  const allSceneIds = [...latestByScene.keys()];

  // Fetch all current character_present links for this project in one query
  const { data: allLinks, error: linkFetchErr } = await supabase
    .from("narrative_scene_entity_links")
    .select("scene_id, entity_id")
    .eq("project_id", projectId)
    .eq("relation_type", "character_present")
    .in("scene_id", allSceneIds);

  let charsWritten = 0;

  if (!linkFetchErr && allLinks) {
    // Group by scene_id
    const linksByScene = new Map<string, string[]>();
    for (const row of (allLinks as any[])) {
      const name = entityNameMap.get(row.entity_id);
      if (!name) continue;
      if (!linksByScene.has(row.scene_id)) linksByScene.set(row.scene_id, []);
      linksByScene.get(row.scene_id)!.push(name);
    }

    // Write back for each scene that has at least one link
    for (const [sceneId, names] of linksByScene.entries()) {
      const ver = latestByScene.get(sceneId);
      if (!ver) continue;

      const sortedNames = [...new Set(names)].sort();
      const { error: updErr } = await supabase
        .from("scene_graph_versions")
        .update({ characters_present: sortedNames })
        .eq("id", ver.id);

      if (updErr) {
        console.warn("[NIT:Phase2] characters_present write-back error", sceneId, updErr.message);
      } else {
        charsWritten++;
      }
    }
  } else if (linkFetchErr) {
    console.warn("[NIT:Phase2] could not fetch links for write-back:", linkFetchErr.message);
  }

  const processed = per_scene.filter(s => !s.skipped).length;
  console.log(`[NIT:Phase2] ${processed} scenes processed, ${totalLinks} dialogue links upserted, ${charsWritten} characters_present written`);

  return { scenes_processed: processed, links_upserted: totalLinks, characters_written: charsWritten, per_scene };
}
