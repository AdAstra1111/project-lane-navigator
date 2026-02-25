/**
 * Edge Function: process-video-render-job
 * Claims a job and iterates through shots. Currently a stub — marks shots
 * as "error" with "provider not configured" since no video gen provider is wired yet.
 * Idempotent and safe.
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

    const { project_id } = await req.json();
    if (!project_id) {
      return new Response(JSON.stringify({ error: "project_id required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Claim next job via RPC
    const { data: jobs, error: claimErr } = await supabase.rpc(
      "claim_next_video_render_job",
      { p_project_id: project_id }
    );

    if (claimErr) throw claimErr;
    if (!jobs || jobs.length === 0) {
      return new Response(
        JSON.stringify({ message: "No queued jobs", processed: 0 }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const job = jobs[0];

    // Mark job as running
    await supabase
      .from("video_render_jobs")
      .update({ status: "running", updated_at: new Date().toISOString() })
      .eq("id", job.id);

    // Iterate shots
    let processedShots = 0;
    let hasMore = true;

    while (hasMore) {
      const { data: shots, error: shotErr } = await supabase.rpc(
        "claim_next_video_render_shot",
        { p_job_id: job.id }
      );

      if (shotErr) throw shotErr;
      if (!shots || shots.length === 0) {
        hasMore = false;
        break;
      }

      const shot = shots[0];

      // STUB: No provider configured yet — mark as error
      await supabase
        .from("video_render_shots")
        .update({
          status: "error",
          last_error: "Provider not configured — Phase 7 stub",
          updated_at: new Date().toISOString(),
        })
        .eq("id", shot.id);

      processedShots++;
    }

    // Mark job as error (since all shots errored — no provider)
    await supabase
      .from("video_render_jobs")
      .update({
        status: "error",
        last_error: "Provider not configured — Phase 7 stub",
        updated_at: new Date().toISOString(),
      })
      .eq("id", job.id);

    return new Response(
      JSON.stringify({
        job_id: job.id,
        processed_shots: processedShots,
        status: "error",
        reason: "Provider not configured",
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err: any) {
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
