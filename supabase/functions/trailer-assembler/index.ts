/**
 * trailer-assembler — Manages trailer cut metadata, timeline, and EDL export.
 * Actual video rendering is client-side (Canvas + MediaRecorder).
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

// ─── Create Cut ───
async function handleCreateCut(db: any, body: any, userId: string) {
  const { projectId, blueprintId, options = {} } = body;
  if (!blueprintId) return json({ error: "blueprintId required" }, 400);

  // Get blueprint + selected clips
  const { data: bp } = await db.from("trailer_blueprints").select("*")
    .eq("id", blueprintId).eq("project_id", projectId).single();
  if (!bp) return json({ error: "Blueprint not found" }, 404);

  const { data: clips } = await db.from("trailer_clips").select("*")
    .eq("blueprint_id", blueprintId).eq("project_id", projectId)
    .eq("used_in_cut", true)
    .order("beat_index");

  // Build timeline from EDL + selected clips
  const edl = bp.edl || [];
  const clipMap: Record<number, any> = {};
  for (const c of (clips || [])) {
    clipMap[c.beat_index] = c;
  }

  const timeline = edl.map((beat: any, idx: number) => {
    const clip = clipMap[idx];
    return {
      beat_index: idx,
      role: beat.role,
      duration_ms: Math.round((beat.duration_s || 3) * 1000),
      clip_id: clip?.id || null,
      clip_url: clip?.public_url || null,
      media_type: clip?.media_type || "video",
      text_overlay: beat.clip_spec?.text_overlay || null,
      audio_cue: beat.clip_spec?.audio_cue || null,
    };
  });

  const totalDurationMs = timeline.reduce((s: number, t: any) => s + t.duration_ms, 0);

  // Build JSON EDL for NLE export
  const edlExport = {
    version: "1.0",
    project_id: projectId,
    blueprint_id: blueprintId,
    arc_type: bp.arc_type,
    created_at: new Date().toISOString(),
    total_duration_ms: totalDurationMs,
    fps: options.fps || 24,
    resolution: { width: options.width || 1920, height: options.height || 1080 },
    tracks: [
      {
        name: "V1",
        type: "video",
        clips: timeline.filter((t: any) => t.media_type === "video" || t.media_type === "sfx" || !t.clip_id).map((t: any, i: number) => ({
          index: i,
          beat_index: t.beat_index,
          role: t.role,
          source: t.clip_url || "PLACEHOLDER",
          in_point_ms: 0,
          out_point_ms: t.duration_ms,
          timeline_start_ms: timeline.slice(0, timeline.indexOf(t)).reduce((s: number, x: any) => s + x.duration_ms, 0),
          duration_ms: t.duration_ms,
          text_overlay: t.text_overlay,
        })),
      },
      {
        name: "A1",
        type: "audio",
        clips: timeline.filter((t: any) => t.media_type === "music" || t.media_type === "sfx").map((t: any) => ({
          beat_index: t.beat_index,
          source: t.clip_url || "PLACEHOLDER",
          duration_ms: t.duration_ms,
          audio_cue: t.audio_cue,
        })),
      },
    ],
    text_cards: (bp.text_card_plan || []).map((tc: any) => ({
      beat_index: tc.beat_index,
      text: tc.text,
      style: tc.style,
      duration_s: tc.duration_s,
    })),
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
  }).select().single();

  if (cutErr) return json({ error: cutErr.message }, 500);
  return json({ ok: true, cutId: cut.id, timeline, edlExport, totalDurationMs });
}

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

async function handleSetCutStatus(db: any, body: any) {
  const { projectId, cutId, status, error: errorMsg, storagePath, publicUrl, durationMs } = body;
  if (!cutId) return json({ error: "cutId required" }, 400);
  const update: any = { status };
  if (errorMsg) update.error = errorMsg;
  if (storagePath) update.storage_path = storagePath;
  if (publicUrl) update.public_url = publicUrl;
  if (durationMs) update.duration_ms = durationMs;
  const { error } = await db.from("trailer_cuts").update(update)
    .eq("id", cutId).eq("project_id", projectId);
  if (error) return json({ error: error.message }, 500);
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

  // Group clips by beat
  const clipsByBeat: Record<number, any[]> = {};
  for (const c of (clips || [])) {
    if (!clipsByBeat[c.beat_index]) clipsByBeat[c.beat_index] = [];
    clipsByBeat[c.beat_index].push(c);
  }

  const beats = (bp.edl || []).map((beat: any, idx: number) => ({
    ...beat,
    beat_index: idx,
    clips: clipsByBeat[idx] || [],
    selected_clip: (clipsByBeat[idx] || []).find((c: any) => c.used_in_cut) || null,
  }));

  return json({ beats, audioPlan: bp.audio_plan, textCardPlan: bp.text_card_plan, arcType: bp.arc_type });
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
      case "list_cuts": return await handleListCuts(db, body);
      case "get_cut": return await handleGetCut(db, body);
      case "set_cut_status": return await handleSetCutStatus(db, body);
      case "get_timeline": return await handleGetTimeline(db, body);
      default: return json({ error: `Unknown action: ${action}` }, 400);
    }
  } catch (err: any) {
    console.error("trailer-assembler error:", err);
    return json({ error: err.message || "Internal error" }, 500);
  }
});
