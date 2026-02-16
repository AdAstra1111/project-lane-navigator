import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
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
  // Fallback: if action_type not listed, we infer from target_ref or regenerate concept_brief
};

/**
 * apply-project-change
 *
 * Applies a change to a project:
 * 1. Patches project metadata columns (if any valid ones in payload)
 * 2. Re-resolves qualifications & marks stale docs
 * 3. Regenerates affected documents with the creative direction from the action
 */
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, serviceKey);

    const token = authHeader.replace("Bearer ", "");
    const { data: { user } } = await supabase.auth.getUser(token);
    if (!user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const body = await req.json();
    const { projectId, patch, changeType, actionId } = body;

    if (!projectId) {
      return new Response(JSON.stringify({ error: "projectId required" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // ─── Look up the action if actionId provided ───
    let actionRecord: any = null;
    if (actionId) {
      const { data } = await supabase.from("document_assistant_actions")
        .select("*")
        .eq("id", actionId)
        .single();
      actionRecord = data;
    }

    const effectivePatch = patch || actionRecord?.patch || {};
    const effectiveChangeType = changeType || actionRecord?.action_type || "project_change";
    const creativeDirection = effectivePatch.description || actionRecord?.human_summary || "";

    // ─── 1) Patch project metadata (if applicable) ───
    const PATCHABLE_COLUMNS = new Set([
      'title', 'format', 'genres', 'budget_range', 'target_audience', 'tone',
      'comparable_titles', 'assigned_lane', 'confidence', 'reasoning', 'recommendations',
      'pipeline_stage', 'primary_territory', 'secondary_territories', 'lifecycle_stage',
      'packaging_mode', 'packaging_stage', 'target_runtime_minutes', 'runtime_tolerance_pct',
      'min_runtime_minutes', 'min_runtime_hard_floor', 'runtime_estimation_mode',
      'development_behavior', 'episode_target_duration_seconds', 'season_episode_count',
      'current_stage', 'vertical_engine_weights', 'guardrails_config',
      'qualifications', 'locked_fields', 'season_style_profile', 'project_features',
      'signals_influence', 'signals_apply', 'hero_image_url', 'active_company_profile_id',
    ]);

    const safePatch: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(effectivePatch)) {
      if (PATCHABLE_COLUMNS.has(key)) {
        safePatch[key] = value;
      }
    }

    let newHash: string | null = null;
    const staleDocs: string[] = [];

    if (Object.keys(safePatch).length > 0) {
      const { error: patchErr } = await supabase.from("projects")
        .update(safePatch)
        .eq("id", projectId);
      if (patchErr) throw new Error(`Patch failed: ${patchErr.message}`);
    }

    // ─── 2) Re-resolve qualifications ───
    try {
      const resolveRes = await fetch(`${supabaseUrl}/functions/v1/resolve-qualifications`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: authHeader },
        body: JSON.stringify({ projectId }),
      });
      const resolveData = await resolveRes.json();
      if (resolveRes.ok) {
        newHash = resolveData.resolver_hash;

        // ─── 3) Mark stale docs ───
        const { data: docs } = await supabase.from("project_documents")
          .select("id, doc_type, latest_version_id")
          .eq("project_id", projectId);

        const latestVersionIds = (docs || [])
          .filter((d: any) => d.latest_version_id)
          .map((d: any) => d.latest_version_id);

        if (latestVersionIds.length > 0) {
          const { data: versions } = await supabase.from("project_document_versions")
            .select("id, document_id, depends_on_resolver_hash")
            .in("id", latestVersionIds);

          const staleVersionIds = (versions || [])
            .filter((v: any) => v.depends_on_resolver_hash && v.depends_on_resolver_hash !== newHash)
            .map((v: any) => v.id);

          if (staleVersionIds.length > 0) {
            await supabase.from("project_document_versions")
              .update({ is_stale: true, stale_reason: `resolver_hash_changed (${effectiveChangeType})` })
              .in("id", staleVersionIds);

            const staleDocIds = new Set(
              (versions || []).filter((v: any) => staleVersionIds.includes(v.id)).map((v: any) => v.document_id)
            );
            for (const doc of (docs || [])) {
              if (staleDocIds.has(doc.id)) staleDocs.push(doc.doc_type);
            }
          }
        }
      }
    } catch (e: any) {
      console.warn("[apply-project-change] resolve-qualifications failed (non-fatal):", e.message);
    }

    // ─── 4) Determine affected doc types and regenerate ───
    let affectedDocTypes: string[] = [];

    // From action_type mapping
    if (effectiveChangeType && ACTION_TYPE_TO_DOC_TYPES[effectiveChangeType]) {
      affectedDocTypes = ACTION_TYPE_TO_DOC_TYPES[effectiveChangeType];
    }

    // From target_ref if present
    if (actionRecord?.target_ref?.doc_type) {
      const targetDoc = actionRecord.target_ref.doc_type;
      if (!affectedDocTypes.includes(targetDoc)) {
        affectedDocTypes.push(targetDoc);
      }
    }

    // Only regenerate docs that actually exist in the project (have versions)
    const { data: existingDocs } = await supabase.from("project_documents")
      .select("doc_type, latest_version_id")
      .eq("project_id", projectId);

    const docsWithVersions = new Set(
      (existingDocs || []).filter((d: any) => d.latest_version_id).map((d: any) => d.doc_type)
    );

    const docsToRegenerate = affectedDocTypes.filter(dt => docsWithVersions.has(dt));

    const regenerated: any[] = [];
    const regenErrors: any[] = [];

    if (docsToRegenerate.length > 0 && creativeDirection) {
      for (const docType of docsToRegenerate) {
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
          } else {
            regenerated.push({ docType, ...genData });
          }
        } catch (e: any) {
          regenErrors.push({ docType, error: e.message });
        }
      }
    }

    // ─── 5) Update action status ───
    if (actionId) {
      await supabase.from("document_assistant_actions")
        .update({ status: "applied", updated_at: new Date().toISOString() })
        .eq("id", actionId);
    }

    return new Response(JSON.stringify({
      success: true,
      new_resolver_hash: newHash,
      stale_doc_types: staleDocs,
      stale_count: staleDocs.length,
      regenerated,
      regeneration_errors: regenErrors,
      affected_doc_types: affectedDocTypes,
      docs_regenerated_count: regenerated.length,
    }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e: any) {
    console.error("[apply-project-change] error:", e);
    return new Response(JSON.stringify({ error: e.message || "Internal error" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
