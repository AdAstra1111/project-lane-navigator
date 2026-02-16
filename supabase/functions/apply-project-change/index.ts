import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

/**
 * apply-project-change
 * 
 * Applies a canonical change to a project (qualifications, format, etc.),
 * re-resolves qualifications, and marks dependent documents as stale.
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
    const { projectId, patch, changeType, sourceDecisionId } = body;

    if (!projectId || !patch) {
      return new Response(JSON.stringify({ error: "projectId and patch required" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Valid columns on the projects table that can be patched
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

    // Filter patch to only valid project columns
    const safePatch: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(patch)) {
      if (PATCHABLE_COLUMNS.has(key)) {
        safePatch[key] = value;
      }
    }

    if (Object.keys(safePatch).length === 0) {
      // Nothing to patch on projects table — that's OK, the action was descriptive
      return new Response(JSON.stringify({
        success: true,
        skipped_patch: true,
        note: "No patchable project columns in payload — action recorded as advisory only.",
        stale_doc_types: [],
        stale_count: 0,
      }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // 1) Apply safe patch to project
    const { error: patchErr } = await supabase.from("projects")
      .update(safePatch)
      .eq("id", projectId);

    if (patchErr) throw new Error(`Patch failed: ${patchErr.message}`);

    // 2) Re-resolve qualifications
    const resolveRes = await fetch(`${supabaseUrl}/functions/v1/resolve-qualifications`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: authHeader,
      },
      body: JSON.stringify({ projectId }),
    });
    const resolveData = await resolveRes.json();
    if (!resolveRes.ok) throw new Error(resolveData.error || "resolve-qualifications failed");

    const newHash = resolveData.resolver_hash;

    // 3) Mark stale: find all latest doc versions where depends_on_resolver_hash != newHash
    const { data: docs } = await supabase.from("project_documents")
      .select("id, doc_type, latest_version_id")
      .eq("project_id", projectId);

    const latestVersionIds = (docs || [])
      .filter((d: any) => d.latest_version_id)
      .map((d: any) => d.latest_version_id);

    const staleDocs: string[] = [];

    if (latestVersionIds.length > 0) {
      // Get versions that have a different hash
      const { data: versions } = await supabase.from("project_document_versions")
        .select("id, document_id, depends_on_resolver_hash")
        .in("id", latestVersionIds);

      const staleVersionIds = (versions || [])
        .filter((v: any) => v.depends_on_resolver_hash && v.depends_on_resolver_hash !== newHash)
        .map((v: any) => v.id);

      if (staleVersionIds.length > 0) {
        await supabase.from("project_document_versions")
          .update({
            is_stale: true,
            stale_reason: `resolver_hash_changed (${changeType || "project_change"})`,
          })
          .in("id", staleVersionIds);

        // Map back to doc types
        const staleDocIds = new Set(
          (versions || [])
            .filter((v: any) => staleVersionIds.includes(v.id))
            .map((v: any) => v.document_id)
        );
        for (const doc of (docs || [])) {
          if (staleDocIds.has(doc.id)) staleDocs.push(doc.doc_type);
        }
      }
    }

    return new Response(JSON.stringify({
      success: true,
      new_resolver_hash: newHash,
      resolved_qualifications: resolveData.resolvedQualifications,
      stale_doc_types: staleDocs,
      stale_count: staleDocs.length,
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
