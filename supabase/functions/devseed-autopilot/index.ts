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
  "seed_writing_voice",
  "extract_comparables",
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
    seed_writing_voice: boolean;
    extract_comparables: boolean;
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

// generate_primary_script removed — DevSeed no longer creates scripts.

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
      const { data: userData, error: userError } = await userClient.auth.getUser(token);
      if (userError || !userData?.user) {
        return jsonRes({ error: "Unauthorized" }, 401, req);
      }
      if (userData.user.role === "service_role") {
        isServiceRole = true;
        userId = body.userId || null;
      } else {
        userId = userData.user.id;
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
          seed_writing_voice: opts.seed_writing_voice !== false,
          extract_comparables: opts.extract_comparables !== false,
        },
        stages: existing?.stages || {
          apply_seed_intel_pack: makeStageState(),
          regen_foundation: makeStageState(),
          seed_writing_voice: makeStageState(),
          extract_comparables: makeStageState(),
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
        } else if (nextStage === "seed_writing_voice") {
          await executeSeedWritingVoice(sb, supabaseUrl, projectId, autopilot);
        } else if (nextStage === "extract_comparables") {
          await executeExtractComparables(sb, supabaseUrl, authHeader, projectId, autopilot, userId);
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

// ─── seed_writing_voice ────────────────────────────────────────────────────
// Auto-select the best writing voice preset based on project concept brief + lane.
// Saves to project_lane_prefs so the writing voice is set before auto-run starts.
// Sebastian can always override manually; this just prevents the "blank dropdown" problem.

const VOICE_PRESETS_CATALOG = [
  // vertical
  { id: "high_heat_addictive_vertical", label: "High-Heat Addictive", lane_group: "vertical", summary: "Rapid-fire cliffhangers, punchy dialogue, maximum scroll-lock energy." },
  { id: "tender_kdrama_vertical", label: "Tender K-Drama Romance", lane_group: "vertical", summary: "Emotionally layered romance with longing glances and restrained dialogue." },
  { id: "comedic_flirty_vertical", label: "Comedic & Flirty", lane_group: "vertical", summary: "Light, witty banter with situational comedy and rom-com energy." },
  { id: "mystery_hook_machine_vertical", label: "Mystery Hook Machine", lane_group: "vertical", summary: "Relentless mystery pacing — every episode adds a question and half-answers another." },
  { id: "dark_obsession_vertical", label: "Dark Obsession", lane_group: "vertical", summary: "Intense psychological tension, morally grey leads, obsessive relationships." },
  // series
  { id: "prestige_intimate_series", label: "Prestige Intimate", lane_group: "series", summary: "Character-driven prestige drama — measured pace, literary dialogue, thematic depth." },
  { id: "propulsive_commercial_series", label: "Propulsive Commercial", lane_group: "series", summary: "High-octane broadcast drama — clear stakes, episode-end hooks, broad appeal." },
  { id: "darkly_comic_series", label: "Darkly Comic", lane_group: "series", summary: "Tonal tightrope between absurd comedy and genuine darkness." },
  { id: "procedural_crisp_series", label: "Procedural Crisp", lane_group: "series", summary: "Clean case-of-the-week structure with sharp investigative dialogue." },
  { id: "ya_emotional_series", label: "YA Emotional", lane_group: "series", summary: "Emotionally authentic coming-of-age with high relatability and identity themes." },
  // feature
  { id: "cinematic_clean_feature", label: "Cinematic Clean", lane_group: "feature", summary: "Elegant, economical prose — every word earns its place, strong visual writing." },
  { id: "crowdpleaser_highconcept_feature", label: "Crowd-Pleaser High-Concept", lane_group: "feature", summary: "Big idea, clear hook, broad emotional beats — studio four-quadrant energy." },
  { id: "elevated_genre_feature", label: "Elevated Genre", lane_group: "feature", summary: "Genre thrills with prestige execution — A24/Neon territory." },
  { id: "lyrical_arthouse_feature", label: "Lyrical Arthouse", lane_group: "feature", summary: "Poetic, image-driven storytelling — rhythm over plot, sensation over explanation." },
  { id: "action_pulse_feature", label: "Action Pulse", lane_group: "feature", summary: "Muscular, kinetic writing — clear geography, visceral action, lean dialogue." },
  // documentary
  { id: "investigative_doc", label: "Investigative", lane_group: "documentary", summary: "Evidence-driven narrative with revelatory structure and journalistic rigor." },
  { id: "human_intimate_doc", label: "Human Intimate", lane_group: "documentary", summary: "Character-centered vérité — empathy over argument, observation over narration." },
  { id: "poetic_observational_doc", label: "Poetic Observational", lane_group: "documentary", summary: "Meditative, image-first documentary — atmosphere and texture over argument." },
  { id: "pop_explainer_doc", label: "Pop Explainer", lane_group: "documentary", summary: "Energetic, accessible storytelling — graphics-friendly, clear narrative drive." },
];

// Map format → lane_group so we only offer relevant presets
function laneGroupForFormat(format: string): string {
  const f = (format || "").toLowerCase().replace(/[_ ]+/g, "-");
  if (f.includes("vertical")) return "vertical";
  if (f === "film" || f === "feature" || f.includes("feature")) return "feature";
  if (f.includes("documentary")) return "documentary";
  return "series"; // default for tv-series, limited-series, etc.
}

async function executeSeedWritingVoice(
  sb: any, supabaseUrl: string, projectId: string, autopilot: AutopilotState,
) {
  console.log("[devseed-autopilot] seed_writing_voice: starting");

  // 1. Check if voice already manually set — don't overwrite a human choice
  const { data: existingPrefs } = await sb.from("project_lane_prefs")
    .select("prefs").eq("project_id", projectId).maybeSingle();
  if (existingPrefs?.prefs?.writing_voice?.id && existingPrefs?.prefs?.writing_voice?._source !== "devseed_auto") {
    console.log("[devseed-autopilot] seed_writing_voice: voice already set manually, skipping");
    autopilot.stages.seed_writing_voice.notes = `skipped:already_set:${existingPrefs.prefs.writing_voice.id}`;
    return;
  }

  // 2. Load project metadata + concept brief
  const { data: project } = await sb.from("projects")
    .select("title, format, assigned_lane, genre, tone, target_audience, logline")
    .eq("id", projectId).maybeSingle();

  const { data: conceptDoc } = await sb.from("project_documents")
    .select("plaintext").eq("project_id", projectId).eq("doc_type", "concept_brief").maybeSingle();

  const format = project?.format || "film";
  const laneGroup = laneGroupForFormat(format);
  const relevantPresets = VOICE_PRESETS_CATALOG.filter(p => p.lane_group === laneGroup);

  if (!relevantPresets.length) {
    console.warn("[devseed-autopilot] seed_writing_voice: no presets for lane_group", laneGroup);
    return;
  }

  const conceptText = (conceptDoc?.plaintext || "").slice(0, 2000);
  const presetList = relevantPresets.map(p => `- ${p.id}: "${p.label}" — ${p.summary}`).join("\n");

  const OPENROUTER_API_KEY = Deno.env.get("OPENROUTER_API_KEY") || "";
  const BALANCED_MODEL = "google/gemini-2.5-flash";

  const systemPrompt = `You are a script development expert. Given a project's concept brief and a list of writing voice presets, select the single best matching preset. Respond with ONLY the preset id (e.g. "elevated_genre_feature"). No explanation.`;
  const userPrompt = `PROJECT: ${project?.title || "Untitled"}
FORMAT: ${format} | LANE: ${project?.assigned_lane || "unknown"}
GENRE/TONE: ${[project?.genre, project?.tone].filter(Boolean).join(", ") || "unspecified"}
LOGLINE: ${project?.logline || "none"}

CONCEPT BRIEF (excerpt):
${conceptText || "(no concept brief yet)"}

AVAILABLE PRESETS for ${laneGroup}:
${presetList}

Which preset id best matches this project?`;

  let chosenId: string | null = null;
  try {
    const resp = await fetch(resolveGateway().url, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Authorization": `Bearer ${LOVABLE_API_KEY}` },
      body: JSON.stringify({
        model: BALANCED_MODEL,
        messages: [{ role: "system", content: systemPrompt }, { role: "user", content: userPrompt }],
        max_tokens: 50,
        temperature: 0,
      }),
    });
    const data = await resp.json();
    const raw = data?.choices?.[0]?.message?.content?.trim() || "";
    // Extract just the id — strip quotes, spaces, explanations
    const match = raw.match(/[\w_]+_(?:vertical|series|feature|doc)/);
    if (match) chosenId = match[0];
  } catch (e: any) {
    console.warn("[devseed-autopilot] seed_writing_voice: LLM call failed:", e?.message);
  }

  // 3. Validate chosen id exists in catalog, fall back to first relevant preset
  const chosen = VOICE_PRESETS_CATALOG.find(p => p.id === chosenId) || relevantPresets[0];
  console.log(`[devseed-autopilot] seed_writing_voice: selected ${chosen.id} (${chosen.label})`);

  // 4. Save to project_lane_prefs (upsert — merge with existing prefs)
  const currentPrefs = existingPrefs?.prefs || {};
  const { data: projectLane } = await sb.from("projects").select("assigned_lane").eq("id", projectId).maybeSingle();
  const lane = projectLane?.assigned_lane || "independent-film";

  await sb.from("project_lane_prefs").upsert({
    project_id: projectId,
    lane,
    prefs: {
      ...currentPrefs,
      writing_voice: {
        id: chosen.id,
        label: chosen.label,
        summary: chosen.summary,
        lane_group: chosen.lane_group,
        _source: "devseed_auto",  // marks as auto-selected so manual override is detected
      },
    },
  }, { onConflict: "project_id,lane" });

  autopilot.stages.seed_writing_voice.notes = `selected:${chosen.id}`;
  console.log(`[devseed-autopilot] seed_writing_voice done: ${chosen.id}`);
}

// executeGeneratePrimaryScript removed — DevSeed no longer generates scripts.
// Script generation is handled by the Auto-Run system.

// ─── extract_comparables ────────────────────────────────────────────────────
// Auto-extract comparables from project docs at the end of DevSeed so they
// are available as guardrails before auto-run begins.
function normalizeTitle(t: string): string {
  return t.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "");
}

async function executeExtractComparables(
  sb: any, supabaseUrl: string, authHeader: string,
  projectId: string, autopilot: AutopilotState, userId: string,
) {
  console.log("[devseed-autopilot] extract_comparables: starting");

  // 1. Get project lane/format
  const { data: proj } = await sb.from("projects").select("assigned_lane, format").eq("id", projectId).maybeSingle();
  const lane = proj?.assigned_lane || "independent-film";

  // 2. Run extract_from_docs (JSON-first extraction from concept brief / market sheet)
  const extractResp = await fetch(`${supabaseUrl}/functions/v1/comps-engine`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: authHeader },
    body: JSON.stringify({ action: "extract_from_docs", project_id: projectId }),
  });
  const extractData = await extractResp.json();
  const extractedCount = extractData?.extraction_summary?.attached || 0;
  console.log(`[devseed-autopilot] extract_comparables: extracted ${extractedCount} from docs`);

  // 3. Run find_candidates — AI suggests comps based on concept brief
  const findResp = await fetch(`${supabaseUrl}/functions/v1/comps-engine`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: authHeader },
    body: JSON.stringify({
      action: "find_candidates",
      project_id: projectId,
      lane,
      user_id: userId,
      use_project_docs: true,
      filters: {},
    }),
  });
  const findData = await findResp.json();
  const candidates: any[] = findData?.candidates || [];
  console.log(`[devseed-autopilot] extract_comparables: found ${candidates.length} AI candidates`);

  // 4. Auto-attach top 8 candidates straight into project_comparables
  // Sort by confidence desc, take top 8, skip any already attached
  const { data: existing } = await sb.from("project_comparables")
    .select("normalized_title").eq("project_id", projectId);
  const existingTitles = new Set((existing || []).map((r: any) => r.normalized_title));

  const toAttach = candidates
    .sort((a: any, b: any) => (b.confidence || 0) - (a.confidence || 0))
    .slice(0, 8)
    .filter((c: any) => c.title);

  let attachedCount = 0;
  for (const c of toAttach) {
    const normalized = normalizeTitle(c.title);
    if (existingTitles.has(normalized)) continue;
    const { error } = await sb.from("project_comparables").upsert({
      project_id: projectId,
      title: c.title,
      normalized_title: normalized,
      kind: c.format || "film",
      source: "devseed_ai",
      extraction_meta: {
        rationale: c.rationale || "",
        confidence: c.confidence || 0,
        comp_type: "tone", // default; user can reclassify
        year: c.year || null,
        genres: c.genres || [],
        _auto_attached: true,
      },
    }, { onConflict: "project_id,normalized_title", ignoreDuplicates: true });
    if (!error) { attachedCount++; existingTitles.add(normalized); }
  }
  console.log(`[devseed-autopilot] extract_comparables: auto-attached ${attachedCount} comps`);

  autopilot.stages.extract_comparables.notes = `extracted:${extractedCount} ai_candidates:${candidates.length} attached:${attachedCount}`;
  console.log("[devseed-autopilot] extract_comparables done");
}
