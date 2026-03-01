/**
 * Edge Function: ai-content-orchestrator
 * Orchestrates storyboard / animatic / trailer pipelines.
 * Actions: ping, start, status, tick, pause, resume, stop
 * Reuses existing run/job tables — no new schema.
 *
 * Controller state is stored in project_documents as doc_type='ai_content_run'
 * with run metadata in the version's meta_json field.
 */
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const BUILD = "ai-content-orchestrator-v1";

function corsHeaders(req: Request) {
  const origin = req.headers.get("Origin") || "*";
  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Headers":
      "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
    "Access-Control-Allow-Credentials": "true",
  };
}

function jsonRes(data: any, status = 200, req?: Request) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders(req!), "Content-Type": "application/json" },
  });
}

type ContentMode = "storyboard" | "animatic" | "teaser" | "trailer";
type ContentPreset = "fast" | "balanced" | "quality";
type RunStatus = "queued" | "running" | "paused" | "completed" | "failed" | "stopped";

interface RunState {
  mode: ContentMode;
  preset: ContentPreset;
  status: RunStatus;
  current_step: string;
  steps_completed: string[];
  steps_remaining: string[];
  error: string | null;
  stop_reason: string | null;
  retry_count: number;
  max_retries: number;
  // References to downstream run IDs
  storyboard_run_id: string | null;
  render_run_id: string | null;
  animatic_run_id: string | null;
  blueprint_id: string | null;
  clip_run_id: string | null;
  cut_id: string | null;
  audio_run_id: string | null;
  render_job_id: string | null;
  created_at: string;
  updated_at: string;
}

const MODE_STEPS: Record<ContentMode, string[]> = {
  storyboard: ["create_panels", "render_frames"],
  animatic: ["verify_storyboard", "create_animatic", "render_animatic"],
  teaser: ["create_blueprint", "generate_clips", "assemble_cut", "generate_audio"],
  trailer: ["create_blueprint", "generate_clips", "assemble_cut", "generate_audio", "render_final"],
};

const PRESET_CAPS: Record<ContentPreset, { maxPanels: number; maxClips: number; maxRetries: number }> = {
  fast: { maxPanels: 8, maxClips: 4, maxRetries: 1 },
  balanced: { maxPanels: 16, maxClips: 8, maxRetries: 2 },
  quality: { maxPanels: 32, maxClips: 12, maxRetries: 3 },
};

// We store run state in a lightweight in-memory table pattern using project_documents
// doc_type = 'ai_content_run', meta_json contains RunState
// This avoids schema additions.

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders(req) });
  }

  // Ping
  if (req.method === "GET") {
    return jsonRes({ ok: true, build: BUILD }, 200, req);
  }

  let body: any;
  try {
    body = await req.json();
  } catch {
    return jsonRes({ error: "Invalid JSON" }, 400, req);
  }

  const { action } = body;
  if (action === "ping") {
    return jsonRes({ ok: true, build: BUILD }, 200, req);
  }

  // Auth
  const authHeader = req.headers.get("Authorization") ?? "";
  if (!authHeader.startsWith("Bearer ")) {
    return jsonRes({ error: "Unauthorized" }, 401, req);
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
  
  // User client for auth check
  const userClient = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authHeader } },
  });
  
  const token = authHeader.replace("Bearer ", "");
  const isServiceRole = token === serviceKey;
  
  let userId: string;
  if (isServiceRole) {
    userId = body.userId;
    if (!userId) return jsonRes({ error: "userId required for service_role" }, 400, req);
  } else {
    const { data: claimsData, error: claimsErr } = await userClient.auth.getUser();
    if (claimsErr || !claimsData?.user) {
      return jsonRes({ error: "Unauthorized" }, 401, req);
    }
    userId = claimsData.user.id;
  }

  // Service client for DB operations
  const db = createClient(supabaseUrl, serviceKey);

  const { projectId } = body;
  if (!projectId && action !== "ping") {
    return jsonRes({ error: "projectId required" }, 400, req);
  }

  // Access check
  if (projectId && !isServiceRole) {
    const { data: hasAccess } = await db.rpc("has_project_access", {
      _user_id: userId,
      _project_id: projectId,
    });
    if (!hasAccess) return jsonRes({ error: "Access denied" }, 403, req);
  }

  try {
    switch (action) {
      case "start":
        return await handleStart(db, projectId, userId, body, req);
      case "status":
        return await handleStatus(db, projectId, body, req);
      case "tick":
        return await handleTick(db, projectId, userId, body, req, authHeader);
      case "pause":
        return await handleSetStatus(db, projectId, body.runId, "paused", req);
      case "resume":
        return await handleSetStatus(db, projectId, body.runId, "running", req);
      case "stop":
        return await handleSetStatus(db, projectId, body.runId, "stopped", req, "user_stopped");
      default:
        return jsonRes({ error: `Unknown action: ${action}` }, 400, req);
    }
  } catch (err: any) {
    console.error("ai-content-orchestrator error:", err);
    return jsonRes({ error: err.message || "Internal error" }, 500, req);
  }
});

// ── Handlers ──

async function handleStart(
  db: any, projectId: string, userId: string,
  body: any, req: Request
) {
  const mode: ContentMode = body.mode || "storyboard";
  const preset: ContentPreset = body.preset || "balanced";
  const steps = [...MODE_STEPS[mode]];
  const caps = PRESET_CAPS[preset];

  const runState: RunState = {
    mode,
    preset,
    status: "queued",
    current_step: steps[0],
    steps_completed: [],
    steps_remaining: steps,
    error: null,
    stop_reason: null,
    retry_count: 0,
    max_retries: caps.maxRetries,
    storyboard_run_id: body.storyboardRunId || null,
    render_run_id: null,
    animatic_run_id: null,
    blueprint_id: body.blueprintId || null,
    clip_run_id: null,
    cut_id: null,
    audio_run_id: null,
    render_job_id: null,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };

  // Store as a row in a simple tracking approach using project meta
  // We'll use a dedicated lightweight table pattern: store in project_documents
  // with doc_type = 'ai_content_run'
  
  // First, ensure a doc slot exists
  let { data: doc } = await db
    .from("project_documents")
    .select("id")
    .eq("project_id", projectId)
    .eq("doc_type", "ai_content_run")
    .eq("title", `ai_content_${mode}_${Date.now()}`)
    .maybeSingle();

  // Create a new doc for this run
  const runTitle = `ai_content_${mode}_${Date.now()}`;
  const { data: newDoc, error: docErr } = await db
    .from("project_documents")
    .insert({
      project_id: projectId,
      user_id: userId,
      doc_type: "ai_content_run",
      title: runTitle,
      plaintext: JSON.stringify(runState),
      status: "active",
    })
    .select("id")
    .single();

  if (docErr) throw docErr;

  return jsonRes({
    runId: newDoc.id,
    mode,
    preset,
    steps,
    status: "queued",
  }, 200, req);
}

async function handleStatus(db: any, projectId: string, body: any, req: Request) {
  const { runId } = body;

  if (runId) {
    // Get specific run
    const { data, error } = await db
      .from("project_documents")
      .select("id, title, plaintext, created_at, updated_at")
      .eq("id", runId)
      .eq("project_id", projectId)
      .eq("doc_type", "ai_content_run")
      .single();

    if (error || !data) return jsonRes({ error: "Run not found" }, 404, req);

    let state: RunState;
    try { state = JSON.parse(data.plaintext); } catch { return jsonRes({ error: "Corrupt run state" }, 500, req); }

    return jsonRes({
      runId: data.id,
      ...state,
      created_at: data.created_at,
    }, 200, req);
  }

  // List recent runs
  const { data, error } = await db
    .from("project_documents")
    .select("id, title, plaintext, created_at, updated_at")
    .eq("project_id", projectId)
    .eq("doc_type", "ai_content_run")
    .order("created_at", { ascending: false })
    .limit(20);

  if (error) throw error;

  const runs = (data || []).map((d: any) => {
    let state: Partial<RunState> = {};
    try { state = JSON.parse(d.plaintext); } catch {}
    return { runId: d.id, ...state, created_at: d.created_at };
  });

  return jsonRes({ runs }, 200, req);
}

async function handleTick(
  db: any, projectId: string, userId: string,
  body: any, req: Request, authHeader: string
) {
  const { runId } = body;
  if (!runId) return jsonRes({ error: "runId required" }, 400, req);

  // Load run state
  const { data: doc, error } = await db
    .from("project_documents")
    .select("id, plaintext")
    .eq("id", runId)
    .eq("project_id", projectId)
    .eq("doc_type", "ai_content_run")
    .single();

  if (error || !doc) return jsonRes({ error: "Run not found" }, 404, req);

  let state: RunState;
  try { state = JSON.parse(doc.plaintext); } catch { return jsonRes({ error: "Corrupt run state" }, 500, req); }

  // Guard: only tick running/queued
  if (state.status !== "running" && state.status !== "queued") {
    return jsonRes({ runId, status: state.status, message: "Not tickable" }, 200, req);
  }

  // Mark running
  state.status = "running";
  state.updated_at = new Date().toISOString();

  const currentStep = state.steps_remaining[0];
  if (!currentStep) {
    state.status = "completed";
    await saveState(db, runId, state);
    return jsonRes({ runId, status: "completed", state }, 200, req);
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

  try {
    // Dispatch to existing engines based on mode + step
    switch (`${state.mode}::${currentStep}`) {
      // ── STORYBOARD ──
      case "storyboard::create_panels": {
        const resp = await callEngine(supabaseUrl, serviceKey, "storyboard-engine", {
          action: "create_run_and_panels",
          projectId,
          stylePreset: state.preset === "fast" ? "cinematic" : "cinematic",
          aspectRatio: "16:9",
        });
        state.storyboard_run_id = resp.runId;
        break;
      }
      case "storyboard::render_frames": {
        if (!state.storyboard_run_id) throw new Error("No storyboard run to render");
        const resp = await callEngine(supabaseUrl, serviceKey, "storyboard-render-queue", {
          action: "enqueue",
          projectId,
          runId: state.storyboard_run_id,
          mode: state.preset,
        });
        state.render_run_id = resp.renderRunId;
        break;
      }

      // ── ANIMATIC ──
      case "animatic::verify_storyboard": {
        if (!state.storyboard_run_id) {
          // Look for latest storyboard run
          const { data: runs } = await db
            .from("storyboard_runs")
            .select("id")
            .eq("project_id", projectId)
            .eq("status", "complete")
            .order("created_at", { ascending: false })
            .limit(1);
          if (!runs?.length) throw new Error("No completed storyboard run found. Create a storyboard first.");
          state.storyboard_run_id = runs[0].id;
        }
        break;
      }
      case "animatic::create_animatic":
      case "animatic::render_animatic": {
        const resp = await callEngine(supabaseUrl, serviceKey, "animatic-manager", {
          action: "create_run",
          projectId,
          storyboardRunId: state.storyboard_run_id,
        });
        state.animatic_run_id = resp.runId || resp.id;
        break;
      }

      // ── TEASER / TRAILER ──
      case "teaser::create_blueprint":
      case "trailer::create_blueprint": {
        const resp = await callEngine(supabaseUrl, serviceKey, "trailer-blueprint-engine", {
          action: "generate",
          projectId,
          preset: state.preset,
        });
        state.blueprint_id = resp.blueprintId || resp.id;
        break;
      }
      case "teaser::generate_clips":
      case "trailer::generate_clips": {
        if (!state.blueprint_id) throw new Error("No blueprint to generate clips from");
        try {
          const resp = await callEngine(supabaseUrl, serviceKey, "trailer-clip-generator", {
            action: "enqueue_for_run",
            projectId,
            blueprintId: state.blueprint_id,
            force: false,
          });
          state.clip_run_id = resp.clipRunId || resp.runId;
        } catch (clipErr: any) {
          // FALLBACK: if clip gen fails (rate limit, etc), fall back to animatic teaser
          if (state.mode === "teaser") {
            console.warn("Clip generation failed, falling back to animatic teaser:", clipErr.message);
            state.steps_remaining = ["verify_storyboard", "create_animatic", "render_animatic"];
            state.mode = "animatic" as ContentMode;
            state.error = `Clip gen failed (${clipErr.message}), fell back to animatic`;
            // Don't advance step — re-tick will process animatic
            await saveState(db, runId, state);
            return jsonRes({ runId, status: "running", fallback: "animatic", state }, 200, req);
          }
          throw clipErr;
        }
        break;
      }
      case "teaser::assemble_cut":
      case "trailer::assemble_cut": {
        if (!state.blueprint_id) throw new Error("No blueprint for assembly");
        const resp = await callEngine(supabaseUrl, serviceKey, "trailer-assembler", {
          action: "create_cut",
          projectId,
          blueprintId: state.blueprint_id,
        });
        state.cut_id = resp.cutId || resp.id;
        break;
      }
      case "teaser::generate_audio":
      case "trailer::generate_audio": {
        if (!state.cut_id && !state.blueprint_id) throw new Error("No cut/blueprint for audio");
        const resp = await callEngine(supabaseUrl, serviceKey, "trailer-audio-engine", {
          action: "create_run",
          projectId,
          blueprintId: state.blueprint_id,
          cutId: state.cut_id,
        });
        state.audio_run_id = resp.runId || resp.id;
        break;
      }
      case "trailer::render_final": {
        // Use trailer-studio-finish or create video render job
        if (!state.cut_id) throw new Error("No cut to render");
        const resp = await callEngine(supabaseUrl, serviceKey, "trailer-studio-finish", {
          action: "start_render",
          projectId,
          cutId: state.cut_id,
        });
        state.render_job_id = resp.jobId || resp.id;
        break;
      }

      default:
        console.warn(`Unknown step: ${state.mode}::${currentStep}`);
        break;
    }

    // Advance step
    state.steps_completed.push(currentStep);
    state.steps_remaining = state.steps_remaining.slice(1);
    state.current_step = state.steps_remaining[0] || "done";
    state.retry_count = 0;

    if (state.steps_remaining.length === 0) {
      state.status = "completed";
    }
  } catch (err: any) {
    state.retry_count++;
    state.error = err.message;
    if (state.retry_count >= state.max_retries) {
      state.status = "failed";
      state.stop_reason = "max_retries_exceeded";
    }
  }

  await saveState(db, runId, state);
  return jsonRes({ runId, status: state.status, state }, 200, req);
}

async function handleSetStatus(
  db: any, projectId: string, runId: string,
  newStatus: RunStatus, req: Request, stopReason?: string
) {
  if (!runId) return jsonRes({ error: "runId required" }, 400, req);

  const { data: doc, error } = await db
    .from("project_documents")
    .select("id, plaintext")
    .eq("id", runId)
    .eq("project_id", projectId)
    .eq("doc_type", "ai_content_run")
    .single();

  if (error || !doc) return jsonRes({ error: "Run not found" }, 404, req);

  let state: RunState;
  try { state = JSON.parse(doc.plaintext); } catch { return jsonRes({ error: "Corrupt state" }, 500, req); }

  state.status = newStatus;
  state.updated_at = new Date().toISOString();
  if (stopReason) state.stop_reason = stopReason;

  await saveState(db, runId, state);
  return jsonRes({ runId, status: newStatus }, 200, req);
}

// ── Helpers ──

async function saveState(db: any, runId: string, state: RunState) {
  await db
    .from("project_documents")
    .update({ plaintext: JSON.stringify(state), updated_at: new Date().toISOString() })
    .eq("id", runId);
}

async function callEngine(
  supabaseUrl: string, serviceKey: string,
  functionName: string, payload: Record<string, any>
): Promise<any> {
  const resp = await fetch(`${supabaseUrl}/functions/v1/${functionName}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${serviceKey}`,
    },
    body: JSON.stringify(payload),
  });
  if (!resp.ok) {
    const text = await resp.text();
    let msg = `${functionName} error`;
    try { msg = JSON.parse(text).error || msg; } catch {}
    throw new Error(msg);
  }
  return resp.json();
}
