import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import { PRODUCTION_MODALITIES } from "../_shared/productionModality.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const JSON_HEADERS = { ...corsHeaders, "Content-Type": "application/json" };
const LOG_TRIM_MAX = 20_000;

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

// ─── Keyword heuristic fallback ───
function inferDocTypeFromKeywords(actionType: string): string[] {
  const lower = actionType.toLowerCase();
  if (lower.includes("character")) return ["character_bible"];
  if (lower.includes("plot") || lower.includes("blueprint")) return ["concept_brief", "blueprint"];
  if (lower.includes("beat") || lower.includes("scene")) return ["beat_sheet"];
  if (lower.includes("budget") || lower.includes("market")) return ["vertical_market_sheet", "market_sheet"];
  return ["concept_brief"];
}

// ─── Patchable project columns whitelist ───
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

// ─── Build composed creative direction ───
function buildCreativeDirection(
  actionType: string,
  humanSummary: string,
  patchObj: Record<string, unknown>,
): string {
  const parts: string[] = [];
  if (actionType) parts.push(`Action: ${actionType}`);
  if (humanSummary) parts.push(`Summary: ${humanSummary}`);
  if (patchObj?.description) parts.push(`Description: ${String(patchObj.description)}`);

  if (patchObj && Object.keys(patchObj).length > 0) {
    try {
      const json = JSON.stringify(patchObj, null, 2);
      const truncated = json.length > 800 ? json.slice(0, 800) + "\n…(truncated)" : json;
      parts.push(`Patch details:\n${truncated}`);
    } catch { /* ignore */ }
  }

  return parts.join("\n\n");
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const logs: string[] = [];
  let applyRunId: string | null = null;
  let sbAdmin: ReturnType<typeof createClient> | null = null;

  try {
    // ════════════════════════════════════════════════
    // REQ 1 — AUTH: validate JWT via ANON client
    // ════════════════════════════════════════════════
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers: JSON_HEADERS });
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const token = authHeader.replace("Bearer ", "").trim();

    // ANON client — used ONLY for user validation
    const sbAnon = createClient(supabaseUrl, anonKey);
    const { data: { user }, error: authError } = await sbAnon.auth.getUser(token);

    if (authError || !user) {
      return new Response(JSON.stringify({ error: "Invalid or expired token" }), { status: 401, headers: JSON_HEADERS });
    }
    logs.push(`auth: user=${user.id}`);

    // ADMIN client — used for all DB writes (bypasses RLS, so we enforce authz manually)
    sbAdmin = createClient(supabaseUrl, serviceKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    // ════════════════════════════════════════════════
    // Parse body
    // ════════════════════════════════════════════════
    const body = await req.json();
    const { projectId, patch, changeType, actionId } = body;

    if (!projectId) {
      return new Response(JSON.stringify({ error: "projectId required" }), { status: 400, headers: JSON_HEADERS });
    }

    // ════════════════════════════════════════════════
    // REQ 2 — AUTHZ: enforce project access BEFORE any writes
    // ════════════════════════════════════════════════
    const { data: hasAccess, error: accessErr } = await sbAdmin.rpc("has_project_access", {
      _user_id: user.id,
      _project_id: projectId,
    });

    if (accessErr || !hasAccess) {
      logs.push(`authz: denied — ${accessErr?.message || "no access"}`);
      return new Response(JSON.stringify({ error: "Forbidden" }), { status: 403, headers: JSON_HEADERS });
    }
    logs.push("authz: granted");

    // ════════════════════════════════════════════════
    // Look up the action record + verify it belongs to this project
    // ════════════════════════════════════════════════
    let actionRecord: any = null;
    if (actionId) {
      const { data } = await sbAdmin
        .from("document_assistant_actions")
        .select("*, document_assistant_threads!inner(project_id)")
        .eq("id", actionId)
        .single();

      if (data) {
        const threadProjectId = (data as any).document_assistant_threads?.project_id;
        if (threadProjectId && threadProjectId !== projectId) {
          return new Response(
            JSON.stringify({ error: "actionId does not belong to project" }),
            { status: 400, headers: JSON_HEADERS },
          );
        }
        actionRecord = data;
      }
    }

    // ════════════════════════════════════════════════
    // REQ 3 — AUDIT TRAIL: insert apply_run with status='running'
    // ════════════════════════════════════════════════
    if (actionId) {
      const { data: runRow, error: runErr } = await sbAdmin
        .from("document_assistant_apply_runs")
        .insert({
          action_id: actionId,
          started_by: user.id,
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

    // ════════════════════════════════════════════════
    // Effective values
    // ════════════════════════════════════════════════
    const effectivePatch = patch || actionRecord?.patch || {};
    const effectiveChangeType = changeType || actionRecord?.action_type || "project_change";

    // ════════════════════════════════════════════════
    // REQ 4 — CREATIVE DIRECTION: composed block
    // ════════════════════════════════════════════════
    const creativeDirection = buildCreativeDirection(
      effectiveChangeType,
      actionRecord?.human_summary || "",
      effectivePatch,
    );
    logs.push(`direction: ${creativeDirection.length} chars`);

    // ════════════════════════════════════════════════
    // REQ 7a — Patch project metadata (safe columns)
    // ════════════════════════════════════════════════
    const safePatch: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(effectivePatch)) {
      if (PATCHABLE_COLUMNS.has(key)) safePatch[key] = value;
    }

    // ── Safe merge for project_features (never clobber existing keys) ──
    const ALLOWED_PROJECT_FEATURE_KEYS = new Set(["production_modality", "signal_tags"]);

    if ("project_features" in safePatch) {
      const incomingFeatures = safePatch.project_features;
      delete safePatch.project_features; // handle separately

      if (incomingFeatures && typeof incomingFeatures === "object" && !Array.isArray(incomingFeatures)) {
        // Load existing project_features from DB
        const { data: existingRow } = await sbAdmin
          .from("projects")
          .select("project_features")
          .eq("id", projectId)
          .single();

        const existing = (existingRow?.project_features && typeof existingRow.project_features === "object" && !Array.isArray(existingRow.project_features))
          ? existingRow.project_features as Record<string, unknown>
          : {};

        // Whitelist incoming keys — reject unknown keys with logging
        const incoming = incomingFeatures as Record<string, unknown>;
        const rejectedKeys: string[] = [];
        const filteredIncoming: Record<string, unknown> = {};
        for (const [k, v] of Object.entries(incoming)) {
          if (ALLOWED_PROJECT_FEATURE_KEYS.has(k)) {
            filteredIncoming[k] = v;
          } else {
            rejectedKeys.push(k);
          }
        }
        if (rejectedKeys.length > 0) {
          logs.push(`[apply-project-change] project_features_keys_rejected=[${rejectedKeys.join(",")}]`);
        }

        // Validate production_modality if present in filtered incoming
        if ("production_modality" in filteredIncoming) {
          if (!PRODUCTION_MODALITIES.includes(filteredIncoming.production_modality as string)) {
            // Invalid modality: preserve existing or default
            filteredIncoming.production_modality = existing.production_modality || "live_action";
            logs.push(`project_features: invalid production_modality rejected, kept=${filteredIncoming.production_modality}`);
          }
        }

        const merged = { ...existing, ...filteredIncoming };
        // Ensure production_modality is never removed
        if (!merged.production_modality && existing.production_modality) {
          merged.production_modality = existing.production_modality;
        }

        const addedKeys = Object.keys(filteredIncoming).filter(k => !(k in existing));
        const overwrittenKeys = Object.keys(filteredIncoming).filter(k => k in existing && existing[k] !== filteredIncoming[k]);
        logs.push(`[apply-project-change] project_features_write=merge keys_added=[${addedKeys.join(",")}] keys_overwritten=[${overwrittenKeys.join(",")}]`);

        safePatch.project_features = merged;
      } else {
        logs.push(`[apply-project-change] project_features_write=rejected reason=non_object_type`);
        // Do NOT apply non-object project_features; preserve existing
      }
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
        // non-fatal — continue to doc regen
      } else {
        patchApplied = true;
        logs.push(`patched: ${patchedKeys.join(", ")}`);
      }
    } else {
      logs.push("patch: skipped (no patchable keys)");
    }

    // ════════════════════════════════════════════════
    // REQ 7b — Re-resolve qualifications (non-fatal)
    // ════════════════════════════════════════════════
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
              (versions || []).filter((v: any) => staleVersionIds.includes(v.id)).map((v: any) => v.document_id),
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

    // ════════════════════════════════════════════════
    // REQ 5 — DOC REGEN TARGETING (priority A → B → C)
    // ════════════════════════════════════════════════

    // Fetch all project docs with versions
    const { data: existingDocs } = await sbAdmin
      .from("project_documents")
      .select("doc_type, latest_version_id")
      .eq("project_id", projectId);

    const docsWithVersions = new Set(
      (existingDocs || []).filter((d: any) => d.latest_version_id).map((d: any) => d.doc_type),
    );

    let affectedDocTypes: string[] = [];

    // A) target_ref.doc_type from action
    if (actionRecord?.target_ref?.doc_type) {
      const targetType = actionRecord.target_ref.doc_type;
      if (docsWithVersions.has(targetType)) {
        affectedDocTypes = [targetType];
        logs.push(`target: A (target_ref) → ${targetType}`);
      }
    }

    // B) ACTION_TYPE_TO_DOC_TYPES mapping
    if (affectedDocTypes.length === 0 && ACTION_TYPE_TO_DOC_TYPES[effectiveChangeType]) {
      affectedDocTypes = ACTION_TYPE_TO_DOC_TYPES[effectiveChangeType].filter((dt) => docsWithVersions.has(dt));
      if (affectedDocTypes.length > 0) {
        logs.push(`target: B (mapping) → ${affectedDocTypes.join(", ")}`);
      }
    }

    // C) keyword heuristic fallback
    if (affectedDocTypes.length === 0) {
      const candidates = inferDocTypeFromKeywords(effectiveChangeType);
      for (const c of candidates) {
        if (docsWithVersions.has(c)) {
          affectedDocTypes.push(c);
          break; // take first match
        }
      }
      if (affectedDocTypes.length > 0) {
        logs.push(`target: C (heuristic) → ${affectedDocTypes.join(", ")}`);
      } else {
        logs.push("target: no eligible docs found");
      }
    }

    // ════════════════════════════════════════════════
    // REQ 7c — Regenerate affected docs
    // ════════════════════════════════════════════════
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

    // ════════════════════════════════════════════════
    // REQ 6 — ACTION STATUS: truthful, no manual updated_at
    // ════════════════════════════════════════════════
    const actionMarkedApplied = patchApplied || regenerated.length > 0;
    const finalActionStatus = actionMarkedApplied ? "applied" : "ready_to_apply";

    if (actionId) {
      await sbAdmin
        .from("document_assistant_actions")
        .update({ status: finalActionStatus })
        .eq("id", actionId);
      logs.push(`action status → ${finalActionStatus}`);
    }

    // ════════════════════════════════════════════════
    // REQ 3 — Finalize audit trail
    // REQ 9 — Trim logs
    // ════════════════════════════════════════════════
    const summary = [
      patchApplied ? `Patched: ${patchedKeys.join(", ")}` : "No metadata patch",
      `Regenerated: ${regenerated.length}/${affectedDocTypes.length} docs`,
      regenErrors.length > 0 ? `Errors: ${regenErrors.length}` : null,
      affectedDocTypes.length === 0 ? "No eligible documents to regenerate" : null,
    ].filter(Boolean).join(". ");

    if (applyRunId && sbAdmin) {
      const rawLogs = logs.join("\n");
      const trimmedLogs = rawLogs.length > LOG_TRIM_MAX ? rawLogs.slice(0, LOG_TRIM_MAX) + "\n…(trimmed)" : rawLogs;

      await sbAdmin
        .from("document_assistant_apply_runs")
        .update({
          finished_at: new Date().toISOString(),
          status: actionMarkedApplied ? "applied" : "failed",
          summary: summary.slice(0, 500),
          details: JSON.stringify({ patchedKeys, affectedDocTypes, regenErrors }).slice(0, 2000),
          logs: trimmedLogs,
        })
        .eq("id", applyRunId);
    }

    // ════════════════════════════════════════════════
    // REQ 8 — Return shape
    // ════════════════════════════════════════════════
    return new Response(
      JSON.stringify({
        success: true,
        new_resolver_hash: newHash,
        stale_doc_types: staleDocs,
        stale_count: staleDocs.length,
        regenerated,
        regeneration_errors: regenErrors,
        affected_doc_types: affectedDocTypes,
        docs_regenerated_count: regenerated.length,
        patched_keys: patchedKeys,
        action_marked_applied: actionMarkedApplied,
        apply_run_id: applyRunId,
      }),
      { headers: JSON_HEADERS },
    );
  } catch (e: any) {
    console.error("[apply-project-change] error:", e);
    logs.push(`FATAL: ${e.message}`);

    // Best-effort audit trail update
    if (applyRunId && sbAdmin) {
      try {
        const rawLogs = logs.join("\n");
        const trimmedLogs = rawLogs.length > LOG_TRIM_MAX ? rawLogs.slice(0, LOG_TRIM_MAX) + "\n…(trimmed)" : rawLogs;

        await sbAdmin
          .from("document_assistant_apply_runs")
          .update({
            finished_at: new Date().toISOString(),
            status: "error",
            summary: `Error: ${(e.message || "unknown").slice(0, 200)}`,
            logs: trimmedLogs,
          })
          .eq("id", applyRunId);
      } catch { /* best effort */ }
    }

    return new Response(
      JSON.stringify({ error: e.message || "Internal error", apply_run_id: applyRunId }),
      { status: 500, headers: JSON_HEADERS },
    );
  }
});
