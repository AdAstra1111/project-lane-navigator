/**
 * Edge Function: create-rough-cut
 * Takes a job_id, validates all shots are complete, builds timeline, creates rough cut.
 * Idempotent: if a complete rough cut already exists for the job, returns it.
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

    const { job_id } = await req.json();
    if (!job_id) {
      return new Response(JSON.stringify({ error: "job_id required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Fetch job
    const { data: job, error: jobErr } = await supabase
      .from("video_render_jobs")
      .select("*")
      .eq("id", job_id)
      .single();

    if (jobErr || !job) {
      return new Response(JSON.stringify({ error: "Job not found" }), {
        status: 404,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Idempotency: check for existing complete rough cut
    const { data: existing } = await supabase
      .from("rough_cuts")
      .select("id, status")
      .eq("job_id", job_id)
      .in("status", ["complete", "running"])
      .limit(1);

    if (existing && existing.length > 0) {
      return new Response(
        JSON.stringify({ rough_cut_id: existing[0].id, idempotent: true, status: existing[0].status }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Fetch all shots ordered by shot_index
    const { data: shots, error: shotsErr } = await supabase
      .from("video_render_shots")
      .select("*")
      .eq("job_id", job_id)
      .order("shot_index", { ascending: true });

    if (shotsErr) throw shotsErr;

    const completeShots = (shots || []).filter((s: any) => s.status === "complete");
    if (completeShots.length === 0) {
      return new Response(
        JSON.stringify({ error: "No completed shots to assemble" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Build deterministic timeline
    const settings = job.settings_json || {};
    const fps = settings.fps || 24;
    const resolution = settings.resolution || "1280x720";

    let cursor = 0;
    const clips = completeShots.map((shot: any) => {
      const artifact = shot.artifact_json || {};
      const prompt = shot.prompt_json || {};
      const durationSec = artifact.durationSec ?? prompt.durationSec ?? 4;
      const startSec = Math.round(cursor * 1000) / 1000;
      const endSec = Math.round((cursor + durationSec) * 1000) / 1000;
      cursor = endSec;

      return {
        shotIndex: shot.shot_index,
        srcPath: artifact.storagePath || "",
        publicUrl: artifact.publicUrl || "",
        startSec,
        endSec,
        durationSec: Math.round(durationSec * 1000) / 1000,
      };
    });

    const timelineJson = {
      version: "v1",
      fps,
      resolution,
      totalDurationSec: Math.round(cursor * 1000) / 1000,
      tracks: [{ type: "video", clips }],
    };

    // Insert rough cut — playlist mode (no server-side stitching in edge env)
    const { data: roughCut, error: insertErr } = await supabase
      .from("rough_cuts")
      .insert({
        project_id: job.project_id,
        job_id: job_id,
        plan_id: job.plan_id,
        status: "complete",
        timeline_json: timelineJson,
        artifact_json: {
          mode: "playlist",
          shotCount: clips.length,
          totalDurationSec: timelineJson.totalDurationSec,
          createdAt: new Date().toISOString(),
        },
      })
      .select("id")
      .single();

    if (insertErr) throw insertErr;

    return new Response(
      JSON.stringify({
        rough_cut_id: roughCut.id,
        shot_count: clips.length,
        total_duration_sec: timelineJson.totalDurationSec,
        mode: "playlist",
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
