/**
 * trailer-audio-engine v1.1 — Audio plan generation, mix settings, render job orchestration.
 * Actions: upsert_audio_run, generate_audio_plan, enqueue_render, render_progress,
 *          retry_render, cancel_render, list_audio_assets, upload_audio_asset
 */
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

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

async function logRenderEvent(db: any, e: {
  project_id: string; render_job_id: string; event_type: string; payload?: any; created_by: string;
}) {
  await db.from("trailer_render_events").insert({
    project_id: e.project_id,
    render_job_id: e.render_job_id,
    event_type: e.event_type,
    payload: e.payload || {},
    created_by: e.created_by,
  });
}

// SHA-256 hash for idempotency keys
async function sha256(text: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, "0")).join("").slice(0, 40);
}

const DEFAULT_MIX: Record<string, any> = {
  music_gain_db: -10,
  sfx_gain_db: -6,
  dialogue_duck_db: -8,
  duck_attack_ms: 30,
  duck_release_ms: 250,
  target_lufs: -14,
};

// ─── Upsert Audio Run ───
async function handleUpsertAudioRun(db: any, body: any, userId: string) {
  const { projectId, trailerCutId, blueprintId, musicBedAssetId, sfxPackTag, mixOverrides } = body;
  if (!trailerCutId) return json({ error: "trailerCutId required" }, 400);

  const mixJson = { ...DEFAULT_MIX, ...(mixOverrides || {}) };

  // Check if existing audio run for this cut
  const { data: existing } = await db.from("trailer_audio_runs")
    .select("*").eq("trailer_cut_id", trailerCutId).eq("project_id", projectId)
    .order("created_at", { ascending: false }).limit(1).maybeSingle();

  if (existing) {
    const updates: any = { mix_json: mixJson, updated_at: new Date().toISOString() };
    if (musicBedAssetId !== undefined) updates.music_bed_asset_id = musicBedAssetId;
    if (sfxPackTag !== undefined) updates.sfx_pack_tag = sfxPackTag;
    if (blueprintId) updates.blueprint_id = blueprintId;

    await db.from("trailer_audio_runs").update(updates).eq("id", existing.id);
    const { data: updated } = await db.from("trailer_audio_runs").select("*").eq("id", existing.id).single();
    return json({ ok: true, audioRun: updated, action: "updated" });
  }

  const { data: audioRun, error } = await db.from("trailer_audio_runs").insert({
    project_id: projectId,
    trailer_cut_id: trailerCutId,
    blueprint_id: blueprintId || null,
    music_bed_asset_id: musicBedAssetId || null,
    sfx_pack_tag: sfxPackTag || null,
    plan_json: {},
    mix_json: mixJson,
    created_by: userId,
  }).select().single();

  if (error) return json({ error: error.message }, 500);
  return json({ ok: true, audioRun, action: "created" });
}

// ─── Generate Audio Plan ───
async function handleGenerateAudioPlan(db: any, body: any, userId: string) {
  const { projectId, audioRunId } = body;
  if (!audioRunId) return json({ error: "audioRunId required" }, 400);

  const { data: audioRun } = await db.from("trailer_audio_runs").select("*")
    .eq("id", audioRunId).eq("project_id", projectId).single();
  if (!audioRun) return json({ error: "Audio run not found" }, 404);

  // Load cut timeline
  const { data: cut } = await db.from("trailer_cuts").select("timeline, duration_ms, blueprint_id")
    .eq("id", audioRun.trailer_cut_id).eq("project_id", projectId).single();
  if (!cut) return json({ error: "Cut not found" }, 404);

  const timeline = cut.timeline || [];
  const totalMs = cut.duration_ms || 0;

  // Load blueprint audio plan if available
  let bpAudioPlan: any = {};
  if (cut.blueprint_id || audioRun.blueprint_id) {
    const bpId = cut.blueprint_id || audioRun.blueprint_id;
    const { data: bp } = await db.from("trailer_blueprints").select("audio_plan")
      .eq("id", bpId).eq("project_id", projectId).single();
    if (bp) bpAudioPlan = bp.audio_plan || {};
  }

  // Build plan_json
  const sfxHits: any[] = [];
  const segments: any[] = [];

  // Identify structural boundaries for SFX placement
  const hitRoles = new Set(["inciting_incident", "climax_tease", "rupture", "stinger", "montage_peak", "twist"]);
  const riserRoles = new Set(["tension_build", "rising_action_1", "rising_action_2", "crescendo"]);

  for (const beat of timeline) {
    if (hitRoles.has(beat.role)) {
      sfxHits.push({
        type: "hit",
        timestamp_ms: beat.start_ms || 0,
        beat_index: beat.beat_index,
        role: beat.role,
        sfx_kind: beat.role === "stinger" ? "impact" : "hit",
      });
    }
    if (riserRoles.has(beat.role)) {
      sfxHits.push({
        type: "riser",
        timestamp_ms: beat.start_ms || 0,
        duration_ms: beat.effective_duration_ms || beat.duration_ms,
        beat_index: beat.beat_index,
        role: beat.role,
        sfx_kind: "riser",
      });
    }
  }

  // Music bed segment spanning entire trailer
  segments.push({
    type: "music_bed",
    start_ms: 0,
    end_ms: totalMs,
    description: "Full trailer music bed",
    gain_db: audioRun.mix_json?.music_gain_db ?? DEFAULT_MIX.music_gain_db,
  });

  // Add blueprint-derived SFX cues if available
  if (bpAudioPlan.sfx_cues) {
    for (const cue of bpAudioPlan.sfx_cues) {
      const beatIdx = cue.beat_index;
      const beat = timeline.find((b: any) => b.beat_index === beatIdx);
      if (beat) {
        sfxHits.push({
          type: "sfx_cue",
          timestamp_ms: beat.start_ms || 0,
          beat_index: beatIdx,
          description: cue.description,
          timing: cue.timing,
          sfx_kind: "sfx",
        });
      }
    }
  }

  // VO lines from blueprint
  const voLines = (bpAudioPlan.vo_lines || []).map((vo: any) => {
    const beat = timeline.find((b: any) => b.beat_index === vo.beat_index);
    return {
      type: "vo",
      timestamp_ms: beat?.start_ms || 0,
      beat_index: vo.beat_index,
      line: vo.line,
      character: vo.character,
    };
  });

  const planJson = {
    version: "1.1",
    total_duration_ms: totalMs,
    music_segments: segments,
    sfx_hits: sfxHits,
    vo_lines: voLines,
    generated_at: new Date().toISOString(),
  };

  await db.from("trailer_audio_runs").update({
    plan_json: planJson,
    status: "draft",
  }).eq("id", audioRunId);

  return json({ ok: true, plan: planJson });
}

// ─── Enqueue Render MP4 ───
async function handleEnqueueRender(db: any, body: any, userId: string) {
  const { projectId, trailerCutId, audioRunId, force, preset = "720p" } = body;
  if (!trailerCutId) return json({ error: "trailerCutId required" }, 400);

  // Load cut
  const { data: cut } = await db.from("trailer_cuts").select("*")
    .eq("id", trailerCutId).eq("project_id", projectId).single();
  if (!cut) return json({ error: "Cut not found" }, 404);

  // Load audio run if specified
  let audioRun: any = null;
  if (audioRunId) {
    const { data: ar } = await db.from("trailer_audio_runs").select("*")
      .eq("id", audioRunId).eq("project_id", projectId).single();
    audioRun = ar;
  }

  // Build input manifest
  const timeline = cut.timeline || [];
  const edl = timeline.map((t: any) => ({
    beat_index: t.beat_index,
    role: t.role,
    clip_url: t.clip_url,
    clip_id: t.clip_id,
    is_text_card: t.is_text_card,
    text_content: t.text_content,
    start_ms: t.start_ms,
    duration_ms: t.effective_duration_ms || t.duration_ms,
    trim_in_ms: t.trim_in_ms || 0,
    trim_out_ms: t.trim_out_ms || 0,
  }));

  const audioPlan = audioRun?.plan_json || {};
  const mixSettings = audioRun?.mix_json || DEFAULT_MIX;

  // Load music bed storage path if referenced
  let musicBedPath: string | null = null;
  if (audioRun?.music_bed_asset_id) {
    const { data: asset } = await db.from("trailer_audio_assets")
      .select("storage_path").eq("id", audioRun.music_bed_asset_id).single();
    musicBedPath = asset?.storage_path || null;
  }

  // Load SFX asset paths by tag
  let sfxPaths: any[] = [];
  if (audioRun?.sfx_pack_tag) {
    const { data: sfxAssets } = await db.from("trailer_audio_assets")
      .select("*").eq("project_id", projectId).eq("kind", "sfx")
      .contains("tags", [audioRun.sfx_pack_tag]);
    sfxPaths = (sfxAssets || []).map((a: any) => ({ name: a.name, path: a.storage_path, tags: a.tags }));
  }

  const edlHash = await sha256(JSON.stringify(edl));
  const audioHash = await sha256(JSON.stringify({ audioPlan, mixSettings, musicBedPath }));
  const forceSuffix = force ? `-${Date.now()}` : "";
  const idempotencyKey = await sha256(`${projectId}|${trailerCutId}|${audioRunId || "none"}|${preset}|${edlHash}|${audioHash}${forceSuffix}`);

  // Check existing
  if (!force) {
    const { data: existing } = await db.from("trailer_render_jobs")
      .select("*").eq("idempotency_key", idempotencyKey).maybeSingle();
    if (existing) return json({ ok: true, job: existing, action: "existing" });
  }

  const outputPaths = {
    mp4: `${projectId}/runs/${trailerCutId}/final.mp4`,
    wav: `${projectId}/runs/${trailerCutId}/final.wav`,
  };

  const inputJson = {
    preset,
    edl,
    audio_plan: audioPlan,
    mix_settings: mixSettings,
    music_bed_path: musicBedPath,
    sfx_paths: sfxPaths,
    output_paths: outputPaths,
    resolution: preset === "1080p" ? { w: 1920, h: 1080 } : { w: 1280, h: 720 },
    fps: cut.render_fps || 24,
    webm_source: cut.storage_path ? `${projectId}/runs/${trailerCutId}/final.webm` : null,
  };

  const { data: job, error } = await db.from("trailer_render_jobs").insert({
    project_id: projectId,
    trailer_cut_id: trailerCutId,
    audio_run_id: audioRunId || null,
    status: "queued",
    idempotency_key: idempotencyKey,
    input_json: inputJson,
    preset,
    created_by: userId,
  }).select().single();

  if (error) return json({ error: error.message }, 500);

  await logRenderEvent(db, {
    project_id: projectId,
    render_job_id: job.id,
    event_type: "render_enqueued",
    payload: { preset, audioRunId, cutId: trailerCutId },
    created_by: userId,
  });

  return json({ ok: true, job, action: "created" });
}

// ─── Render Progress ───
async function handleRenderProgress(db: any, body: any) {
  const { projectId, trailerCutId } = body;
  if (!trailerCutId) return json({ error: "trailerCutId required" }, 400);

  const { data: jobs } = await db.from("trailer_render_jobs").select("*")
    .eq("project_id", projectId).eq("trailer_cut_id", trailerCutId)
    .order("created_at", { ascending: false }).limit(10);

  const list = jobs || [];
  const counts = {
    queued: list.filter((j: any) => j.status === "queued").length,
    running: list.filter((j: any) => j.status === "running").length,
    succeeded: list.filter((j: any) => j.status === "succeeded").length,
    failed: list.filter((j: any) => j.status === "failed").length,
    canceled: list.filter((j: any) => j.status === "canceled").length,
    total: list.length,
  };

  return json({ ok: true, jobs: list, counts, latest: list[0] || null });
}

// ─── Retry Render ───
async function handleRetryRender(db: any, body: any, userId: string) {
  const { projectId, renderJobId } = body;
  if (!renderJobId) return json({ error: "renderJobId required" }, 400);

  const { data: job } = await db.from("trailer_render_jobs").select("*")
    .eq("id", renderJobId).eq("project_id", projectId).single();
  if (!job) return json({ error: "Job not found" }, 404);
  if (job.status !== "failed") return json({ error: "Only failed jobs can be retried" }, 400);
  if (job.attempt >= 3) return json({ error: "Max attempts reached" }, 400);

  await db.from("trailer_render_jobs").update({
    status: "queued", error: null, claimed_at: null,
  }).eq("id", renderJobId);

  await logRenderEvent(db, {
    project_id: projectId, render_job_id: renderJobId,
    event_type: "render_retried", payload: { attempt: job.attempt },
    created_by: userId,
  });

  return json({ ok: true });
}

// ─── Cancel Render ───
async function handleCancelRender(db: any, body: any, userId: string) {
  const { projectId, renderJobId } = body;
  if (!renderJobId) return json({ error: "renderJobId required" }, 400);

  const { data: job } = await db.from("trailer_render_jobs").select("*")
    .eq("id", renderJobId).eq("project_id", projectId).single();
  if (!job) return json({ error: "Job not found" }, 404);
  if (!["queued", "running"].includes(job.status)) return json({ error: "Cannot cancel" }, 400);

  await db.from("trailer_render_jobs").update({ status: "canceled" }).eq("id", renderJobId);

  await logRenderEvent(db, {
    project_id: projectId, render_job_id: renderJobId,
    event_type: "render_canceled", created_by: userId,
  });

  return json({ ok: true });
}

// ─── List Audio Assets ───
async function handleListAudioAssets(db: any, body: any) {
  const { projectId, kind } = body;
  let query = db.from("trailer_audio_assets").select("*").eq("project_id", projectId);
  if (kind) query = query.eq("kind", kind);
  const { data } = await query.order("created_at", { ascending: false });
  return json({ ok: true, assets: data || [] });
}

// ─── Get Audio Run ───
async function handleGetAudioRun(db: any, body: any) {
  const { projectId, trailerCutId } = body;
  if (!trailerCutId) return json({ error: "trailerCutId required" }, 400);

  const { data } = await db.from("trailer_audio_runs").select("*")
    .eq("trailer_cut_id", trailerCutId).eq("project_id", projectId)
    .order("created_at", { ascending: false }).limit(1).maybeSingle();

  return json({ ok: true, audioRun: data || null });
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

    switch (action) {
      case "upsert_audio_run": return await handleUpsertAudioRun(db, body, userId);
      case "generate_audio_plan": return await handleGenerateAudioPlan(db, body, userId);
      case "enqueue_render": return await handleEnqueueRender(db, body, userId);
      case "render_progress": return await handleRenderProgress(db, body);
      case "retry_render": return await handleRetryRender(db, body, userId);
      case "cancel_render": return await handleCancelRender(db, body, userId);
      case "list_audio_assets": return await handleListAudioAssets(db, body);
      case "get_audio_run": return await handleGetAudioRun(db, body);
      default: return json({ error: `Unknown action: ${action}` }, 400);
    }
  } catch (err: any) {
    console.error("trailer-audio-engine error:", err);
    return json({ error: err.message || "Internal error" }, 500);
  }
});
