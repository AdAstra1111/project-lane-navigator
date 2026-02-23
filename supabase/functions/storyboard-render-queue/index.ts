/**
 * storyboard-render-queue — Render queue worker for Storyboard Pipeline.
 * Enqueues render jobs, claims them atomically, processes via image generation.
 */
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const GATEWAY_URL = "https://ai.gateway.lovable.dev/v1/chat/completions";
const IMAGE_MODEL = "google/gemini-2.5-flash-image";
const STORAGE_BUCKET = "storyboards";

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
  const { data, error } = await db.rpc("has_project_access", { _user_id: userId, _project_id: projectId });
  if (error) {
    const { data: proj } = await db.from("projects").select("id").eq("id", projectId).eq("user_id", userId).limit(1).maybeSingle();
    if (proj) return true;
    const { data: collab } = await db.from("project_collaborators").select("id").eq("project_id", projectId).eq("user_id", userId).eq("status", "accepted").limit(1).maybeSingle();
    return !!collab;
  }
  return !!data;
}

function extractDataUrl(genResult: any): string | null {
  try {
    const choice = genResult?.choices?.[0]?.message;
    if (!choice) return null;
    const imgUrl1 = choice.images?.[0]?.image_url?.url;
    if (imgUrl1 && imgUrl1.startsWith("data:image")) return imgUrl1;
    if (Array.isArray(choice.content)) {
      for (const part of choice.content) {
        if (part.type === "image_url" && part.image_url?.url?.startsWith("data:image")) return part.image_url.url;
        if (part.type === "image" && part.image?.url?.startsWith("data:image")) return part.image.url;
        if (part.inline_data?.data) return `data:${part.inline_data.mime_type || "image/png"};base64,${part.inline_data.data}`;
        if (typeof part === "string" && part.startsWith("data:image")) return part;
        if (typeof part.text === "string" && part.text.startsWith("data:image")) return part.text;
      }
    }
    if (typeof choice.content === "string" && choice.content.startsWith("data:image")) return choice.content;
  } catch (_e) { /* ignore */ }
  return null;
}

function dataUrlToBytes(dataUrl: string): Uint8Array {
  const base64Part = dataUrl.split(",")[1];
  if (!base64Part) throw new Error("Invalid data URL");
  const binaryStr = atob(base64Part);
  const bytes = new Uint8Array(binaryStr.length);
  for (let i = 0; i < binaryStr.length; i++) bytes[i] = binaryStr.charCodeAt(i);
  return bytes;
}

// ─── Update render run counters from actual job statuses ───
async function refreshRenderRunCounters(db: any, renderRunId: string) {
  const { data: jobs } = await db.from("storyboard_render_jobs")
    .select("status")
    .eq("render_run_id", renderRunId);
  if (!jobs) return;
  const counts = { queued: 0, running: 0, succeeded: 0, failed: 0, canceled: 0 };
  for (const j of jobs) counts[j.status as keyof typeof counts] = (counts[j.status as keyof typeof counts] || 0) + 1;
  const total = jobs.length;
  const done = counts.succeeded + counts.failed + counts.canceled;
  const update: any = { total, queued: counts.queued, running: counts.running, succeeded: counts.succeeded, failed: counts.failed };
  if (done >= total && total > 0) {
    update.status = counts.failed > 0 ? "failed" : "complete";
    update.completed_at = new Date().toISOString();
    if (counts.failed > 0) {
      const { data: failedJobs } = await db.from("storyboard_render_jobs")
        .select("last_error").eq("render_run_id", renderRunId).eq("status", "failed").limit(1);
      update.last_error = failedJobs?.[0]?.last_error || "Some jobs failed";
    }
  }
  await db.from("storyboard_render_runs").update(update).eq("id", renderRunId);
}

// ─── ENQUEUE ───
async function handleEnqueue(db: any, body: any, userId: string) {
  const { projectId, runId, unitKeys, mode = "missing_only", priority = 100 } = body;
  if (!runId) return json({ error: "runId required" }, 400);

  // Fetch panels for this run
  let query = db.from("storyboard_panels").select("id, unit_key, status").eq("run_id", runId).eq("project_id", projectId);
  if (unitKeys && Array.isArray(unitKeys) && unitKeys.length > 0) {
    query = query.in("unit_key", unitKeys);
  }
  const { data: panels, error: pErr } = await query;
  if (pErr) return json({ error: pErr.message }, 500);
  if (!panels || panels.length === 0) return json({ error: "No panels found for this run" }, 400);

  let panelsToRender = panels;
  if (mode === "missing_only") {
    // Check which panels already have a successful frame
    const panelIds = panels.map((p: any) => p.id);
    const { data: existingFrames } = await db.from("storyboard_pipeline_frames")
      .select("panel_id").in("panel_id", panelIds).eq("status", "generated");
    const renderedPanelIds = new Set((existingFrames || []).map((f: any) => f.panel_id));
    panelsToRender = panels.filter((p: any) => p.status !== "generated" || !renderedPanelIds.has(p.id));
  }

  if (panelsToRender.length === 0) return json({ ok: true, renderRunId: null, totalEnqueued: 0, skippedAlreadyActive: 0, message: "All panels already rendered" });

  // Create render run
  const { data: renderRun, error: rrErr } = await db.from("storyboard_render_runs").insert({
    project_id: projectId,
    run_id: runId,
    unit_keys: unitKeys || null,
    status: "running",
    total: panelsToRender.length,
    queued: panelsToRender.length,
    created_by: userId,
  }).select().single();
  if (rrErr) return json({ error: "Failed to create render run: " + rrErr.message }, 500);

  // Insert jobs, skipping conflicts (partial unique index on panel_id WHERE status IN queued/running)
  let enqueued = 0;
  let skipped = 0;
  for (const panel of panelsToRender) {
    const { error: insertErr } = await db.from("storyboard_render_jobs").insert({
      project_id: projectId,
      run_id: runId,
      render_run_id: renderRun.id,
      panel_id: panel.id,
      unit_key: panel.unit_key,
      status: "queued",
      priority,
      created_by: userId,
    });
    if (insertErr) {
      if (insertErr.message?.includes("unique") || insertErr.code === "23505") {
        skipped++;
      } else {
        console.error("Job insert error:", insertErr);
        skipped++;
      }
    } else {
      enqueued++;
    }
  }

  // Update counters
  await db.from("storyboard_render_runs").update({ total: enqueued, queued: enqueued }).eq("id", renderRun.id);
  if (enqueued === 0) {
    await db.from("storyboard_render_runs").update({ status: "complete", completed_at: new Date().toISOString() }).eq("id", renderRun.id);
  }

  return json({ ok: true, renderRunId: renderRun.id, totalEnqueued: enqueued, skippedAlreadyActive: skipped });
}

// ─── CLAIM NEXT JOB ───
async function handleClaimNextJob(db: any, body: any, userId: string) {
  const { projectId, renderRunId } = body;
  const { data: jobs, error } = await db.rpc("claim_next_storyboard_render_job", {
    p_project_id: projectId,
    p_render_run_id: renderRunId || null,
    p_claimed_by: userId,
  });
  if (error) return json({ error: "Claim failed: " + error.message }, 500);
  const job = Array.isArray(jobs) ? jobs[0] : jobs;
  if (!job) return json({ job: null });
  // Update render run counters
  if (job.render_run_id) await refreshRenderRunCounters(db, job.render_run_id);
  return json({ job });
}

// ─── PROCESS JOB ───
async function handleProcessJob(db: any, body: any, userId: string, apiKey: string) {
  const { projectId, jobId } = body;
  if (!jobId) return json({ error: "jobId required" }, 400);

  const { data: job } = await db.from("storyboard_render_jobs").select("*").eq("id", jobId).single();
  if (!job) return json({ error: "Job not found" }, 404);
  if (job.status !== "running") return json({ error: "Job not in running state" }, 400);

  const panelId = job.panel_id;

  // Fetch panel + run style
  const { data: panel } = await db.from("storyboard_panels")
    .select("*, storyboard_runs(style_preset, aspect_ratio)")
    .eq("id", panelId).eq("project_id", projectId).single();

  if (!panel) {
    await db.from("storyboard_render_jobs").update({ status: "failed", last_error: "Panel not found", completed_at: new Date().toISOString() }).eq("id", jobId);
    if (job.render_run_id) await refreshRenderRunCounters(db, job.render_run_id);
    return json({ error: "Panel not found" }, 404);
  }

  const payload = panel.panel_payload || {};
  const run = panel.storyboard_runs || {};
  const stylePreset = run.style_preset || "cinematic_realism";
  const aspectRatio = run.aspect_ratio || "16:9";
  const basePrompt = payload.prompt || "A cinematic scene";
  const negativePrompt = payload.negative_prompt || "";

  const styleGuide: Record<string, string> = {
    cinematic_realism: "cinematic storyboard frame, film still, high detail, realistic lighting, professional cinematography",
    anime: "anime style storyboard, detailed animation key frame, vivid colors",
    noir: "film noir style, high contrast black and white, dramatic shadows, moody atmosphere",
    watercolor: "watercolor storyboard sketch, artistic, soft edges, painterly style",
  };
  const finalPrompt = `${basePrompt}. ${styleGuide[stylePreset] || styleGuide.cinematic_realism}. Aspect ratio ${aspectRatio}.${negativePrompt ? ` Avoid: ${negativePrompt}` : ""}`;

  try {
    const response = await fetch(GATEWAY_URL, {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: IMAGE_MODEL,
        messages: [{ role: "user", content: finalPrompt }],
        modalities: ["image", "text"],
      }),
    });

    if (!response.ok) {
      const errText = await response.text();
      const errMsg = `Image gen failed (${response.status}): ${errText.slice(0, 200)}`;
      if (job.attempts >= job.max_attempts) {
        await db.from("storyboard_render_jobs").update({ status: "failed", last_error: errMsg, completed_at: new Date().toISOString() }).eq("id", jobId);
        await db.from("storyboard_panels").update({ status: "failed" }).eq("id", panelId);
      } else {
        await db.from("storyboard_render_jobs").update({ status: "queued", last_error: errMsg, claimed_at: null, claimed_by: null }).eq("id", jobId);
      }
      if (job.render_run_id) await refreshRenderRunCounters(db, job.render_run_id);
      return json({ error: errMsg }, response.status === 429 ? 429 : 500);
    }

    const genResult = await response.json();
    const imageDataUrl = extractDataUrl(genResult);
    if (!imageDataUrl) {
      const errMsg = "No image in AI response";
      console.error(errMsg, JSON.stringify(Object.keys(genResult?.choices?.[0]?.message || {})));
      if (job.attempts >= job.max_attempts) {
        await db.from("storyboard_render_jobs").update({ status: "failed", last_error: errMsg, completed_at: new Date().toISOString() }).eq("id", jobId);
        await db.from("storyboard_panels").update({ status: "failed" }).eq("id", panelId);
      } else {
        await db.from("storyboard_render_jobs").update({ status: "queued", last_error: errMsg, claimed_at: null, claimed_by: null }).eq("id", jobId);
      }
      if (job.render_run_id) await refreshRenderRunCounters(db, job.render_run_id);
      return json({ error: errMsg }, 500);
    }

    const bytes = dataUrlToBytes(imageDataUrl);
    const storagePath = `${projectId}/storyboard-frames/${panelId}_${Date.now()}.png`;
    const blob = new Blob([bytes], { type: "image/png" });
    const { error: uploadErr } = await db.storage.from(STORAGE_BUCKET).upload(storagePath, blob, { contentType: "image/png", upsert: false });
    if (uploadErr) {
      const errMsg = "Upload failed: " + uploadErr.message;
      if (job.attempts >= job.max_attempts) {
        await db.from("storyboard_render_jobs").update({ status: "failed", last_error: errMsg, completed_at: new Date().toISOString() }).eq("id", jobId);
      } else {
        await db.from("storyboard_render_jobs").update({ status: "queued", last_error: errMsg, claimed_at: null, claimed_by: null }).eq("id", jobId);
      }
      if (job.render_run_id) await refreshRenderRunCounters(db, job.render_run_id);
      return json({ error: errMsg }, 500);
    }

    // Get URL
    let publicUrl = "";
    const { data: signedData, error: signedErr } = await db.storage.from(STORAGE_BUCKET).createSignedUrl(storagePath, 60 * 60 * 24 * 7);
    if (signedErr || !signedData?.signedUrl) {
      const { data: pubData } = db.storage.from(STORAGE_BUCKET).getPublicUrl(storagePath);
      publicUrl = pubData?.publicUrl || "";
    } else {
      publicUrl = signedData.signedUrl;
    }

    // Insert frame
    await db.from("storyboard_pipeline_frames").insert({
      project_id: projectId,
      panel_id: panelId,
      status: "generated",
      storage_path: storagePath,
      public_url: publicUrl,
      model: IMAGE_MODEL,
      gen_params: { prompt: finalPrompt, negative_prompt: negativePrompt, style_preset: stylePreset, aspect_ratio: aspectRatio },
      created_by: userId,
    });

    // Mark job succeeded
    await db.from("storyboard_render_jobs").update({ status: "succeeded", completed_at: new Date().toISOString() }).eq("id", jobId);
    await db.from("storyboard_panels").update({ status: "generated" }).eq("id", panelId);
    if (job.render_run_id) await refreshRenderRunCounters(db, job.render_run_id);

    return json({ ok: true, jobId });
  } catch (err: any) {
    console.error("process_job error:", err);
    const errMsg = err.message || "Unknown error";
    if (job.attempts >= job.max_attempts) {
      await db.from("storyboard_render_jobs").update({ status: "failed", last_error: errMsg, completed_at: new Date().toISOString() }).eq("id", jobId);
      await db.from("storyboard_panels").update({ status: "failed" }).eq("id", panelId);
    } else {
      await db.from("storyboard_render_jobs").update({ status: "queued", last_error: errMsg, claimed_at: null, claimed_by: null }).eq("id", jobId);
    }
    if (job.render_run_id) await refreshRenderRunCounters(db, job.render_run_id);
    return json({ error: errMsg }, 500);
  }
}

// ─── GET RENDER RUN ───
async function handleGetRenderRun(db: any, body: any) {
  const { projectId, renderRunId } = body;
  if (!renderRunId) return json({ error: "renderRunId required" }, 400);
  const { data: renderRun } = await db.from("storyboard_render_runs").select("*").eq("id", renderRunId).eq("project_id", projectId).single();
  if (!renderRun) return json({ error: "Render run not found" }, 404);
  const { data: jobs } = await db.from("storyboard_render_jobs").select("id, panel_id, unit_key, status, attempts, last_error, completed_at")
    .eq("render_run_id", renderRunId).order("created_at", { ascending: true }).limit(200);
  return json({ renderRun, jobs: jobs || [] });
}

// ─── CANCEL ───
async function handleCancel(db: any, body: any) {
  const { projectId, renderRunId } = body;
  if (!renderRunId) return json({ error: "renderRunId required" }, 400);
  await db.from("storyboard_render_jobs").update({ status: "canceled" }).eq("render_run_id", renderRunId).in("status", ["queued", "running"]);
  await db.from("storyboard_render_runs").update({ status: "canceled", completed_at: new Date().toISOString() }).eq("id", renderRunId).eq("project_id", projectId);
  await refreshRenderRunCounters(db, renderRunId);
  return json({ ok: true });
}

// ─── LIST RENDER RUNS ───
async function handleListRenderRuns(db: any, body: any) {
  const { projectId, runId, limit = 10 } = body;
  let query = db.from("storyboard_render_runs").select("*").eq("project_id", projectId);
  if (runId) query = query.eq("run_id", runId);
  const { data } = await query.order("started_at", { ascending: false }).limit(limit);
  return json({ renderRuns: data || [] });
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
    const projectId = body.projectId || body.project_id;
    if (!projectId) return json({ error: "projectId required" }, 400);

    const db = adminClient();
    const hasAccess = await verifyAccess(db, userId, projectId);
    if (!hasAccess) return json({ error: "Forbidden" }, 403);

    const apiKey = Deno.env.get("LOVABLE_API_KEY") || "";

    switch (action) {
      case "enqueue": return await handleEnqueue(db, body, userId);
      case "claim_next_job": return await handleClaimNextJob(db, body, userId);
      case "process_job": return await handleProcessJob(db, body, userId, apiKey);
      case "get_render_run": return await handleGetRenderRun(db, body);
      case "cancel": return await handleCancel(db, body);
      case "list_render_runs": return await handleListRenderRuns(db, body);
      default: return json({ error: `Unknown action: ${action}` }, 400);
    }
  } catch (err: any) {
    console.error("storyboard-render-queue error:", err);
    return json({ error: err.message || "Internal error" }, 500);
  }
});
