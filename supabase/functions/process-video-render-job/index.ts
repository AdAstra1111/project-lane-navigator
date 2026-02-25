/**
 * Edge Function: process-video-render-job
 * Claims a job, compiles deterministic prompts, submits to Veo provider,
 * polls for completion, uploads artifacts to storage.
 *
 * Supports two actions:
 * - "submit": claim job + submit all shots to provider
 * - "poll": poll pending shots for completion and download artifacts
 */
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

/* ── Constants ── */
const MAX_SHOT_ATTEMPTS = 3;
const MAX_JOB_ATTEMPTS = 3;
const VEO_API_BASE = "https://generativelanguage.googleapis.com/v1beta";
const MAX_VEO_DURATION = 8; // Veo caps at 8s per clip

/* ── FNV-1a hash (deterministic seed) ── */
function fnv1aHash(input: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

/* ── Shot framing/movement maps ── */
const SHOT_FRAMING: Record<string, string> = {
  WIDE: "wide establishing shot showing full environment",
  MEDIUM: "medium shot from waist up",
  CLOSE: "close-up shot focused on subject details",
  INSERT: "insert detail shot of specific object or action",
  POV: "point-of-view shot from character perspective",
  DRONE: "aerial drone shot looking down at scene",
  OTS: "over-the-shoulder shot",
  ECU: "extreme close-up on fine details",
};

const MOVE_DESCRIPTION: Record<string, string> = {
  STATIC: "static locked camera",
  PAN: "smooth horizontal pan",
  TILT: "vertical tilt movement",
  DOLLY: "dolly push forward or pull back",
  HANDHELD: "handheld organic camera movement",
  CRANE: "crane rising or descending movement",
  STEADICAM: "steadicam smooth tracking",
  TRACKING: "lateral tracking alongside subject",
};

const GLOBAL_NEGATIVE_PROMPT = "blurry, low quality, distorted faces, extra limbs, watermark, text overlay, lens flare artifact, frame rate stutter, color banding, compression artifacts";

/* ── Compile deterministic prompt ── */
function compilePrompt(shot: any, projectId: string, planId: string): {
  prompt: string; seed: number; negativePrompt: string; durationSec: number;
} {
  const seed = fnv1aHash(`${projectId}:${planId}:${shot.shotIndex}`);
  const framing = SHOT_FRAMING[shot.shotType] || shot.shotType?.toLowerCase() || "shot";
  const movement = MOVE_DESCRIPTION[shot.cameraMove] || shot.cameraMove?.toLowerCase() || "static";

  const parts = [
    `Cinematic ${framing}.`,
    `Camera: ${movement}.`,
    `Lens: ${shot.lensMm}mm focal length.`,
    `Duration: ${shot.durationSec} seconds.`,
  ];
  if (shot.description) parts.push(shot.description);

  const tags = (shot.continuityTags || []) as string[];
  for (const t of tags) {
    if (!t.startsWith("avoid:")) parts.push(`Constraint: ${t}`);
  }

  const avoids = tags.filter((t: string) => t.startsWith("avoid:")).map((t: string) => t.slice(6));
  const negativePrompt = avoids.length > 0
    ? `${GLOBAL_NEGATIVE_PROMPT}, ${avoids.join(", ")}`
    : GLOBAL_NEGATIVE_PROMPT;

  return {
    prompt: parts.join(" "),
    seed,
    negativePrompt,
    durationSec: Math.min(shot.durationSec || 4, MAX_VEO_DURATION),
  };
}

/* ── Main Handler ── */
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

    const VEO_API_KEY = Deno.env.get("VEO_API_KEY");
    const body = await req.json();
    const { project_id, action = "submit" } = body;

    if (!project_id) {
      return new Response(JSON.stringify({ error: "project_id required" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (!VEO_API_KEY) {
      return new Response(JSON.stringify({ error: "VEO_API_KEY not configured" }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (action === "poll") {
      return await handlePoll(supabase, project_id, VEO_API_KEY);
    }

    return await handleSubmit(supabase, project_id, VEO_API_KEY);
  } catch (err: any) {
    console.error("process-video-render-job error:", err);
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});

/* ── Submit: claim job + submit shots to Veo ── */
async function handleSubmit(supabase: any, projectId: string, apiKey: string) {
  // Claim next job
  const { data: jobs, error: claimErr } = await supabase.rpc(
    "claim_next_video_render_job", { p_project_id: projectId }
  );
  if (claimErr) throw claimErr;
  if (!jobs || jobs.length === 0) {
    return new Response(
      JSON.stringify({ message: "No queued jobs", processed: 0 }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }

  const job = jobs[0];

  // Check max job attempts
  if (job.attempt_count > MAX_JOB_ATTEMPTS) {
    await supabase.from("video_render_jobs").update({
      status: "error", last_error: `Max job attempts (${MAX_JOB_ATTEMPTS}) exceeded`,
      updated_at: new Date().toISOString(),
    }).eq("id", job.id);
    return new Response(
      JSON.stringify({ job_id: job.id, status: "error", reason: "max_attempts" }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }

  // Get the plan for this job
  const { data: plan } = await supabase
    .from("video_generation_plans").select("id, project_id, plan_json")
    .eq("id", job.plan_id).single();

  if (!plan) {
    await supabase.from("video_render_jobs").update({
      status: "error", last_error: "Plan not found",
      updated_at: new Date().toISOString(),
    }).eq("id", job.id);
    return new Response(
      JSON.stringify({ job_id: job.id, status: "error", reason: "plan_not_found" }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }

  // Mark job as running
  await supabase.from("video_render_jobs").update({
    status: "running", updated_at: new Date().toISOString(),
  }).eq("id", job.id);

  // Process shots
  const settings = job.settings_json || {};
  let submitted = 0;
  let errors = 0;
  let hasMore = true;

  while (hasMore) {
    const { data: shots, error: shotErr } = await supabase.rpc(
      "claim_next_video_render_shot", { p_job_id: job.id }
    );
    if (shotErr) throw shotErr;
    if (!shots || shots.length === 0) { hasMore = false; break; }

    const shot = shots[0];

    // Check max shot attempts
    if (shot.attempt_count > MAX_SHOT_ATTEMPTS) {
      await supabase.from("video_render_shots").update({
        status: "error", last_error: `Max shot attempts (${MAX_SHOT_ATTEMPTS}) exceeded`,
        updated_at: new Date().toISOString(),
      }).eq("id", shot.id);
      errors++;
      continue;
    }

    // Get shot plan data from plan_json
    const shotPlan = (plan.plan_json?.shotPlan || []) as any[];
    const planShot = shotPlan.find((s: any) => s.shotIndex === shot.shot_index) || shot.prompt_json || {};

    // Compile deterministic prompt
    const compiled = compilePrompt(planShot, projectId, plan.id);

    // Store seed in prompt_json
    const updatedPromptJson = {
      ...(shot.prompt_json || {}),
      seed: compiled.seed,
      compiledPrompt: compiled.prompt,
      negativePrompt: compiled.negativePrompt,
    };

    // Submit to Veo
    const resolution = settings.resolution || "1280x720";
    const fps = settings.fps || 24;
    const aspectRatio = resolution.includes("1920") || resolution.includes("1280") ? "16:9" : "9:16";

    const veoBody = {
      model: `models/${settings.model_id || "veo-2.0-generate-001"}`,
      generateVideoConfig: {
        outputConfig: {
          mimeType: "video/mp4",
          fps,
          durationSeconds: compiled.durationSec,
          aspectRatio,
        },
        seed: compiled.seed,
      },
      prompt: { text: compiled.prompt },
    };

    try {
      const veoResp = await fetch(
        `${VEO_API_BASE}/models/veo-2.0-generate-001:predictLongRunning?key=${apiKey}`,
        { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(veoBody) }
      );

      if (!veoResp.ok) {
        const errText = await veoResp.text();
        const retryable = veoResp.status === 429 || veoResp.status >= 500;
        await supabase.from("video_render_shots").update({
          status: retryable ? "queued" : "error",
          last_error: `Veo ${veoResp.status}: ${errText.slice(0, 300)}`,
          prompt_json: updatedPromptJson,
          updated_at: new Date().toISOString(),
        }).eq("id", shot.id);
        if (!retryable) errors++;
        continue;
      }

      const veoResult = await veoResp.json();
      const operationName = veoResult.name || "";

      // Mark shot as running with provider job ID
      await supabase.from("video_render_shots").update({
        status: "running",
        prompt_json: { ...updatedPromptJson, providerJobId: operationName },
        updated_at: new Date().toISOString(),
      }).eq("id", shot.id);

      submitted++;
    } catch (err: any) {
      await supabase.from("video_render_shots").update({
        status: "queued", // retry
        last_error: `Submit error: ${err.message}`,
        prompt_json: updatedPromptJson,
        updated_at: new Date().toISOString(),
      }).eq("id", shot.id);
    }
  }

  // If all shots errored immediately, mark job error
  if (submitted === 0 && errors > 0) {
    await supabase.from("video_render_jobs").update({
      status: "error", last_error: `All ${errors} shots failed during submission`,
      updated_at: new Date().toISOString(),
    }).eq("id", job.id);
  }

  return new Response(
    JSON.stringify({ job_id: job.id, submitted, errors, status: "running" }),
    { headers: { ...corsHeaders, "Content-Type": "application/json" } }
  );
}

/* ── Poll: check running shots for completion ── */
async function handlePoll(supabase: any, projectId: string, apiKey: string) {
  // Find running shots for this project's jobs
  const { data: runningJobs } = await supabase
    .from("video_render_jobs").select("id, plan_id")
    .eq("project_id", projectId).eq("status", "running");

  if (!runningJobs || runningJobs.length === 0) {
    return new Response(
      JSON.stringify({ message: "No running jobs", polled: 0 }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }

  let polled = 0;
  let completed = 0;
  let errored = 0;

  for (const job of runningJobs) {
    const { data: runningShots } = await supabase
      .from("video_render_shots").select("*")
      .eq("job_id", job.id).eq("status", "running");

    if (!runningShots || runningShots.length === 0) {
      // Check if all shots are done
      const { data: allShots } = await supabase
        .from("video_render_shots").select("status")
        .eq("job_id", job.id);

      const allComplete = allShots?.every((s: any) => s.status === "complete");
      const anyError = allShots?.some((s: any) => s.status === "error");

      if (allComplete) {
        await supabase.from("video_render_jobs").update({
          status: "complete", updated_at: new Date().toISOString(),
        }).eq("id", job.id);
      } else if (anyError && !allShots?.some((s: any) => s.status === "running" || s.status === "queued")) {
        const errorCount = allShots?.filter((s: any) => s.status === "error").length || 0;
        await supabase.from("video_render_jobs").update({
          status: "error",
          last_error: `${errorCount} shot(s) failed`,
          updated_at: new Date().toISOString(),
        }).eq("id", job.id);
      }
      continue;
    }

    for (const shot of runningShots) {
      const providerJobId = (shot.prompt_json as any)?.providerJobId;
      if (!providerJobId) {
        await supabase.from("video_render_shots").update({
          status: "error", last_error: "No provider job ID",
          updated_at: new Date().toISOString(),
        }).eq("id", shot.id);
        errored++;
        continue;
      }

      polled++;

      try {
        const pollResp = await fetch(
          `${VEO_API_BASE}/${providerJobId}?key=${apiKey}`
        );

        if (!pollResp.ok) {
          const errText = await pollResp.text();
          // Don't error on transient poll failures
          if (pollResp.status >= 500) continue;
          await supabase.from("video_render_shots").update({
            status: "error",
            last_error: `Poll failed ${pollResp.status}: ${errText.slice(0, 300)}`,
            updated_at: new Date().toISOString(),
          }).eq("id", shot.id);
          errored++;
          continue;
        }

        const result = await pollResp.json();

        if (result.done === true) {
          const video = result.response?.generateVideoResponse?.generatedSamples?.[0];
          const videoUri = video?.video?.uri;

          if (!videoUri) {
            await supabase.from("video_render_shots").update({
              status: "error",
              last_error: "Generation completed but no video URI",
              updated_at: new Date().toISOString(),
            }).eq("id", shot.id);
            errored++;
            continue;
          }

          // Download video and upload to storage
          const storagePath = `projects/${projectId}/renders/${job.id}/shots/${shot.shot_index}.mp4`;
          let publicUrl = videoUri; // fallback

          try {
            const videoResp = await fetch(videoUri);
            if (videoResp.ok) {
              const videoBytes = new Uint8Array(await videoResp.arrayBuffer());
              const { error: uploadErr } = await supabase.storage
                .from("trailers")
                .upload(storagePath, videoBytes, {
                  contentType: "video/mp4",
                  upsert: true,
                });

              if (!uploadErr) {
                const { data: urlData } = supabase.storage
                  .from("trailers")
                  .getPublicUrl(storagePath);
                publicUrl = urlData?.publicUrl || videoUri;
              }
            }
          } catch {
            // Storage upload failed — use provider URL as fallback
          }

          const artifactJson = {
            storagePath,
            publicUrl,
            durationSec: shot.prompt_json?.durationSec || 4,
            provider: "veo",
            providerJobId,
            generatedAt: new Date().toISOString(),
          };

          await supabase.from("video_render_shots").update({
            status: "complete",
            artifact_json: artifactJson,
            updated_at: new Date().toISOString(),
          }).eq("id", shot.id);

          completed++;
        } else if (result.error) {
          await supabase.from("video_render_shots").update({
            status: "error",
            last_error: result.error.message || "Veo generation error",
            updated_at: new Date().toISOString(),
          }).eq("id", shot.id);
          errored++;
        }
        // else still running — no update needed
      } catch (err: any) {
        // Transient poll error — don't mark as failed
        console.error(`Poll error for shot ${shot.id}:`, err.message);
      }
    }
  }

  return new Response(
    JSON.stringify({ polled, completed, errored }),
    { headers: { ...corsHeaders, "Content-Type": "application/json" } }
  );
}
