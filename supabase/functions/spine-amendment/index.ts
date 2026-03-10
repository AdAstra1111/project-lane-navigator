// spine-amendment/index.ts
// Handles two actions:
//   compute_impact  — given projectId + axis + proposed_value, returns severity + revalidation scope
//   confirm_amendment — given projectId + axis + proposed_value + rationale, supersedes active ledger entry,
//                       inserts new one, patches projects.narrative_spine_json

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";
import {
  SpineAxis,
  SPINE_AXES,
  getAxisSeverity,
  getRevalidationFloorIndex,
  getSpineState,
  NarrativeSpine,
  AXIS_METADATA,
} from "../_shared/narrativeSpine.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const FEATURE_FILM_LADDER = [
  "idea", "concept_brief", "market_sheet", "treatment", "story_outline",
  "character_bible", "beat_sheet", "feature_script", "production_draft", "deck",
];

const TV_LADDER = [
  "idea", "concept_brief", "vertical_market_sheet", "format_rules",
  "character_bible", "season_arc", "episode_grid", "vertical_episode_beats", "season_script",
];

function getLadderForFormat(format: string): string[] {
  const f = (format || "").toLowerCase();
  if (f.includes("vertical") || f.includes("tv") || f.includes("series")) return TV_LADDER;
  return FEATURE_FILM_LADDER;
}

// Severity human labels
const SEVERITY_LABELS: Record<string, { label: string; colour: string; warningText: string }> = {
  constitutional: {
    label: "Constitutional",
    colour: "red",
    warningText: "This axis is constitutionally locked. Changing it reshapes the entire story engine. All approved documents from Concept Brief onward must be revalidated.",
  },
  severe: {
    label: "Severe",
    colour: "orange",
    warningText: "This is a severe structural change. Core narrative documents must be revalidated for consistency.",
  },
  severe_moderate: {
    label: "Severe–Moderate",
    colour: "amber",
    warningText: "This axis change has significant structural implications. Several approved documents will need review.",
  },
  moderate: {
    label: "Moderate",
    colour: "amber",
    warningText: "This is a moderate structural change. Some downstream documents may need updating.",
  },
  light: {
    label: "Light",
    colour: "green",
    warningText: "This is a light expressive change. No documents require mandatory revalidation, but tonal drift should be monitored.",
  },
};

serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const authHeader = req.headers.get("Authorization") || `Bearer ${serviceKey}`;

    const supabase = createClient(supabaseUrl, serviceKey, {
      global: { headers: { Authorization: authHeader } },
    });

    const body = await req.json();
    const { action, projectId, axis, proposed_value, rationale } = body;

    if (!projectId) {
      return new Response(JSON.stringify({ error: "projectId required" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (!axis || !SPINE_AXES.includes(axis as SpineAxis)) {
      return new Response(JSON.stringify({ error: `axis must be one of: ${SPINE_AXES.join(", ")}` }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // ── Load project + spine state ──
    const { data: project } = await supabase
      .from("projects")
      .select("format, narrative_spine_json, title")
      .eq("id", projectId)
      .single();

    if (!project) {
      return new Response(JSON.stringify({ error: "Project not found" }), {
        status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const ladder = getLadderForFormat(project.format || "film");
    const { state, spine, entryId } = await getSpineState(supabase, projectId);

    // ── ACTION: compute_impact ──
    if (action === "compute_impact") {
      if (!proposed_value) {
        return new Response(JSON.stringify({ error: "proposed_value required" }), {
          status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const severity = getAxisSeverity(axis as SpineAxis);
      const severityInfo = SEVERITY_LABELS[severity] || SEVERITY_LABELS.moderate;
      const axisMeta = AXIS_METADATA[axis as SpineAxis];

      // Compute revalidation floor
      const floorIdx = getRevalidationFloorIndex(axis as SpineAxis, ladder);
      const revalidationFloorStage = floorIdx === -1
        ? "next_unapproved" // caller resolves — means the next non-approved stage
        : ladder[floorIdx] || ladder[0];

      // Find which approved docs are at or after the revalidation floor
      const { data: approvedDocs } = await supabase
        .from("project_documents")
        .select("id, doc_type, latest_version_id")
        .eq("project_id", projectId);

      const { data: approvedVersions } = await supabase
        .from("project_document_versions")
        .select("id, document_id, approval_status")
        .eq("approval_status", "approved")
        .in("document_id", (approvedDocs || []).map((d: any) => d.id));

      const approvedDocTypes = new Set(
        (approvedVersions || []).map((v: any) => {
          const doc = (approvedDocs || []).find((d: any) => d.id === v.document_id);
          return doc?.doc_type;
        }).filter(Boolean)
      );

      // Filter to docs at or after the revalidation floor
      const floorStageIdx = floorIdx === -1 ? 0 : floorIdx;
      const affectedDocs = ladder
        .slice(floorStageIdx)
        .filter((stage) => approvedDocTypes.has(stage));

      const currentValue = spine ? (spine as any)[axis] : null;

      return new Response(JSON.stringify({
        axis,
        axis_label: axisMeta.description,
        inheritance_class: axisMeta.inheritanceClass,
        current_value: currentValue,
        proposed_value,
        severity,
        severity_label: severityInfo.label,
        severity_colour: severityInfo.colour,
        warning_text: severityInfo.warningText,
        revalidation_floor_stage: revalidationFloorStage,
        affected_approved_docs: affectedDocs,
        affected_doc_count: affectedDocs.length,
        spine_state: state,
        can_amend: state === "locked" || state === "locked_amended" || state === "confirmed" || state === "provisional",
        amendment_count: state === "locked_amended" ? "≥1 prior amendment" : "none",
      }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // ── ACTION: confirm_amendment ──
    if (action === "confirm_amendment") {
      if (!proposed_value) {
        return new Response(JSON.stringify({ error: "proposed_value required" }), {
          status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      if (!rationale || rationale.trim().length < 10) {
        return new Response(JSON.stringify({ error: "rationale required (min 10 chars)" }), {
          status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const severity = getAxisSeverity(axis as SpineAxis);
      const currentValue = spine ? (spine as any)[axis] : null;

      // 1. Supersede the active ledger entry (if one exists)
      if (entryId) {
        await supabase
          .from("decision_ledger")
          .update({ status: "superseded" })
          .eq("id", entryId);
      }

      // 2. Patch projects.narrative_spine_json with the new axis value
      const updatedSpine: NarrativeSpine = {
        ...(spine || {}),
        [axis]: proposed_value,
      } as NarrativeSpine;

      await supabase
        .from("projects")
        .update({ narrative_spine_json: updatedSpine })
        .eq("id", projectId);

      // 3. Insert new active ledger entry for the amended spine
      const { data: newEntry, error: ledgerErr } = await supabase
        .from("decision_ledger")
        .insert({
          project_id: projectId,
          decision_key: "narrative_spine",
          title: `Spine amendment: ${axis} → ${proposed_value}`,
          decision_text: rationale,
          decision_value: JSON.stringify(updatedSpine),
          scope: "project",
          source: "user_amendment",
          status: state === "locked" || state === "locked_amended" ? "active" : "pending_lock",
          locked: state === "locked" || state === "locked_amended",
          meta: {
            amended_axis: axis,
            previous_value: currentValue,
            new_value: proposed_value,
            severity,
            superseded_entry_id: entryId || null,
            amendment_rationale: rationale,
            amended_at: new Date().toISOString(),
          },
        })
        .select()
        .single();

      if (ledgerErr) {
        console.error("[spine-amendment] ledger insert failed:", ledgerErr);
        return new Response(JSON.stringify({ error: "Failed to create ledger entry", detail: ledgerErr.message }), {
          status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      // 4a. Phase 4 Stage 1 — Resolve stale Class A spine note for the amended axis only.
      //     When a spine amendment is confirmed, the old Class A violation was against the
      //     superseded constitutional spec and is no longer valid. We resolve only the exact
      //     axis that was amended; other axes remain untouched.
      const staleNoteKey = `class_a_spine_${axis}`;
      let staleNotesResolved = 0;
      try {
        const { data: resolvedRows, error: resolveErr } = await supabase
          .from("development_notes")
          .update({ resolved: true })
          .eq("project_id", projectId)
          .eq("note_key", staleNoteKey)
          .eq("resolved", false)
          .select("id");

        if (resolveErr) {
          console.warn(`[spine-amendment] stale note resolution failed for ${staleNoteKey}:`, resolveErr.message);
        } else {
          staleNotesResolved = (resolvedRows || []).length;
          if (staleNotesResolved > 0) {
            console.log(`[spine-amendment] resolved ${staleNotesResolved} stale ${staleNoteKey} note(s)`);
          }
        }
      } catch (resolveEx: any) {
        console.warn(`[spine-amendment] stale note resolution error:`, resolveEx.message);
      }

      // 4b. Compute revalidation scope and flag affected documents
      const floorIdx = getRevalidationFloorIndex(axis as SpineAxis, ladder);
      const floorStageIdx = floorIdx === -1 ? 0 : floorIdx;
      const revalidationFloorStage = floorIdx === -1 ? "next_unapproved" : ladder[floorIdx] || ladder[0];

      const { data: allDocs } = await supabase
        .from("project_documents")
        .select("id, doc_type")
        .eq("project_id", projectId);

      const { data: approvedVersions } = await supabase
        .from("project_document_versions")
        .select("document_id")
        .eq("approval_status", "approved")
        .in("document_id", (allDocs || []).map((d: any) => d.id));

      const approvedDocIds = new Set(
        (approvedVersions || []).map((v: any) => v.document_id)
      );

      // Build a map of doc_type → document IDs that have approved versions
      const approvedDocsByType = new Map<string, string[]>();
      for (const doc of (allDocs || [])) {
        if (approvedDocIds.has(doc.id)) {
          const existing = approvedDocsByType.get(doc.doc_type) || [];
          existing.push(doc.id);
          approvedDocsByType.set(doc.doc_type, existing);
        }
      }

      const affectedDocTypes = ladder
        .slice(floorStageIdx)
        .filter((stage) => approvedDocsByType.has(stage));

      // Collect actual document IDs that are affected
      const affectedDocIds: string[] = [];
      for (const docType of affectedDocTypes) {
        const ids = approvedDocsByType.get(docType) || [];
        affectedDocIds.push(...ids);
      }

      // 4c. Phase 4 Stage 2 — Flag affected documents as needing spine revalidation.
      //     Uses the existing needs_reconcile + reconcile_reasons pattern on project_documents.
      //     Sets needs_reconcile = true and appends a spine_amendment reason for each affected doc.
      //     This does NOT trigger auto-reanalysis — it only persists the revalidation flag.
      let docsFlaged = 0;
      if (affectedDocIds.length > 0) {
        try {
          const reconcileReason = {
            type: "spine_amendment",
            axis,
            previous_value: currentValue,
            new_value: proposed_value,
            severity,
            amendment_entry_id: newEntry.id,
            flagged_at: new Date().toISOString(),
          };

          // Fetch existing reconcile_reasons to merge, not overwrite
          const { data: existingDocs } = await supabase
            .from("project_documents")
            .select("id, reconcile_reasons")
            .in("id", affectedDocIds);

          const updates = (existingDocs || []).map((doc: any) => {
            const existing = Array.isArray(doc.reconcile_reasons) ? doc.reconcile_reasons : [];
            return {
              id: doc.id,
              needs_reconcile: true,
              reconcile_reasons: [...existing, reconcileReason],
            };
          });

          // Update each doc individually to preserve per-doc existing reasons
          let flagCount = 0;
          for (const upd of updates) {
            const { error: upErr } = await supabase
              .from("project_documents")
              .update({ needs_reconcile: upd.needs_reconcile, reconcile_reasons: upd.reconcile_reasons })
              .eq("id", upd.id);
            if (!upErr) flagCount++;
            else console.warn(`[spine-amendment] flag failed for doc ${upd.id}:`, upErr.message);
          }

          docsFlaged = flagCount;
          if (docsFlaged > 0) {
            console.log(`[spine-amendment] flagged ${docsFlaged} doc(s) for spine revalidation after ${axis} amendment`);
          }
        } catch (flagEx: any) {
          console.warn(`[spine-amendment] revalidation flag error:`, flagEx.message);
        }
      }

      return new Response(JSON.stringify({
        success: true,
        amendment_entry_id: newEntry.id,
        axis,
        previous_value: currentValue,
        new_value: proposed_value,
        severity,
        new_spine_state: (state === "locked" || state === "locked_amended") ? "locked_amended" : state,
        revalidation_floor_stage: revalidationFloorStage,
        affected_docs_requiring_revalidation: affectedDocTypes,
        affected_doc_ids_flagged: affectedDocIds,
        docs_flagged_for_revalidation: docsFlaged,
        superseded_entry_id: entryId || null,
        stale_notes_resolved: staleNotesResolved,
        stale_note_key: staleNotesResolved > 0 ? staleNoteKey : null,
        message: `Spine amended: ${axis} changed from "${currentValue}" to "${proposed_value}". ${docsFlaged} document(s) flagged for revalidation.${staleNotesResolved > 0 ? ` ${staleNotesResolved} stale ${staleNoteKey} note(s) auto-resolved.` : ""}`,
      }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    return new Response(JSON.stringify({ error: `Unknown action: ${action}. Use compute_impact or confirm_amendment.` }), {
      status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

  } catch (err: any) {
    console.error("[spine-amendment] unhandled error:", err);
    return new Response(JSON.stringify({ error: err.message || "Internal server error" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
