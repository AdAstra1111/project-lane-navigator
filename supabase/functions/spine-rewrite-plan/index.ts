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
  'document type. Section presence in the specific document has not been verified. ' +
  'Re-run analysis for excerpt-verified targeting.';

/**
 * Compute section_targets for a given axis + doc_type using the registry map.
 * Returns null when: doc_type not in section registry, axis not in map, or doc_type not
 * registered for this axis. Fail-closed: null rather than empty array (explicit absence).
 */
function computeSectionTargets(
  axis: string,
  docType: string | null,
): Array<{
  section_key: string;
  section_label: string;
  confidence: 'deterministic' | 'bounded';
  basis: string;
  targeting_method: 'registry';
  note: string;
}> | null {
  if (!docType) return null;
  if (!isSectionRepairSupported(docType)) return null;  // not in registry → no targets
  const axisMap = AXIS_DOC_SECTION_MAP[axis];
  if (!axisMap) return null;
  const entries = axisMap[docType];
  if (!entries || entries.length === 0) return null;

  return entries.map(e => {
    const secDef = findSectionDef(docType, e.section_key);
    return {
      section_key:      e.section_key,
      section_label:    secDef?.label || e.section_key,
      confidence:       e.confidence,
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
          section_targets: computeSectionTargets(axis, documentType),
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
          section_targets: computeSectionTargets(axis, documentType),
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
          section_targets: computeSectionTargets(axis, documentType),
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
          section_targets: computeSectionTargets(axis, documentType),
        });
      }
    }

    // ── 5b. Populate likely_affected_areas ──
    // Deduplicated union of section_keys from all rewrite_targets.
    // Gives producers a flat overview of which document sections need attention.
    // Derived from registry-based section_targets — no document text required.
    const affectedSectionKeys = new Set<string>();
    for (const rt of rewriteTargets) {
      if (rt.section_targets) {
        for (const st of rt.section_targets) {
          affectedSectionKeys.add(st.section_key);
        }
      }
    }
    const likelyAffectedAreas = affectedSectionKeys.size > 0
      ? [...affectedSectionKeys].map(sk => ({
          section_key: sk,
          section_label: (() => { const sd = findSectionDef(documentType || '', sk); return sd?.label || sk; })(),
          targeting_method: 'registry' as const,
        }))
      : null;

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

    // ── 7. Return plan ──
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
    }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });

  } catch (err: any) {
    console.error("[spine-rewrite-plan] unhandled error:", err);
    return new Response(
      JSON.stringify({ error: err.message || "Internal server error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
