/**
 * Edge Function: create-video-render-job
 * Takes a plan_id, creates a video_render_job and per-shot records.
 * Idempotent: if a queued job already exists for the plan, returns it.
 */
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get("Authorization") ?? "";
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
      { global: { headers: { Authorization: authHeader } } }
    );

    const { plan_id, settings } = await req.json();
    if (!plan_id) {
      return new Response(JSON.stringify({ error: "plan_id required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Fetch plan
    const { data: plan, error: planErr } = await supabase
      .from("video_generation_plans")
      .select("*")
      .eq("id", plan_id)
      .single();

    if (planErr || !plan) {
      return new Response(JSON.stringify({ error: "Plan not found" }), {
        status: 404,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Idempotency: check for existing queued job
    const { data: existing } = await supabase
      .from("video_render_jobs")
      .select("id")
      .eq("plan_id", plan_id)
      .eq("status", "queued")
      .limit(1);

    if (existing && existing.length > 0) {
      return new Response(
        JSON.stringify({ job_id: existing[0].id, idempotent: true }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Create job
    const { data: job, error: jobErr } = await supabase
      .from("video_render_jobs")
      .insert({
        project_id: plan.project_id,
        plan_id: plan_id,
        settings_json: settings || {},
      })
      .select("id")
      .single();

    if (jobErr) throw jobErr;

    // Create per-shot records from plan_json.shotPlan
    const shotPlan = (plan.plan_json as any)?.shotPlan || [];
    if (shotPlan.length > 0) {
      const shotRows = shotPlan.map((shot: any) => {
        // Deterministic prompt_json
        const textPrompt = [
          `Shot ${shot.shotIndex}:`,
          `${shot.shotType} shot,`,
          `${shot.cameraMove} movement,`,
          `${shot.lensMm}mm lens,`,
          `${shot.durationSec}s duration.`,
          shot.description,
        ].join(" ");

        return {
          job_id: job.id,
          shot_index: shot.shotIndex,
          prompt_json: {
            shotIndex: shot.shotIndex,
            unitIndex: shot.unitIndex,
            shotType: shot.shotType,
            cameraMove: shot.cameraMove,
            lensMm: shot.lensMm,
            durationSec: shot.durationSec,
            description: shot.description,
            continuityTags: shot.continuityTags || [],
            textPrompt,
          },
        };
      });

      const { error: shotErr } = await supabase
        .from("video_render_shots")
        .insert(shotRows);

      if (shotErr) throw shotErr;
    }

    return new Response(
      JSON.stringify({ job_id: job.id, shot_count: shotPlan.length }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err: any) {
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
