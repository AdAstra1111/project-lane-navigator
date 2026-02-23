/**
 * trailer-clip-generator v2 — Two-provider clip generation with job queue.
 * Providers: Veo (Google, primary), Runway (hero beats), ElevenLabs (audio), Stub (fallback).
 * Actions: enqueue_for_run, claim_next_job, process_job, progress, retry_job, cancel_job,
 *          select_clip, list_clips, list_jobs
 */
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const STORAGE_BUCKET = "trailers";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function parseUserId(token: string): string {
  const payload = JSON.parse(atob(token.split(".")[1]));
  if (!payload.sub || (payload.exp && payload.exp < Date.now() / 1000)) throw new Error("expired");
  return payload.sub;
}

function adminClient() {
  return createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
}

async function verifyAccess(db: any, userId: string, projectId: string): Promise<boolean> {
  const { data } = await db.rpc("has_project_access", { _user_id: userId, _project_id: projectId });
  return !!data;
}

// ─── Helpers ───

async function sha256Short(input: string): Promise<string> {
  const encoded = new TextEncoder().encode(input);
  const hash = await crypto.subtle.digest("SHA-256", encoded);
  return Array.from(new Uint8Array(hash)).map(b => b.toString(16).padStart(2, "0")).join("").slice(0, 40);
}

function sleep(ms: number): Promise<void> {
  return new Promise(r => setTimeout(r, ms));
}

async function logEvent(db: any, e: {
  project_id: string; blueprint_id: string; beat_index?: number;
  job_id?: string; clip_id?: string; clip_run_id?: string;
  event_type: string; payload?: any; created_by: string;
}) {
  await db.from("trailer_clip_events").insert({
    project_id: e.project_id,
    blueprint_id: e.blueprint_id,
    beat_index: e.beat_index ?? null,
    job_id: e.job_id ?? null,
    clip_id: e.clip_id ?? null,
    clip_run_id: e.clip_run_id ?? null,
    event_type: e.event_type,
    payload: e.payload || {},
    created_by: e.created_by,
  });
}

// ─── Provider: Veo (Google Gemini Video) ───

async function callVeo(params: {
  prompt: string; lengthMs: number; aspectRatio: string; fps: number;
  seed: string; initImagePaths: string[]; paramsJson: any;
}): Promise<{ videoUrl?: string; providerJobId?: string; model: string; status: string }> {
  const apiKey = Deno.env.get("VEO_API_KEY") || Deno.env.get("GOOGLE_API_KEY");
  if (!apiKey) throw new Error("VEO_API_KEY not configured — using stub mode");

  // Veo 2 via Gemini API (generativelanguage)
  // POST https://generativelanguage.googleapis.com/v1beta/models/veo-2.0-generate-001:predictLongRunning
  const model = "veo-2.0-generate-001";
  const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${model}:predictLongRunning?key=${apiKey}`;

  const durationSec = Math.max(5, Math.min(8, Math.round(params.lengthMs / 1000)));

  const body: any = {
    instances: [{
      prompt: params.prompt,
    }],
    parameters: {
      aspectRatio: params.aspectRatio,
      durationSeconds: durationSec,
    },
  };

  console.log(`[Veo] Calling ${endpoint.replace(apiKey, 'REDACTED')} with duration=${durationSec}s`);

  const resp = await fetch(endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  if (!resp.ok) {
    const errText = await resp.text();
    console.error(`[Veo] API error ${resp.status}:`, errText.slice(0, 800));
    throw new Error(`Veo API error ${resp.status}: ${errText.slice(0, 500)}`);
  }

  const result = await resp.json();
  console.log(`[Veo] Response:`, JSON.stringify(result).slice(0, 1000));

  // Veo returns a long-running operation — we need to poll
  if (result.name) {
    return { providerJobId: result.name, model, status: "polling" };
  }

  // Direct result (unlikely for video but handle it)
  const videoUri = result?.predictions?.[0]?.videoUri;
  if (videoUri) {
    return { videoUrl: videoUri, model, status: "complete" };
  }

  throw new Error("Unexpected Veo response format: " + JSON.stringify(result).slice(0, 500));
}

async function pollVeo(operationName: string): Promise<{ videoUrl?: string; status: string }> {
  const apiKey = Deno.env.get("VEO_API_KEY") || Deno.env.get("GOOGLE_API_KEY");
  if (!apiKey) throw new Error("VEO_API_KEY not configured");

  const endpoint = `https://generativelanguage.googleapis.com/v1beta/${operationName}?key=${apiKey}`;
  const resp = await fetch(endpoint);
  if (!resp.ok) {
    const errText = await resp.text();
    console.error(`[Veo poll] Error ${resp.status}:`, errText.slice(0, 500));
    throw new Error(`Veo poll error ${resp.status}`);
  }

  const result = await resp.json();
  console.log(`[Veo poll] Response:`, JSON.stringify(result).slice(0, 1500));

  if (result.done) {
    // Try multiple known response shapes
    const videoUri = result.response?.predictions?.[0]?.videoUri ||
                     result.response?.generatedSamples?.[0]?.video?.uri ||
                     result.response?.generateVideoResponse?.generatedSamples?.[0]?.video?.uri ||
                     result.metadata?.generatedSamples?.[0]?.video?.uri;
    if (videoUri) return { videoUrl: videoUri, status: "complete" };
    if (result.error) throw new Error(`Veo generation failed: ${result.error.message}`);
    // Log full response for debugging
    console.error(`[Veo poll] Done but no video URI found. Full response:`, JSON.stringify(result));
    throw new Error("Veo completed but no video returned. Response: " + JSON.stringify(result).slice(0, 500));
  }
  return { status: "polling" };
}

// ─── Provider: Runway ───

async function callRunway(params: {
  prompt: string; lengthMs: number; aspectRatio: string;
  seed: string; initImagePaths: string[]; paramsJson: any;
}): Promise<{ videoUrl?: string; providerJobId?: string; model: string; status: string }> {
  const apiKey = Deno.env.get("RUNWAY_API_KEY");
  if (!apiKey) throw new Error("RUNWAY_API_KEY not configured — using stub mode");

  const model = "gen4.5";
  const durationSec = Math.max(5, Math.min(10, Math.round(params.lengthMs / 1000)));

  const body: any = {
    model,
    promptText: params.prompt,
    duration: durationSec,
    ratio: params.aspectRatio === "16:9" ? "1280:720" : params.aspectRatio,
  };

  const resp = await fetch("https://api.dev.runwayml.com/v1/text_to_video", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      "X-Runway-Version": "2024-11-06",
    },
    body: JSON.stringify(body),
  });

  if (!resp.ok) {
    const errText = await resp.text();
    throw new Error(`Runway API error ${resp.status}: ${errText.slice(0, 500)}`);
  }

  const result = await resp.json();
  return { providerJobId: result.id, model, status: "polling" };
}

async function pollRunway(taskId: string): Promise<{ videoUrl?: string; status: string }> {
  const apiKey = Deno.env.get("RUNWAY_API_KEY");
  if (!apiKey) throw new Error("RUNWAY_API_KEY not configured");

  const resp = await fetch(`https://api.dev.runwayml.com/v1/tasks/${taskId}`, {
    headers: {
      "Authorization": `Bearer ${apiKey}`,
      "X-Runway-Version": "2024-11-06",
    },
  });
  if (!resp.ok) throw new Error(`Runway poll error ${resp.status}`);

  const result = await resp.json();
  if (result.status === "SUCCEEDED") {
    const videoUrl = result.output?.[0];
    if (videoUrl) return { videoUrl, status: "complete" };
    throw new Error("Runway completed but no video URL");
  }
  if (result.status === "FAILED") {
    throw new Error(`Runway generation failed: ${result.failure || "unknown"}`);
  }
  return { status: "polling" };
}

// ─── Provider: Stub (placeholder when no keys) ───

function generateStubVideo(): { bytes: Uint8Array; mimeType: string } {
  // Return a tiny 1x1 PNG as placeholder
  const png = new Uint8Array([
    0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d,
    0x49, 0x48, 0x44, 0x52, 0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01,
    0x08, 0x02, 0x00, 0x00, 0x00, 0x90, 0x77, 0x53, 0xde, 0x00, 0x00, 0x00,
    0x0c, 0x49, 0x44, 0x41, 0x54, 0x08, 0xd7, 0x63, 0xf8, 0xcf, 0xc0, 0x00,
    0x00, 0x00, 0x02, 0x00, 0x01, 0xe2, 0x21, 0xbc, 0x33, 0x00, 0x00, 0x00,
    0x00, 0x49, 0x45, 0x4e, 0x44, 0xae, 0x42, 0x60, 0x82,
  ]);
  return { bytes: png, mimeType: "image/png" };
}

// ─── Action: enqueue_for_run ───

async function handleEnqueueForRun(db: any, body: any, userId: string) {
  const { projectId, blueprintId, force = false, enabledProviders, beatIndices } = body;
  if (!blueprintId) return json({ error: "blueprintId required" }, 400);

  // Provider filter: if enabledProviders is provided, only use those providers
  const allowedProviders: Set<string> | null = Array.isArray(enabledProviders) && enabledProviders.length > 0
    ? new Set(enabledProviders as string[])
    : null;

  const { data: bp } = await db.from("trailer_blueprints")
    .select("id, edl, status")
    .eq("id", blueprintId).eq("project_id", projectId).single();
  if (!bp) return json({ error: "Blueprint not found" }, 404);
  if (bp.status !== "complete") return json({ error: "Blueprint not complete" }, 400);

  const edl = bp.edl || [];
  if (edl.length === 0) return json({ error: "Blueprint has no beats" }, 400);

  // Create clip run
  const { data: clipRun, error: crErr } = await db.from("trailer_clip_runs").insert({
    project_id: projectId,
    blueprint_id: blueprintId,
    created_by: userId,
    status: "running",
    total_jobs: 0,
  }).select().single();
  if (crErr) return json({ error: crErr.message }, 500);

  let totalJobs = 0;
  const jobsToInsert: any[] = [];

  // Optional beat filter
  const beatFilter: Set<number> | null = Array.isArray(beatIndices) && beatIndices.length > 0
    ? new Set(beatIndices as number[])
    : null;

  for (let beatIndex = 0; beatIndex < edl.length; beatIndex++) {
    if (beatFilter && !beatFilter.has(beatIndex)) continue;
    const beat = edl[beatIndex];
    const hint = beat.generator_hint || {};
    let provider = hint.preferred_provider || "veo";

    // Override provider if not in allowed set — fallback to first allowed provider
    if (allowedProviders && !allowedProviders.has(provider)) {
      provider = allowedProviders.values().next().value || "veo";
    }
    const mode = hint.preferred_mode || "text_to_video";
    const candidates = hint.candidates || 1;
    const lengthMs = hint.length_ms || Math.round((beat.duration_s || 3) * 1000);
    const aspectRatio = hint.aspect_ratio || "16:9";
    const fps = hint.fps || 24;

    // Build prompt from clip_spec
    const cs = beat.clip_spec || {};
    const prompt = cs.visual_prompt || cs.action_description ||
      `${beat.role}: ${cs.shot_type || ""} ${cs.camera_move || ""} — ${cs.action_description || "cinematic scene"}`;

    for (let ci = 1; ci <= candidates; ci++) {
      const seedBase = force ? `${blueprintId}-${beatIndex}-${ci}-${Date.now()}` : `${blueprintId}-${beatIndex}-${ci}`;
      const seed = seedBase;

      const idemInput = `${projectId}|${blueprintId}|${beatIndex}|${provider}|${mode}|${ci}|${lengthMs}|${seed}`;
      const idempotencyKey = await sha256Short(idemInput);

      jobsToInsert.push({
        project_id: projectId,
        blueprint_id: blueprintId,
        beat_index: beatIndex,
        clip_run_id: clipRun.id,
        provider,
        mode,
        candidate_index: ci,
        length_ms: lengthMs,
        aspect_ratio: aspectRatio,
        fps,
        seed,
        prompt,
        init_image_paths: [],
        params_json: { beat_role: beat.role, clip_spec: cs, generator_hint: hint },
        status: "queued",
        attempt: 0,
        idempotency_key: idempotencyKey,
      });
      totalJobs++;
    }
  }

  // Batch insert (ON CONFLICT skip for idempotency unless force)
  if (jobsToInsert.length > 0) {
    const { error: insertErr } = await db.from("trailer_clip_jobs").upsert(jobsToInsert, {
      onConflict: "idempotency_key",
      ignoreDuplicates: !force,
    });
    if (insertErr) {
      console.error("Job insert error:", insertErr);
      // Try one-by-one for partial success
      for (const job of jobsToInsert) {
        await db.from("trailer_clip_jobs").upsert(job, {
          onConflict: "idempotency_key",
          ignoreDuplicates: true,
        });
      }
    }
  }

  // Update run totals
  await db.from("trailer_clip_runs").update({ total_jobs: totalJobs }).eq("id", clipRun.id);

  await logEvent(db, {
    project_id: projectId, blueprint_id: blueprintId,
    clip_run_id: clipRun.id,
    event_type: "enqueue_for_run",
    payload: { totalJobs, force, beatCount: edl.length },
    created_by: userId,
  });

  return json({ ok: true, clipRunId: clipRun.id, totalJobs });
}

// ─── Action: claim_next_job ───

async function handleClaimNextJob(db: any, body: any) {
  const { projectId, blueprintId } = body;
  if (!blueprintId) return json({ error: "blueprintId required" }, 400);

  const { data: jobId } = await db.rpc("claim_next_trailer_clip_job", {
    _project_id: projectId,
    _blueprint_id: blueprintId,
  });

  if (!jobId) return json({ ok: true, job: null, message: "No queued jobs" });

  const { data: job } = await db.from("trailer_clip_jobs").select("*").eq("id", jobId).single();
  return json({ ok: true, job });
}

// ─── Action: process_job ───

async function handleProcessJob(db: any, body: any, userId: string) {
  const { projectId, jobId } = body;
  if (!jobId) return json({ error: "jobId required" }, 400);

  const { data: job } = await db.from("trailer_clip_jobs").select("*")
    .eq("id", jobId).eq("project_id", projectId).single();
  if (!job) return json({ error: "Job not found" }, 404);
  if (job.status !== "running") return json({ error: `Job status is ${job.status}, expected running` }, 400);

  const useStub = Deno.env.get("CLIP_GEN_PROVIDER_STUB") === "true";

  try {
    // ── Stub mode ──
    if (useStub || (job.provider === "veo" && !Deno.env.get("VEO_API_KEY") && !Deno.env.get("GOOGLE_API_KEY")) ||
        (job.provider === "runway" && !Deno.env.get("RUNWAY_API_KEY"))) {
      const { bytes, mimeType } = generateStubVideo();
      const storagePath = `${projectId}/clips/${job.blueprint_id}/${job.beat_index}/${jobId}.png`;
      const blob = new Blob([bytes], { type: mimeType });
      await db.storage.from(STORAGE_BUCKET).upload(storagePath, blob, { contentType: mimeType, upsert: true });
      return await finalizeClip(db, job, jobId, projectId, userId, storagePath, mimeType, "stub");
    }

    // ── Real provider: fire-and-forget ──
    if (job.provider === "veo") {
      const veoResult = await callVeo({
        prompt: job.prompt, lengthMs: job.length_ms, aspectRatio: job.aspect_ratio,
        fps: job.fps, seed: job.seed, initImagePaths: job.init_image_paths || [],
        paramsJson: job.params_json || {},
      });

      if (veoResult.status === "polling" && veoResult.providerJobId) {
        // Save provider job ID and set status to "polling" — return immediately
        await db.from("trailer_clip_jobs").update({
          provider_job_id: veoResult.providerJobId,
          status: "polling",
        }).eq("id", jobId);
        console.log(`[process_job] Veo submitted, polling: ${veoResult.providerJobId}`);
        return json({ ok: true, status: "polling", providerJobId: veoResult.providerJobId });
      }
      // Direct result (unlikely)
      if (veoResult.videoUrl) {
        const storagePath = await downloadAndStore(db, veoResult.videoUrl, projectId, job.blueprint_id, job.beat_index, jobId);
        return await finalizeClip(db, job, jobId, projectId, userId, storagePath, "video/mp4", veoResult.model);
      }
    } else if (job.provider === "runway") {
      const rwResult = await callRunway({
        prompt: job.prompt, lengthMs: job.length_ms, aspectRatio: job.aspect_ratio,
        seed: job.seed, initImagePaths: job.init_image_paths || [],
        paramsJson: job.params_json || {},
      });

      if (rwResult.status === "polling" && rwResult.providerJobId) {
        await db.from("trailer_clip_jobs").update({
          provider_job_id: rwResult.providerJobId,
          status: "polling",
        }).eq("id", jobId);
        return json({ ok: true, status: "polling", providerJobId: rwResult.providerJobId });
      }
    } else {
      throw new Error(`Unknown provider: ${job.provider}`);
    }

    throw new Error("Provider returned no job ID or video URL");
  } catch (err: any) {
    console.error(`[process_job] Error:`, err.message);
    await markJobFailed(db, job, jobId, projectId, userId, err.message);
    return json({ error: err.message }, 500);
  }
}

// ─── Helper: download video and store ───

async function downloadAndStore(db: any, videoUrl: string, projectId: string, blueprintId: string, beatIndex: number, jobId: string): Promise<string> {
  // Google generativelanguage file URIs require the API key
  const apiKey = Deno.env.get("VEO_API_KEY") || Deno.env.get("GOOGLE_API_KEY") || "";
  let fetchUrl = videoUrl;
  if (videoUrl.includes("generativelanguage.googleapis.com") && !videoUrl.includes("key=")) {
    fetchUrl += (videoUrl.includes("?") ? "&" : "?") + `key=${apiKey}`;
  }
  console.log(`[download] Fetching video from ${fetchUrl.replace(apiKey, 'REDACTED')}`);
  const videoResp = await fetch(fetchUrl);
  if (!videoResp.ok) {
    const errText = await videoResp.text();
    console.error(`[download] Failed ${videoResp.status}:`, errText.slice(0, 500));
    throw new Error(`Failed to download video (${videoResp.status})`);
  }
  const videoBytes = await videoResp.arrayBuffer();
  const storagePath = `${projectId}/clips/${blueprintId}/${beatIndex}/${jobId}.mp4`;
  const blob = new Blob([videoBytes], { type: "video/mp4" });
  await db.storage.from(STORAGE_BUCKET).upload(storagePath, blob, { contentType: "video/mp4", upsert: true });
  console.log(`[download] Stored ${storagePath} (${videoBytes.byteLength} bytes)`);
  return storagePath;
}

// ─── Helper: finalize a completed clip ───

async function finalizeClip(db: any, job: any, jobId: string, projectId: string, userId: string, storagePath: string, contentType: string, model: string) {
  const { data: pubData } = db.storage.from(STORAGE_BUCKET).getPublicUrl(storagePath);
  const publicUrl = pubData?.publicUrl || "";

  const { data: clip } = await db.from("trailer_clips").insert({
    project_id: projectId, blueprint_id: job.blueprint_id, beat_index: job.beat_index,
    provider: job.provider, status: "complete", media_type: contentType.startsWith("video") ? "video" : "image",
    storage_path: storagePath, public_url: publicUrl, duration_ms: job.length_ms,
    gen_params: job.params_json, created_by: userId, job_id: jobId,
    clip_run_id: job.clip_run_id, candidate_index: job.candidate_index,
    seed: job.seed, model, mode: job.mode, aspect_ratio: job.aspect_ratio, fps: job.fps,
  }).select().single();

  await db.from("trailer_clip_jobs").update({ status: "succeeded" }).eq("id", jobId);
  await updateRunCounters(db, job.clip_run_id);

  await logEvent(db, {
    project_id: projectId, blueprint_id: job.blueprint_id,
    beat_index: job.beat_index, job_id: jobId, clip_id: clip?.id,
    event_type: "job_succeeded",
    payload: { provider: job.provider, model, candidate_index: job.candidate_index },
    created_by: userId,
  });

  return json({ ok: true, clipId: clip?.id, publicUrl });
}

// ─── Helper: mark job failed ───

async function markJobFailed(db: any, job: any, jobId: string, projectId: string, userId: string, errorMsg: string) {
  await db.from("trailer_clip_jobs").update({ status: "failed", error: errorMsg }).eq("id", jobId);
  await updateRunCounters(db, job.clip_run_id);
  await logEvent(db, {
    project_id: projectId, blueprint_id: job.blueprint_id,
    beat_index: job.beat_index, job_id: jobId,
    event_type: "job_failed",
    payload: { provider: job.provider, error: errorMsg, attempt: job.attempt },
    created_by: userId,
  });
}

// ─── Helper: update run counters ───

async function updateRunCounters(db: any, clipRunId: string | null) {
  if (!clipRunId) return;
  const { data: runJobs } = await db.from("trailer_clip_jobs")
    .select("status").eq("clip_run_id", clipRunId);
  const done = (runJobs || []).filter((j: any) => j.status === "succeeded").length;
  const failed = (runJobs || []).filter((j: any) => j.status === "failed").length;
  const allDone = (runJobs || []).every((j: any) => ["succeeded", "failed", "canceled"].includes(j.status));
  await db.from("trailer_clip_runs").update({
    done_jobs: done, failed_jobs: failed,
    status: allDone ? "complete" : "running",
  }).eq("id", clipRunId);
}

// ─── Action: poll_pending_jobs ───

async function handlePollPendingJobs(db: any, body: any, userId: string) {
  const { projectId, blueprintId } = body;
  if (!blueprintId) return json({ error: "blueprintId required" }, 400);

  const { data: pollingJobs } = await db.from("trailer_clip_jobs")
    .select("*")
    .eq("project_id", projectId)
    .eq("blueprint_id", blueprintId)
    .eq("status", "polling");

  if (!pollingJobs || pollingJobs.length === 0) {
    return json({ ok: true, polled: 0, completed: 0, stillPolling: 0 });
  }

  let completed = 0;
  let stillPolling = 0;
  let failed = 0;

  for (const job of pollingJobs) {
    try {
      let pollResult: { videoUrl?: string; status: string };

      if (job.provider === "veo") {
        pollResult = await pollVeo(job.provider_job_id);
      } else if (job.provider === "runway") {
        pollResult = await pollRunway(job.provider_job_id);
      } else {
        continue;
      }

      if (pollResult.status === "complete" && pollResult.videoUrl) {
        const storagePath = await downloadAndStore(db, pollResult.videoUrl, projectId, job.blueprint_id, job.beat_index, job.id);
        await finalizeClip(db, job, job.id, projectId, userId, storagePath, "video/mp4", job.provider === "veo" ? "veo-2.0-generate-001" : "gen4.5");
        completed++;
      } else {
        stillPolling++;
        // Check if job has been polling too long (>10 min)
        const claimedAt = new Date(job.claimed_at).getTime();
        if (Date.now() - claimedAt > 10 * 60 * 1000) {
          await markJobFailed(db, job, job.id, projectId, userId, "Veo generation timed out after 10 minutes");
          failed++;
          stillPolling--;
        }
      }
    } catch (err: any) {
      console.error(`[poll_pending] Job ${job.id} error:`, err.message);
      await markJobFailed(db, job, job.id, projectId, userId, err.message);
      failed++;
    }
  }

  return json({ ok: true, polled: pollingJobs.length, completed, stillPolling, failed });
}

// ─── Action: progress ───

async function handleProgress(db: any, body: any) {
  const { projectId, blueprintId } = body;
  if (!blueprintId) return json({ error: "blueprintId required" }, 400);

  const { data: jobs } = await db.from("trailer_clip_jobs").select("id, beat_index, status, provider, candidate_index")
    .eq("project_id", projectId).eq("blueprint_id", blueprintId);

  const { data: clips } = await db.from("trailer_clips").select("beat_index, selected, id, provider, candidate_index, public_url, status")
    .eq("project_id", projectId).eq("blueprint_id", blueprintId);

  const counts: Record<string, number> = { queued: 0, running: 0, polling: 0, succeeded: 0, failed: 0, canceled: 0, total: 0 };
  for (const j of (jobs || [])) {
    counts.total++;
    counts[j.status as keyof typeof counts] = ((counts[j.status as keyof typeof counts] as number) || 0) + 1;
  }

  // Per-beat summary
  const beatSummary: Record<number, any> = {};
  for (const j of (jobs || [])) {
    if (!beatSummary[j.beat_index]) beatSummary[j.beat_index] = { jobs: [], clips: [], selectedClipId: null };
    beatSummary[j.beat_index].jobs.push(j);
  }
  for (const c of (clips || [])) {
    if (!beatSummary[c.beat_index]) beatSummary[c.beat_index] = { jobs: [], clips: [], selectedClipId: null };
    beatSummary[c.beat_index].clips.push(c);
    if (c.selected) beatSummary[c.beat_index].selectedClipId = c.id;
  }

  // Clip runs
  const { data: runs } = await db.from("trailer_clip_runs").select("*")
    .eq("blueprint_id", blueprintId).order("created_at", { ascending: false }).limit(5);

  return json({ ok: true, counts, beatSummary, clipCount: (clips || []).length, runs: runs || [] });
}

// ─── Action: retry_job ───

async function handleRetryJob(db: any, body: any, userId: string) {
  const { projectId, jobId } = body;
  if (!jobId) return json({ error: "jobId required" }, 400);

  const { data: job } = await db.from("trailer_clip_jobs").select("*")
    .eq("id", jobId).eq("project_id", projectId).single();
  if (!job) return json({ error: "Job not found" }, 404);
  if (job.status !== "failed") return json({ error: "Can only retry failed jobs" }, 400);
  if (job.attempt >= job.max_attempts) return json({ error: `Max attempts (${job.max_attempts}) reached` }, 400);

  await db.from("trailer_clip_jobs").update({
    status: "queued", error: null, provider_job_id: null, claimed_at: null,
  }).eq("id", jobId);

  await logEvent(db, {
    project_id: projectId, blueprint_id: job.blueprint_id,
    beat_index: job.beat_index, job_id: jobId,
    event_type: "job_retried", payload: { attempt: job.attempt },
    created_by: userId,
  });

  return json({ ok: true });
}

// ─── Action: cancel_job ───

async function handleCancelJob(db: any, body: any, userId: string) {
  const { projectId, jobId } = body;
  if (!jobId) return json({ error: "jobId required" }, 400);

  const { data: job } = await db.from("trailer_clip_jobs").select("*")
    .eq("id", jobId).eq("project_id", projectId).single();
  if (!job) return json({ error: "Job not found" }, 404);
  if (!["queued", "running"].includes(job.status)) return json({ error: "Can only cancel queued/running jobs" }, 400);

  await db.from("trailer_clip_jobs").update({ status: "canceled" }).eq("id", jobId);

  await logEvent(db, {
    project_id: projectId, blueprint_id: job.blueprint_id,
    beat_index: job.beat_index, job_id: jobId,
    event_type: "job_canceled", created_by: userId,
  });

  return json({ ok: true });
}

// ─── Action: select_clip ───

async function handleSelectClip(db: any, body: any, userId: string) {
  const { projectId, clipId, blueprintId, beatIndex } = body;
  if (!clipId) return json({ error: "clipId required" }, 400);

  // Deselect all for same beat
  await db.from("trailer_clips")
    .update({ used_in_cut: false, selected: false })
    .eq("blueprint_id", blueprintId).eq("beat_index", beatIndex).eq("project_id", projectId);

  // Select this one
  await db.from("trailer_clips")
    .update({ used_in_cut: true, selected: true, status: "selected" })
    .eq("id", clipId).eq("project_id", projectId);

  await logEvent(db, {
    project_id: projectId, blueprint_id: blueprintId,
    beat_index: beatIndex, clip_id: clipId,
    event_type: "clip_selected", created_by: userId,
  });

  return json({ ok: true });
}

// ─── Action: list_clips ───

async function handleListClips(db: any, body: any) {
  const { projectId, blueprintId } = body;
  if (!blueprintId) return json({ error: "blueprintId required" }, 400);
  const { data } = await db.from("trailer_clips").select("*")
    .eq("project_id", projectId).eq("blueprint_id", blueprintId)
    .order("beat_index").order("candidate_index");
  return json({ clips: data || [] });
}

// ─── Action: list_jobs ───

async function handleListJobs(db: any, body: any) {
  const { projectId, blueprintId } = body;
  if (!blueprintId) return json({ error: "blueprintId required" }, 400);
  const { data } = await db.from("trailer_clip_jobs").select("*")
    .eq("project_id", projectId).eq("blueprint_id", blueprintId)
    .order("beat_index").order("candidate_index");
  return json({ jobs: data || [] });
}

// ─── Action: process_queue (batch process N jobs) ───

async function handleProcessQueue(db: any, body: any, userId: string) {
  const { projectId, blueprintId, maxJobs = 2 } = body;
  if (!blueprintId) return json({ error: "blueprintId required" }, 400);

  const results: any[] = [];

  for (let i = 0; i < maxJobs; i++) {
    const { data: jobId } = await db.rpc("claim_next_trailer_clip_job", {
      _project_id: projectId,
      _blueprint_id: blueprintId,
    });
    if (!jobId) break;

    const processResult = await handleProcessJob(db, { projectId, jobId }, userId);
    const resultBody = await processResult.json();
    results.push({ jobId, ...resultBody });

    // Delay between jobs to avoid Veo 429 rate limits
    if (i < maxJobs - 1) await sleep(3000);
  }

  return json({ ok: true, processed: results.length, results });
}

// ─── Action: cancel_all (stop all queued/running jobs) ───

async function handleCancelAll(db: any, body: any, userId: string) {
  const { projectId, blueprintId } = body;
  if (!blueprintId) return json({ error: "blueprintId required" }, 400);

  const { data: affected } = await db.from("trailer_clip_jobs")
    .update({ status: "canceled" })
    .eq("project_id", projectId)
    .eq("blueprint_id", blueprintId)
    .in("status", ["queued", "running"])
    .select("id");

  const count = (affected || []).length;

  // Update any active clip runs to reflect cancellation
  await db.from("trailer_clip_runs")
    .update({ status: "canceled" })
    .eq("blueprint_id", blueprintId)
    .eq("status", "running");

  await logEvent(db, {
    project_id: projectId, blueprint_id: blueprintId,
    event_type: "cancel_all",
    payload: { canceledCount: count },
    created_by: userId,
  });

  return json({ ok: true, canceled: count });
}

// ─── Action: reset_failed (re-queue all failed jobs) ───

async function handleResetFailed(db: any, body: any, userId: string) {
  const { projectId, blueprintId } = body;
  if (!blueprintId) return json({ error: "blueprintId required" }, 400);

  const { data: affected } = await db.from("trailer_clip_jobs")
    .update({ status: "queued", error: null, provider_job_id: null, claimed_at: null })
    .eq("project_id", projectId)
    .eq("blueprint_id", blueprintId)
    .eq("status", "failed")
    .select("id");

  const count = (affected || []).length;

  await logEvent(db, {
    project_id: projectId, blueprint_id: blueprintId,
    event_type: "reset_failed",
    payload: { resetCount: count },
    created_by: userId,
  });

  return json({ ok: true, reset: count });
}

// ─── Action: test_veo (diagnostic) ───

async function handleTestVeo() {
  const apiKey = Deno.env.get("VEO_API_KEY") || Deno.env.get("GOOGLE_API_KEY");
  if (!apiKey) return json({ error: "VEO_API_KEY not configured", keyPresent: false }, 400);

  const model = "veo-2.0-generate-001";
  const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${model}:predictLongRunning?key=${apiKey}`;

  const body = {
    instances: [{ prompt: "A calm ocean wave at sunset, cinematic, 4K" }],
    parameters: { aspectRatio: "16:9", durationSeconds: 5 },
  };

  console.log(`[test_veo] Calling Veo API...`);

  try {
    const resp = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

    const text = await resp.text();
    console.log(`[test_veo] Status: ${resp.status}, Response: ${text.slice(0, 2000)}`);

    let parsed: any = null;
    try { parsed = JSON.parse(text); } catch {}

    return json({
      ok: resp.ok,
      status: resp.status,
      keyPresent: true,
      keyPrefix: apiKey.slice(0, 8) + "...",
      response: parsed || text.slice(0, 1000),
    }, resp.ok ? 200 : 400);
  } catch (err: any) {
    console.error(`[test_veo] Fetch error:`, err.message);
    return json({ error: err.message, keyPresent: true }, 500);
  }
}

// ─── Main handler ───

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const authHeader = req.headers.get("Authorization") || "";
    if (!authHeader.startsWith("Bearer ")) return json({ error: "Unauthorized" }, 401);
    const token = authHeader.replace("Bearer ", "");
    let userId: string;
    try { userId = parseUserId(token); } catch { return json({ error: "Invalid token" }, 401); }

    const body = await req.json();
    const action = body.action;

    // test_veo doesn't need projectId
    if (action === "test_veo") return await handleTestVeo();

    const projectId = body.projectId || body.project_id;
    if (!projectId) return json({ error: "projectId required" }, 400);

    const db = adminClient();
    const hasAccess = await verifyAccess(db, userId, projectId);
    if (!hasAccess) return json({ error: "Forbidden" }, 403);

    switch (action) {
      case "test_veo": return await handleTestVeo();
      case "enqueue_for_run": return await handleEnqueueForRun(db, body, userId);
      case "claim_next_job": return await handleClaimNextJob(db, body);
      case "process_job": return await handleProcessJob(db, body, userId);
      case "process_queue": return await handleProcessQueue(db, body, userId);
      case "progress": return await handleProgress(db, body);
      case "poll_pending_jobs": return await handlePollPendingJobs(db, body, userId);
      case "retry_job": return await handleRetryJob(db, body, userId);
      case "cancel_job": return await handleCancelJob(db, body, userId);
      case "cancel_all": return await handleCancelAll(db, body, userId);
      case "reset_failed": return await handleResetFailed(db, body, userId);
      case "select_clip": return await handleSelectClip(db, body, userId);
      case "list_clips": return await handleListClips(db, body);
      case "list_jobs": return await handleListJobs(db, body);
      default: return json({ error: `Unknown action: ${action}` }, 400);
    }
  } catch (err: any) {
    console.error("trailer-clip-generator error:", err);
    return json({ error: err.message || "Internal error" }, 500);
  }
});
