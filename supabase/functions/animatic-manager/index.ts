/**
 * animatic-manager — Manages animatic runs, returns assets for client-side rendering.
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
  const { data: proj } = await db.from("projects").select("id").eq("id", projectId).eq("user_id", userId).limit(1).maybeSingle();
  if (proj) return true;
  const { data: collab } = await db.from("project_collaborators").select("id").eq("project_id", projectId).eq("user_id", userId).eq("status", "accepted").limit(1).maybeSingle();
  return !!collab;
}

// ─── CREATE RUN ───
async function handleCreateRun(db: any, body: any, userId: string) {
  const { projectId, storyboardRunId, options = {} } = body;
  if (!storyboardRunId) return json({ error: "storyboardRunId required" }, 400);

  const defaults = {
    width: 1280, height: 720, fps: 24,
    default_duration_ms: 900, lead_in_ms: 300, tail_out_ms: 500,
    caption: true, watermark: false,
  };
  const mergedOptions = { ...defaults, ...options };

  const { data: run, error } = await db.from("animatic_runs").insert({
    project_id: projectId,
    storyboard_run_id: storyboardRunId,
    status: "draft",
    options: mergedOptions,
    created_by: userId,
  }).select().single();

  if (error) return json({ error: "Failed to create animatic run: " + error.message }, 500);
  return json({ ok: true, animaticRunId: run.id, options: mergedOptions });
}

// ─── GET RUN ───
async function handleGetRun(db: any, body: any) {
  const { projectId, animaticRunId } = body;
  if (!animaticRunId) return json({ error: "animaticRunId required" }, 400);

  const { data: run } = await db.from("animatic_runs").select("*")
    .eq("id", animaticRunId).eq("project_id", projectId).single();
  if (!run) return json({ error: "Not found" }, 404);

  const { data: events } = await db.from("animatic_events").select("*")
    .eq("animatic_run_id", animaticRunId)
    .order("created_at", { ascending: false }).limit(20);

  return json({ run, events: events || [] });
}

// ─── GET ASSETS ───
async function handleGetAssets(db: any, body: any) {
  const { projectId, storyboardRunId, animaticRunId } = body;
  if (!storyboardRunId) return json({ error: "storyboardRunId required" }, 400);

  // Get run options if animaticRunId provided
  let options: any = { default_duration_ms: 900, caption: true };
  let ordering: any[] = [];
  if (animaticRunId) {
    const { data: run } = await db.from("animatic_runs").select("options, ordering")
      .eq("id", animaticRunId).single();
    if (run) {
      options = { ...options, ...run.options };
      ordering = Array.isArray(run.ordering) ? run.ordering : [];
    }
  }

  // Get panels ordered
  const { data: panels } = await db.from("storyboard_panels")
    .select("id, unit_key, panel_index, panel_payload, status")
    .eq("run_id", storyboardRunId).eq("project_id", projectId)
    .order("unit_key", { ascending: true })
    .order("panel_index", { ascending: true });

  if (!panels || panels.length === 0) return json({ assets: [], options, missingCount: 0 });

  // Get latest generated frame per panel
  const panelIds = panels.map((p: any) => p.id);
  const { data: allFrames } = await db.from("storyboard_pipeline_frames")
    .select("id, panel_id, public_url, storage_path, status, created_at")
    .in("panel_id", panelIds).eq("status", "generated")
    .order("created_at", { ascending: false });

  const frameMap: Record<string, any> = {};
  for (const f of (allFrames || [])) {
    if (!frameMap[f.panel_id]) frameMap[f.panel_id] = f;
  }

  // Build ordering map for duration overrides
  const orderMap: Record<string, any> = {};
  for (const o of ordering) {
    if (o.panel_id) orderMap[o.panel_id] = o;
  }

  let missingCount = 0;
  const assets = panels.map((p: any) => {
    const frame = frameMap[p.id];
    const override = orderMap[p.id];
    const payload = p.panel_payload || {};

    if (!frame) missingCount++;

    const captionParts = [p.unit_key, `#${p.panel_index}`];
    if (payload.shot_type) captionParts.push(payload.shot_type);
    if (payload.camera) captionParts.push(payload.camera);
    if (payload.lens) captionParts.push(payload.lens);
    const captionLine1 = captionParts.join(" · ");
    const captionLine2 = (payload.action || "").slice(0, 80);

    return {
      panel_id: p.id,
      unit_key: p.unit_key,
      panel_index: p.panel_index,
      frame_url: frame?.public_url || null,
      storage_path: frame?.storage_path || null,
      caption_text: `${captionLine1}\n${captionLine2}`,
      duration_ms: override?.duration_ms || options.default_duration_ms || 900,
    };
  });

  return json({ assets, options, missingCount });
}

// ─── SET STATUS ───
async function handleSetStatus(db: any, body: any, userId: string) {
  const { projectId, animaticRunId, status, error: errMsg, payload = {} } = body;
  if (!animaticRunId || !status) return json({ error: "animaticRunId and status required" }, 400);

  const update: any = { status };
  if (errMsg) update.error = errMsg;
  await db.from("animatic_runs").update(update).eq("id", animaticRunId).eq("project_id", projectId);

  await db.from("animatic_events").insert({
    project_id: projectId,
    animatic_run_id: animaticRunId,
    event_type: status === 'failed' ? 'failed' : status === 'canceled' ? 'canceled' : 'progress',
    payload: { ...payload, status, error: errMsg },
    created_by: userId,
  });

  return json({ ok: true });
}

// ─── COMPLETE UPLOAD ───
async function handleCompleteUpload(db: any, body: any, userId: string) {
  const { projectId, animaticRunId, storagePath, publicUrl } = body;
  if (!animaticRunId) return json({ error: "animaticRunId required" }, 400);

  await db.from("animatic_runs").update({
    status: "complete",
    storage_path: storagePath,
    public_url: publicUrl,
  }).eq("id", animaticRunId).eq("project_id", projectId);

  await db.from("animatic_events").insert({
    project_id: projectId,
    animatic_run_id: animaticRunId,
    event_type: "uploaded",
    payload: { storagePath, publicUrl },
    created_by: userId,
  });

  return json({ ok: true });
}

// ─── LIST RUNS ───
async function handleListRuns(db: any, body: any) {
  const { projectId, storyboardRunId, limit = 10 } = body;
  let query = db.from("animatic_runs").select("*").eq("project_id", projectId);
  if (storyboardRunId) query = query.eq("storyboard_run_id", storyboardRunId);
  const { data } = await query.order("created_at", { ascending: false }).limit(limit);
  return json({ runs: data || [] });
}

// ─── Main ───
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
      case "create_run": return await handleCreateRun(db, body, userId);
      case "get_run": return await handleGetRun(db, body);
      case "get_assets": return await handleGetAssets(db, body);
      case "set_status": return await handleSetStatus(db, body, userId);
      case "complete_upload": return await handleCompleteUpload(db, body, userId);
      case "list_runs": return await handleListRuns(db, body);
      default: return json({ error: `Unknown action: ${action}` }, 400);
    }
  } catch (err: any) {
    console.error("animatic-manager error:", err);
    return json({ error: err.message || "Internal error" }, 500);
  }
});
