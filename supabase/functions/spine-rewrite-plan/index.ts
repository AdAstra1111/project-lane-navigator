/**
 * spine-rewrite-plan/index.ts
 *
 * Read-only deterministic rewrite planning primitive.
 * Converts narrative_units + current spine state into a structured rewrite plan.
 *
 * NO LLM call. NO schema mutations. NO document text loading.
 * All data is derived from narrative_units + projects.narrative_spine_json + AXIS_METADATA.
 *
 * Input:   { projectId, documentId, versionId }
 * Output:  RewritePlan (see schema below)
 *
 * Plan semantics:
 *   stale unit      → rewrite_target (spec changed; unit evaluated against superseded spec)
 *   contradicted    → rewrite_target (spec unchanged; document actively contradicts current spec)
 *   aligned         → preserve_target (document correctly reflects current spec — preserve in rewrite)
 *   active          → preserve_target (provisional: alignment unclear; treat as preserve unless contradicted)
 *
 * plan_complete = true only when ALL non-null spine axes have a unit row for this version.
 * coverage_warning is populated whenever plan_complete = false.
 *
 * Canonical location: supabase/functions/spine-rewrite-plan/index.ts
 */

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";
import {
  SPINE_AXES,
  AXIS_METADATA,
  VALIDATOR_SUPPORTED_AXES,
  VALIDATOR_DEFERRED_AXES,
  getSpineState,
  SpineAxis,
} from "../_shared/narrativeSpine.ts";
import {
  findSectionDef,
  isSectionRepairSupported,
} from "../_shared/deliverableSectionRegistry.ts";
import { parseSections } from "../_shared/sectionRepairEngine.ts";
import type { SectionBoundary } from "../_shared/sectionRepairEngine.ts";
import {
  getDownstreamAxes,
  getUpstreamAxes,
  computePropagatedRisk,
  getDependencyPosition,
  computeDependencyRisk,
  computeRewritePriorityScore,
  sequenceRewriteTargets,
  buildSceneImpactIndex,
  getAffectedScenesForAxes,
  type UnitConfidenceMeta,
  type SceneImpactEntry,
} from "../_shared/narrativeDependencyGraph.ts";
import { buildPatchBlueprints, type EntityContext, type SceneContext } from "../_shared/patchBlueprintEngine.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// ── Priority label from AmendmentSeverity ──
const SEVERITY_TO_PRIORITY: Record<string, string> = {
  constitutional:  'constitutional',
  severe:          'high',
  severe_moderate: 'high',
  moderate:        'moderate',
  light:           'advisory',
};

// ── Section Targeting — L4.2 ──
//
// Registry-driven static mapping: spine axis × doc_type → section_key(s)
//
// Architecture:
//   - Purely deterministic — no document text loading, no LLM, no new DB fetch
//   - Sources structural knowledge from deliverableSectionRegistry.ts (category maps +
//     SectionDefinition ordering)
//   - Confidence classes:
//       "deterministic" — axis name directly corresponds to a dedicated section key
//       "bounded"       — structurally justified; axis content appears in this range
//                         but may span multiple sections or share space with others
//   - Doc types NOT safely targetable (feature_script, production_draft):
//       Not in section registry (screenplay format uses scene sluglines, not markdown
//       heading structure). Returns no section_targets — explicit silence.
//   - targeting_method: "registry" (future: "document_verified" when parseSections()
//       is run against version.plaintext to confirm section presence + excerpt locality)
//
// Phase 2 follow-up: load version.plaintext + run parseSections() to upgrade
//   "registry" targets to "document_verified" with actual line bounds.
//   That pass also populates likely_affected_areas with section content excerpts.
//
// Note: Class S deferred axes (inciting_incident, midpoint_reversal) still get registry
//   section targeting for stale/rewrite planning — section targeting is structural and
//   independent of validator coverage.
// Note: tonal_gravity is excluded — structurally diffuse, no primary section home.

type SectionTargetEntry = {
  section_key: string;
  confidence: 'deterministic' | 'bounded';
  basis: string;
};

const AXIS_DOC_SECTION_MAP: Record<string, Partial<Record<string, SectionTargetEntry[]>>> = {
  story_engine: {
    concept_brief:  [
      { section_key: 'premise',       confidence: 'deterministic', basis: 'registry_rule:story_engine_defines_premise' },
      { section_key: 'logline',       confidence: 'deterministic', basis: 'registry_rule:story_engine_drives_logline' },
    ],
    story_outline:  [{ section_key: 'setup',         confidence: 'bounded',       basis: 'registry_rule:story_engine_established_in_opening' }],
    treatment:      [{ section_key: 'act_1_setup',   confidence: 'bounded',       basis: 'registry_rule:story_engine_established_in_act1' }],
    long_treatment: [{ section_key: 'act_1_setup',   confidence: 'bounded',       basis: 'registry_rule:story_engine_established_in_act1' }],
    season_arc:     [{ section_key: 'season_premise',confidence: 'deterministic', basis: 'registry_rule:story_engine_is_season_premise' }],
  },

  protagonist_arc: {
    character_bible: [
      { section_key: 'protagonists',   confidence: 'deterministic', basis: 'registry_rule:protagonist_arc_primary_home' },
      { section_key: 'character_arcs', confidence: 'deterministic', basis: 'registry_rule:protagonist_arc_dedicated_section' },
    ],
    concept_brief:   [{ section_key: 'protagonist',  confidence: 'deterministic', basis: 'registry_rule:axis_name_matches_section_name' }],
    story_outline:   [
      { section_key: 'setup',      confidence: 'bounded', basis: 'registry_rule:arc_established_in_opening' },
      { section_key: 'resolution', confidence: 'bounded', basis: 'registry_rule:arc_resolved_in_resolution' },
    ],
    beat_sheet:      [
      { section_key: 'act_1_beats', confidence: 'bounded', basis: 'registry_rule:arc_established_in_act1' },
      { section_key: 'act_3_beats', confidence: 'bounded', basis: 'registry_rule:arc_resolved_in_act3' },
    ],
    treatment:       [
      { section_key: 'act_1_setup',             confidence: 'bounded', basis: 'registry_rule:arc_established_in_act1' },
      { section_key: 'act_3_climax_resolution', confidence: 'bounded', basis: 'registry_rule:arc_resolved_in_act3' },
    ],
    long_treatment:  [
      { section_key: 'act_1_setup',             confidence: 'bounded', basis: 'registry_rule:arc_established_in_act1' },
      { section_key: 'act_3_climax_resolution', confidence: 'bounded', basis: 'registry_rule:arc_resolved_in_act3' },
    ],
    season_arc:      [{ section_key: 'character_season_arcs', confidence: 'deterministic', basis: 'registry_rule:protagonist_arc_in_season_arcs' }],
  },

  pressure_system: {
    story_outline:  [
      { section_key: 'rising_action', confidence: 'deterministic', basis: 'registry_rule:pressure_builds_in_rising_action' },
      { section_key: 'midpoint',      confidence: 'bounded',       basis: 'registry_rule:pressure_peaks_at_midpoint' },
    ],
    beat_sheet:     [
      { section_key: 'act_2a_beats', confidence: 'bounded', basis: 'registry_rule:pressure_rises_act2a' },
      { section_key: 'act_2b_beats', confidence: 'bounded', basis: 'registry_rule:pressure_peaks_act2b' },
    ],
    treatment:      [
      { section_key: 'act_2a_rising_action', confidence: 'deterministic', basis: 'registry_rule:pressure_in_rising_action' },
      { section_key: 'act_2b_complications', confidence: 'bounded',       basis: 'registry_rule:pressure_drives_complications' },
    ],
    long_treatment: [
      { section_key: 'act_2a_rising_action', confidence: 'deterministic', basis: 'registry_rule:pressure_in_rising_action' },
      { section_key: 'act_2b_complications', confidence: 'bounded',       basis: 'registry_rule:pressure_drives_complications' },
    ],
    season_arc:     [
      { section_key: 'arc_overview',   confidence: 'bounded', basis: 'registry_rule:pressure_system_shapes_arc' },
      { section_key: 'turning_points', confidence: 'bounded', basis: 'registry_rule:pressure_peaks_at_turning_points' },
    ],
  },

  central_conflict: {
    concept_brief:   [{ section_key: 'central_conflict', confidence: 'deterministic', basis: 'registry_rule:axis_name_matches_section_name' }],
    story_outline:   [
      { section_key: 'inciting_incident', confidence: 'deterministic', basis: 'registry_rule:conflict_established_at_inciting_incident' },
      { section_key: 'rising_action',     confidence: 'bounded',       basis: 'registry_rule:conflict_escalated_in_rising_action' },
    ],
    character_bible: [{ section_key: 'relationships', confidence: 'bounded', basis: 'registry_rule:central_conflict_expressed_in_relationships' }],
    beat_sheet:      [
      { section_key: 'act_1_beats',  confidence: 'bounded', basis: 'registry_rule:conflict_established_act1' },
      { section_key: 'act_2a_beats', confidence: 'bounded', basis: 'registry_rule:conflict_escalated_act2a' },
    ],
    treatment:       [
      { section_key: 'act_1_setup',          confidence: 'bounded', basis: 'registry_rule:conflict_established_act1' },
      { section_key: 'act_2a_rising_action', confidence: 'bounded', basis: 'registry_rule:conflict_escalated_act2a' },
    ],
    long_treatment:  [
      { section_key: 'act_1_setup',          confidence: 'bounded', basis: 'registry_rule:conflict_established_act1' },
      { section_key: 'act_2a_rising_action', confidence: 'bounded', basis: 'registry_rule:conflict_escalated_act2a' },
    ],
    season_arc:      [
      { section_key: 'arc_overview',   confidence: 'deterministic', basis: 'registry_rule:conflict_shapes_arc' },
      { section_key: 'turning_points', confidence: 'bounded',       basis: 'registry_rule:conflict_escalated_at_turning_points' },
    ],
  },

  resolution_type: {
    story_outline:   [
      { section_key: 'climax',     confidence: 'deterministic', basis: 'registry_rule:resolution_type_manifests_at_climax' },
      { section_key: 'resolution', confidence: 'deterministic', basis: 'registry_rule:axis_name_matches_section_name' },
    ],
    beat_sheet:      [{ section_key: 'act_3_beats',             confidence: 'deterministic', basis: 'registry_rule:resolution_type_in_act3' }],
    treatment:       [{ section_key: 'act_3_climax_resolution', confidence: 'deterministic', basis: 'registry_rule:resolution_type_in_act3' }],
    long_treatment:  [{ section_key: 'act_3_climax_resolution', confidence: 'deterministic', basis: 'registry_rule:resolution_type_in_act3' }],
    character_bible: [{ section_key: 'character_arcs',          confidence: 'bounded',       basis: 'registry_rule:resolution_type_visible_in_arcs' }],
    season_arc:      [
      { section_key: 'season_finale',        confidence: 'deterministic', basis: 'registry_rule:resolution_type_in_finale' },
      { section_key: 'thematic_throughline', confidence: 'bounded',       basis: 'registry_rule:resolution_reflects_theme' },
    ],
  },

  stakes_class: {
    concept_brief:  [
      { section_key: 'premise',     confidence: 'deterministic', basis: 'registry_rule:stakes_established_in_premise' },
      { section_key: 'unique_hook', confidence: 'bounded',       basis: 'registry_rule:stakes_drive_unique_hook' },
    ],
    story_outline:  [
      { section_key: 'setup',         confidence: 'bounded', basis: 'registry_rule:stakes_established_in_opening' },
      { section_key: 'rising_action', confidence: 'bounded', basis: 'registry_rule:stakes_raised_in_rising_action' },
    ],
    beat_sheet:     [{ section_key: 'act_1_beats',  confidence: 'bounded', basis: 'registry_rule:stakes_established_act1' }],
    treatment:      [{ section_key: 'act_1_setup',  confidence: 'bounded', basis: 'registry_rule:stakes_established_act1' }],
    long_treatment: [{ section_key: 'act_1_setup',  confidence: 'bounded', basis: 'registry_rule:stakes_established_act1' }],
    season_arc:     [{ section_key: 'arc_overview', confidence: 'bounded', basis: 'registry_rule:stakes_visible_in_arc_overview' }],
  },

  // Class S deferred axes still receive registry section targeting when they appear as
  // rewrite/preserve targets (e.g. after spine amendment). Section targeting is structural
  // and independent of validator coverage.
  inciting_incident: {
    story_outline:  [{ section_key: 'inciting_incident', confidence: 'deterministic', basis: 'registry_rule:axis_name_matches_section_name' }],
    beat_sheet:     [{ section_key: 'act_1_beats',       confidence: 'bounded',       basis: 'registry_rule:inciting_incident_in_act1' }],
    treatment:      [{ section_key: 'act_1_setup',       confidence: 'bounded',       basis: 'registry_rule:inciting_incident_in_act1_setup' }],
    long_treatment: [{ section_key: 'act_1_setup',       confidence: 'bounded',       basis: 'registry_rule:inciting_incident_in_act1_setup' }],
  },

  midpoint_reversal: {
    story_outline:  [{ section_key: 'midpoint',             confidence: 'deterministic', basis: 'registry_rule:axis_name_matches_section_name' }],
    beat_sheet:     [{ section_key: 'act_2b_beats',         confidence: 'bounded',       basis: 'registry_rule:midpoint_reversal_in_act2b' }],
    treatment:      [{ section_key: 'act_2b_complications', confidence: 'bounded',       basis: 'registry_rule:midpoint_reversal_in_complications' }],
    long_treatment: [{ section_key: 'act_2b_complications', confidence: 'bounded',       basis: 'registry_rule:midpoint_reversal_in_complications' }],
  },

  // tonal_gravity: structurally diffuse — no primary section home.
  // Tone is felt across all sections equally. Emitting a section target would be false precision.
  // Explicitly absent from map; produces no section_targets.
};

const REGISTRY_TARGET_NOTE =
  'Registry-based targeting: this section is the structural home for this axis in this ' +
  'document type. Section presence in the specific document has not been verified.';

const VERIFIED_TARGET_NOTE =
  'Document-verified: section heading located in this document version at the reported ' +
  'line range. Narrative unit evidence is associated via structural axis mapping, not ' +
  'verbatim excerpt position.';

const PASSAGE_VERIFIED_NOTE =
  'Passage-verified: verbatim quote located inside this section at the reported line range.';

/**
 * L4.4 — Passage-level targeting.
 *
 * Deterministically locates a verbatim_quote inside a parsed section boundary.
 * Returns passage_start_line + passage_end_line when found, null otherwise.
 *
 * Strategy:
 *  1. Normalise whitespace in both quote and section content (LLMs may alter spacing)
 *  2. Check section-level containment first (fast guard)
 *  3. Scan lines for single-line match
 *  4. Scan line windows (up to 4 lines) for multi-line matches
 *
 * Fail-closed: returns null on any doubt. Never fabricates a position.
 *
 * Complexity: O(section_lines × quote_len) — acceptable for typical section sizes.
 */
function findPassageLines(
  boundary: SectionBoundary,
  verbatimQuote: string,
): { passage_start_line: number; passage_end_line: number } | null {
  if (!verbatimQuote || verbatimQuote.length < 5) return null;

  const normalise = (s: string) => s.replace(/\s+/g, ' ').trim();
  const normQuote = normalise(verbatimQuote);

  // Guard: check section-level containment with normalised whitespace
  const normSection = normalise(boundary.content);
  if (!normSection.includes(normQuote)) return null;

  const sectionLines = boundary.content.split('\n');

  // Single-line match
  for (let i = 0; i < sectionLines.length; i++) {
    if (normalise(sectionLines[i]).includes(normQuote)) {
      return {
        passage_start_line: boundary.start_line + i,
        passage_end_line:   boundary.start_line + i,
      };
    }
  }

  // Multi-line match (quote spans up to 4 lines)
  const WINDOW = 4;
  const quotePrefix = normQuote.slice(0, Math.min(20, normQuote.length));
  for (let i = 0; i < sectionLines.length; i++) {
    if (!normalise(sectionLines[i]).includes(quotePrefix.slice(0, 10))) continue;
    const windowEnd = Math.min(i + WINDOW, sectionLines.length);
    const windowText = normalise(sectionLines.slice(i, windowEnd).join(' '));
    if (windowText.includes(normQuote)) {
      return {
        passage_start_line: boundary.start_line + i,
        passage_end_line:   boundary.start_line + windowEnd - 1,
      };
    }
  }

  return null;
}

/**
 * L4.5 stored passage metadata shape (subset of payload_json).
 * Present on units written after L4.5 deployment; absent (undefined) on legacy units.
 */
interface StoredPassageMeta {
  verbatim_quote?: string | null;
  verbatim_quote_verified?: boolean;
  verbatim_quote_match_section_key?: string | null;
  verbatim_quote_match_line_start?: number | null;
  verbatim_quote_match_line_end?: number | null;
}

/**
 * Compute section_targets for a given axis + doc_type.
 *
 * Three-tier targeting (L4.5):
 *  0. passage_verified (L4.5): storedMeta.verbatim_quote_verified === true
 *     → use stored section_key + line_start/end; skip live passage scan.
 *  1. document_verified (L4.3): section heading confirmed in this document version.
 *     Returns start_line + end_line. confidence: "deterministic".
 *  2. registry (L4.2 fallback): section not found in document or not loaded.
 *     confidence: "bounded". No line numbers.
 *
 * Live passage scan (L4.4):
 *  Runs only when storedMeta.verbatim_quote_verified is ABSENT (legacy units).
 *  Skipped when verified=false (known failure from extraction time).
 *
 * Fail-closed: returns null when doc_type not in registry, axis not mapped, or no entries.
 */
function computeSectionTargets(
  axis: string,
  docType: string | null,
  sectionBoundaryMap?: Map<string, SectionBoundary>,
  storedMeta?: StoredPassageMeta | null,
): Array<{
  section_key: string;
  section_label: string;
  confidence: 'deterministic' | 'bounded';
  basis: string;
  targeting_method: 'passage_verified' | 'document_verified' | 'registry';
  start_line?: number;
  end_line?: number;
  passage_start_line?: number;
  passage_end_line?: number;
  note: string;
}> | null {
  if (!docType) return null;
  if (!isSectionRepairSupported(docType)) return null;
  const axisMap = AXIS_DOC_SECTION_MAP[axis];
  if (!axisMap) return null;
  const entries = axisMap[docType];
  if (!entries || entries.length === 0) return null;

  // L4.5: Determine passage targeting strategy from stored metadata
  const storedVerified = storedMeta?.verbatim_quote_verified;
  // storedVerified === true  → trust stored coordinates
  // storedVerified === false → skip live scan, fall through
  // storedVerified === undefined → legacy unit, run live L4.4 scan
  const liveVerbatimQuote = (storedVerified === undefined)
    ? (storedMeta?.verbatim_quote ?? null)
    : null;  // don't run live scan when verification status is known

  return entries.map(e => {
    const secDef = findSectionDef(docType, e.section_key);
    const label = secDef?.label || e.section_key;

    if (sectionBoundaryMap) {
      const boundary = sectionBoundaryMap.get(e.section_key);
      if (boundary) {

        // ── L4.5: stored passage_verified ──────────────────────────────
        if (storedVerified === true &&
            storedMeta?.verbatim_quote_match_section_key === e.section_key &&
            storedMeta.verbatim_quote_match_line_start != null) {
          return {
            section_key:        e.section_key,
            section_label:      label,
            confidence:         'deterministic' as const,
            basis:              `passage_verified:stored_at_line_${storedMeta.verbatim_quote_match_line_start}`,
            targeting_method:   'passage_verified' as const,
            start_line:         boundary.start_line,
            end_line:           boundary.end_line,
            passage_start_line: storedMeta.verbatim_quote_match_line_start,
            passage_end_line:   storedMeta.verbatim_quote_match_line_end ?? storedMeta.verbatim_quote_match_line_start,
            note:               PASSAGE_VERIFIED_NOTE,
          };
        }

        // ── L4.4: live passage scan (legacy units only) ─────────────────
        if (liveVerbatimQuote) {
          const passage = findPassageLines(boundary, liveVerbatimQuote);
          if (passage) {
            return {
              section_key:          e.section_key,
              section_label:        label,
              confidence:           'deterministic' as const,
              basis:                `passage_verified:quote_found_at_line_${passage.passage_start_line}`,
              targeting_method:     'passage_verified' as const,
              start_line:           boundary.start_line,
              end_line:             boundary.end_line,
              passage_start_line:   passage.passage_start_line,
              passage_end_line:     passage.passage_end_line,
              note:                 PASSAGE_VERIFIED_NOTE,
            };
          }
        }

        // ── L4.3: section heading confirmed in document ─────────────────
        return {
          section_key:      e.section_key,
          section_label:    label,
          confidence:       'deterministic' as const,
          basis:            `document_verified:heading_found_at_line_${boundary.start_line}`,
          targeting_method: 'document_verified' as const,
          start_line:       boundary.start_line,
          end_line:         boundary.end_line,
          note:             VERIFIED_TARGET_NOTE,
        };
      }
      // Section not found in this document — advisory registry fallback
    }

    // ── L4.2: registry-only ─────────────────────────────────────────────
    return {
      section_key:      e.section_key,
      section_label:    label,
      confidence:       'bounded' as const,
      basis:            e.basis,
      targeting_method: 'registry' as const,
      note:             REGISTRY_TARGET_NOTE,
    };
  });
}

serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey  = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const authHeader  = req.headers.get("Authorization") || `Bearer ${serviceKey}`;

    const supabase = createClient(supabaseUrl, serviceKey, {
      global: { headers: { Authorization: authHeader } },
    });

    const body = await req.json();
    const { projectId, documentId, versionId } = body;

    if (!projectId || !versionId) {
      return new Response(
        JSON.stringify({ error: "projectId and versionId are required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const now = new Date().toISOString();

    // ── 1. Load current spine state ──
    const { state: spineState, spine } = await getSpineState(supabase, projectId);

    if (!spine || (spineState !== 'locked' && spineState !== 'locked_amended')) {
      return new Response(JSON.stringify({
        error: "No locked spine found for this project. Rewrite planning requires a locked spine.",
        spine_state: spineState,
      }), { status: 422, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // ── 2. Determine which spine axes are relevant (non-null in current spine) ──
    const relevantAxes: SpineAxis[] = SPINE_AXES.filter(ax => {
      const val = (spine as any)[ax];
      return val !== null && val !== undefined && val !== '';
    });

    // ── 3. Load narrative_units for this version ──
    // scope: project_id + source_doc_version_id (narrative_units has no document_id column)
    let unitRows: any[] = [];
    try {
      const { data, error } = await supabase
        .from("narrative_units")
        .select("unit_key, unit_type, status, stale_reason, payload_json, confidence, extraction_method, source_doc_type, source_doc_version_id, created_at, updated_at")
        .eq("project_id", projectId)
        .eq("source_doc_version_id", versionId);

      if (error) {
        console.warn("[spine-rewrite-plan] narrative_units query failed (non-fatal):", error.message);
      } else {
        unitRows = data || [];
      }
    } catch (unitEx: any) {
      console.warn("[spine-rewrite-plan] narrative_units query error (non-fatal):", unitEx.message);
    }

    // Build axis → unit map (one unit per axis per version via unique constraint on unit_key)
    const unitByAxis = new Map<string, any>();
    for (const row of unitRows) {
      unitByAxis.set(row.unit_type, row);
    }

    // ── 4. Determine is_latest_version ──
    // Compare versionId against project_documents.latest_version_id
    let isLatestVersion: boolean | null = null;
    let effectiveDocumentId: string | null = documentId || null;
    try {
      // If documentId not provided, derive it from the version record
      if (!effectiveDocumentId) {
        const { data: versionRow } = await supabase
          .from("project_document_versions")
          .select("document_id")
          .eq("id", versionId)
          .maybeSingle();
        effectiveDocumentId = versionRow?.document_id || null;
      }
      if (effectiveDocumentId) {
        const { data: docRow } = await supabase
          .from("project_documents")
          .select("latest_version_id, doc_type")
          .eq("id", effectiveDocumentId)
          .maybeSingle();
        if (docRow) {
          isLatestVersion = docRow.latest_version_id === versionId;
        }
      }
    } catch (versionEx: any) {
      console.warn("[spine-rewrite-plan] version lookup failed (non-fatal):", versionEx.message);
    }

    // Derive document type from first unit (or null)
    const documentType = unitRows.length > 0 ? unitRows[0].source_doc_type : null;

    // ── 4b. L4.3 — Load plaintext and build section boundary map ──
    //
    // If documentType is supported by the section registry, fetch the version plaintext
    // and run parseSections() once. The resulting map (section_key → SectionBoundary) is
    // passed into computeSectionTargets() to upgrade registry targets to document_verified
    // targets with exact start_line / end_line values.
    //
    // Why this is safe:
    //   - Single indexed DB fetch (project_document_versions.id = versionId)
    //   - parseSections() is O(n_lines), deterministic, no LLM
    //   - Fail-closed: any error falls back to registry targeting (sectionBoundaryMap stays null)
    //   - Unsupported doc types skip this block entirely
    //
    // What "document_verified" means here:
    //   Section heading was found in this specific document version at the reported lines.
    //   Evidence excerpt is NOT positionally verified (it is a synthetic LLM explanation,
    //   not a verbatim quote — see L4.4 for excerpt-position verification).
    let sectionBoundaryMap: Map<string, SectionBoundary> | null = null;
    if (documentType && isSectionRepairSupported(documentType)) {
      try {
        const { data: versionPlaintext } = await supabase
          .from("project_document_versions")
          .select("plaintext")
          .eq("id", versionId)
          .maybeSingle();

        if (versionPlaintext?.plaintext) {
          const boundaries = parseSections(versionPlaintext.plaintext, documentType);
          if (boundaries.length > 0) {
            sectionBoundaryMap = new Map<string, SectionBoundary>();
            for (const b of boundaries) {
              if (b.section_key !== '__preamble') {
                sectionBoundaryMap.set(b.section_key, b);
              }
            }
            console.log("[spine-rewrite-plan] L4.3 section parse", {
              docType: documentType,
              sections: sectionBoundaryMap.size,
              versionId,
            });
          }
        }
      } catch (sectErr: any) {
        console.warn("[spine-rewrite-plan] L4.3 section parse failed (non-fatal, fallback to registry):", sectErr?.message);
        sectionBoundaryMap = null;
      }
    }

    // ── 5. Build the plan ──
    const rewriteTargets: any[] = [];
    const preserveTargets: any[] = [];
    const axesWithNoUnits: string[] = [];
    let hasActiveUnits = false;

    for (const axis of relevantAxes) {
      const unit = unitByAxis.get(axis);
      const meta = AXIS_METADATA[axis];
      const currentSpineValue = (spine as any)[axis] || null;
      const priority = SEVERITY_TO_PRIORITY[meta.severity] || meta.severity;

      if (!unit) {
        // No unit for this axis on this version — coverage gap
        axesWithNoUnits.push(axis);
        continue;
      }

      if (unit.status === 'stale') {
        // Spine was amended; unit evaluated against superseded spec
        let amendmentContext: string | null = null;
        if (unit.stale_reason && typeof unit.stale_reason === 'object') {
          const sr = unit.stale_reason;
          if (sr.previous_value && sr.new_value) {
            amendmentContext = `Spine amended: "${sr.previous_value}" → "${sr.new_value}"${sr.flagged_at ? ` (flagged ${sr.flagged_at.substring(0, 10)})` : ''}`;
          } else if (sr.amendment_entry_id) {
            amendmentContext = `Spine amended (entry: ${sr.amendment_entry_id})`;
          }
        }
        rewriteTargets.push({
          axis,
          unit_key: unit.unit_key,
          reason: 'stale',
          current_evidence: unit.payload_json?.evidence_excerpt || null,
          target_spec: currentSpineValue,
          amendment_context: amendmentContext,
          priority,
          axis_class: meta.class,
          confidence: unit.confidence ?? null,
          section_targets: computeSectionTargets(axis, documentType, sectionBoundaryMap ?? undefined, unit.payload_json ?? null),
        });

      } else if (unit.status === 'contradicted') {
        // Spec unchanged but document actively contradicts current spine
        rewriteTargets.push({
          axis,
          unit_key: unit.unit_key,
          reason: 'contradicted',
          current_evidence: unit.payload_json?.evidence_excerpt || null,
          target_spec: currentSpineValue,
          amendment_context: null,
          priority,
          axis_class: meta.class,
          confidence: unit.confidence ?? null,
          section_targets: computeSectionTargets(axis, documentType, sectionBoundaryMap ?? undefined, unit.payload_json ?? null),
        });

      } else if (unit.status === 'aligned') {
        // Document correctly reflects current spec — preserve in any rewrite
        preserveTargets.push({
          axis,
          unit_key: unit.unit_key,
          status: 'aligned',
          evidence: unit.payload_json?.evidence_excerpt || null,
          spine_value: currentSpineValue,
          note: 'Aligned with current spine — preserve this in any rewrite.',
          axis_class: meta.class,
          section_targets: computeSectionTargets(axis, documentType, sectionBoundaryMap ?? undefined, unit.payload_json ?? null),
        });

      } else if (unit.status === 'active') {
        // Alignment unclear — provisional preserve target
        hasActiveUnits = true;
        preserveTargets.push({
          axis,
          unit_key: unit.unit_key,
          status: 'active',
          evidence: unit.payload_json?.evidence_excerpt || null,
          spine_value: currentSpineValue,
          note: 'Alignment unclear — included as provisional preserve target. Re-run analysis for definitive classification.',
          axis_class: meta.class,
          section_targets: computeSectionTargets(axis, documentType, sectionBoundaryMap ?? undefined, unit.payload_json ?? null),
        });
      }
    }

    // ── 5b. Populate likely_affected_areas ──
    // ── 5b. Populate likely_affected_areas ──
    // Deduplicated union of section_keys from all rewrite_targets.
    // Prefers document_verified targets when available — those entries carry start_line/end_line.
    // Falls back to registry targets when no verified entry exists for a section.
    const METHOD_RANK: Record<string, number> = { passage_verified: 3, document_verified: 2, registry: 1 };
    const affectedByKey = new Map<string, { section_key: string; section_label: string; targeting_method: string; start_line?: number; end_line?: number; passage_start_line?: number; passage_end_line?: number }>();
    for (const rt of rewriteTargets) {
      if (rt.section_targets) {
        for (const st of rt.section_targets) {
          const existing = affectedByKey.get(st.section_key);
          // Prefer passage_verified > document_verified > registry
          if (!existing || (METHOD_RANK[st.targeting_method] ?? 0) > (METHOD_RANK[existing.targeting_method] ?? 0)) {
            const sd = findSectionDef(documentType || '', st.section_key);
            affectedByKey.set(st.section_key, {
              section_key:      st.section_key,
              section_label:    sd?.label || st.section_key,
              targeting_method: st.targeting_method,
              ...(st.start_line           !== undefined ? { start_line:           st.start_line           } : {}),
              ...(st.end_line             !== undefined ? { end_line:             st.end_line             } : {}),
              ...(st.passage_start_line   !== undefined ? { passage_start_line:   st.passage_start_line   } : {}),
              ...(st.passage_end_line     !== undefined ? { passage_end_line:     st.passage_end_line     } : {}),
            });
          }
        }
      }
    }
    const likelyAffectedAreas = affectedByKey.size > 0 ? [...affectedByKey.values()] : null;

    // ── NDG v1+v2: Propagated risk + dependency position + risk scoring ──
    // Additive enrichment — advisory only, read-only, no unit lifecycle changes.
    // Computes which rewrite_target axes have structural downstream dependents,
    // adds dependency_position hints, and scores propagated impact (NDG v2).

    // All axes that need attention (contradicted or stale)
    const rewriteAxisSet = new Set<SpineAxis>(rewriteTargets.map((rt: any) => rt.axis as SpineAxis));

    // Build confidence meta map from all units already loaded (no extra DB query)
    const unitConfidenceMap = new Map<SpineAxis, UnitConfidenceMeta | null>();
    for (const [ax, unit] of unitByAxis.entries()) {
      if (unit?.payload_json) {
        unitConfidenceMap.set(ax, unit.payload_json as UnitConfidenceMeta);
      }
    }

    // propagated_risk: for each rewrite target axis, list downstream axes + risk scores
    const propagatedRiskBase = computePropagatedRisk([...rewriteAxisSet]);
    // NDG v2: add risk_score to each propagated_risk entry
    const propagatedRisk = propagatedRiskBase.map(pr => {
      // Compute per-downstream risk scores using loaded unit confidence data
      const perAxisScores = pr.downstream_axes.map(targetAxis => {
        const meta = unitConfidenceMap.get(targetAxis) ?? null;
        const rs = computeDependencyRisk(pr.source_axis, targetAxis, meta);
        return rs ? rs.risk_score : null;
      }).filter((s): s is number => s !== null);

      const maxScore = perAxisScores.length > 0 ? Math.max(...perAxisScores) : 0;
      const avgScore = perAxisScores.length > 0
        ? Math.round(perAxisScores.reduce((a, b) => a + b, 0) / perAxisScores.length * 100) / 100
        : 0;

      return {
        ...pr,
        risk_score:         maxScore,   // representative score for this propagation path
        average_risk_score: avgScore,
      };
    });

    // Enrich each rewrite_target with dependency_position + rewrite_priority_score (NDG v2)
    for (const rt of rewriteTargets) {
      rt.dependency_position     = getDependencyPosition(rt.axis as SpineAxis, rewriteAxisSet);
      rt.rewrite_priority_score  = computeRewritePriorityScore(rt.axis as SpineAxis);
    }
    // Enrich preserve_targets — dep_pos + rewrite_priority_score (structural importance, always useful)
    for (const pt of preserveTargets) {
      pt.dependency_position    = getDependencyPosition(pt.axis as SpineAxis, rewriteAxisSet);
      pt.rewrite_priority_score = computeRewritePriorityScore(pt.axis as SpineAxis);
    }

    // ── NDG v3: Rewrite sequencing ──
    // Additive — advisory only, read-only, no lifecycle changes.
    // Computes the safest repair order for rewrite targets using:
    //   bucket rank → reason priority → rewrite_priority_score → canonical axis order
    const rewriteSequence = sequenceRewriteTargets(rewriteTargets);

    // Backfill sequence metadata into each rewrite_target (additive — keeps original target shape)
    const sequenceByAxis = new Map(rewriteSequence.map(s => [s.axis, s]));
    for (const rt of rewriteTargets) {
      const seq = sequenceByAxis.get(rt.axis as SpineAxis);
      if (seq) {
        rt.sequence_bucket = seq.sequence_bucket;
        rt.sequence_rank   = seq.sequence_rank;
        rt.sequence_reason = seq.sequence_reason;
      }
    }

    // ── 6. Coverage accounting ──
    //
    // SEMANTIC CHANGE vs prior version (document for UI consumers):
    // Previously: plan_complete = false whenever ANY relevant spine axis (including unsupported
    //   ones like inciting_incident, midpoint_reversal) lacked unit coverage.
    // Now: plan_complete is scoped to VALIDATOR_SUPPORTED_AXES only. Unsupported axes are
    //   explicitly classified in coverage_breakdown.unsupported_axes — they don't make the
    //   plan incomplete (the system doesn't cover them; it's a validator limitation, not a
    //   document deficiency). UI should use coverage_breakdown to explain this distinction.
    //
    // axes_with_no_units is RETAINED unchanged for backward compatibility. It now represents
    //   only the supported axes that lack coverage on this version (supported-but-missing).
    //   The old behavior (all-axes gaps) is preserved in coverage_breakdown for full context.

    const staledAxes = relevantAxes.filter(ax => {
      const u = unitByAxis.get(ax);
      return u && u.status === 'stale';
    });

    // Coverage breakdown — distinguishes three semantic categories of axes
    const supportedAxes = VALIDATOR_SUPPORTED_AXES.filter(ax =>
      relevantAxes.includes(ax as SpineAxis)
    );
    const unsupportedAxes = relevantAxes.filter(ax =>
      !(VALIDATOR_SUPPORTED_AXES as readonly string[]).includes(ax)
    );
    const supportedButMissing = supportedAxes.filter(ax =>
      !unitByAxis.has(ax) || unitByAxis.get(ax).status === 'stale'
    );
    const supportedAndEvaluated = supportedAxes.filter(ax =>
      unitByAxis.has(ax) && unitByAxis.get(ax).status !== 'stale'
    );

    // plan_complete: true only when all SUPPORTED axes have fresh non-stale, non-active coverage.
    // Unsupported axes do not affect plan_complete — they are not a document deficiency.
    const planComplete =
      supportedButMissing.length === 0 &&
      !hasActiveUnits &&
      supportedAndEvaluated.length === supportedAxes.length;

    // axes_with_no_units: backward-compatible; now only includes supported-but-missing axes.
    // (Unsupported axes are in coverage_breakdown.unsupported_axes instead.)
    const axesWithNoUnitsResolved = [...new Set([...axesWithNoUnits, ...supportedButMissing])]
      .filter(ax => (VALIDATOR_SUPPORTED_AXES as readonly string[]).includes(ax));

    // Build coverage warning — only fires for supported-axis gaps, not unsupported axes
    const warningParts: string[] = [];
    if (axesWithNoUnitsResolved.length > 0) {
      warningParts.push(`${axesWithNoUnitsResolved.length} supported axis(es) have no unit data for this version: ${axesWithNoUnitsResolved.join(', ')}`);
    }
    if (staledAxes.length > 0) {
      warningParts.push(`${staledAxes.length} unit(s) evaluated against a superseded spine spec — re-run analysis to refresh`);
    }
    if (hasActiveUnits) {
      warningParts.push('some units have unclear alignment — provisional preserve targets included');
    }
    const coverageWarning = warningParts.length > 0
      ? `Coverage incomplete: ${warningParts.join('; ')}.`
      : null;

    // ── 7. L5.1: Entity context for blueprint enrichment ──
    // Load narrative_entities + relations once. Fail-safe: if absent/errored, blueprints
    // remain structure-only (backward compatible). Only runs when rewrite targets exist
    // and include axes that have deterministic entity mappings.
    const ENTITY_MAPPED_AXES = new Set(["protagonist_arc", "central_conflict"]);
    const needsEntityContext =
      rewriteTargets.length > 0 &&
      rewriteTargets.some((rt: any) => ENTITY_MAPPED_AXES.has(rt.axis));

    let entityContext: EntityContext | null = null;
    if (needsEntityContext) {
      try {
        // Load active entities for this project (small table — 6 rows for a typical project)
        const { data: entData } = await supabase
          .from("narrative_entities")
          .select("id, entity_key, entity_type, canonical_name, status, meta_json")
          .eq("project_id", projectId)
          .eq("status", "active");

        if (entData && entData.length > 0) {
          // Build id→key map so relations (which use entity IDs) can be resolved to keys
          const idToKey = new Map<string, string>(
            (entData as any[]).map(e => [e.id as string, e.entity_key as string])
          );
          const entityIds = (entData as any[]).map(e => e.id as string);

          // Load relations where source is one of this project's entities
          const { data: relData } = await supabase
            .from("narrative_entity_relations")
            .select("source_entity_id, target_entity_id, relation_type")
            .in("source_entity_id", entityIds);

          const relations = ((relData ?? []) as any[])
            .map(r => ({
              source_key:    idToKey.get(r.source_entity_id as string) ?? "",
              target_key:    idToKey.get(r.target_entity_id as string) ?? "",
              relation_type: r.relation_type as string,
            }))
            .filter(r => r.source_key && r.target_key);

          entityContext = {
            entities: (entData as any[]).map(e => ({
              entity_key:     e.entity_key  as string,
              entity_type:    e.entity_type as string,
              canonical_name: e.canonical_name as string,
              status:         e.status      as string,
              meta_json:      (e.meta_json  as Record<string, any>) ?? {},
            })),
            relations,
          };

          console.log("[spine-rewrite-plan] L5.1 entity context loaded:", {
            entities:  entityContext.entities.length,
            relations: entityContext.relations.length,
          });
        }
      } catch (nitErr: any) {
        // Fail-safe: entity load error must never block blueprint generation
        console.warn("[spine-rewrite-plan] L5.1 entity load failed (non-fatal):", nitErr?.message);
        entityContext = null;
      }
    }

    // ── 7b. Phase 4+5: Scene context for blueprint affected_scenes + NDG scene impact ──
    // Load scene_spine_links (with axis_key) + scene_graph_scenes (for scene_key).
    // Fail-safe: missing/empty scene data → sceneContext = null → affected_scenes = [] on blueprints.
    // Only loads when rewrite targets exist (no need if nothing to plan).
    let sceneContext: SceneContext | null = null;
    let sceneImpactIndex: Map<string, SceneImpactEntry[]> = new Map();
    if (rewriteTargets.length > 0) {
      try {
        // Load scene_spine_links with axis_key (may be empty if no roles assigned yet)
        const { data: spineLinks } = await supabase
          .from("scene_spine_links")
          .select("scene_id, axis_key")
          .eq("project_id", projectId)
          .not("axis_key", "is", null);

        if (spineLinks && spineLinks.length > 0) {
          // Load scene_key + slugline (latest version per scene)
          const spineLinkSceneIds = [...new Set((spineLinks as any[]).map((l: any) => l.scene_id as string))];

          const { data: sceneRows } = await supabase
            .from("scene_graph_scenes")
            .select("id, scene_key")
            .in("id", spineLinkSceneIds)
            .is("deprecated_at", null);

          const { data: verRows } = await supabase
            .from("scene_graph_versions")
            .select("scene_id, slugline, version_number")
            .in("scene_id", spineLinkSceneIds)
            .order("version_number", { ascending: false });

          // Dedupe: latest slugline per scene
          const sluglineMap = new Map<string, string | null>();
          for (const v of (verRows || []) as any[]) {
            if (!sluglineMap.has(v.scene_id)) sluglineMap.set(v.scene_id, v.slugline ?? null);
          }

          // Build sceneKeyMap: scene_id → { scene_key, slugline }
          const sceneKeyMap = new Map<string, { scene_key: string; slugline: string | null }>();
          for (const s of (sceneRows || []) as any[]) {
            sceneKeyMap.set(s.id, { scene_key: s.scene_key, slugline: sluglineMap.get(s.id) ?? null });
          }

          sceneImpactIndex = buildSceneImpactIndex(
            (spineLinks as any[]).map((l: any) => ({ scene_id: l.scene_id, axis_key: l.axis_key })),
            sceneKeyMap,
          );

          // Build SceneContext for blueprint enrichment (same data, map format for blueprints)
          const blueprintSceneMap = new Map<string, Array<{ scene_key: string; scene_id: string; slugline: string | null }>>();
          for (const [axisKey, entries] of sceneImpactIndex.entries()) {
            blueprintSceneMap.set(axisKey, entries.map(e => ({ scene_key: e.scene_key, scene_id: e.scene_id, slugline: e.slugline })));
          }
          sceneContext = { sceneIndex: blueprintSceneMap };

          console.log("[spine-rewrite-plan] Phase 4+5 scene context loaded:", {
            spine_link_rows: spineLinks.length,
            axes_indexed:    sceneImpactIndex.size,
          });
        }
      } catch (sceneErr: any) {
        console.warn("[spine-rewrite-plan] Phase 4+5 scene load failed (non-fatal):", sceneErr?.message);
        sceneContext = null;
        sceneImpactIndex = new Map();
      }
    }

    // Phase 4: Compute affected_scenes per propagated_risk entry
    const propagatedRiskWithScenes = propagatedRisk.map((pr: any) => {
      const allDownstream: string[] = pr.downstream_axes || [];
      const affectedScenes = getAffectedScenesForAxes(allDownstream, sceneImpactIndex);
      return { ...pr, affected_scenes: affectedScenes };
    });

    // ── 8. Return plan ──
    return new Response(JSON.stringify({
      document_id: effectiveDocumentId,
      version_id: versionId,
      document_type: documentType,
      spine_state: spineState,
      is_latest_version: isLatestVersion,
      is_latest_version_note: isLatestVersion === false
        ? 'This version is not the latest analyzed version for this document. The plan reflects an older state.'
        : null,
      rewrite_targets: rewriteTargets,
      preserve_targets: preserveTargets,
      likely_affected_areas: likelyAffectedAreas,
      // ── Backward-compatible fields (unchanged shape, updated semantics) ──
      axes_with_no_units: axesWithNoUnitsResolved,  // supported-but-missing only (semantic change)
      staled_axes: staledAxes,
      total_relevant_axes: relevantAxes.length,     // all non-null spine axes (unchanged)
      axes_covered: supportedAndEvaluated.length,   // supported + evaluated (narrowed)
      coverage_warning: coverageWarning,
      plan_complete: planComplete,
      generated_at: now,
      // ── Additive: coverage_breakdown distinguishes unsupported vs supported-but-missing ──
      coverage_breakdown: {
        supported_axes: supportedAxes,
        unsupported_axes: unsupportedAxes,
        deferred_validator_axes: VALIDATOR_DEFERRED_AXES.filter(ax =>
          relevantAxes.includes(ax as SpineAxis)
        ),
        supported_but_missing_on_version: supportedButMissing,
        supported_and_evaluated_on_version: supportedAndEvaluated,
      },
      // ── NDG v1: additive dependency intelligence — advisory only ──
      // UI may safely ignore these fields. No unit statuses changed.
      // rewrite_targets and preserve_targets now include dependency_position hints.
      // Phase 4: propagated_risk entries now include affected_scenes ([] when no scene_spine_links).
      propagated_risk: propagatedRiskWithScenes,
      // ── NDG v3: rewrite sequencing — advisory safe repair order ──
      // rewrite_targets include sequence_bucket, sequence_rank, sequence_reason.
      // rewrite_sequence is a deduplicated sorted summary (same data, top-level for UI convenience).
      rewrite_sequence: rewriteSequence,
      // ── L5: Patch blueprints — deterministic repair instructions ──
      // Advisory only. No patch execution. No document mutation. No LLM.
      // Each blueprint answers: what to fix, where to fix it, why, and how urgent.
      // Ordered by sequence_rank (safest repair order). Empty when no rewrite targets.
      // L5.1: pass entityContext for entity-aware blueprint enrichment (null = structure-only)
      // Phase 5: pass sceneContext for affected_scenes per blueprint (null = [] on all blueprints)
      patch_blueprints: buildPatchBlueprints(rewriteTargets, preserveTargets, propagatedRiskWithScenes, entityContext, sceneContext),
    }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });

  } catch (err: any) {
    console.error("[spine-rewrite-plan] unhandled error:", err);
    return new Response(
      JSON.stringify({ error: err.message || "Internal server error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
