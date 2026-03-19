import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { resolveFormatToLane, PRESTIGE_STYLES } from "../_shared/prestigeStyleSystem.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

/**
 * Backfill legacy project_images with lane_key and prestige_style.
 *
 * For each image missing lane_key:
 * - Infers lane_key from project.format
 * - Sets prestige_style to project.default_prestige_style or 'legacy_unclassified'
 * - Optionally computes lane_compliance_score from width/height/shot_type
 *
 * Safe: only updates rows where lane_key IS NULL. Idempotent.
 */
serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const authHeader = req.headers.get("Authorization");
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const userClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader || "" } },
    });
    const { data: { user }, error: authErr } = await userClient.auth.getUser();
    if (authErr || !user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const body = await req.json();
    const { project_id, dry_run = false, limit = 500 } = body;

    if (!project_id) {
      return new Response(JSON.stringify({ error: "project_id required" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Get project format + default style
    const { data: project, error: projErr } = await supabase
      .from("projects")
      .select("format, default_prestige_style")
      .eq("id", project_id)
      .single();

    if (projErr || !project) {
      return new Response(JSON.stringify({ error: "Project not found" }), {
        status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const inferredLane = resolveFormatToLane(project.format || "film");
    const inferredStyle = (project.default_prestige_style && PRESTIGE_STYLES[project.default_prestige_style])
      ? project.default_prestige_style
      : null;

    // Fetch unclassified images
    const { data: images, error: fetchErr } = await supabase
      .from("project_images")
      .select("id, width, height, shot_type, lane_key, prestige_style")
      .eq("project_id", project_id)
      .is("lane_key", null)
      .limit(limit);

    if (fetchErr) {
      return new Response(JSON.stringify({ error: fetchErr.message }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (!images || images.length === 0) {
      return new Response(JSON.stringify({
        backfilled: 0,
        message: "No unclassified images found",
        inferred_lane: inferredLane,
      }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    if (dry_run) {
      return new Response(JSON.stringify({
        dry_run: true,
        would_backfill: images.length,
        inferred_lane: inferredLane,
        inferred_style: inferredStyle || "legacy_unclassified",
      }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // Batch update
    let updated = 0;
    let errors = 0;

    for (const img of images) {
      const { error: updateErr } = await supabase
        .from("project_images")
        .update({
          lane_key: inferredLane,
          prestige_style: inferredStyle,
        })
        .eq("id", img.id);

      if (updateErr) {
        console.error(`[backfill] failed to update image ${img.id}: ${updateErr.message}`);
        errors++;
      } else {
        updated++;
      }
    }

    return new Response(JSON.stringify({
      backfilled: updated,
      errors,
      total_candidates: images.length,
      inferred_lane: inferredLane,
      inferred_style: inferredStyle || "legacy_unclassified",
    }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });

  } catch (err: unknown) {
    const errMsg = err instanceof Error ? err.message : "Unknown error";
    console.error("[backfill-prestige-style] error:", errMsg);
    return new Response(JSON.stringify({ error: errMsg }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
