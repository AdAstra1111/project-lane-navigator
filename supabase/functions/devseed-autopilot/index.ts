/**
 * devseed-autopilot — Deterministic orchestrator for end-to-end DevSeed pipeline.
 *
 * Actions:
 *   - ping: health check
 *   - start: begin or resume autopilot pipeline for a project
 *   - status: get current autopilot state from canon_json
 *   - tick: advance pipeline one stage (idempotent)
 *
 * Pipeline stages (deterministic order):
 *   0. validate — ensure project + canon exist
 *   1. apply_seed_intel_pack — route through canon-decisions
 *   2. regen_foundation — regenerate stub foundation docs via dev-engine-v2
 *   3. generate_primary_script — create primary script doc (season_script or episode_script)
 *   4. complete — mark done
 *
 * State stored in: canon_json.autopilot (NO new tables)
 */
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

// ── Dynamic CORS ──
function getCorsHeaders(req: Request) {
  const origin = req.headers.get("Origin") || "*";
  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Credentials": "true",
    "Access-Control-Allow-Headers":
      "authorization, apikey, x-client-info, content-type, prefer, accept, origin, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
    "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
  };
}

function jsonRes(body: Record<string, any>, status: number, req: Request) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...getCorsHeaders(req), "Content-Type": "application/json" },
  });
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// ── Pipeline stage definitions ──
const STAGES = [
  "apply_seed_intel_pack",
  "regen_foundation",
  "generate_primary_script",
] as const;
type StageName = typeof STAGES[number];

interface StageState {
  status: "pending" | "running" | "done" | "error" | "skipped";
  updated_at: string | null;
  doc_id?: string | null;
  version_id?: string | null;
  notes?: string | null;
  error?: string | null;
}

interface AutopilotState {
  run_id: string;
  status: "idle" | "running" | "paused" | "complete" | "error";
  started_at: string;
  updated_at: string;
  options: {
    apply_seed_intel_pack: boolean;
    regen_foundation: boolean;
    generate_primary_script: boolean;
  };
  stages: Record<StageName, StageState>;
  last_error?: { message: string; stage: string; at: string } | null;
  pitch_idea_id?: string;
}

function makeStageState(status: StageState["status"] = "pending"): StageState {
  return { status, updated_at: null };
}

function nowISO(): string {
  return new Date().toISOString();
}

function resolvePrimaryScriptDocType(lane?: string | null): "season_script" | "episode_script" {
  if (lane === "series") return "episode_script";
  return "season_script";
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: getCorsHeaders(req) });
  }

  // ── Ping ──
  if (req.method === "GET") {
    return jsonRes({ ok: true, build: "devseed-autopilot-v1" }, 200, req);
  }

  try {
    const body = await req.json();
    const { action } = body;

    if (action === "ping") {
      return jsonRes({ ok: true, build: "devseed-autopilot-v1" }, 200, req);
    }

    // ── Auth ──
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return jsonRes({ error: "Unauthorized" }, 401, req);
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const token = authHeader.replace("Bearer ", "");

    let userId: string | null = null;
    let isServiceRole = false;

    // Check raw service key
    if (token === serviceKey) {
      isServiceRole = true;
      userId = body.userId || null;
    } else {
      // JWT validation
      const userClient = createClient(supabaseUrl, anonKey, {
        global: { headers: { Authorization: authHeader } },
      });
      const { data, error } = await userClient.auth.getClaims(token);
      if (error || !data?.claims) {
        return jsonRes({ error: "Unauthorized" }, 401, req);
      }
      if (data.claims.role === "service_role") {
        isServiceRole = true;
        userId = body.userId || null;
      } else {
        userId = data.claims.sub as string;
      }
    }

    // Service role fallback: resolve userId from project owner
    const sb = createClient(supabaseUrl, serviceKey);

    if (isServiceRole && !userId && body.projectId) {
      const { data: proj } = await sb.from("projects").select("user_id").eq("id", body.projectId).single();
      userId = proj?.user_id || null;
    }

    if (!userId || !UUID_RE.test(userId)) {
      return jsonRes({ error: "Could not resolve valid userId" }, 400, req);
    }

    // ═══════════════════════════════════════════
    // STATUS — read autopilot state from canon
    // ═══════════════════════════════════════════
    if (action === "status") {
      const { projectId } = body;
      if (!projectId) return jsonRes({ error: "projectId required" }, 400, req);

      const { data: canon } = await sb
        .from("project_canon")
        .select("canon_json")
        .eq("project_id", projectId)
        .single();

      const autopilot = canon?.canon_json?.autopilot || null;
      return jsonRes({ ok: true, autopilot }, 200, req);
    }

    // ═══════════════════════════════════════════
    // START — initialize or resume autopilot
    // ═══════════════════════════════════════════
    if (action === "start") {
      const { projectId, pitchIdeaId, options } = body;
      if (!projectId) return jsonRes({ error: "projectId required" }, 400, req);

      // Read existing canon
      const { data: canonRow } = await sb
        .from("project_canon")
        .select("canon_json")
        .eq("project_id", projectId)
        .single();

      const canonJson = canonRow?.canon_json || {};
      const existing = canonJson.autopilot as AutopilotState | undefined;

      // If already complete, don't restart
      if (existing?.status === "complete") {
        return jsonRes({ ok: true, autopilot: existing, message: "already_complete" }, 200, req);
      }

      // If already running, return current state for resume
      if (existing?.status === "running") {
        return jsonRes({ ok: true, autopilot: existing, message: "already_running" }, 200, req);
      }

      // Initialize or resume
      const runId = existing?.run_id || crypto.randomUUID();
      const opts = options || {};
      const autopilot: AutopilotState = {
        run_id: runId,
        status: "running",
        started_at: existing?.started_at || nowISO(),
        updated_at: nowISO(),
        options: {
          apply_seed_intel_pack: opts.apply_seed_intel_pack !== false,
          regen_foundation: opts.regen_foundation !== false,
          generate_primary_script: opts.generate_primary_script !== false,
        },
        stages: existing?.stages || {
          apply_seed_intel_pack: makeStageState(),
          regen_foundation: makeStageState(),
          generate_primary_script: makeStageState(),
        },
        last_error: null,
        pitch_idea_id: pitchIdeaId || existing?.pitch_idea_id,
      };

      // Preserve done stages from previous run
      if (existing?.stages) {
        for (const stage of STAGES) {
          if (existing.stages[stage]?.status === "done") {
            autopilot.stages[stage] = existing.stages[stage];
          }
        }
      }

      // Write to canon
      await sb.from("project_canon").update({
        canon_json: { ...canonJson, autopilot },
        updated_by: userId,
      }).eq("project_id", projectId);

      return jsonRes({ ok: true, autopilot }, 200, req);
    }

    // ═══════════════════════════════════════════
    // TICK — advance pipeline one stage
    // ═══════════════════════════════════════════
    if (action === "tick") {
      const { projectId } = body;
      if (!projectId) return jsonRes({ error: "projectId required" }, 400, req);

      // Read current state
      const { data: canonRow } = await sb
        .from("project_canon")
        .select("canon_json")
        .eq("project_id", projectId)
        .single();

      const canonJson = canonRow?.canon_json || {};
      const autopilot = canonJson.autopilot as AutopilotState | undefined;

      if (!autopilot || autopilot.status !== "running") {
        return jsonRes({ ok: true, done: true, autopilot, message: "not_running" }, 200, req);
      }

      // Get project metadata
      const { data: project } = await sb
        .from("projects")
        .select("id, assigned_lane, title, user_id, source_pitch_idea_id")
        .eq("id", projectId)
        .single();

      if (!project) {
        return jsonRes({ error: "Project not found" }, 404, req);
      }

      // Find next stage to process
      let nextStage: StageName | null = null;
      for (const stage of STAGES) {
        const s = autopilot.stages[stage];
        if (s.status === "pending" || s.status === "error") {
          // Check if this stage is enabled
          if (!autopilot.options[stage]) {
            autopilot.stages[stage] = { ...s, status: "skipped", updated_at: nowISO() };
            continue;
          }
          nextStage = stage;
          break;
        }
        if (s.status === "running") {
          nextStage = stage;
          break;
        }
      }

      if (!nextStage) {
        // All stages done/skipped
        autopilot.status = "complete";
        autopilot.updated_at = nowISO();
        await sb.from("project_canon").update({
          canon_json: { ...canonJson, autopilot },
          updated_by: userId,
        }).eq("project_id", projectId);
        return jsonRes({ ok: true, done: true, autopilot }, 200, req);
      }

      // Mark stage as running
      autopilot.stages[nextStage] = {
        ...autopilot.stages[nextStage],
        status: "running",
        updated_at: nowISO(),
      };
      autopilot.updated_at = nowISO();

      // Persist running state
      await sb.from("project_canon").update({
        canon_json: { ...canonJson, autopilot },
        updated_by: userId,
      }).eq("project_id", projectId);

      try {
        // ── Execute stage ──
        if (nextStage === "apply_seed_intel_pack") {
          await executeApplySeedIntelPack(sb, supabaseUrl, authHeader, projectId, autopilot, userId);
        } else if (nextStage === "regen_foundation") {
          await executeRegenFoundation(sb, supabaseUrl, authHeader, projectId, autopilot, userId);
        } else if (nextStage === "generate_primary_script") {
          await executeGeneratePrimaryScript(sb, supabaseUrl, authHeader, projectId, project, autopilot, userId);
        }

        // Mark stage done
        autopilot.stages[nextStage].status = "done";
        autopilot.stages[nextStage].updated_at = nowISO();
      } catch (err: any) {
        const errMsg = (err?.message || "Unknown error").slice(0, 500);
        autopilot.stages[nextStage].status = "error";
        autopilot.stages[nextStage].error = errMsg;
        autopilot.stages[nextStage].updated_at = nowISO();
        autopilot.last_error = { message: errMsg, stage: nextStage, at: nowISO() };
        // Don't fail the whole pipeline — mark stage error, caller can retry
        console.error(`[devseed-autopilot] stage ${nextStage} failed:`, errMsg);
      }

      // Check if all done
      const allDone = STAGES.every(s =>
        autopilot.stages[s].status === "done" || autopilot.stages[s].status === "skipped"
      );
      if (allDone) {
        autopilot.status = "complete";
      }
      autopilot.updated_at = nowISO();

      // Persist
      // Re-read canon to avoid overwriting concurrent changes
      const { data: freshCanon } = await sb
        .from("project_canon")
        .select("canon_json")
        .eq("project_id", projectId)
        .single();
      const freshJson = freshCanon?.canon_json || {};

      await sb.from("project_canon").update({
        canon_json: { ...freshJson, autopilot },
        updated_by: userId,
      }).eq("project_id", projectId);

      return jsonRes({
        ok: true,
        done: allDone,
        stage_completed: nextStage,
        autopilot,
      }, 200, req);
    }

    // ═══════════════════════════════════════════
    // PAUSE
    // ═══════════════════════════════════════════
    if (action === "pause") {
      const { projectId } = body;
      if (!projectId) return jsonRes({ error: "projectId required" }, 400, req);

      const { data: canonRow } = await sb
        .from("project_canon")
        .select("canon_json")
        .eq("project_id", projectId)
        .single();
      const canonJson = canonRow?.canon_json || {};
      if (canonJson.autopilot) {
        canonJson.autopilot.status = "paused";
        canonJson.autopilot.updated_at = nowISO();
        await sb.from("project_canon").update({
          canon_json: canonJson,
          updated_by: userId,
        }).eq("project_id", projectId);
      }
      return jsonRes({ ok: true }, 200, req);
    }

    return jsonRes({ error: `Unknown action: ${action}` }, 400, req);
  } catch (e: any) {
    console.error("[devseed-autopilot] error:", e);
    return jsonRes({ error: e.message || "Internal error" }, 500, req);
  }
});

// ════════════════════════════════════════════════════════════════
// STAGE EXECUTORS
// ════════════════════════════════════════════════════════════════

async function executeApplySeedIntelPack(
  sb: any, supabaseUrl: string, authHeader: string,
  projectId: string, autopilot: AutopilotState, userId: string,
) {
  // Check if seed_intel_pack already applied (idempotent)
  const { data: canonRow } = await sb
    .from("project_canon")
    .select("canon_json")
    .eq("project_id", projectId)
    .single();

  const canonJson = canonRow?.canon_json || {};
  if (canonJson.seed_intel_pack) {
    console.log("[devseed-autopilot] seed_intel_pack already present, skipping apply");
    autopilot.stages.apply_seed_intel_pack.notes = "already_applied";
    return;
  }

  // If no pitch idea, can't build pack — skip
  const pitchIdeaId = autopilot.pitch_idea_id;
  if (!pitchIdeaId) {
    autopilot.stages.apply_seed_intel_pack.notes = "no_pitch_idea_id";
    return;
  }

  // Fetch pitch idea for context
  const { data: idea } = await sb
    .from("pitch_ideas")
    .select("id, recommended_lane, production_type")
    .eq("id", pitchIdeaId)
    .single();

  if (!idea) {
    autopilot.stages.apply_seed_intel_pack.notes = "pitch_idea_not_found";
    return;
  }

  // Fetch active trend signals for building pack
  const { data: signals } = await sb
    .from("trend_signals")
    .select("*")
    .eq("status", "active")
    .order("strength", { ascending: false })
    .limit(100);

  const { data: castTrends } = await sb
    .from("cast_trends")
    .select("*")
    .eq("status", "active")
    .order("strength", { ascending: false })
    .limit(50);

  // Build a basic seed intel pack from trends
  const lane = idea.recommended_lane || "independent-film";
  const productionType = idea.production_type || "film";

  const pack: Record<string, any> = {
    generated_at: nowISO(),
    lane,
    production_type: productionType,
    demand_signals: (signals || []).slice(0, 20).map((s: any) => ({
      name: s.name,
      category: s.category,
      strength: s.strength,
      velocity: s.velocity,
    })),
    genre_heat: (signals || []).filter((s: any) => s.category === "genre").slice(0, 10).map((s: any) => ({
      name: s.name,
      strength: s.strength,
    })),
    comparable_candidates: [],
    tone_style_signals: {},
    constraints_suggestions: {},
  };

  // Route through canon-decisions
  const resp = await fetch(`${supabaseUrl}/functions/v1/canon-decisions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: authHeader,
    },
    body: JSON.stringify({
      action: "create_and_apply",
      projectId,
      decision: {
        type: "APPLY_SEED_INTEL_PACK",
        payload: {
          seed_intel_pack: pack,
          init_comparables_if_empty: true,
          comparables_from_pack_max: 12,
          source_label: "devseed_autopilot",
        },
      },
      apply: { mode: "auto" },
    }),
  });

  const result = await resp.json();
  if (!resp.ok) {
    throw new Error(result.error || "canon-decisions APPLY_SEED_INTEL_PACK failed");
  }

  autopilot.stages.apply_seed_intel_pack.notes = `applied: ${result.decisionId || "ok"}`;
  console.log("[devseed-autopilot] APPLY_SEED_INTEL_PACK done");
}

async function executeRegenFoundation(
  sb: any, supabaseUrl: string, authHeader: string,
  projectId: string, autopilot: AutopilotState, userId: string,
) {
  const FOUNDATION_TYPES = ["idea", "concept_brief", "treatment", "character_bible", "market_sheet"];

  // Start regen queue
  const startResp = await fetch(`${supabaseUrl}/functions/v1/dev-engine-v2`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: authHeader,
    },
    body: JSON.stringify({
      action: "regen-insufficient-start",
      projectId,
      dryRun: false,
      docTypeWhitelist: FOUNDATION_TYPES,
      userId,
    }),
  });

  const startData = await startResp.json();
  if (!startResp.ok) {
    throw new Error(startData.error || "regen-insufficient-start failed");
  }

  const jobId = startData.job_id;
  const total = startData.total_count || 0;

  if (!jobId || total === 0) {
    autopilot.stages.regen_foundation.notes = "no_stubs_to_regen";
    console.log("[devseed-autopilot] regen_foundation: nothing to regen");
    return;
  }

  // Tick loop with bounded iterations
  let done = false;
  let iterations = 0;
  const MAX_ITERATIONS = 50;
  let backoff = 500;

  while (!done && iterations < MAX_ITERATIONS) {
    iterations++;
    const tickResp = await fetch(`${supabaseUrl}/functions/v1/dev-engine-v2`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: authHeader,
      },
      body: JSON.stringify({
        action: "regen-insufficient-tick",
        jobId,
        maxItemsPerTick: 3,
        userId,
      }),
    });

    const tickData = await tickResp.json();
    if (!tickResp.ok) {
      throw new Error(tickData.error || "regen-insufficient-tick failed");
    }

    done = tickData.done === true;
    if (!done) {
      await new Promise(r => setTimeout(r, backoff));
      backoff = Math.min(backoff * 1.2, 3000);
    }
  }

  if (!done) {
    autopilot.stages.regen_foundation.notes = `timed_out_after_${MAX_ITERATIONS}_ticks`;
    throw new Error("Foundation regen timed out");
  }

  // Get final status
  const statusResp = await fetch(`${supabaseUrl}/functions/v1/dev-engine-v2`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: authHeader,
    },
    body: JSON.stringify({ action: "regen-insufficient-status", jobId }),
  });

  const statusData = await statusResp.json();
  const items = statusData?.items || [];
  const errorItems = items.filter((i: any) => i.status === "error");

  if (errorItems.length > 0) {
    autopilot.stages.regen_foundation.notes = `${errorItems.length} items errored`;
    throw new Error(`Regen failed for: ${errorItems.map((i: any) => i.doc_type).join(", ")}`);
  }

  const regenCount = items.filter((i: any) => i.status === "regenerated").length;
  autopilot.stages.regen_foundation.notes = `regenerated ${regenCount}/${total} docs`;
  console.log(`[devseed-autopilot] regen_foundation done: ${regenCount}/${total}`);
}

async function executeGeneratePrimaryScript(
  sb: any, supabaseUrl: string, authHeader: string,
  projectId: string, project: any, autopilot: AutopilotState, userId: string,
) {
  const lane = project.assigned_lane || "independent-film";
  const primaryDocType = resolvePrimaryScriptDocType(lane);

  // Check if primary script doc already exists (idempotent)
  const { data: existingDocs } = await sb
    .from("project_documents")
    .select("id")
    .eq("project_id", projectId)
    .eq("doc_type", primaryDocType)
    .limit(1);

  if (existingDocs && existingDocs.length > 0) {
    const docId = existingDocs[0].id;

    // Check if it has a current version with content
    const { data: currentVer } = await sb
      .from("project_document_versions")
      .select("id, plaintext")
      .eq("document_id", docId)
      .eq("is_current", true)
      .limit(1)
      .maybeSingle();

    if (currentVer?.plaintext && currentVer.plaintext.length > 200) {
      autopilot.stages.generate_primary_script.doc_id = docId;
      autopilot.stages.generate_primary_script.version_id = currentVer.id;
      autopilot.stages.generate_primary_script.notes = "already_exists";
      console.log(`[devseed-autopilot] primary script already exists: ${docId}`);
      return;
    }
  }

  // Find the best source document to convert from (treatment > concept_brief > idea)
  const SOURCE_PRIORITY = ["treatment", "concept_brief", "idea"];
  let sourceDocId: string | null = null;
  let sourceVersionId: string | null = null;

  for (const docType of SOURCE_PRIORITY) {
    const { data: docs } = await sb
      .from("project_documents")
      .select("id")
      .eq("project_id", projectId)
      .eq("doc_type", docType)
      .limit(1);

    if (docs && docs.length > 0) {
      const { data: ver } = await sb
        .from("project_document_versions")
        .select("id, plaintext")
        .eq("document_id", docs[0].id)
        .eq("is_current", true)
        .limit(1)
        .maybeSingle();

      if (ver?.plaintext && ver.plaintext.length > 50) {
        sourceDocId = docs[0].id;
        sourceVersionId = ver.id;
        console.log(`[devseed-autopilot] using source ${docType} (${docs[0].id}) for primary script`);
        break;
      }
    }
  }

  if (!sourceDocId || !sourceVersionId) {
    autopilot.stages.generate_primary_script.notes = "no_source_document";
    throw new Error("No source document available for script generation");
  }

  // Use dev-engine-v2 convert to generate the primary script
  const convertResp = await fetch(`${supabaseUrl}/functions/v1/dev-engine-v2`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: authHeader,
    },
    body: JSON.stringify({
      action: "convert",
      projectId,
      documentId: sourceDocId,
      versionId: sourceVersionId,
      targetOutput: primaryDocType,
      userId,
    }),
  });

  const convertData = await convertResp.json();
  if (!convertResp.ok) {
    throw new Error(convertData.error || `convert to ${primaryDocType} failed`);
  }

  const newDocId = convertData.document_id || convertData.documentId || convertData.doc_id;
  const newVersionId = convertData.version_id || convertData.versionId;

  autopilot.stages.generate_primary_script.doc_id = newDocId || null;
  autopilot.stages.generate_primary_script.version_id = newVersionId || null;
  autopilot.stages.generate_primary_script.notes = `generated ${primaryDocType}`;
  console.log(`[devseed-autopilot] primary script generated: ${primaryDocType} doc=${newDocId}`);
}
