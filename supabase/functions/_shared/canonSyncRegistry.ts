/**
 * Canon Sync Registry — Phase 3B
 *
 * Narrow, fail-closed bridge from repaired upstream source documents
 * into project_canon.canon_json, enabling Phase 3 subject propagation.
 *
 * SAFE INITIAL SOURCE DOCS:
 *   - concept_brief  → logline, premise
 *   - format_rules   → format_constraints
 *   - character_bible → characters[]
 *
 * ARCHITECTURE:
 *   - Zero schema drift: writes to existing project_canon table
 *   - Deterministic: heading-based extraction only, no LLM
 *   - Fail-closed: returns null on any extraction ambiguity
 *   - Versioning: relies on existing auto_version_canon() trigger
 *   - Additive: never removes canon fields, only updates non-empty extractions
 *
 * ACTIVATION:
 *   Called after a successful upstream repair creates a new version.
 *   If extraction succeeds and produces a non-empty patch, canon JSON
 *   is updated, which triggers auto_version_canon() → new canon version row.
 *   Phase 3 subject propagation (in invalidateDescendants) can then
 *   compute non-empty deltas against the previous canon version.
 */

// ── Types ──

export interface CanonSyncFieldMapping {
  /** Canon JSON field to write to */
  canon_field: string;
  /** Extraction strategy */
  extraction_mode: "heading_content" | "structured_list" | "full_section";
  /** Heading pattern to look for (case-insensitive) */
  heading_pattern: RegExp;
  /** Whether this field is safe for sync */
  sync_enabled: boolean;
}

export interface CanonSyncConfig {
  source_doc_type: string;
  /** Field mappings for this doc type */
  field_mappings: CanonSyncFieldMapping[];
  /** Whether sync is enabled for this doc type overall */
  sync_enabled: boolean;
  /** Reason if sync is disabled */
  fail_closed_reason?: string;
}

export interface CanonPatch {
  /** Fields to merge into canon JSON */
  fields: Record<string, unknown>;
  /** Source doc type that produced this patch */
  source_doc_type: string;
  /** Source version ID */
  source_version_id: string;
  /** Extraction confidence per field */
  field_confidences: Record<string, number>;
  /** Fields that failed extraction (logged but not patched) */
  failed_fields: string[];
}

export interface CanonSyncResult {
  success: boolean;
  patch: CanonPatch | null;
  /** Whether canon was actually updated */
  canon_updated: boolean;
  /** Reason if sync was skipped */
  skip_reason?: string;
  /** Provenance metadata */
  provenance: {
    source_doc_type: string;
    source_version_id: string;
    fields_patched: string[];
    fields_failed: string[];
    sync_enabled: boolean;
    fail_closed: boolean;
    fail_closed_reason?: string;
  };
}

// ── Registry ──

const SYNC_CONFIGS: Record<string, CanonSyncConfig> = {
  concept_brief: {
    source_doc_type: "concept_brief",
    sync_enabled: true,
    field_mappings: [
      {
        canon_field: "logline",
        extraction_mode: "heading_content",
        heading_pattern: /^#{1,3}\s*logline\s*$/im,
        sync_enabled: true,
      },
      {
        canon_field: "premise",
        extraction_mode: "heading_content",
        heading_pattern: /^#{1,3}\s*premise\s*$/im,
        sync_enabled: true,
      },
    ],
  },
  format_rules: {
    source_doc_type: "format_rules",
    sync_enabled: true,
    field_mappings: [
      {
        canon_field: "format_constraints",
        extraction_mode: "full_section",
        heading_pattern: /^#{1,3}\s*(technical\s+specifications?|format\s+(engine|rules?|spec))/im,
        sync_enabled: true,
      },
    ],
  },
  // Phase 3C: Re-enabled with safe keyed merge (mergeCharactersByName).
  // characters[] are merged by normalized name key, preserving existing
  // fields not present in extracted patch. Sync is rejected if:
  //   - extracted count < existing count (destructive shrink)
  //   - duplicate normalized names in either set
  //   - any extracted character has an empty/malformed name
  character_bible: {
    source_doc_type: "character_bible",
    sync_enabled: true,
    field_mappings: [
      {
        canon_field: "characters",
        extraction_mode: "structured_list",
        heading_pattern: /^##\s+([A-Z][A-Z\s''-]+)\s*$/m,
        sync_enabled: true,
      },
    ],
  },
};

// ── Public API ──

/**
 * Check if a doc type is eligible for canon sync.
 */
export function isCanonSyncEligible(docType: string): boolean {
  const config = SYNC_CONFIGS[docType];
  return !!config && config.sync_enabled;
}

/**
 * Extract a canon patch from a repaired document's content.
 * Returns null if extraction fails closed (no safe patch possible).
 */
export function extractCanonPatchFromDocument(
  docType: string,
  content: string,
  sourceVersionId: string,
): CanonPatch | null {
  const config = SYNC_CONFIGS[docType];
  if (!config || !config.sync_enabled) return null;
  if (!content || content.trim().length < 20) return null;

  const fields: Record<string, unknown> = {};
  const fieldConfidences: Record<string, number> = {};
  const failedFields: string[] = [];

  for (const mapping of config.field_mappings) {
    if (!mapping.sync_enabled) continue;

    try {
      if (mapping.extraction_mode === "heading_content") {
        const extracted = extractHeadingContent(content, mapping.heading_pattern);
        if (extracted && extracted.trim().length >= 10) {
          fields[mapping.canon_field] = extracted.trim();
          fieldConfidences[mapping.canon_field] = 1.0;
        } else {
          failedFields.push(mapping.canon_field);
        }
      } else if (mapping.extraction_mode === "full_section") {
        const extracted = extractFullSection(content, mapping.heading_pattern);
        if (extracted && extracted.trim().length >= 20) {
          fields[mapping.canon_field] = extracted.trim();
          fieldConfidences[mapping.canon_field] = 1.0;
        } else {
          failedFields.push(mapping.canon_field);
        }
      } else if (mapping.extraction_mode === "structured_list" && mapping.canon_field === "characters") {
        const chars = extractCharacterList(content);
        if (chars && chars.length > 0) {
          fields[mapping.canon_field] = chars;
          fieldConfidences[mapping.canon_field] = 1.0;
        } else {
          failedFields.push(mapping.canon_field);
        }
      }
    } catch {
      failedFields.push(mapping.canon_field);
    }
  }

  // Fail closed: if no fields were successfully extracted, return null
  if (Object.keys(fields).length === 0) return null;

  return {
    fields,
    source_doc_type: docType,
    source_version_id: sourceVersionId,
    field_confidences: fieldConfidences,
    failed_fields: failedFields,
  };
}

/**
 * Validate a canon patch before applying.
 * Returns true if the patch is safe to apply.
 */
export function validateCanonPatch(
  patch: CanonPatch,
  existingCanon: Record<string, unknown>,
): boolean {
  // Basic validation: patch must have at least one field
  if (!patch.fields || Object.keys(patch.fields).length === 0) return false;

  // Validate each field type
  for (const [field, value] of Object.entries(patch.fields)) {
    if (field === "characters") {
      if (!Array.isArray(value) || value.length === 0) return false;
      // Each character must have a non-empty name
      for (const ch of value) {
        if (!ch || typeof ch !== "object") return false;
        const name = (ch as any).name;
        if (!name || typeof name !== "string" || name.trim().length < 2) return false;
      }
      // Reject duplicate normalized names in extracted patch
      const extractedNames = (value as any[]).map((c) => normalizeCharName(c.name));
      if (new Set(extractedNames).size !== extractedNames.length) {
        console.warn(`[canon-sync] validate_reject: duplicate names in extracted characters`);
        return false;
      }
      // Reject if extracted count < existing count (destructive shrink)
      const existingChars = existingCanon.characters;
      if (Array.isArray(existingChars) && existingChars.length > 0) {
        if (value.length < existingChars.length) {
          console.warn(`[canon-sync] validate_reject: extracted ${value.length} chars < existing ${existingChars.length} (destructive shrink)`);
          return false;
        }
        // Reject if duplicate normalized names in existing canon
        const existingNames = existingChars.map((c: any) => normalizeCharName(c?.name || ""));
        if (new Set(existingNames).size !== existingNames.length) {
          console.warn(`[canon-sync] validate_reject: duplicate names in existing canon characters`);
          return false;
        }
      }
    } else if (typeof value !== "string" || value.trim().length < 5) {
      return false;
    }
  }

  return true;
}

/**
 * Normalize a character name for use as a merge key.
 * Lowercases, trims, collapses whitespace.
 */
function normalizeCharName(name: string): string {
  return name.toLowerCase().trim().replace(/\s+/g, " ");
}

/**
 * Keyed merge for characters[] array.
 * Merges by normalized character name:
 *   - Existing fields NOT in extracted object are PRESERVED
 *   - Extracted fields that are non-empty OVERWRITE existing
 *   - New characters (in extracted but not in existing) are ADDED
 *   - Characters only in existing are PRESERVED (no deletion)
 *
 * Returns the merged characters array.
 */
function mergeCharactersByName(
  existing: any[],
  extracted: any[],
): { merged: any[]; matched: number; added: number; preserved: number } {
  const existingByKey = new Map<string, any>();
  for (const ch of existing) {
    if (ch?.name) existingByKey.set(normalizeCharName(ch.name), { ...ch });
  }

  const seenKeys = new Set<string>();
  let matched = 0;
  let added = 0;

  for (const ext of extracted) {
    const key = normalizeCharName(ext.name);
    seenKeys.add(key);

    if (existingByKey.has(key)) {
      // Merge: preserve existing fields, overwrite with non-empty extracted fields
      const merged = existingByKey.get(key)!;
      for (const [field, value] of Object.entries(ext)) {
        if (value !== undefined && value !== null && value !== "") {
          merged[field] = value;
        }
      }
      existingByKey.set(key, merged);
      matched++;
    } else {
      // New character from extraction
      existingByKey.set(key, { ...ext });
      added++;
    }
  }

  // Characters only in existing are preserved (not deleted)
  const preserved = existing.filter((ch) => ch?.name && !seenKeys.has(normalizeCharName(ch.name))).length;

  // Build final array: existing order first, then new additions
  const result: any[] = [];
  const usedKeys = new Set<string>();

  // Preserve original ordering for existing characters
  for (const ch of existing) {
    if (ch?.name) {
      const key = normalizeCharName(ch.name);
      if (existingByKey.has(key)) {
        result.push(existingByKey.get(key));
        usedKeys.add(key);
      }
    }
  }
  // Append new characters
  for (const [key, ch] of existingByKey.entries()) {
    if (!usedKeys.has(key)) {
      result.push(ch);
    }
  }

  return { merged: result, matched, added, preserved };
}

/**
 * Merge a canon patch into existing canon JSON.
 * Only overwrites fields present in the patch.
 * Never removes existing fields not in the patch.
 * Uses keyed merge for characters[] to preserve existing fields.
 */
export function mergeCanonPatch(
  existingCanon: Record<string, unknown>,
  patch: CanonPatch,
): Record<string, unknown> {
  const merged = { ...existingCanon };
  for (const [field, value] of Object.entries(patch.fields)) {
    if (field === "characters" && Array.isArray(value)) {
      const existingChars = Array.isArray(merged.characters) ? merged.characters as any[] : [];
      const result = mergeCharactersByName(existingChars, value);
      merged.characters = result.merged;
      console.log(`[canon-sync] character_merge { matched: ${result.matched}, added: ${result.added}, preserved: ${result.preserved} }`);
    } else {
      merged[field] = value;
    }
  }
  return merged;
}

/**
 * Full canon sync flow: extract, validate, apply.
 * Fail-closed: if any step fails, canon is NOT updated.
 */
export async function applyCanonSyncIfEligible(
  supabase: any,
  projectId: string,
  repairedDocType: string,
  repairedContent: string,
  repairedVersionId: string,
  userId?: string,
): Promise<CanonSyncResult> {
  const provenance: CanonSyncResult["provenance"] = {
    source_doc_type: repairedDocType,
    source_version_id: repairedVersionId,
    fields_patched: [],
    fields_failed: [],
    sync_enabled: false,
    fail_closed: false,
  };

  // 1. Check eligibility
  if (!isCanonSyncEligible(repairedDocType)) {
    return {
      success: false,
      patch: null,
      canon_updated: false,
      skip_reason: `doc_type "${repairedDocType}" not eligible for canon sync`,
      provenance: { ...provenance, fail_closed: true, fail_closed_reason: "doc_type_not_eligible" },
    };
  }
  provenance.sync_enabled = true;

  // 2. Extract canon patch
  const patch = extractCanonPatchFromDocument(repairedDocType, repairedContent, repairedVersionId);
  if (!patch) {
    return {
      success: false,
      patch: null,
      canon_updated: false,
      skip_reason: "extraction_failed_closed: no fields could be extracted deterministically",
      provenance: { ...provenance, fail_closed: true, fail_closed_reason: "extraction_empty" },
    };
  }
  provenance.fields_failed = patch.failed_fields;

  // 3. Fetch existing canon
  const { data: canonRow, error: canonErr } = await supabase
    .from("project_canon")
    .select("canon_json")
    .eq("project_id", projectId)
    .maybeSingle();

  if (canonErr || !canonRow) {
    return {
      success: false,
      patch,
      canon_updated: false,
      skip_reason: "canon_row_not_found",
      provenance: { ...provenance, fail_closed: true, fail_closed_reason: "canon_row_missing" },
    };
  }

  const existingCanon = (canonRow.canon_json || {}) as Record<string, unknown>;

  // 4. Validate patch
  if (!validateCanonPatch(patch, existingCanon)) {
    return {
      success: false,
      patch,
      canon_updated: false,
      skip_reason: "patch_validation_failed",
      provenance: { ...provenance, fail_closed: true, fail_closed_reason: "validation_failed" },
    };
  }

  // 5. Merge and apply
  const merged = mergeCanonPatch(existingCanon, patch);

  const { error: updateErr } = await supabase
    .from("project_canon")
    .update({
      canon_json: merged,
      updated_by: userId || null,
    })
    .eq("project_id", projectId);

  if (updateErr) {
    console.error(`[canon-sync] update_failed: ${updateErr.message}`);
    return {
      success: false,
      patch,
      canon_updated: false,
      skip_reason: `db_update_failed: ${updateErr.message}`,
      provenance: { ...provenance, fail_closed: true, fail_closed_reason: "db_update_error" },
    };
  }

  // 6. Success — auto_version_canon trigger will create version row
  provenance.fields_patched = Object.keys(patch.fields);
  console.log(`[canon-sync] sync_success { project: "${projectId}", doc_type: "${repairedDocType}", version: "${repairedVersionId}", fields_patched: ${JSON.stringify(provenance.fields_patched)}, fields_failed: ${JSON.stringify(provenance.fields_failed)} }`);

  return {
    success: true,
    patch,
    canon_updated: true,
    provenance,
  };
}

// ── Extraction Helpers ──

/**
 * Extract content under a markdown heading.
 * Returns text between the matched heading and the next heading of same or higher level.
 */
function extractHeadingContent(content: string, headingPattern: RegExp): string | null {
  const match = content.match(headingPattern);
  if (!match) return null;

  const matchStart = content.indexOf(match[0]);
  const afterHeading = content.slice(matchStart + match[0].length);

  // Find the level of the matched heading
  const headingLevel = (match[0].match(/^(#+)/) || ["", "#"])[1].length;

  // Find next heading of same or higher level
  const nextHeadingPattern = new RegExp(`^#{1,${headingLevel}}\\s+`, "m");
  const nextMatch = afterHeading.match(nextHeadingPattern);

  let sectionContent: string;
  if (nextMatch && nextMatch.index !== undefined) {
    sectionContent = afterHeading.slice(0, nextMatch.index);
  } else {
    sectionContent = afterHeading;
  }

  // Clean up: remove leading/trailing whitespace, collapse empty lines
  return sectionContent.trim() || null;
}

/**
 * Extract an entire section including its sub-sections.
 * Used for format_rules where we want the full specification block.
 */
function extractFullSection(content: string, headingPattern: RegExp): string | null {
  const match = content.match(headingPattern);
  if (!match) return null;

  const matchStart = content.indexOf(match[0]);
  const afterHeading = content.slice(matchStart + match[0].length);

  // Find the level of the matched heading
  const headingLevel = (match[0].match(/^(#+)/) || ["", "#"])[1].length;

  // Find next heading of same or higher level (not sub-headings)
  const nextSameLevel = new RegExp(`^#{1,${headingLevel}}\\s+(?!\\d)`, "m");
  const nextMatch = afterHeading.match(nextSameLevel);

  let sectionContent: string;
  if (nextMatch && nextMatch.index !== undefined) {
    sectionContent = afterHeading.slice(0, nextMatch.index);
  } else {
    sectionContent = afterHeading;
  }

  return sectionContent.trim() || null;
}

/**
 * Structured relationship extracted from a character bible section.
 */
interface ExtractedRelationship {
  target_name: string;
  arc_summary: string;
}

/**
 * Extract character list from a character bible document.
 * Expects ## CHARACTER_NAME headings followed by **Role:** fields.
 * Deterministic: only extracts characters with explicit ## heading + **Role:** line.
 *
 * Phase 3E: Also extracts structured relationships from
 * `**Relationship Arc (with NAME):**` headings — deterministic heading-based extraction.
 */
function extractCharacterList(
  content: string,
): Array<{
  name: string;
  role: string;
  goals?: string;
  traits?: string;
  secrets?: string;
  relationships?: Array<{ target_name: string; arc_summary: string }>;
}> | null {
  const characters: Array<{
    name: string;
    role: string;
    goals?: string;
    traits?: string;
    secrets?: string;
    relationships?: Array<{ target_name: string; arc_summary: string }>;
  }> = [];

  // Split by ## headings (character names are typically ALL CAPS or Title Case at ## level)
  const charHeadingPattern = /^##\s+([A-Z][A-Za-z\s''-]+)\s*$/gm;
  const headings: Array<{ name: string; index: number }> = [];
  let m: RegExpExecArray | null;

  while ((m = charHeadingPattern.exec(content)) !== null) {
    const name = m[1].trim();
    // Skip section headings that aren't character names
    if (/^(character|cast|overview|summary|relationships?|notes?|appendix)/i.test(name)) continue;
    headings.push({ name, index: m.index + m[0].length });
  }

  if (headings.length === 0) return null;

  // Collect all extracted character names for relationship target validation
  const allCharacterNames = new Set(headings.map(h => h.name.toLowerCase().trim()));

  for (let i = 0; i < headings.length; i++) {
    const start = headings[i].index;
    const end = i + 1 < headings.length ? headings[i + 1].index - (headings[i + 1].name.length + 4) : content.length;
    const section = content.slice(start, end);

    // Extract **Role:** field (required for inclusion)
    const roleMatch = section.match(/\*\*Role:\*\*\s*(.+)/i);
    if (!roleMatch) continue;

    const char: {
      name: string;
      role: string;
      goals?: string;
      traits?: string;
      secrets?: string;
      relationships?: Array<{ target_name: string; arc_summary: string }>;
    } = {
      name: headings[i].name,
      role: roleMatch[1].trim(),
    };

    // Optional fields
    const goalsMatch = section.match(/\*\*(?:Goals?|Core Value|Motivation):\*\*\s*(.+)/i);
    if (goalsMatch) char.goals = goalsMatch[1].trim();

    const traitsMatch = section.match(/\*\*(?:Traits?|Behavioral Matrix):\*\*\s*(.+)/i);
    if (traitsMatch) char.traits = traitsMatch[1].trim();

    const secretsMatch = section.match(/\*\*(?:Secrets?|Contradictory Secret):\*\*\s*(.+)/i);
    if (secretsMatch) char.secrets = secretsMatch[1].trim();

    // Phase 3E: Extract structured relationships from heading pattern
    // `**Relationship Arc (with NAME):**` — deterministic, heading-based only
    const rels = extractRelationshipArcsFromSection(section, headings[i].name, allCharacterNames);
    if (rels.length > 0) {
      char.relationships = rels;
    }

    characters.push(char);
  }

  return characters.length > 0 ? characters : null;
}

/**
 * Phase 3E: Extract structured relationship arcs from a character section.
 *
 * Deterministic extraction: only matches `**Relationship Arc (with NAME):**` headings.
 * Target name must resolve to a known character in the extracted set.
 * Content between the heading and the next bold heading is captured as arc_summary.
 *
 * Fail-closed: unknown target names are silently skipped (not invented).
 */
function extractRelationshipArcsFromSection(
  section: string,
  sourceCharName: string,
  knownCharacterNames: Set<string>,
): ExtractedRelationship[] {
  const relationships: ExtractedRelationship[] = [];
  const seen = new Set<string>();

  // Match **Relationship Arc (with NAME):** pattern
  const relHeadingPattern = /\*\*Relationship\s+Arc\s*\(with\s+(.+?)\)\s*:\*\*/gi;
  let match: RegExpExecArray | null;

  while ((match = relHeadingPattern.exec(section)) !== null) {
    const targetName = match[1].trim();
    if (!targetName || targetName.length < 2) continue;

    // Fail-closed: target must be a known character name
    const targetNormalized = targetName.toLowerCase().trim();
    if (!knownCharacterNames.has(targetNormalized)) {
      // Check partial match: first name only
      const targetFirstName = targetNormalized.split(/[\s-]/)[0];
      let found = false;
      for (const known of knownCharacterNames) {
        if (known === targetFirstName || known.startsWith(targetFirstName + " ")) {
          found = true;
          break;
        }
      }
      if (!found) {
        console.warn(`[canon-sync] relationship_target_unknown: "${targetName}" not in character set, skipping`);
        continue;
      }
    }

    // Avoid duplicate entries for the same target
    const dedupKey = targetNormalized;
    if (seen.has(dedupKey)) continue;
    seen.add(dedupKey);

    // Extract arc content: text between this heading and the next bold heading or end of section
    const afterMatch = section.slice(match.index + match[0].length);
    const nextBoldHeading = afterMatch.match(/\n\*\*[A-Z]/);
    const arcContent = nextBoldHeading && nextBoldHeading.index !== undefined
      ? afterMatch.slice(0, nextBoldHeading.index).trim()
      : afterMatch.trim();

    // Only include if we got meaningful content
    if (arcContent.length < 10) continue;

    // Condense arc summary: collapse to a single-line summary for canon storage
    const arcSummary = arcContent
      .replace(/\n\s*\*\s+/g, " | ")  // bullet points to pipe-separated
      .replace(/\*\*/g, "")            // strip bold markers
      .replace(/\s+/g, " ")           // collapse whitespace
      .trim()
      .slice(0, 500);                 // cap length

    relationships.push({
      target_name: targetName,
      arc_summary: arcSummary,
    });
  }

  return relationships;
}
