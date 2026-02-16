import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

// ─── Action type → affected doc types mapping ───
const ACTION_TYPE_TO_DOC_TYPES: Record<string, string[]> = {
  rewrite_character_arc: ["character_bible"],
  add_character: ["character_bible"],
  remove_character: ["character_bible"],
  modify_character: ["character_bible"],
  apply_note_to_blueprint: ["concept_brief", "season_arc"],
  rewrite_scene: ["vertical_episode_beats"],
  adjust_tone: ["concept_brief", "format_rules"],
  restructure_plot: ["season_arc", "episode_grid"],
  modify_setting: ["concept_brief"],
  add_subplot: ["season_arc", "episode_grid"],
  budget_adjustment: ["vertical_market_sheet"],
  format_change: ["format_rules"],
};

// ─── Keyword-based heuristic fallback for doc type ───
function inferDocTypeFromKeywords(actionType: string): string {
  const lower = actionType.toLowerCase();
  if (lower.includes("character")) return "character_bible";
  if (lower.includes("plot") || lower.includes("blueprint")) return "concept_brief";
  if (lower.includes("beat") || lower.includes("scene")) return "beat_sheet";
  if (lower.includes("budget") || lower.includes("market")) return "vertical_market_sheet";
  return "concept_brief";
}

// ─── Build composed creative direction ───
function buildCreativeDirection(action: {
  action_type?: string;
  human_summary?: string;
  patch?: Record<string, unknown>;
}): string {
  const parts: string[] = [];
  if (action.action_type) parts.push(`Action: ${action.action_type}`);
  if (action.human_summary) parts.push(`Summary: ${action.human_summary}`);
  if (action.patch?.description) parts.push(`Description: ${action.patch.description}`);

  // Add truncated patch JSON for context
  if (action.patch && Object.keys(action.patch).length > 0) {
    try {
      const patchJson = JSON.stringify(action.patch, null, 2);
      const truncated = patchJson.length > 500 ? patchJson.slice(0, 500) + "\n…(truncated)" : patchJson;
      parts.push(`Patch details:\n${truncated}`);
    } catch { /* ignore stringify errors */ }
  }

  return parts.join("\n\n");
}

const JSON_HEADERS = { ...corsHeaders, "Content-Type": "application/json" };

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const logs: string[] = [];
  let applyRunId: string | null = null;
  let sbAdmin: ReturnType<typeof createClient> | null = null;

  try {
    // ──────────────────────────────────────────────
    // GOAL 1: Correct AUTH — validate JWT via anon client
    // ──────────────────────────────────────────────
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers: JSON_HEADERS });
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const token = authHeader.replace("Bearer ", "");

    const sbAnon = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    sbAdmin = createClient(supabaseUrl, serviceKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    const { data: claimsData, error: claimsError } = await sbAnon.auth.getClaims(token);
    if (claimsError || !claimsData?.claims) {
      return new Response(JSON.stringify({ error: "Invalid token" }), { status: 401, headers: JSON_HEADERS });
    }
    const userId = claimsData.claims.sub as string;
    logs.push(`auth: user ${userId}`);

    // ──────────────────────────────────────────────
    // Parse body
    // ──────────────────────────────────────────────
    const body = await req.json();
    const { projectId, patch, changeType, actionId } = body;

    if (!projectId) {
      return new Response(JSON.stringify({ error: "projectId required" }), { status: 400, headers: JSON_HEADERS });
    }

    // ──────────────────────────────────────────────
    // GOAL 2: Correct AUTHZ — enforce project access
    // ──────────────────────────────────────────────
    const { data: hasAccess, error: accessErr } = await sbAdmin.rpc("has_project_access", {
      _user_id: userId,
      _project_id: projectId,
    });
    if (accessErr || !hasAccess) {
      logs.push(`authz: denied — ${accessErr?.message || "no access"}`);
      return new Response(JSON.stringify({ error: "Forbidden" }), { status: 403, headers: JSON_HEADERS });
    }
    logs.push("authz: granted");

    // ──────────────────────────────────────────────
    // Look up the action record if actionId provided
    // ──────────────────────────────────────────────
    let actionRecord: any = null;
    if (actionId) {
      const { data } = await sbAdmin
        .from("document_assistant_actions")
        .select("*")
        .eq("id", actionId)
        .single();
      actionRecord = data;
    }

    // ──────────────────────────────────────────────
    // GOAL 3: Audit trail — insert apply_run
    // ──────────────────────────────────────────────
    if (actionId) {
      const { data: runRow, error: runErr } = await sbAdmin
        .from("document_assistant_apply_runs")
        .insert({
          action_id: actionId,
          started_by: userId,
          status: "running",
        })
        .select("id")
        .single();
      if (!runErr && runRow) {
        applyRunId = runRow.id;
        logs.push(`apply_run: ${applyRunId}`);
      } else {
        logs.push(`apply_run insert failed: ${runErr?.message}`);
      }
    }

    const effectivePatch = patch || actionRecord?.patch || {};
    const effectiveChangeType = changeType || actionRecord?.action_type || "project_change";

    // ──────────────────────────────────────────────
    // GOAL 4: Build composed creative direction
    // ──────────────────────────────────────────────
    const creativeDirection = buildCreativeDirection({
      action_type: effectiveChangeType,
      human_summary: actionRecord?.human_summary || "",
      patch: effectivePatch,
    });
    logs.push(`direction: ${creativeDirection.length} chars`);

    // ──────────────────────────────────────────────
    // 1) Patch project metadata (if applicable)
    // ──────────────────────────────────────────────
    const PATCHABLE_COLUMNS = new Set([
      "title", "format", "genres", "budget_range", "target_audience", "tone",
      "comparable_titles", "assigned_lane", "confidence", "reasoning", "recommendations",
      "pipeline_stage", "primary_territory", "secondary_territories", "lifecycle_stage",
      "packaging_mode", "packaging_stage", "target_runtime_minutes", "runtime_tolerance_pct",
      "min_runtime_minutes", "min_runtime_hard_floor", "runtime_estimation_mode",
      "development_behavior", "episode_target_duration_seconds", "season_episode_count",
      "current_stage", "vertical_engine_weights", "guardrails_config",
      "qualifications", "locked_fields", "season_style_profile", "project_features",
      "signals_influence", "signals_apply", "hero_image_url", "active_company_profile_id",
    ]);

    const safePatch: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(effectivePatch)) {
      if (PATCHABLE_COLUMNS.has(key)) safePatch[key] = value;
    }

    let patchApplied = false;
    const patchedKeys = Object.keys(safePatch);

    if (patchedKeys.length > 0) {
      const { error: patchErr } = await sbAdmin
        .from("projects")
        .update(safePatch)
        .eq("id", projectId);
      if (patchErr) {
        logs.push(`patch failed: ${patchErr.message}`);
        throw new Error(`Patch failed: ${patchErr.message}`);
      }
      patchApplied = true;
      logs.push(`patched: ${patchedKeys.join(", ")}`);
    } else {
      logs.push("patch: skipped (no patchable keys)");
    }

    // ──────────────────────────────────────────────
    // 2) Re-resolve qualifications (non-fatal)
    // ──────────────────────────────────────────────
    let newHash: string | null = null;
    const staleDocs: string[] = [];

    try {
      const resolveRes = await fetch(`${supabaseUrl}/functions/v1/resolve-qualifications`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: authHeader },
        body: JSON.stringify({ projectId }),
      });
      const resolveData = await resolveRes.json();
      if (resolveRes.ok) {
        newHash = resolveData.resolver_hash;
        logs.push(`resolver: hash=${newHash}`);

        // Mark stale docs
        const { data: docs } = await sbAdmin
          .from("project_documents")
          .select("id, doc_type, latest_version_id")
          .eq("project_id", projectId);

        const latestVersionIds = (docs || [])
          .filter((d: any) => d.latest_version_id)
          .map((d: any) => d.latest_version_id);

        if (latestVersionIds.length > 0) {
          const { data: versions } = await sbAdmin
            .from("project_document_versions")
            .select("id, document_id, depends_on_resolver_hash")
            .in("id", latestVersionIds);

          const staleVersionIds = (versions || [])
            .filter((v: any) => v.depends_on_resolver_hash && v.depends_on_resolver_hash !== newHash)
            .map((v: any) => v.id);

          if (staleVersionIds.length > 0) {
            await sbAdmin
              .from("project_document_versions")
              .update({ is_stale: true, stale_reason: `resolver_hash_changed (${effectiveChangeType})` })
              .in("id", staleVersionIds);

            const staleDocIds = new Set(
              (versions || []).filter((v: any) => staleVersionIds.includes(v.id)).map((v: any) => v.document_id)
            );
            for (const doc of docs || []) {
              if (staleDocIds.has(doc.id)) staleDocs.push(doc.doc_type);
            }
            logs.push(`stale: ${staleDocs.join(", ")}`);
          }
        }
      } else {
        logs.push(`resolver: non-ok ${resolveRes.status}`);
      }
    } catch (e: any) {
      logs.push(`resolver: failed (non-fatal) ${e.message}`);
    }

    // ──────────────────────────────────────────────
    // GOAL 5: Determine affected doc types & regenerate
    // ──────────────────────────────────────────────
    // Get all project docs with versions
    const { data: existingDocs } = await sbAdmin
      .from("project_documents")
      .select("doc_type, latest_version_id")
      .eq("project_id", projectId);

    const docsWithVersions = new Set(
      (existingDocs || []).filter((d: any) => d.latest_version_id).map((d: any) => d.doc_type)
    );

    // Priority 1: target_ref.doc_type from action
    let affectedDocTypes: string[] = [];
    if (actionRecord?.target_ref?.doc_type && docsWithVersions.has(actionRecord.target_ref.doc_type)) {
      affectedDocTypes.push(actionRecord.target_ref.doc_type);
    }

    // Priority 2: ACTION_TYPE_TO_DOC_TYPES mapping (only existing docs)
    if (affectedDocTypes.length === 0 && ACTION_TYPE_TO_DOC_TYPES[effectiveChangeType]) {
      affectedDocTypes = ACTION_TYPE_TO_DOC_TYPES[effectiveChangeType].filter((dt) => docsWithVersions.has(dt));
    }

    // Priority 3: keyword heuristic fallback
    if (affectedDocTypes.length === 0) {
      const inferred = inferDocTypeFromKeywords(effectiveChangeType);
      if (docsWithVersions.has(inferred)) {
        affectedDocTypes.push(inferred);
      }
    }

    logs.push(`affected: ${affectedDocTypes.length > 0 ? affectedDocTypes.join(", ") : "none"}`);

    const regenerated: any[] = [];
    const regenErrors: any[] = [];

    for (const docType of affectedDocTypes) {
      try {
        const genRes = await fetch(`${supabaseUrl}/functions/v1/generate-document`, {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: authHeader },
          body: JSON.stringify({
            projectId,
            docType,
            mode: "draft",
            generatorId: "apply-project-change",
            additionalContext: creativeDirection,
          }),
        });
        const genData = await genRes.json();
        if (!genRes.ok) {
          regenErrors.push({ docType, error: genData.error || "Generation failed" });
          logs.push(`regen FAIL ${docType}: ${genData.error || genRes.status}`);
        } else {
          regenerated.push({ docType, ...genData });
          logs.push(`regen OK ${docType}`);
        }
      } catch (e: any) {
        regenErrors.push({ docType, error: e.message });
        logs.push(`regen ERROR ${docType}: ${e.message}`);
      }
    }

    // ──────────────────────────────────────────────
    // GOAL 7: Only mark 'applied' if real work happened
    // ──────────────────────────────────────────────
    const actionMarkedApplied = patchApplied || regenerated.length > 0;
    const finalActionStatus = actionMarkedApplied ? "applied" : "ready_to_apply";

    // GOAL 6: Do NOT manually set updated_at
    if (actionId) {
      await sbAdmin
        .from("document_assistant_actions")
        .update({ status: finalActionStatus })
        .eq("id", actionId);
      logs.push(`action status → ${finalActionStatus}`);
    }

    // ──────────────────────────────────────────────
    // GOAL 3: Finalize audit trail
    // ──────────────────────────────────────────────
    const summary = [
      patchApplied ? `Patched: ${patchedKeys.join(", ")}` : "No metadata patch",
      `Regenerated: ${regenerated.length}/${affectedDocTypes.length} docs`,
      regenErrors.length > 0 ? `Errors: ${regenErrors.length}` : null,
    ].filter(Boolean).join(". ");

    if (applyRunId && sbAdmin) {
      await sbAdmin
        .from("document_assistant_apply_runs")
        .update({
          finished_at: new Date().toISOString(),
          status: actionMarkedApplied ? "applied" : "failed",
          summary: summary.slice(0, 500),
          details: JSON.stringify({ patchedKeys, affectedDocTypes, regenErrors }).slice(0, 2000),
          logs: logs.join("\n").slice(0, 5000),
        })
        .eq("id", applyRunId);
    }

    return new Response(
      JSON.stringify({
        success: true,
        new_resolver_hash: newHash,
        stale_doc_types: staleDocs,
        regenerated,
        regeneration_errors: regenErrors,
        affected_doc_types: affectedDocTypes,
        docs_regenerated_count: regenerated.length,
        patched_keys: patchedKeys,
        action_marked_applied: actionMarkedApplied,
        apply_run_id: applyRunId,
      }),
      { headers: JSON_HEADERS }
    );
  } catch (e: any) {
    console.error("[apply-project-change] error:", e);
    logs.push(`FATAL: ${e.message}`);

    // Best-effort audit trail update on error
    if (applyRunId && sbAdmin) {
      try {
        await sbAdmin
          .from("document_assistant_apply_runs")
          .update({
            finished_at: new Date().toISOString(),
            status: "error",
            summary: `Error: ${(e.message || "unknown").slice(0, 200)}`,
            logs: logs.join("\n").slice(0, 5000),
          })
          .eq("id", applyRunId);
      } catch { /* best effort */ }
    }

    return new Response(JSON.stringify({ error: e.message || "Internal error", apply_run_id: applyRunId }), {
      status: 500,
      headers: JSON_HEADERS,
    });
  }
});
