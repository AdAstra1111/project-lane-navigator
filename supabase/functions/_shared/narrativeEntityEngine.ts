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
