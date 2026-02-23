/**
 * trailer-assembler v2 — Timeline management, EDL resolution, editorial control + exports.
 * Actions: create_cut, update_beat, reorder_beats, render_manifest, finalize_run,
 *          list_cuts, get_cut, set_cut_status, get_timeline
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

function formatTimecode(ms: number): string {
  const totalSec = ms / 1000;
  const min = Math.floor(totalSec / 60);
  const sec = Math.floor(totalSec % 60);
  const frac = Math.round((totalSec % 1) * 100);
  return `${String(min).padStart(2, "0")}:${String(sec).padStart(2, "0")}.${String(frac).padStart(2, "0")}`;
}

async function logCutEvent(db: any, e: {
  project_id: string; cut_id: string; blueprint_id?: string;
  beat_index?: number; event_type: string; payload?: any; created_by: string;
}) {
  await db.from("trailer_cut_events").insert({
    project_id: e.project_id,
    cut_id: e.cut_id,
    blueprint_id: e.blueprint_id ?? null,
    beat_index: e.beat_index ?? null,
    event_type: e.event_type,
    payload: e.payload || {},
    created_by: e.created_by,
  });
}

// Compute trim_out_ms from clip duration and planned duration
function computeTrims(beat: any, clipDurationMs?: number | null): { trim_in_ms: number; trim_out_ms: number } {
  const plannedMs = beat.duration_ms || 3000;
  const trimIn = beat.trim_in_ms || 0;
  if (clipDurationMs && clipDurationMs > 0) {
    return { trim_in_ms: trimIn, trim_out_ms: Math.min(clipDurationMs, plannedMs) };
  }
  // No clip duration known — use planned duration
  return { trim_in_ms: trimIn, trim_out_ms: plannedMs };
}

// Recompute start_ms for timeline entries
function recomputeTimeline(timeline: any[]): any[] {
  let currentMs = 0;
  return timeline.map((entry: any, idx: number) => {
    const effectiveDuration = Math.max(0, entry.duration_ms - (entry.trim_in_ms || 0) - (entry.trim_out_ms || 0));
    const result = { ...entry, beat_index: idx, start_ms: currentMs, effective_duration_ms: effectiveDuration };
    currentMs += effectiveDuration;
    return result;
  });
}

// ─── Create Cut (enhanced) ───
async function handleCreateCut(db: any, body: any, userId: string) {
  const { projectId, blueprintId, options = {} } = body;
  if (!blueprintId) return json({ error: "blueprintId required" }, 400);

  const { data: bp } = await db.from("trailer_blueprints").select("*")
    .eq("id", blueprintId).eq("project_id", projectId).single();
  if (!bp) return json({ error: "Blueprint not found" }, 404);

  const { data: clips } = await db.from("trailer_clips").select("*")
    .eq("blueprint_id", blueprintId).eq("project_id", projectId)
    .order("beat_index").order("created_at", { ascending: false });

  // Build clip maps: selected first, then any available
  const selectedMap: Record<number, any> = {};
  const fallbackMap: Record<number, any> = {};
  for (const c of (clips || [])) {
    if ((c.used_in_cut || c.selected) && !selectedMap[c.beat_index]) {
      selectedMap[c.beat_index] = c;
    }
    if (!fallbackMap[c.beat_index] && (c.status === "complete" || c.status === "selected")) {
      fallbackMap[c.beat_index] = c;
    }
  }

  const edl = bp.edl || [];
  const textCardPlan = bp.text_card_plan || [];
  const textCardBeats = new Set(textCardPlan.map((tc: any) => tc.beat_index));

  let timeline = edl.map((beat: any, idx: number) => {
    const clip = selectedMap[idx] || fallbackMap[idx] || null;
    const isTextCard = beat.role === "title_card" || textCardBeats.has(idx);
    const durationMs = Math.round((beat.duration_s || 3) * 1000);
    const textContent = isTextCard
      ? (textCardPlan.find((tc: any) => tc.beat_index === idx)?.text || beat.clip_spec?.text_overlay || beat.role.toUpperCase())
      : null;

    const clipDurationMs = clip?.duration_ms || clip?.metadata?.duration_ms || null;
    const trims = computeTrims({ duration_ms: durationMs }, clipDurationMs);

    return {
      beat_index: idx,
      role: beat.role,
      duration_ms: durationMs,
      trim_in_ms: trims.trim_in_ms,
      trim_out_ms: trims.trim_out_ms,
      start_ms: 0,
      effective_duration_ms: Math.max(0, durationMs - trims.trim_in_ms - trims.trim_out_ms) || durationMs,
      clip_id: clip?.id || null,
      clip_url: clip?.public_url || null,
      clip_duration_ms: clipDurationMs,
      media_type: clip?.media_type || "video",
      text_overlay: beat.clip_spec?.text_overlay || null,
      audio_cue: beat.clip_spec?.audio_cue || null,
      is_text_card: isTextCard,
      text_content: textContent,
      provider: clip?.provider || null,
      has_clip: !!clip,
    };
  });

  timeline = recomputeTimeline(timeline);
  const totalDurationMs = timeline.reduce((s: number, t: any) => s + (t.effective_duration_ms || t.duration_ms), 0);

  // Build NLE EDL export
  const edlExport = {
    version: "2.0",
    project_id: projectId,
    blueprint_id: blueprintId,
    arc_type: bp.arc_type,
    created_at: new Date().toISOString(),
    total_duration_ms: totalDurationMs,
    fps: options.fps || 24,
    resolution: { width: options.width || 1280, height: options.height || 720 },
    tracks: [
      {
        name: "V1", type: "video",
        clips: timeline.map((t: any) => ({
          beat_index: t.beat_index,
          role: t.role,
          source: t.clip_url || (t.is_text_card ? "TEXT_CARD" : "PLACEHOLDER"),
          in_point_ms: t.trim_in_ms || 0,
          out_point_ms: (t.duration_ms || 0) - (t.trim_out_ms || 0),
          timeline_start_ms: t.start_ms,
          duration_ms: t.effective_duration_ms,
          text_overlay: t.text_overlay,
          text_content: t.text_content,
          is_text_card: t.is_text_card,
        })),
      },
    ],
    text_cards: textCardPlan,
    audio_plan: bp.audio_plan || {},
  };

  const { data: cut, error: cutErr } = await db.from("trailer_cuts").insert({
    project_id: projectId,
    blueprint_id: blueprintId,
    status: "draft",
    timeline,
    edl_export: edlExport,
    duration_ms: totalDurationMs,
    options,
    created_by: userId,
    title: `${bp.arc_type} cut`,
    arc_type: bp.arc_type,
    render_width: options.width || 1280,
    render_height: options.height || 720,
    render_fps: options.fps || 24,
  }).select().single();

  if (cutErr) return json({ error: cutErr.message }, 500);

  await logCutEvent(db, {
    project_id: projectId, cut_id: cut.id, blueprint_id: blueprintId,
    event_type: "create_cut",
    payload: { beatCount: timeline.length, totalDurationMs, hasClips: timeline.filter((t: any) => t.has_clip).length },
    created_by: userId,
  });

  return json({ ok: true, cutId: cut.id, timeline, edlExport, totalDurationMs });
}

// ─── Update Beat ───
async function handleUpdateBeat(db: any, body: any, userId: string) {
  const { projectId, cutId, beatIndex, duration_ms, trim_in_ms, trim_out_ms, clip_id } = body;
  if (!cutId || beatIndex === undefined) return json({ error: "cutId and beatIndex required" }, 400);

  const { data: cut } = await db.from("trailer_cuts").select("*")
    .eq("id", cutId).eq("project_id", projectId).single();
  if (!cut) return json({ error: "Cut not found" }, 404);

  let timeline = [...(cut.timeline || [])];
  if (beatIndex < 0 || beatIndex >= timeline.length) return json({ error: "Invalid beatIndex" }, 400);

  const beat = { ...timeline[beatIndex] };

  // Apply updates
  if (duration_ms !== undefined) beat.duration_ms = duration_ms;
  if (trim_in_ms !== undefined) beat.trim_in_ms = trim_in_ms;
  if (trim_out_ms !== undefined) beat.trim_out_ms = trim_out_ms;

  // Clip swap — auto-recompute trims
  if (clip_id !== undefined) {
    if (clip_id === null) {
      beat.clip_id = null;
      beat.clip_url = null;
      beat.has_clip = false;
      beat.clip_duration_ms = null;
      const trims = computeTrims(beat, null);
      beat.trim_in_ms = trims.trim_in_ms;
      beat.trim_out_ms = trims.trim_out_ms;
    } else {
      const { data: newClip } = await db.from("trailer_clips").select("*")
        .eq("id", clip_id).eq("project_id", projectId).single();
      if (newClip) {
        beat.clip_id = newClip.id;
        beat.clip_url = newClip.public_url;
        beat.media_type = newClip.media_type;
        beat.provider = newClip.provider;
        beat.has_clip = true;
        const clipDurMs = newClip.duration_ms || newClip.metadata?.duration_ms || null;
        beat.clip_duration_ms = clipDurMs;
        // Auto-recompute trims only if user hasn't manually set them
        if ((beat.trim_out_ms || 0) === 0 || trim_in_ms === undefined && trim_out_ms === undefined) {
          const trims = computeTrims(beat, clipDurMs);
          beat.trim_in_ms = trims.trim_in_ms;
          beat.trim_out_ms = trims.trim_out_ms;
        }
      }
    }
  }

  timeline[beatIndex] = beat;
  timeline = recomputeTimeline(timeline);
  const totalDurationMs = timeline.reduce((s: number, t: any) => s + (t.effective_duration_ms || t.duration_ms), 0);

  // Rebuild edl_export
  const edlExport = { ...(cut.edl_export || {}), total_duration_ms: totalDurationMs, tracks: [
    { name: "V1", type: "video", clips: timeline.map((t: any) => ({
      beat_index: t.beat_index, role: t.role,
      source: t.clip_url || (t.is_text_card ? "TEXT_CARD" : "PLACEHOLDER"),
      in_point_ms: t.trim_in_ms || 0,
      out_point_ms: (t.duration_ms || 0) - (t.trim_out_ms || 0),
      timeline_start_ms: t.start_ms,
      duration_ms: t.effective_duration_ms,
      text_overlay: t.text_overlay,
      text_content: t.text_content,
      is_text_card: t.is_text_card,
    }))},
  ]};

  await db.from("trailer_cuts").update({ timeline, edl_export: edlExport, duration_ms: totalDurationMs })
    .eq("id", cutId);

  await logCutEvent(db, {
    project_id: projectId, cut_id: cutId, beat_index: beatIndex,
    event_type: "update_beat",
    payload: { duration_ms, trim_in_ms, trim_out_ms, clip_id },
    created_by: userId,
  });

  return json({ ok: true, timeline, totalDurationMs });
}

// ─── Reorder Beats ───
async function handleReorderBeats(db: any, body: any, userId: string) {
  const { projectId, cutId, orderedBeatIndices } = body;
  if (!cutId || !orderedBeatIndices) return json({ error: "cutId and orderedBeatIndices required" }, 400);

  const { data: cut } = await db.from("trailer_cuts").select("*")
    .eq("id", cutId).eq("project_id", projectId).single();
  if (!cut) return json({ error: "Cut not found" }, 404);

  const oldTimeline = cut.timeline || [];
  if (orderedBeatIndices.length !== oldTimeline.length) return json({ error: "Length mismatch" }, 400);

  let newTimeline = orderedBeatIndices.map((oldIdx: number) => oldTimeline[oldIdx]);
  newTimeline = recomputeTimeline(newTimeline);
  const totalDurationMs = newTimeline.reduce((s: number, t: any) => s + (t.effective_duration_ms || t.duration_ms), 0);

  await db.from("trailer_cuts").update({ timeline: newTimeline, duration_ms: totalDurationMs }).eq("id", cutId);

  await logCutEvent(db, {
    project_id: projectId, cut_id: cutId,
    event_type: "reorder_beats",
    payload: { orderedBeatIndices },
    created_by: userId,
  });

  return json({ ok: true, timeline: newTimeline, totalDurationMs });
}

// ─── Render Manifest ───
async function handleRenderManifest(db: any, body: any) {
  const { projectId, cutId } = body;
  if (!cutId) return json({ error: "cutId required" }, 400);

  const { data: cut } = await db.from("trailer_cuts").select("*")
    .eq("id", cutId).eq("project_id", projectId).single();
  if (!cut) return json({ error: "Cut not found" }, 404);

  const timeline = cut.timeline || [];
  const manifest = {
    beats: timeline.map((t: any) => ({
      type: t.is_text_card ? "text" : "clip",
      src: t.clip_url || null,
      text_content: t.text_content || t.text_overlay || null,
      start_ms: t.start_ms || 0,
      duration_ms: t.effective_duration_ms || t.duration_ms,
      trim_in_ms: t.trim_in_ms || 0,
      trim_out_ms: t.trim_out_ms || 0,
      role: t.role,
      beat_index: t.beat_index,
    })),
    total_duration_ms: cut.duration_ms || 0,
    width: cut.render_width || 1280,
    height: cut.render_height || 720,
    fps: cut.render_fps || 24,
  };

  return json({ ok: true, manifest });
}

// ─── Finalize Run ───
async function handleFinalizeRun(db: any, body: any, userId: string) {
  const { projectId, cutId, outputPath, publicUrl } = body;
  if (!cutId) return json({ error: "cutId required" }, 400);

  const update: any = { status: "ready" };
  if (outputPath) update.storage_path = outputPath;
  if (publicUrl) update.public_url = publicUrl;

  await db.from("trailer_cuts").update(update).eq("id", cutId).eq("project_id", projectId);

  await logCutEvent(db, {
    project_id: projectId, cut_id: cutId,
    event_type: "finalized",
    payload: { outputPath, publicUrl },
    created_by: userId,
  });

  return json({ ok: true });
}

// ─── Export Beatlist ───
async function handleExportBeatlist(db: any, body: any) {
  const { projectId, cutId } = body;
  if (!cutId) return json({ error: "cutId required" }, 400);

  const { data: cut } = await db.from("trailer_cuts").select("*")
    .eq("id", cutId).eq("project_id", projectId).single();
  if (!cut) return json({ error: "Cut not found" }, 404);

  const beatlist = (cut.timeline || []).map((t: any) => ({
    beat_index: t.beat_index,
    role: t.role,
    timecode_in: formatTimecode(t.start_ms || 0),
    timecode_out: formatTimecode((t.start_ms || 0) + (t.effective_duration_ms || t.duration_ms)),
    duration_ms: t.effective_duration_ms || t.duration_ms,
    trim_in_ms: t.trim_in_ms || 0,
    trim_out_ms: t.trim_out_ms || 0,
    clip_id: t.clip_id,
    provider: t.provider,
    is_text_card: t.is_text_card || false,
    text_content: t.text_content,
    has_clip: t.has_clip || false,
  }));

  return json({
    ok: true,
    beatlist: {
      version: "1.0",
      cut_id: cutId,
      project_id: projectId,
      total_duration_ms: cut.duration_ms,
      total_duration_timecode: formatTimecode(cut.duration_ms || 0),
      beat_count: beatlist.length,
      beats: beatlist,
    },
  });
}

// ─── Existing actions (preserved) ───

async function handleListCuts(db: any, body: any) {
  const { projectId, blueprintId, limit = 20 } = body;
  let query = db.from("trailer_cuts").select("*").eq("project_id", projectId);
  if (blueprintId) query = query.eq("blueprint_id", blueprintId);
  const { data } = await query.order("created_at", { ascending: false }).limit(limit);
  return json({ cuts: data || [] });
}

async function handleGetCut(db: any, body: any) {
  const { projectId, cutId } = body;
  if (!cutId) return json({ error: "cutId required" }, 400);
  const { data } = await db.from("trailer_cuts").select("*")
    .eq("id", cutId).eq("project_id", projectId).single();
  if (!data) return json({ error: "Cut not found" }, 404);
  return json({ cut: data });
}

async function handleSetCutStatus(db: any, body: any, userId: string) {
  const { projectId, cutId, status, error: errorMsg, storagePath, publicUrl, durationMs } = body;
  if (!cutId) return json({ error: "cutId required" }, 400);
  const update: any = { status };
  if (errorMsg) update.error = errorMsg;
  if (storagePath) update.storage_path = storagePath;
  if (publicUrl) update.public_url = publicUrl;
  if (durationMs) update.duration_ms = durationMs;
  await db.from("trailer_cuts").update(update).eq("id", cutId).eq("project_id", projectId);

  await logCutEvent(db, {
    project_id: projectId, cut_id: cutId,
    event_type: "status_change",
    payload: { status, error: errorMsg },
    created_by: userId,
  });

  return json({ ok: true });
}

async function handleGetTimeline(db: any, body: any) {
  const { projectId, blueprintId } = body;
  if (!blueprintId) return json({ error: "blueprintId required" }, 400);

  const { data: bp } = await db.from("trailer_blueprints").select("edl, arc_type, audio_plan, text_card_plan")
    .eq("id", blueprintId).eq("project_id", projectId).single();
  if (!bp) return json({ error: "Blueprint not found" }, 404);

  const { data: clips } = await db.from("trailer_clips").select("*")
    .eq("blueprint_id", blueprintId).eq("project_id", projectId)
    .order("beat_index").order("created_at", { ascending: false });

  const clipsByBeat: Record<number, any[]> = {};
  for (const c of (clips || [])) {
    if (!clipsByBeat[c.beat_index]) clipsByBeat[c.beat_index] = [];
    clipsByBeat[c.beat_index].push(c);
  }

  const beats = (bp.edl || []).map((beat: any, idx: number) => ({
    ...beat,
    beat_index: idx,
    clips: clipsByBeat[idx] || [],
    selected_clip: (clipsByBeat[idx] || []).find((c: any) => c.used_in_cut || c.selected) || null,
  }));

  return json({ beats, audioPlan: bp.audio_plan, textCardPlan: bp.text_card_plan, arcType: bp.arc_type });
}

// ─── Fix Trims (backfill) ───
async function handleFixTrims(db: any, body: any, userId: string) {
  const { projectId, cutId } = body;
  if (!cutId) return json({ error: "cutId required" }, 400);

  const { data: cut } = await db.from("trailer_cuts").select("*")
    .eq("id", cutId).eq("project_id", projectId).single();
  if (!cut) return json({ error: "Cut not found" }, 404);

  let timeline = [...(cut.timeline || [])];
  let fixedCount = 0;

  // Batch-fetch all clip IDs used in timeline
  const clipIds = timeline.map((t: any) => t.clip_id).filter(Boolean);
  const clipDurMap: Record<string, number> = {};
  if (clipIds.length > 0) {
    const { data: clipRows } = await db.from("trailer_clips").select("id, duration_ms, metadata")
      .in("id", clipIds).eq("project_id", projectId);
    for (const c of (clipRows || [])) {
      clipDurMap[c.id] = c.duration_ms || c.metadata?.duration_ms || 0;
    }
  }

  for (let i = 0; i < timeline.length; i++) {
    const beat = timeline[i];
    const plannedMs = beat.duration_ms || 3000;
    // Fix if trim_out is 0 (or missing) and beat has positive duration
    if ((!beat.trim_out_ms || beat.trim_out_ms <= 0) && plannedMs > 0) {
      const clipDur = beat.clip_id ? (clipDurMap[beat.clip_id] || null) : null;
      const trims = computeTrims(beat, clipDur);
      timeline[i] = { ...beat, ...trims, clip_duration_ms: clipDur };
      fixedCount++;
    }
  }

  if (fixedCount > 0) {
    timeline = recomputeTimeline(timeline);
    const totalDurationMs = timeline.reduce((s: number, t: any) => s + (t.effective_duration_ms || t.duration_ms), 0);
    await db.from("trailer_cuts").update({ timeline, duration_ms: totalDurationMs }).eq("id", cutId);
    await logCutEvent(db, {
      project_id: projectId, cut_id: cutId,
      event_type: "fix_trims",
      payload: { fixedCount },
      created_by: userId,
    });
    return json({ ok: true, fixedCount, timeline, totalDurationMs });
  }

  return json({ ok: true, fixedCount: 0, message: "All trims already valid" });
}

// ─── Validate Trims (pre-render check) ───
async function handleValidateTrims(db: any, body: any) {
  const { projectId, cutId } = body;
  if (!cutId) return json({ error: "cutId required" }, 400);

  const { data: cut } = await db.from("trailer_cuts").select("timeline")
    .eq("id", cutId).eq("project_id", projectId).single();
  if (!cut) return json({ error: "Cut not found" }, 404);

  const issues: Array<{ beat_index: number; role: string; issue: string }> = [];
  for (const beat of (cut.timeline || [])) {
    if (beat.is_text_card) continue;
    const trimIn = beat.trim_in_ms || 0;
    const trimOut = beat.trim_out_ms || 0;
    if (trimOut <= 0 && (beat.duration_ms || 0) > 0) {
      issues.push({ beat_index: beat.beat_index, role: beat.role, issue: "trim_out_ms is 0" });
    }
    if (trimIn >= trimOut && trimOut > 0) {
      issues.push({ beat_index: beat.beat_index, role: beat.role, issue: "trim_in_ms >= trim_out_ms" });
    }
    if (beat.clip_duration_ms && trimOut > beat.clip_duration_ms) {
      issues.push({ beat_index: beat.beat_index, role: beat.role, issue: "trim_out exceeds clip duration" });
    }
  }

  return json({ ok: true, valid: issues.length === 0, issues });
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
      case "create_cut": return await handleCreateCut(db, body, userId);
      case "update_beat": return await handleUpdateBeat(db, body, userId);
      case "reorder_beats": return await handleReorderBeats(db, body, userId);
      case "render_manifest": return await handleRenderManifest(db, body);
      case "finalize_run": return await handleFinalizeRun(db, body, userId);
      case "export_beatlist": return await handleExportBeatlist(db, body);
      case "list_cuts": return await handleListCuts(db, body);
      case "get_cut": return await handleGetCut(db, body);
      case "set_cut_status": return await handleSetCutStatus(db, body, userId);
      case "get_timeline": return await handleGetTimeline(db, body);
      case "fix_trims": return await handleFixTrims(db, body, userId);
      case "validate_trims": return await handleValidateTrims(db, body);
      default: return json({ error: `Unknown action: ${action}` }, 400);
    }
  } catch (err: any) {
    console.error("trailer-assembler error:", err);
    return json({ error: err.message || "Internal error" }, 500);
  }
});
