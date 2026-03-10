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
        // Derive amendment context from stale_reason (may be null on very old rows)
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
        });

      } else if (unit.status === 'contradicted') {
        // Spec unchanged but document actively contradicts current spine
        // contradicted units have null stale_reason by design — do not read it
        rewriteTargets.push({
          axis,
          unit_key: unit.unit_key,
          reason: 'contradicted',
          current_evidence: unit.payload_json?.evidence_excerpt || null,
          target_spec: currentSpineValue,
          amendment_context: null,   // stale_reason is null for contradicted (never amended)
          priority,
          axis_class: meta.class,
          confidence: unit.confidence ?? null,
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
        });

      } else if (unit.status === 'active') {
        // Alignment unclear (model returned "unclear" — insufficient evidence)
        // Include as provisional preserve target to prevent accidental rewrite drift.
        // Do NOT treat as a rewrite target — absence of contradiction ≠ contradiction.
        hasActiveUnits = true;
        preserveTargets.push({
          axis,
          unit_key: unit.unit_key,
          status: 'active',
          evidence: unit.payload_json?.evidence_excerpt || null,
          spine_value: currentSpineValue,
          note: 'Alignment unclear — included as provisional preserve target. Re-run analysis for definitive classification.',
          axis_class: meta.class,
        });
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
      likely_affected_areas: null,
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
