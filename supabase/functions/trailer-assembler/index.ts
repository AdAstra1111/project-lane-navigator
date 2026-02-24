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
    const trimIn = Math.max(0, entry.trim_in_ms || 0);
    const trimOut = Math.max(trimIn, entry.trim_out_ms ?? (entry.duration_ms || 0));
    const effectiveDuration = Math.max(0, trimOut - trimIn);
    const result = {
      ...entry,
      beat_index: idx,
      trim_in_ms: trimIn,
      trim_out_ms: trimOut,
      start_ms: currentMs,
      effective_duration_ms: effectiveDuration,
    };
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
      effective_duration_ms: Math.max(0, trims.trim_out_ms - trims.trim_in_ms) || durationMs,
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

  // ── Load rhythm markers for sync enforcement ──
  let rhythmMarkers: any = null;
  const scriptRunId = bp.options?.script_run_id;
  if (scriptRunId) {
    const { data: rrs } = await db.from("trailer_rhythm_runs")
      .select("hit_points_json, silence_windows_json, drop_timestamp_ms, audio_plan_json, beat_hit_intents_json")
      .eq("script_run_id", scriptRunId)
      .eq("status", "complete")
      .order("created_at", { ascending: false })
      .limit(1);
    if (rrs?.[0]) rhythmMarkers = rrs[0];
  }

  // ── Rhythm Sync Enforcement ──
  const rhythmViolations: string[] = [];
  if (rhythmMarkers) {
    const hitPoints = rhythmMarkers.hit_points_json || [];
    const silenceWindows = rhythmMarkers.silence_windows_json || [];
    const dropMs = rhythmMarkers.drop_timestamp_ms;

    // 1) Align cut points to nearest hit marker (±200ms tolerance)
    for (const hp of hitPoints) {
      const hpMs = hp.t_ms || hp.timestamp_ms || 0;
      if (hpMs <= 0) continue;
      const nearestBeat = timeline.reduce((best: any, t: any) => {
        const dist = Math.abs((t.start_ms || 0) - hpMs);
        return (!best || dist < best.dist) ? { entry: t, dist } : best;
      }, null as any);
      if (nearestBeat && nearestBeat.dist > 200) {
        rhythmViolations.push(`Hit marker "${hp.type}" at ${hpMs}ms — nearest cut at ${nearestBeat.entry.start_ms}ms (${nearestBeat.dist}ms drift)`);
      }
    }

    // 2) Verify no clip crosses a mandated silence window
    for (const sw of silenceWindows) {
      const swStart = sw.start_ms || 0;
      const swEnd = sw.end_ms || 0;
      if (swEnd <= swStart) continue;
      for (const t of timeline) {
        const tStart = t.start_ms || 0;
        const tEnd = tStart + (t.effective_duration_ms || t.duration_ms || 0);
        // Check if clip overlaps silence window interior (not just boundary)
        if (tStart < swEnd && tEnd > swStart && t.has_clip && !t.is_text_card) {
          const overlap = Math.min(tEnd, swEnd) - Math.max(tStart, swStart);
          if (overlap > 100) { // >100ms overlap is a violation
            rhythmViolations.push(`Beat #${t.beat_index} crosses silence window ${swStart}–${swEnd}ms (${overlap}ms overlap)`);
          }
        }
      }
    }

    // 3) Ensure crescendo drop aligns to strongest visual beat
    if (dropMs) {
      const dropBeat = timeline.find((t: any) => {
        const tStart = t.start_ms || 0;
        const tEnd = tStart + (t.effective_duration_ms || t.duration_ms || 0);
        return tStart <= dropMs && tEnd >= dropMs;
      });
      if (dropBeat && !dropBeat.has_clip) {
        rhythmViolations.push(`Drop marker at ${dropMs}ms falls on beat #${dropBeat.beat_index} which has no clip`);
      }
    }
  }

  // ── Assembly Gates ──
  const assemblyFailures: string[] = [...rhythmViolations];
  const clipsPresent = timeline.filter((t: any) => t.has_clip).length;
  const totalBeats = timeline.length;
  const clipCoverage = totalBeats > 0 ? clipsPresent / totalBeats : 0;

  // Gate: minimum clip coverage (at least 60%)
  if (clipCoverage < 0.6) {
    assemblyFailures.push(`Only ${Math.round(clipCoverage * 100)}% of beats have clips — need ≥60%`);
  }

  // Gate: beat count sanity (at least 6 beats)
  if (totalBeats < 6) {
    assemblyFailures.push(`Only ${totalBeats} beats in timeline — trailers need ≥6`);
  }

  // Gate: button beat exists (last beat should have role or phase hint)
  const lastBeat = timeline[timeline.length - 1];
  if (lastBeat && !["button", "title_card"].includes(lastBeat.role)) {
    // Soft warning, not blocking
  }

  // Gate: total duration sanity
  if (totalDurationMs < 15000) {
    assemblyFailures.push(`Total duration ${Math.round(totalDurationMs / 1000)}s too short — need ≥15s`);
  }
  if (totalDurationMs > 300000) {
    assemblyFailures.push(`Total duration ${Math.round(totalDurationMs / 1000)}s too long — trailers should be ≤300s`);
  }

  const assemblyGates = { passed: assemblyFailures.length === 0, failures: assemblyFailures };

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
          out_point_ms: t.trim_out_ms ?? (t.duration_ms || 0),
          timeline_start_ms: t.start_ms,
          duration_ms: t.effective_duration_ms || Math.max(0, (t.trim_out_ms ?? (t.duration_ms || 0)) - (t.trim_in_ms || 0)),
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
    gates_json: assemblyGates,
  }).select().single();

  if (cutErr) return json({ error: cutErr.message }, 500);

  await logCutEvent(db, {
    project_id: projectId, cut_id: cut.id, blueprint_id: blueprintId,
    event_type: "create_cut",
    payload: { beatCount: timeline.length, totalDurationMs, hasClips: clipsPresent, gates: assemblyGates },
    created_by: userId,
  });

  // Log rhythm violations separately for tracking
  if (rhythmViolations.length > 0) {
    await logCutEvent(db, {
      project_id: projectId, cut_id: cut.id, blueprint_id: blueprintId,
      event_type: "rhythm_violation",
      payload: { violations: rhythmViolations, count: rhythmViolations.length },
      created_by: userId,
    });
  }

  return json({ ok: true, cutId: cut.id, timeline, edlExport, totalDurationMs, gates: assemblyGates, rhythmViolations });
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
      out_point_ms: t.trim_out_ms ?? (t.duration_ms || 0),
      timeline_start_ms: t.start_ms,
      duration_ms: t.effective_duration_ms || Math.max(0, (t.trim_out_ms ?? (t.duration_ms || 0)) - (t.trim_in_ms || 0)),
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

  // ─── Load rhythm markers if available ───
  let markers: any = { hit_points: [], silence_windows: [], drop_ms: null };
  const bpId = cut.blueprint_id;
  if (bpId) {
    // Find rhythm run via blueprint options or script run
    const { data: bp } = await db.from("trailer_blueprints")
      .select("options").eq("id", bpId).single();
    const rhythmRunId = bp?.options?.rhythm_run_id;
    const scriptRunId = bp?.options?.script_run_id;

    let rhythmRun: any = null;
    if (rhythmRunId) {
      const { data: rr } = await db.from("trailer_rhythm_runs")
        .select("hit_points_json, silence_windows_json, drop_timestamp_ms")
        .eq("id", rhythmRunId).single();
      rhythmRun = rr;
    } else if (scriptRunId) {
      const { data: rrs } = await db.from("trailer_rhythm_runs")
        .select("hit_points_json, silence_windows_json, drop_timestamp_ms")
        .eq("script_run_id", scriptRunId)
        .eq("status", "complete")
        .order("created_at", { ascending: false })
        .limit(1);
      rhythmRun = rrs?.[0];
    }

    if (rhythmRun) {
      markers = {
        hit_points: rhythmRun.hit_points_json || [],
        silence_windows: rhythmRun.silence_windows_json || [],
        drop_ms: rhythmRun.drop_timestamp_ms || null,
      };
    }
  }

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
    markers,
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

  const { data: bp } = await db.from("trailer_blueprints").select("edl, arc_type, audio_plan, text_card_plan, options")
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

  // ─── Load rhythm markers ───
  let markers: any = { hit_points: [], silence_windows: [], drop_ms: null };
  const rhythmRunId = bp.options?.rhythm_run_id;
  const scriptRunId = bp.options?.script_run_id;

  let rhythmRun: any = null;
  if (rhythmRunId) {
    const { data: rr } = await db.from("trailer_rhythm_runs")
      .select("hit_points_json, silence_windows_json, drop_timestamp_ms")
      .eq("id", rhythmRunId).single();
    rhythmRun = rr;
  } else if (scriptRunId) {
    const { data: rrs } = await db.from("trailer_rhythm_runs")
      .select("hit_points_json, silence_windows_json, drop_timestamp_ms")
      .eq("script_run_id", scriptRunId)
      .eq("status", "complete")
      .order("created_at", { ascending: false })
      .limit(1);
    rhythmRun = rrs?.[0];
  }

  if (rhythmRun) {
    markers = {
      hit_points: rhythmRun.hit_points_json || [],
      silence_windows: rhythmRun.silence_windows_json || [],
      drop_ms: rhythmRun.drop_timestamp_ms || null,
    };
  }

  return json({ beats, audioPlan: bp.audio_plan, textCardPlan: bp.text_card_plan, arcType: bp.arc_type, markers });
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

  const originalTimeline = JSON.stringify(timeline);

  for (let i = 0; i < timeline.length; i++) {
    const beat = timeline[i];
    const plannedMs = beat.duration_ms || 3000;
    const clipDur = beat.clip_id ? (clipDurMap[beat.clip_id] || null) : null;

    const trimIn = beat.trim_in_ms || 0;
    const trimOut = beat.trim_out_ms || 0;
    const hasInvalidTrims = (trimOut <= 0 && plannedMs > 0) || trimIn >= trimOut;
    const hasInvalidEffective = !beat.is_text_card && plannedMs > 0 && (beat.effective_duration_ms || 0) <= 0;

    if (hasInvalidTrims || hasInvalidEffective) {
      const trims = computeTrims(beat, clipDur);
      timeline[i] = { ...beat, ...trims, clip_duration_ms: clipDur };
      fixedCount++;
    }
  }

  timeline = recomputeTimeline(timeline);
  const totalDurationMs = timeline.reduce((s: number, t: any) => s + (t.effective_duration_ms || t.duration_ms), 0);
  const existingClips = cut.edl_export?.tracks?.[0]?.clips || [];
  const needsEdlRefresh = existingClips.length !== timeline.length || existingClips.some((clip: any, i: number) => {
    const t = timeline[i];
    const expectedOut = t.trim_out_ms ?? (t.duration_ms || 0);
    const expectedDur = t.effective_duration_ms || Math.max(0, expectedOut - (t.trim_in_ms || 0));
    return (clip.out_point_ms ?? null) !== expectedOut || (clip.duration_ms ?? null) !== expectedDur || (clip.timeline_start_ms ?? null) !== (t.start_ms || 0);
  });
  const changed = fixedCount > 0 || JSON.stringify(timeline) !== originalTimeline || totalDurationMs !== (cut.duration_ms || 0) || needsEdlRefresh;

  if (changed) {
    const edlExport = {
      ...(cut.edl_export || {}),
      total_duration_ms: totalDurationMs,
      tracks: [
        {
          name: "V1",
          type: "video",
          clips: timeline.map((t: any) => ({
            beat_index: t.beat_index,
            role: t.role,
            source: t.clip_url || (t.is_text_card ? "TEXT_CARD" : "PLACEHOLDER"),
            in_point_ms: t.trim_in_ms || 0,
            out_point_ms: t.trim_out_ms ?? (t.duration_ms || 0),
            timeline_start_ms: t.start_ms,
            duration_ms: t.effective_duration_ms || Math.max(0, (t.trim_out_ms ?? (t.duration_ms || 0)) - (t.trim_in_ms || 0)),
            text_overlay: t.text_overlay,
            text_content: t.text_content,
            is_text_card: t.is_text_card,
          })),
        },
      ],
    };

    await db.from("trailer_cuts").update({ timeline, duration_ms: totalDurationMs, edl_export: edlExport }).eq("id", cutId);
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

// ─── Delete Cut ───
async function handleDeleteCut(db: any, body: any, userId: string) {
  const { projectId, cutId } = body;
  if (!cutId) return json({ error: "cutId required" }, 400);

  // Only allow deleting failed or draft cuts
  const { data: cut, error: fetchErr } = await db
    .from("trailer_cuts")
    .select("id, status, storage_path")
    .eq("id", cutId)
    .eq("project_id", projectId)
    .single();

  if (fetchErr || !cut) return json({ error: "Cut not found" }, 404);
  if (!["failed", "draft", "error"].includes(cut.status)) {
    return json({ error: `Cannot delete cut with status '${cut.status}'. Only failed/draft cuts can be deleted.` }, 400);
  }

  // Clean up storage if there's a file
  if (cut.storage_path) {
    await db.storage.from("trailers").remove([cut.storage_path]);
  }

  // Delete events first (FK)
  await db.from("trailer_cut_events").delete().eq("cut_id", cutId);

  // Delete the cut
  const { error: delErr } = await db.from("trailer_cuts").delete().eq("id", cutId).eq("project_id", projectId);
  if (delErr) return json({ error: delErr.message }, 500);

  return json({ ok: true, deleted: cutId });
}

// ─── Shuffle Montage Group ───
async function handleShuffleMontage(db: any, body: any, userId: string) {
  const { projectId, cutId, montageGroupId } = body;
  if (!cutId || !montageGroupId) return json({ error: "cutId and montageGroupId required" }, 400);

  const { data: cut } = await db.from("trailer_cuts").select("*")
    .eq("id", cutId).eq("project_id", projectId).single();
  if (!cut) return json({ error: "Cut not found" }, 404);

  let timeline = [...(cut.timeline || [])];

  // Find beats in this montage group
  const groupIndices: number[] = [];
  for (let i = 0; i < timeline.length; i++) {
    if (timeline[i].montage_group_id === montageGroupId) {
      groupIndices.push(i);
    }
  }

  if (groupIndices.length < 2) return json({ error: "Montage group has fewer than 2 entries" }, 400);

  // Fisher-Yates shuffle within the group
  const groupEntries = groupIndices.map(i => ({ ...timeline[i] }));
  for (let i = groupEntries.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [groupEntries[i], groupEntries[j]] = [groupEntries[j], groupEntries[i]];
  }

  // Put them back
  for (let k = 0; k < groupIndices.length; k++) {
    timeline[groupIndices[k]] = groupEntries[k];
  }

  timeline = recomputeTimeline(timeline);
  const totalDurationMs = timeline.reduce((s: number, t: any) => s + (t.effective_duration_ms || t.duration_ms), 0);

  await db.from("trailer_cuts").update({ timeline, duration_ms: totalDurationMs }).eq("id", cutId);

  await logCutEvent(db, {
    project_id: projectId, cut_id: cutId,
    event_type: "shuffle_montage",
    payload: { montageGroupId, shuffledCount: groupEntries.length },
    created_by: userId,
  });

  return json({ ok: true, timeline, totalDurationMs, shuffledCount: groupEntries.length });
}

// ─── Compute Project Bias ───
async function handleComputeProjectBias(db: any, body: any, userId: string) {
  const { projectId } = body;

  // Load last 100 learning signals
  const { data: signals } = await db.from("trailer_learning_signals")
    .select("*")
    .eq("project_id", projectId)
    .order("occurred_at", { ascending: false })
    .limit(100);

  if (!signals?.length) {
    return json({ ok: true, bias: null, message: "No learning signals yet" });
  }

  // Analyze signals
  const profileCounts: Record<string, number> = {};
  const providerCounts: Record<string, number> = {};
  let totalMotionOverrides = 0;
  let highMotionSelections = 0;
  let totalBpmFromApproved = 0;
  let approvedCount = 0;
  let silenceShortenCount = 0;

  for (const sig of signals) {
    const val = sig.signal_value_json || {};

    if (sig.signal_key === "manual_select" || sig.signal_key === "clip_selection") {
      const profile = val.generation_profile || val.provider;
      if (profile) profileCounts[profile] = (profileCounts[profile] || 0) + 1;
      if (val.provider) providerCounts[val.provider] = (providerCounts[val.provider] || 0) + 1;
      if ((val.motion_score || 0) >= 7) highMotionSelections++;
    }

    if (sig.signal_key === "override_auto_pick" || sig.signal_key === "clip_override") {
      totalMotionOverrides++;
    }

    if (sig.signal_key === "final_cut" || sig.signal_key === "cut_approved") {
      if (val.bpm) { totalBpmFromApproved += val.bpm; approvedCount++; }
    }

    if (sig.signal_key === "silence_shortened") {
      silenceShortenCount++;
    }

    if (sig.signal_key === "variant_preference") {
      const profile = val.tonePreset || val.generation_profile;
      if (profile) profileCounts[profile] = (profileCounts[profile] || 0) + 2; // variant selections weight more
    }
  }

  // Derive preferred profile (most selected)
  let preferred_profile: string | null = null;
  let maxCount = 0;
  for (const [k, v] of Object.entries(profileCounts)) {
    if (v > maxCount) { maxCount = v; preferred_profile = k; }
  }

  // Derive preferred provider
  let preferred_provider: string | null = null;
  let maxProvCount = 0;
  for (const [k, v] of Object.entries(providerCounts)) {
    if (v > maxProvCount) { maxProvCount = v; preferred_provider = k; }
  }

  // Motion bias: +1 if >40% high-motion selections, +2 if >60%
  const totalSelections = Object.values(profileCounts).reduce((s, v) => s + v, 0) || 1;
  const motionRatio = highMotionSelections / totalSelections;
  let motion_bias = 0;
  if (motionRatio > 0.6) motion_bias = 2;
  else if (motionRatio > 0.4) motion_bias = 1;
  if (totalMotionOverrides > 5) motion_bias = Math.min(2, motion_bias + 1);

  // Pacing bias
  let pacing_bias: string | null = null;
  if (approvedCount > 0) {
    const avgBpm = totalBpmFromApproved / approvedCount;
    if (avgBpm > 120) pacing_bias = "faster";
    else if (avgBpm < 95) pacing_bias = "slower";
  }

  // Silence bias
  let silence_bias = 0;
  if (silenceShortenCount > 3) silence_bias = -1;

  const bias = {
    preferred_profile,
    preferred_provider,
    motion_bias,
    silence_bias,
    pacing_bias,
    computed_at: new Date().toISOString(),
    signal_count: signals.length,
  };

  // Store in projects table
  await db.from("projects").update({ trailer_bias_json: bias }).eq("id", projectId);

  return json({ ok: true, bias });
}

// ─── Reset Project Bias ───
async function handleResetProjectBias(db: any, body: any, _userId: string) {
  const { projectId } = body;
  await db.from("projects").update({ trailer_bias_json: null }).eq("id", projectId);
  return json({ ok: true, message: "Trailer bias reset" });
}

// ─── Get Project Bias ───
async function handleGetProjectBias(db: any, body: any) {
  const { projectId } = body;
  const { data } = await db.from("projects").select("trailer_bias_json").eq("id", projectId).single();
  return json({ ok: true, bias: data?.trailer_bias_json || null });
}

// ─── Auto Assemble Cut v1 ───
async function handleAutoAssembleCut(db: any, body: any, userId: string) {
  const {
    projectId,
    blueprintId: rawBpId,
    scriptRunId: rawScriptRunId,
    rhythmRunId: rawRhythmRunId,
    strategy = "best_scores",
    cutTitle = "Auto Cut v1",
  } = body;

  // 1) Resolve blueprint
  let blueprintId = rawBpId;
  let scriptRunId = rawScriptRunId;
  if (!blueprintId) {
    // Find latest blueprint for project (optionally filtered by script run)
    let q = db.from("trailer_blueprints").select("id, options").eq("project_id", projectId).order("created_at", { ascending: false }).limit(1);
    const { data: bps } = await q;
    if (!bps?.length) return json({ error: "No blueprints found for project" }, 404);
    blueprintId = bps[0].id;
    if (!scriptRunId) scriptRunId = bps[0].options?.script_run_id;
  }

  // Load blueprint
  const { data: bp } = await db.from("trailer_blueprints").select("*").eq("id", blueprintId).eq("project_id", projectId).single();
  if (!bp) return json({ error: "Blueprint not found" }, 404);
  if (!scriptRunId) scriptRunId = bp.options?.script_run_id;

  // 2) Load rhythm run
  let rhythmRunId = rawRhythmRunId;
  let rhythmRun: any = null;
  if (rhythmRunId) {
    const { data: rr } = await db.from("trailer_rhythm_runs").select("*").eq("id", rhythmRunId).single();
    rhythmRun = rr;
  } else if (scriptRunId) {
    const { data: rrs } = await db.from("trailer_rhythm_runs").select("*")
      .eq("script_run_id", scriptRunId).eq("status", "complete")
      .order("created_at", { ascending: false }).limit(1);
    rhythmRun = rrs?.[0];
    if (rhythmRun) rhythmRunId = rhythmRun.id;
  }

  const hitPoints = rhythmRun?.hit_points_json || [];
  const silenceWindows = rhythmRun?.silence_windows_json || [];
  const dropMs = rhythmRun?.drop_timestamp_ms || null;

  // 3) Load EDL beats
  const edl = bp.edl || [];
  const textCardPlan = bp.text_card_plan || [];
  const textCardBeats = new Set(textCardPlan.map((tc: any) => tc.beat_index));

  // 4) Load all clips for this blueprint, excluding rejected
  const { data: allClips } = await db.from("trailer_clips").select("*")
    .eq("blueprint_id", blueprintId).eq("project_id", projectId)
    .neq("status", "rejected")
    .order("beat_index").order("created_at", { ascending: false });

  // Also try to load clip scores if they exist
  const clipIds = (allClips || []).map((c: any) => c.id);
  let clipScoresMap: Record<string, any> = {};
  if (clipIds.length > 0) {
    try {
      const { data: scores } = await db.from("trailer_clip_scores").select("*").in("clip_id", clipIds);
      for (const s of (scores || [])) { clipScoresMap[s.clip_id] = s; }
    } catch { /* table may not exist */ }
  }

  // Group clips by beat_index
  const clipsByBeat: Record<number, any[]> = {};
  for (const c of (allClips || [])) {
    if (c.auto_rejected) continue;
    if (c.status !== "complete" && c.status !== "selected" && c.status !== "ready") continue;
    if (!clipsByBeat[c.beat_index]) clipsByBeat[c.beat_index] = [];
    clipsByBeat[c.beat_index].push(c);
  }

  // 5) Load beat phases from script beats if available
  let beatPhases: Record<number, string> = {};
  if (scriptRunId) {
    const { data: scriptBeats } = await db.from("trailer_script_beats").select("beat_index, phase")
      .eq("script_run_id", scriptRunId).order("beat_index");
    for (const sb of (scriptBeats || [])) {
      beatPhases[sb.beat_index] = sb.phase;
    }
  }

  // 5b) Load project bias for weighting
  let projectBias: any = null;
  try {
    const { data: proj } = await db.from("projects").select("trailer_bias_json").eq("id", projectId).single();
    projectBias = proj?.trailer_bias_json || null;
  } catch { /* no bias */ }

  const motionBias = projectBias?.motion_bias || 0;
  const preferredProvider = projectBias?.preferred_provider || null;

  // Phase defaults for trim durations (ms)
  const phaseDurationDefaults: Record<string, [number, number]> = {
    hook: [2500, 4000],
    setup: [3000, 4000],
    escalation: [2000, 3000],
    twist: [1500, 2500],
    crescendo: [700, 1200],
    button: [1200, 2000],
  };

  // 6) Auto-pick + auto-trim per beat
  const pickedClips: any[] = [];
  const trimDecisions: any[] = [];
  const textCardDecisions: any[] = [];
  let missingCount = 0;

  let timeline = edl.map((beat: any, idx: number) => {
    const isTextCard = beat.role === "title_card" || textCardBeats.has(idx);
    const durationMs = Math.round((beat.duration_s || 3) * 1000);
    const phase = beatPhases[idx] || beat.role || "setup";
    const textContent = isTextCard
      ? (textCardPlan.find((tc: any) => tc.beat_index === idx)?.text || beat.clip_spec?.text_overlay || beat.role.toUpperCase())
      : null;

    // Auto-pick best clip
    const candidates = clipsByBeat[idx] || [];
    let bestClip: any = null;
    let bestScore = -1;
    let pickReason = "";

    for (const c of candidates) {
      const techScore = c.technical_score ?? 5;
      const clipScore = clipScoresMap[c.id]?.overall ?? 0;
      let score = techScore * 0.55 + clipScore * 10 * 0.35;

      // Motion bonus for high-energy phases
      const motionScore = c.motion_score ?? 5;
      if (["hook", "twist", "crescendo"].includes(phase) && motionScore >= 7) score += 2 * 0.10;
      // Clarity bonus near silence windows
      const clarityScore = c.clarity_score ?? 5;
      const nearSilence = silenceWindows.some((sw: any) => Math.abs((sw.start_ms || 0) - idx * durationMs) < durationMs * 2);
      if (nearSilence && clarityScore >= 7) score += 1;
      // Dialogue forward: prefer clean artifacts
      if (strategy === "dialogue_forward" && (c.artifact_score ?? 5) >= 6) score += 0.5;
      // Motion forward: extra motion weight
      if (strategy === "motion_forward") score += motionScore * 0.15;
      // Apply learned bias: motion boost
      if (motionBias > 0) score += motionScore * 0.05 * motionBias;
      // Apply learned bias: preferred provider
      if (preferredProvider && c.provider === preferredProvider) score += 0.5;

      if (score > bestScore) {
        bestScore = score;
        bestClip = c;
        pickReason = `score=${score.toFixed(1)} tech=${techScore} motion=${motionScore}`;
      }
    }

    if (!bestClip && !isTextCard) {
      missingCount++;
      pickedClips.push({ beat_index: idx, clip_id: null, reason: "PLACEHOLDER - no viable clip", scores_snapshot: null });
    } else if (bestClip) {
      pickedClips.push({
        beat_index: idx, clip_id: bestClip.id, reason: pickReason,
        scores_snapshot: { technical: bestClip.technical_score, motion: bestClip.motion_score, clarity: bestClip.clarity_score },
      });
    }

    // Auto-trim
    const clipDurationMs = bestClip?.duration_ms || bestClip?.metadata?.duration_ms || null;
    const [minDur, maxDur] = phaseDurationDefaults[phase] || [2000, 4000];
    let targetDur = durationMs;
    if (targetDur < minDur) targetDur = minDur;
    if (targetDur > maxDur) targetDur = maxDur;

    let trimIn = 0;
    let trimOut = targetDur;
    if (clipDurationMs && clipDurationMs > 0) {
      trimOut = Math.min(clipDurationMs, targetDur);
      // Prefer middle section for motion continuity
      if (clipDurationMs > targetDur) {
        const slack = clipDurationMs - targetDur;
        trimIn = Math.floor(slack * 0.25); // Start 25% in for better content
        trimOut = trimIn + targetDur;
      }
    }

    // Ensure trims don't cross silence windows
    // (check is done after timeline is built)

    const trimReason = `phase=${phase} target=${targetDur}ms clip=${clipDurationMs || 'none'}ms`;
    trimDecisions.push({ beat_index: idx, clip_id: bestClip?.id || null, in_ms: trimIn, out_ms: trimOut, reason: trimReason });

    return {
      beat_index: idx,
      role: beat.role,
      duration_ms: durationMs,
      trim_in_ms: trimIn,
      trim_out_ms: trimOut,
      start_ms: 0,
      effective_duration_ms: Math.max(0, trimOut - trimIn) || durationMs,
      clip_id: bestClip?.id || null,
      clip_url: bestClip?.public_url || null,
      clip_duration_ms: clipDurationMs,
      media_type: bestClip?.media_type || "video",
      text_overlay: beat.clip_spec?.text_overlay || null,
      audio_cue: beat.clip_spec?.audio_cue || null,
      is_text_card: isTextCard,
      text_content: textContent,
      provider: bestClip?.provider || null,
      has_clip: !!bestClip,
      phase,
      locked: false,
    };
  });

  // 7) Recompute timeline positions
  timeline = recomputeTimeline(timeline);
  const totalDurationMs = timeline.reduce((s: number, t: any) => s + (t.effective_duration_ms || t.duration_ms), 0);

  // 8) Align to hit markers
  let twistHitAligned = false;
  let dropAligned = false;

  for (const hp of hitPoints) {
    const hpMs = hp.t_ms || hp.timestamp_ms || 0;
    if (hpMs <= 0) continue;
    const nearestBeat = timeline.reduce((best: any, t: any) => {
      const dist = Math.abs((t.start_ms || 0) - hpMs);
      return (!best || dist < best.dist) ? { entry: t, dist } : best;
    }, null as any);
    if (nearestBeat && nearestBeat.dist <= 200) {
      if (hp.type === "twist_hit") twistHitAligned = true;
      if (hp.type === "crescendo_drop") dropAligned = true;
    }
  }

  // 9) Text card placement: place at silence windows or calm beats
  for (const tc of textCardPlan) {
    const beatIdx = tc.beat_index;
    const beatEntry = timeline[beatIdx];
    if (!beatEntry) continue;
    const phase = beatEntry.phase || beatEntry.role;
    // Don't place during crescendo
    if (phase === "crescendo") continue;
    // Find nearest silence window or use beat start
    let placementMs = beatEntry.start_ms || 0;
    const nearestSw = silenceWindows.find((sw: any) => Math.abs((sw.start_ms || 0) - placementMs) < 5000);
    if (nearestSw) placementMs = nearestSw.start_ms;
    textCardDecisions.push({ beat_index: beatIdx, text: tc.text, timestamp_ms: placementMs, reason: nearestSw ? "aligned_to_silence" : "at_beat_start" });
  }

  // 10) Build auto_assembly_json
  const autoAssemblyJson = {
    picked_clips: pickedClips,
    trims: trimDecisions,
    text_cards: textCardDecisions,
    alignment: {
      drop_ms: dropMs,
      twist_hit_aligned: twistHitAligned,
      drop_aligned: dropAligned,
      silence_windows_applied: silenceWindows.length > 0,
    },
    strategy,
    version: "v1",
  };

  // 11) Build EDL export
  const edlExport = {
    version: "2.0",
    project_id: projectId,
    blueprint_id: blueprintId,
    arc_type: bp.arc_type,
    created_at: new Date().toISOString(),
    total_duration_ms: totalDurationMs,
    fps: 24,
    resolution: { width: 1280, height: 720 },
    tracks: [{
      name: "V1", type: "video",
      clips: timeline.map((t: any) => ({
        beat_index: t.beat_index, role: t.role,
        source: t.clip_url || (t.is_text_card ? "TEXT_CARD" : "PLACEHOLDER"),
        in_point_ms: t.trim_in_ms || 0,
        out_point_ms: t.trim_out_ms ?? (t.duration_ms || 0),
        timeline_start_ms: t.start_ms,
        duration_ms: t.effective_duration_ms || Math.max(0, (t.trim_out_ms ?? (t.duration_ms || 0)) - (t.trim_in_ms || 0)),
        text_overlay: t.text_overlay, text_content: t.text_content, is_text_card: t.is_text_card,
      })),
    }],
    text_cards: textCardPlan,
    audio_plan: bp.audio_plan || {},
  };

  // 12) Insert cut
  const { data: cut, error: cutErr } = await db.from("trailer_cuts").insert({
    project_id: projectId,
    blueprint_id: blueprintId,
    status: "draft",
    timeline,
    edl_export: edlExport,
    duration_ms: totalDurationMs,
    options: { strategy, auto_assembled: true },
    created_by: userId,
    title: cutTitle,
    arc_type: bp.arc_type,
    render_width: 1280,
    render_height: 720,
    render_fps: 24,
    auto_assembly_json: autoAssemblyJson,
  }).select().single();

  if (cutErr) return json({ error: cutErr.message }, 500);

  // 13) Log events
  await logCutEvent(db, {
    project_id: projectId, cut_id: cut.id, blueprint_id: blueprintId,
    event_type: "auto_assemble_started",
    payload: { strategy, blueprintId, rhythmRunId },
    created_by: userId,
  });

  for (const pc of pickedClips) {
    await logCutEvent(db, {
      project_id: projectId, cut_id: cut.id, blueprint_id: blueprintId,
      beat_index: pc.beat_index,
      event_type: pc.clip_id ? "auto_clip_picked" : "auto_clip_missing",
      payload: pc,
      created_by: userId,
    });
  }

  await logCutEvent(db, {
    project_id: projectId, cut_id: cut.id, blueprint_id: blueprintId,
    event_type: "auto_assemble_complete",
    payload: { pickedCount: pickedClips.filter(p => p.clip_id).length, missingCount, totalDurationMs },
    created_by: userId,
  });

  return json({
    ok: true,
    cutId: cut.id,
    pickedCount: pickedClips.filter(p => p.clip_id).length,
    missingCount,
    appliedSilenceWindows: silenceWindows.length,
    alignedHits: { twistHitAligned, dropAligned },
    decisions: autoAssemblyJson,
  });
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
      case "delete_cut": return await handleDeleteCut(db, body, userId);
      case "shuffle_montage": return await handleShuffleMontage(db, body, userId);
      case "auto_assemble_cut_v1": return await handleAutoAssembleCut(db, body, userId);
      case "compute_project_bias": return await handleComputeProjectBias(db, body, userId);
      case "reset_project_bias": return await handleResetProjectBias(db, body, userId);
      case "get_project_bias": return await handleGetProjectBias(db, body);
      default: return json({ error: `Unknown action: ${action}` }, 400);
    }
  } catch (err: any) {
    console.error("trailer-assembler error:", err);
    return json({ error: err.message || "Internal error" }, 500);
  }
});
