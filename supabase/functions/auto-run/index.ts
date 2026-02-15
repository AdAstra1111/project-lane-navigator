import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

// ── Document Ladder ──
const LADDER = ["idea", "concept_brief", "blueprint", "architecture", "draft"] as const;
type DocStage = (typeof LADDER)[number];

function nextDoc(current: DocStage): DocStage | null {
  const idx = LADDER.indexOf(current);
  return idx >= 0 && idx < LADDER.length - 1 ? LADDER[idx + 1] : null;
}

function isOnLadder(d: string): d is DocStage {
  return (LADDER as readonly string[]).includes(d);
}

// ── Mode Config ──
const MODE_CONFIG: Record<string, { max_stage_loops: number; max_total_steps: number; require_readiness?: number }> = {
  fast: { max_stage_loops: 1, max_total_steps: 8 },
  balanced: { max_stage_loops: 2, max_total_steps: 12 },
  premium: { max_stage_loops: 3, max_total_steps: 18, require_readiness: 82 },
};

// ── Qualification Resolver ──

interface QualificationDefaults {
  episode_target_duration_seconds?: number;
  season_episode_count?: number;
  target_runtime_min_low?: number;
  target_runtime_min_high?: number;
}

const FORMAT_DEFAULTS: Record<string, QualificationDefaults> = {
  "vertical-drama": { episode_target_duration_seconds: 60, season_episode_count: 30 },
  "limited-series": { episode_target_duration_seconds: 3300, season_episode_count: 8 },
  "tv-series": { episode_target_duration_seconds: 2700, season_episode_count: 10 },
  "anim-series": { episode_target_duration_seconds: 1320, season_episode_count: 10 },
  "documentary-series": { episode_target_duration_seconds: 2700, season_episode_count: 6 },
  "digital-series": { episode_target_duration_seconds: 600, season_episode_count: 10 },
  "reality": { episode_target_duration_seconds: 2700, season_episode_count: 10 },
  "film": { target_runtime_min_low: 85, target_runtime_min_high: 110 },
  "anim-feature": { target_runtime_min_low: 80, target_runtime_min_high: 100 },
  "short-film": { target_runtime_min_low: 5, target_runtime_min_high: 20 },
};

// Stages where episode qualifications become required
const SERIES_STAGE_THRESHOLD = LADDER.indexOf("concept_brief"); // concept_brief+
const FILM_STAGE_THRESHOLD = LADDER.indexOf("draft"); // draft+

function needsEpisodeQuals(format: string, _stageIdx: number): boolean {
  const seriesFormats = ["vertical-drama", "tv-series", "limited-series", "anim-series", "documentary-series", "digital-series", "reality"];
  return seriesFormats.includes(format); // always true for series — no stage threshold
}

function needsFilmQuals(format: string, stageIdx: number): boolean {
  const filmFormats = ["film", "anim-feature", "short-film"];
  return filmFormats.includes(format) && stageIdx >= FILM_STAGE_THRESHOLD;
}

interface PreflightResult {
  resolved: Record<string, any>;
  changed: boolean;
}

async function runPreflight(
  supabase: any, projectId: string, format: string, currentDoc: DocStage
): Promise<PreflightResult> {
  const { data: project } = await supabase.from("projects")
    .select("episode_target_duration_seconds, season_episode_count, assigned_lane, budget_range, guardrails_config")
    .eq("id", projectId).single();

  if (!project) return { resolved: {}, changed: false };

  const stageIdx = LADDER.indexOf(currentDoc);
  const defaults = FORMAT_DEFAULTS[format] || {};
  const updates: Record<string, any> = {};
  const resolved: Record<string, any> = {};

  // Episode qualifications for series formats
  if (needsEpisodeQuals(format, stageIdx)) {
    if (!project.episode_target_duration_seconds && defaults.episode_target_duration_seconds) {
      updates.episode_target_duration_seconds = defaults.episode_target_duration_seconds;
      resolved.episode_target_duration_seconds = defaults.episode_target_duration_seconds;
    }
    // season_episode_count — try guardrails_config overrides
    const existingOverrides = project.guardrails_config?.overrides?.qualifications || {};
    if (!existingOverrides.season_episode_count && defaults.season_episode_count) {
      const gc = project.guardrails_config || {};
      gc.overrides = gc.overrides || {};
      gc.overrides.qualifications = { ...(gc.overrides.qualifications || {}), season_episode_count: defaults.season_episode_count };
      updates.guardrails_config = gc;
      resolved.season_episode_count = defaults.season_episode_count;
    }
  }

  // Film qualifications
  if (needsFilmQuals(format, stageIdx)) {
    const existingOverrides = (updates.guardrails_config || project.guardrails_config)?.overrides?.qualifications || {};
    if (!existingOverrides.target_runtime_min_low && defaults.target_runtime_min_low) {
      const gc = updates.guardrails_config || project.guardrails_config || {};
      gc.overrides = gc.overrides || {};
      gc.overrides.qualifications = {
        ...(gc.overrides.qualifications || {}),
        target_runtime_min_low: defaults.target_runtime_min_low,
        target_runtime_min_high: defaults.target_runtime_min_high,
      };
      updates.guardrails_config = gc;
      resolved.target_runtime_min_low = defaults.target_runtime_min_low;
      resolved.target_runtime_min_high = defaults.target_runtime_min_high;
    }
  }

  // Lane fallback
  if (!project.assigned_lane) {
    updates.assigned_lane = "independent-film";
    resolved.assigned_lane = "independent-film";
  }

  // Budget fallback
  if (!project.budget_range) {
    updates.budget_range = "low";
    resolved.budget_range = "low";
  }

  if (Object.keys(updates).length > 0) {
    await supabase.from("projects").update(updates).eq("id", projectId);
    return { resolved, changed: true };
  }

  return { resolved, changed: false };
}

// Patterns that indicate a missing qualification error
const QUAL_ERROR_PATTERNS = [
  "missing qualification", "episode_target_duration", "episode_target_duration_seconds",
  "episodetargetdurationseconds", "season_episode_count",
  "required", "episode duration", "episode count", "target_runtime",
  "missing episode duration",
];

function isQualificationError(msg: string): boolean {
  const lower = msg.toLowerCase();
  return QUAL_ERROR_PATTERNS.some(p => lower.includes(p));
}

// ── Promotion Intel (inline) ──
const WEIGHTS: Record<string, { ci: number; gp: number; gap: number; traj: number; hi: number; pen: number }> = {
  idea:          { ci: 0.20, gp: 0.30, gap: 0.10, traj: 0.15, hi: 0.20, pen: 0.05 },
  concept_brief: { ci: 0.25, gp: 0.25, gap: 0.10, traj: 0.15, hi: 0.20, pen: 0.05 },
  blueprint:     { ci: 0.30, gp: 0.20, gap: 0.10, traj: 0.20, hi: 0.15, pen: 0.05 },
  architecture:  { ci: 0.30, gp: 0.20, gap: 0.10, traj: 0.20, hi: 0.15, pen: 0.05 },
  draft:         { ci: 0.35, gp: 0.20, gap: 0.10, traj: 0.20, hi: 0.10, pen: 0.05 },
};

function clamp(v: number, lo: number, hi: number) { return Math.max(lo, Math.min(hi, v)); }

// ── Helper: robust score extraction ──
function pickNumber(obj: any, paths: string[], fallback: number, riskFlags?: string[]): number {
  for (const path of paths) {
    const parts = path.split(".");
    let cur = obj;
    for (const p of parts) {
      if (cur == null) break;
      cur = cur[p];
    }
    if (cur != null && typeof cur === "number" && isFinite(cur)) return cur;
  }
  if (riskFlags) riskFlags.push("score_missing_fallback");
  return fallback;
}

function trajectoryScore(t: string | null): number {
  const n = (t || "").toLowerCase().replace(/[_-]/g, "");
  if (n === "converging") return 90;
  if (n === "strengthened") return 85;
  if (n === "overoptimised" || n === "overoptimized") return 60;
  if (n === "stalled") return 55;
  if (n === "eroding") return 25;
  return 55;
}

interface PromotionResult {
  recommendation: "promote" | "stabilise" | "escalate";
  readiness_score: number;
  confidence: number;
  risk_flags: string[];
  reasons: string[];
}

function computePromotion(
  ci: number, gp: number, gap: number, trajectory: string | null,
  doc: string, blockersCount: number, highImpactCount: number, iterationCount: number
): PromotionResult {
  const w = WEIGHTS[doc] || WEIGHTS.concept_brief;
  const gapScore = 100 - clamp(gap * 2, 0, 100);
  const trajScore = trajectoryScore(trajectory);
  const hiScore = 100 - clamp(highImpactCount * 10, 0, 60);
  const iterPenalty = clamp((iterationCount - 2) * 4, 0, 20);

  let readinessScore = Math.round(
    ci * w.ci + gp * w.gp + gapScore * w.gap + trajScore * w.traj + hiScore * w.hi - iterPenalty * w.pen
  );
  readinessScore = clamp(readinessScore, 0, 100);

  let conf = 70;
  if (iterationCount <= 1) conf -= 10;
  if (highImpactCount >= 5) conf -= 10;
  if (gap >= 20) conf -= 15;
  const tn = (trajectory || "").toLowerCase().replace(/[_-]/g, "");
  if (tn === "converging" || tn === "strengthened") conf += 10;
  const confidence = clamp(conf, 0, 100);

  const risk_flags: string[] = [];
  const reasons: string[] = [];

  // Hard Gates
  if (blockersCount > 0) {
    risk_flags.push("hard_gate:blockers");
    reasons.push(`Blockers active (${blockersCount})`);
    return { recommendation: "stabilise", readiness_score: readinessScore, confidence, risk_flags, reasons };
  }
  if (tn === "eroding") {
    risk_flags.push("hard_gate:eroding_trajectory");
    reasons.push("Trajectory eroding");
    return { recommendation: "escalate", readiness_score: readinessScore, confidence, risk_flags, reasons };
  }
  if ((doc === "idea" || doc === "concept_brief") && highImpactCount > 0) {
    risk_flags.push("hard_gate:early_stage_high_impact");
    reasons.push("Early-stage high-impact issues");
    return { recommendation: "stabilise", readiness_score: readinessScore, confidence, risk_flags, reasons };
  }

  let recommendation: "promote" | "stabilise" | "escalate";
  if (readinessScore >= 78) recommendation = "promote";
  else if (readinessScore >= 65) recommendation = "stabilise";
  else recommendation = "escalate";

  if (tn === "overoptimised" && blockersCount === 0 && gp >= 60 && readinessScore >= 72) {
    recommendation = "promote";
    reasons.push("Over-optimised nudge");
  }

  reasons.push(`Readiness: ${readinessScore}/100`);
  return { recommendation, readiness_score: readinessScore, confidence, risk_flags, reasons };
}

// ── Helper: call another edge function (with retry on qualification errors) ──
async function callEdgeFunction(
  supabaseUrl: string, functionName: string, body: any, token: string
): Promise<any> {
  const resp = await fetch(`${supabaseUrl}/functions/v1/${functionName}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(body),
  });
  const text = await resp.text();
  if (!resp.ok) throw new Error(`${functionName} error: ${text}`);
  try { return JSON.parse(text); } catch { return { raw: text }; }
}

async function callEdgeFunctionWithRetry(
  supabase: any, supabaseUrl: string, functionName: string, body: any, token: string,
  projectId: string, format: string, currentDoc: DocStage,
  jobId: string, stepCount: number
): Promise<{ result: any; retried: boolean }> {
  try {
    const result = await callEdgeFunction(supabaseUrl, functionName, body, token);
    return { result, retried: false };
  } catch (e: any) {
    if (!isQualificationError(e.message)) throw e;

    // Attempt blockage resolve
    const preflight = await runPreflight(supabase, projectId, format, currentDoc);
    if (preflight.changed) {
      await logStep(supabase, jobId, stepCount, currentDoc, "blockage_resolve",
        `Resolved missing qualifications: ${Object.keys(preflight.resolved).join(", ")}`,
      );
    }

    // Retry once
    const result = await callEdgeFunction(supabaseUrl, functionName, body, token);
    return { result, retried: true };
  }
}

// ── Helper: log a step ──
async function logStep(
  supabase: any,
  jobId: string,
  stepIndex: number,
  document: string,
  action: string,
  summary: string,
  scores: { ci?: number; gp?: number; gap?: number; readiness?: number; confidence?: number; risk_flags?: string[] } = {},
  outputText?: string,
  outputRef?: any
) {
  await supabase.from("auto_run_steps").insert({
    job_id: jobId,
    step_index: stepIndex,
    document,
    action,
    summary,
    ci: scores.ci ?? null,
    gp: scores.gp ?? null,
    gap: scores.gap ?? null,
    readiness: scores.readiness ?? null,
    confidence: scores.confidence ?? null,
    risk_flags: scores.risk_flags || [],
    output_text: outputText ? outputText.slice(0, 4000) : null,
    output_ref: outputRef || null,
  });
}

// ── Helper: update job ──
async function updateJob(supabase: any, jobId: string, fields: Record<string, any>) {
  await supabase.from("auto_run_jobs").update(fields).eq("id", jobId);
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return respond({ error: "Unauthorized" }, 401);
    }
    const token = authHeader.replace("Bearer ", "");

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, serviceKey);

    // Verify user
    const { data: { user }, error: userErr } = await supabase.auth.getUser(token);
    if (userErr || !user) return respond({ error: "Unauthorized" }, 401);
    const userId = user.id;

    const body = await req.json();
    const { action, projectId, jobId, mode, start_document, target_document, max_stage_loops, max_total_steps, decision } = body;

    // ═══════════════════════════════════════
    // ACTION: status
    // ═══════════════════════════════════════
    if (action === "status") {
      const query = jobId
        ? supabase.from("auto_run_jobs").select("*").eq("id", jobId).eq("user_id", userId).single()
        : supabase.from("auto_run_jobs").select("*").eq("project_id", projectId).eq("user_id", userId).order("created_at", { ascending: false }).limit(1).single();
      const { data: job, error } = await query;
      if (error || !job) return respond({ job: null, latest_steps: [], next_action_hint: "No job found" });

      const { data: steps } = await supabase.from("auto_run_steps").select("*").eq("job_id", job.id).order("step_index", { ascending: false }).limit(10);
      return respond({ job, latest_steps: (steps || []).reverse(), next_action_hint: getHint(job) });
    }

    // ═══════════════════════════════════════
    // ACTION: start
    // ═══════════════════════════════════════
    if (action === "start") {
      if (!projectId) return respond({ error: "projectId required" }, 400);
      const startDoc = start_document || "idea";
      const targetDoc = target_document || "draft";
      if (!isOnLadder(startDoc)) return respond({ error: `Invalid start_document: ${startDoc}` }, 400);
      if (!isOnLadder(targetDoc)) return respond({ error: `Invalid target_document: ${targetDoc}` }, 400);

      const modeConf = MODE_CONFIG[mode || "balanced"] || MODE_CONFIG.balanced;
      const effectiveMaxLoops = max_stage_loops ?? modeConf.max_stage_loops;
      const effectiveMaxSteps = max_total_steps ?? modeConf.max_total_steps;

      // ── Preflight qualification resolver at start ──
      const { data: proj } = await supabase.from("projects").select("format").eq("id", projectId).single();
      const fmt = (proj?.format || "film").toLowerCase().replace(/_/g, "-");
      const preflight = await runPreflight(supabase, projectId, fmt, startDoc as DocStage);

      const { data: job, error } = await supabase.from("auto_run_jobs").insert({
        user_id: userId,
        project_id: projectId,
        status: "running",
        mode: mode || "balanced",
        start_document: startDoc,
        target_document: targetDoc,
        current_document: startDoc,
        max_stage_loops: effectiveMaxLoops,
        max_total_steps: effectiveMaxSteps,
      }).select("*").single();

      if (error) throw new Error(`Failed to create job: ${error.message}`);

      await logStep(supabase, job.id, 0, startDoc, "start", `Auto-run started: ${startDoc} → ${targetDoc} (${mode || "balanced"} mode)`);

      if (preflight.changed) {
        await logStep(supabase, job.id, 0, startDoc, "preflight_resolve",
          `Resolved qualifications: ${Object.keys(preflight.resolved).join(", ")} → ${JSON.stringify(preflight.resolved)}`,
        );
      }

      return respond({ job, latest_steps: [], next_action_hint: "run-next" });
    }

    // ═══════════════════════════════════════
    // ACTION: pause / stop
    // ═══════════════════════════════════════
    if (action === "pause" || action === "stop") {
      if (!jobId) return respond({ error: "jobId required" }, 400);
      const newStatus = action === "pause" ? "paused" : "stopped";
      await updateJob(supabase, jobId, { status: newStatus, stop_reason: `User ${action}d` });
      const { data: job } = await supabase.from("auto_run_jobs").select("*").eq("id", jobId).single();
      return respond({ job, latest_steps: [], next_action_hint: action === "pause" ? "resume" : "none" });
    }

    // ═══════════════════════════════════════
    // ACTION: resume
    // ═══════════════════════════════════════
    if (action === "resume") {
      if (!jobId) return respond({ error: "jobId required" }, 400);
      await updateJob(supabase, jobId, { status: "running", stop_reason: null });
      const { data: job } = await supabase.from("auto_run_jobs").select("*").eq("id", jobId).single();
      return respond({ job, latest_steps: [], next_action_hint: "run-next" });
    }

    // ═══════════════════════════════════════
    // ACTION: approve-decision
    // ═══════════════════════════════════════
    if (action === "approve-decision") {
      if (!jobId) return respond({ error: "jobId required" }, 400);
      const { decisionId, selectedValue } = body;
      if (!decisionId || !selectedValue) return respond({ error: "decisionId and selectedValue required" }, 400);

      const { data: job, error: jobErr } = await supabase.from("auto_run_jobs").select("*").eq("id", jobId).eq("user_id", userId).single();
      if (jobErr || !job) return respond({ error: "Job not found" }, 404);

      const pending = job.pending_decisions || [];
      // Support both old format (decisionId + selectedValue) and new choice format (choiceId)
      const choiceId = body.choiceId || decisionId;
      const choiceValue = body.selectedValue || "yes";

      const decision = pending.find((d: any) => d.id === choiceId);
      if (!decision) return respond({ error: `Decision ${choiceId} not found in pending_decisions` }, 404);

      const stepCount = job.step_count + 1;
      const currentDoc = job.current_document as DocStage;

      // ── Handle step-limit choices ──
      if (choiceId === "raise_step_limit_once" && choiceValue === "yes") {
        const newMax = job.max_total_steps + 6;
        await logStep(supabase, jobId, stepCount, currentDoc, "decision_applied",
          `Step limit raised: ${job.max_total_steps} → ${newMax}`,
          {}, undefined, { choiceId, choiceValue }
        );
        await updateJob(supabase, jobId, {
          step_count: stepCount,
          max_total_steps: newMax,
          status: "running",
          stop_reason: null,
          pending_decisions: null,
        });
        return respondWithJob(supabase, jobId, "run-next");
      }

      if (choiceId === "raise_step_limit_once" && choiceValue === "no") {
        await logStep(supabase, jobId, stepCount, currentDoc, "decision_applied",
          "User declined step extension — stopping run",
          {}, undefined, { choiceId, choiceValue }
        );
        await updateJob(supabase, jobId, {
          step_count: stepCount,
          status: "stopped",
          stop_reason: "User stopped at step limit",
          pending_decisions: null,
        });
        return respondWithJob(supabase, jobId, "none");
      }

      if (choiceId === "run_exec_strategy" && choiceValue === "yes") {
        // Run executive strategy inline
        try {
          const { data: project } = await supabase.from("projects")
            .select("format, development_behavior")
            .eq("id", job.project_id).single();
          const format = (project?.format || "film").toLowerCase().replace(/_/g, "-");
          const behavior = project?.development_behavior || "market";

          const { data: docs } = await supabase.from("project_documents")
            .select("id").eq("project_id", job.project_id).eq("doc_type", currentDoc)
            .order("created_at", { ascending: false }).limit(1);
          const doc = docs?.[0];
          if (!doc) throw new Error("No document found for executive strategy");

          const { data: versions } = await supabase.from("project_document_versions")
            .select("id").eq("document_id", doc.id)
            .order("version_number", { ascending: false }).limit(1);
          const latestVersion = versions?.[0];
          if (!latestVersion) throw new Error("No version found");

          const stratResult = await callEdgeFunctionWithRetry(
            supabase, supabaseUrl, "dev-engine-v2", {
              action: "executive-strategy",
              projectId: job.project_id,
              documentId: doc.id,
              versionId: latestVersion.id,
              deliverableType: currentDoc,
              format,
              developmentBehavior: behavior,
            }, token, job.project_id, format, currentDoc, jobId, stepCount
          );

          const strat = stratResult?.result || stratResult || {};
          const autoFixes = strat.auto_fixes || {};
          const mustDecide = Array.isArray(strat.must_decide) ? strat.must_decide : [];

          // Apply auto_fixes
          const projectUpdates: Record<string, any> = {};
          if (autoFixes.assigned_lane) projectUpdates.assigned_lane = autoFixes.assigned_lane;
          if (autoFixes.budget_range) projectUpdates.budget_range = autoFixes.budget_range;
          const qualFixes = autoFixes.qualifications || {};
          if (Object.keys(qualFixes).length > 0) {
            const { data: curProj } = await supabase.from("projects").select("guardrails_config").eq("id", job.project_id).single();
            const gc = curProj?.guardrails_config || {};
            gc.overrides = gc.overrides || {};
            gc.overrides.qualifications = { ...(gc.overrides.qualifications || {}), ...qualFixes };
            projectUpdates.guardrails_config = gc;
            if (qualFixes.episode_target_duration_seconds) {
              projectUpdates.episode_target_duration_seconds = qualFixes.episode_target_duration_seconds;
            }
          }
          if (Object.keys(projectUpdates).length > 0) {
            await supabase.from("projects").update(projectUpdates).eq("id", job.project_id);
          }

          await logStep(supabase, jobId, stepCount, currentDoc, "executive_strategy",
            strat.summary || `Auto-fixes applied: ${Object.keys(projectUpdates).join(", ") || "none"}`,
            {}, undefined, { strategy: strat, updates: projectUpdates }
          );

          // If strategy produced blocking decisions, pause again
          const blockingDecisions = mustDecide.filter((d: any) => d.impact === "blocking");
          if (blockingDecisions.length > 0) {
            await updateJob(supabase, jobId, {
              step_count: stepCount,
              stage_loop_count: 0,
              status: "paused",
              stop_reason: `Approval required: ${blockingDecisions[0].question}`,
              pending_decisions: mustDecide,
            });
            return respondWithJob(supabase, jobId, "approve-decision");
          }

          // Resume with extended steps
          await updateJob(supabase, jobId, {
            step_count: stepCount,
            stage_loop_count: 0,
            max_total_steps: job.max_total_steps + 6,
            status: "running",
            stop_reason: null,
            pending_decisions: null,
          });
          return respondWithJob(supabase, jobId, "run-next");
        } catch (stratErr: any) {
          await logStep(supabase, jobId, stepCount, currentDoc, "decision_applied",
            `Executive strategy failed: ${stratErr.message}`,
          );
          // Fall through to just raise step limit
          await updateJob(supabase, jobId, {
            step_count: stepCount,
            max_total_steps: job.max_total_steps + 6,
            status: "running",
            stop_reason: null,
            pending_decisions: null,
          });
          return respondWithJob(supabase, jobId, "run-next");
        }
      }

      if (choiceId === "force_promote" && choiceValue === "yes") {
        const next = nextDoc(currentDoc);
        if (next && LADDER.indexOf(next) <= LADDER.indexOf(job.target_document as DocStage)) {
          await logStep(supabase, jobId, stepCount, currentDoc, "decision_applied",
            `Force-promoted: ${currentDoc} → ${next}`,
            {}, undefined, { choiceId, choiceValue }
          );
          await updateJob(supabase, jobId, {
            step_count: stepCount,
            current_document: next,
            stage_loop_count: 0,
            max_total_steps: job.max_total_steps + 6,
            status: "running",
            stop_reason: null,
            pending_decisions: null,
          });
          return respondWithJob(supabase, jobId, "run-next");
        } else {
          await updateJob(supabase, jobId, {
            step_count: stepCount,
            status: "completed",
            stop_reason: "Reached target document (force-promoted)",
            pending_decisions: null,
          });
          return respondWithJob(supabase, jobId);
        }
      }

      // ── Generic decision handling (original executive-strategy must_decide) ──
      const projectUpdates: Record<string, any> = {};
      const did = choiceId.toLowerCase();
      if (did.includes("lane") || did.includes("positioning")) {
        projectUpdates.assigned_lane = choiceValue;
      } else if (did.includes("budget")) {
        projectUpdates.budget_range = choiceValue;
      } else if (did.includes("format")) {
        projectUpdates.format = choiceValue;
      } else if (did.includes("episode") || did.includes("duration") || did.includes("runtime")) {
        const num = Number(choiceValue);
        if (!isNaN(num)) {
          const { data: curProj } = await supabase.from("projects").select("guardrails_config").eq("id", job.project_id).single();
          const gc = curProj?.guardrails_config || {};
          gc.overrides = gc.overrides || {};
          gc.overrides.qualifications = { ...(gc.overrides.qualifications || {}), [choiceId]: num };
          projectUpdates.guardrails_config = gc;
          if (did.includes("episode_target_duration")) {
            projectUpdates.episode_target_duration_seconds = num;
          }
        }
      } else {
        const { data: curProj } = await supabase.from("projects").select("guardrails_config").eq("id", job.project_id).single();
        const gc = curProj?.guardrails_config || {};
        gc.overrides = gc.overrides || {};
        gc.overrides.qualifications = { ...(gc.overrides.qualifications || {}), [choiceId]: choiceValue };
        projectUpdates.guardrails_config = gc;
      }

      if (Object.keys(projectUpdates).length > 0) {
        await supabase.from("projects").update(projectUpdates).eq("id", job.project_id);
      }

      const remainingDecisions = pending.filter((d: any) => d.id !== choiceId);
      const hasBlockingRemaining = remainingDecisions.some((d: any) => d.impact === "blocking");

      await logStep(supabase, jobId, stepCount, job.current_document, "decision_applied",
        `${decision.question} → ${choiceValue}`,
        {}, undefined, { decisionId: choiceId, selectedValue: choiceValue, updates: projectUpdates }
      );

      if (hasBlockingRemaining) {
        const nextBlocking = remainingDecisions.find((d: any) => d.impact === "blocking");
        await updateJob(supabase, jobId, {
          step_count: stepCount,
          pending_decisions: remainingDecisions,
          stop_reason: `Approval required: ${nextBlocking?.question || "pending decisions"}`,
        });
        return respondWithJob(supabase, jobId, "approve-decision");
      }

      await updateJob(supabase, jobId, {
        step_count: stepCount,
        status: "running",
        stop_reason: null,
        pending_decisions: null,
      });
      return respondWithJob(supabase, jobId, "run-next");
    }

    // ═══════════════════════════════════════
    // ACTION: get-pending-doc
    // ═══════════════════════════════════════
    if (action === "get-pending-doc") {
      if (!jobId) return respond({ error: "jobId required" }, 400);
      const { data: job, error: jobErr } = await supabase.from("auto_run_jobs").select("*").eq("id", jobId).eq("user_id", userId).single();
      if (jobErr || !job) return respond({ error: "Job not found" }, 404);
      if (!job.awaiting_approval || !job.pending_doc_id) return respond({ error: "No pending document" }, 400);

      // Fetch version plaintext
      let docText = "";
      if (job.pending_version_id) {
        const { data: ver } = await supabase.from("project_document_versions")
          .select("plaintext").eq("id", job.pending_version_id).single();
        docText = ver?.plaintext || "";
      }
      if (!docText && job.pending_doc_id) {
        const { data: docRow } = await supabase.from("project_documents")
          .select("extracted_text, plaintext").eq("id", job.pending_doc_id).single();
        docText = docRow?.extracted_text || docRow?.plaintext || "";
      }

      return respond({
        job,
        pending_doc: {
          doc_id: job.pending_doc_id,
          version_id: job.pending_version_id,
          doc_type: job.pending_doc_type,
          next_doc_type: job.pending_next_doc_type,
          approval_type: job.approval_type,
          char_count: docText.length,
          text: docText.slice(0, 50000),
          preview: docText.slice(0, 500),
        },
      });
    }

    // ═══════════════════════════════════════
    // ACTION: approve-next
    // ═══════════════════════════════════════
    if (action === "approve-next") {
      if (!jobId) return respond({ error: "jobId required" }, 400);
      const approvalDecision = decision || body.approvalDecision;
      if (!approvalDecision || !["approve", "revise", "stop"].includes(approvalDecision)) {
        return respond({ error: "decision required: approve | revise | stop" }, 400);
      }

      const { data: job, error: jobErr } = await supabase.from("auto_run_jobs").select("*").eq("id", jobId).eq("user_id", userId).single();
      if (jobErr || !job) return respond({ error: "Job not found" }, 404);
      if (!job.awaiting_approval) return respond({ error: "Job is not awaiting approval" }, 400);

      const stepCount = job.step_count + 1;
      const currentDoc = job.current_document as DocStage;

      if (approvalDecision === "stop") {
        await logStep(supabase, jobId, stepCount, currentDoc, "approval_stop", "User stopped at approval gate");
        await updateJob(supabase, jobId, {
          step_count: stepCount, status: "stopped", stop_reason: "User stopped at approval gate",
          awaiting_approval: false, approval_type: null, approval_payload: null,
          pending_doc_id: null, pending_version_id: null, pending_doc_type: null, pending_next_doc_type: null,
        });
        return respondWithJob(supabase, jobId, "none");
      }

      if (approvalDecision === "revise") {
        await logStep(supabase, jobId, stepCount, currentDoc, "approval_revise", "User requested another rewrite pass");
        await updateJob(supabase, jobId, {
          step_count: stepCount, status: "running", stop_reason: null,
          awaiting_approval: false, approval_type: null, approval_payload: null,
          pending_doc_id: null, pending_version_id: null, pending_doc_type: null, pending_next_doc_type: null,
          stage_loop_count: Math.max(0, job.stage_loop_count - 1), // allow one more loop
        });
        return respondWithJob(supabase, jobId, "run-next");
      }

      // approve — advance stage
      const nextStage = job.pending_next_doc_type as DocStage | null;
      await logStep(supabase, jobId, stepCount, currentDoc, "approval_approved",
        `User approved ${job.approval_type}: ${currentDoc} → ${nextStage || "continue"}`
      );

      if (nextStage && isOnLadder(nextStage) && LADDER.indexOf(nextStage) <= LADDER.indexOf(job.target_document as DocStage)) {
        await updateJob(supabase, jobId, {
          step_count: stepCount, current_document: nextStage, stage_loop_count: 0,
          status: "running", stop_reason: null,
          awaiting_approval: false, approval_type: null, approval_payload: null,
          pending_doc_id: null, pending_version_id: null, pending_doc_type: null, pending_next_doc_type: null,
        });
      } else {
        // Target reached
        await updateJob(supabase, jobId, {
          step_count: stepCount, status: "completed", stop_reason: "Reached target document (approved)",
          awaiting_approval: false, approval_type: null, approval_payload: null,
          pending_doc_id: null, pending_version_id: null, pending_doc_type: null, pending_next_doc_type: null,
        });
      }
      return respondWithJob(supabase, jobId, "run-next");
    }

    // ═══════════════════════════════════════
    // ACTION: set-stage
    // ═══════════════════════════════════════
    if (action === "set-stage") {
      if (!jobId) return respond({ error: "jobId required" }, 400);
      const { stage } = body;
      if (!stage || !isOnLadder(stage)) return respond({ error: `Invalid stage: ${stage}` }, 400);
      const { data: job, error: jobErr } = await supabase.from("auto_run_jobs").select("*").eq("id", jobId).eq("user_id", userId).single();
      if (jobErr || !job) return respond({ error: "Job not found" }, 404);
      const stepCount = job.step_count + 1;
      await logStep(supabase, jobId, stepCount, stage, "set_stage", `Manual stage set: ${job.current_document} → ${stage}`);
      await updateJob(supabase, jobId, {
        current_document: stage, stage_loop_count: 0, step_count: stepCount,
      });
      return respondWithJob(supabase, jobId);
    }

    // ═══════════════════════════════════════
    // ACTION: force-promote
    // ═══════════════════════════════════════
    if (action === "force-promote") {
      if (!jobId) return respond({ error: "jobId required" }, 400);
      const { data: job, error: jobErr } = await supabase.from("auto_run_jobs").select("*").eq("id", jobId).eq("user_id", userId).single();
      if (jobErr || !job) return respond({ error: "Job not found" }, 404);
      const current = job.current_document as DocStage;
      const next = nextDoc(current);
      if (!next) return respond({ error: `Already at final stage: ${current}` }, 400);
      const stepCount = job.step_count + 1;
      await logStep(supabase, jobId, stepCount, current, "force_promote", `Force-promoted: ${current} → ${next}`);
      const targetIdx = LADDER.indexOf(job.target_document as DocStage);
      const nextIdx = LADDER.indexOf(next);
      if (nextIdx > targetIdx) {
        await updateJob(supabase, jobId, { step_count: stepCount, status: "completed", stop_reason: `Force-promoted past target` });
      } else {
        await updateJob(supabase, jobId, {
          current_document: next, stage_loop_count: 0, step_count: stepCount,
          status: "running", stop_reason: null,
          awaiting_approval: false, approval_type: null, pending_doc_id: null, pending_version_id: null,
          pending_doc_type: null, pending_next_doc_type: null, pending_decisions: null,
        });
      }
      return respondWithJob(supabase, jobId, "run-next");
    }

    // ═══════════════════════════════════════
    // ACTION: restart-from-stage
    // ═══════════════════════════════════════
    if (action === "restart-from-stage") {
      if (!jobId) return respond({ error: "jobId required" }, 400);
      const { stage } = body;
      if (!stage || !isOnLadder(stage)) return respond({ error: `Invalid stage: ${stage}` }, 400);
      const { data: job, error: jobErr } = await supabase.from("auto_run_jobs").select("*").eq("id", jobId).eq("user_id", userId).single();
      if (jobErr || !job) return respond({ error: "Job not found" }, 404);
      const stepCount = job.step_count + 1;
      await logStep(supabase, jobId, stepCount, stage, "restart_from_stage", `Restarted from ${stage}`);
      await updateJob(supabase, jobId, {
        current_document: stage, stage_loop_count: 0, step_count: stepCount,
        status: "running", stop_reason: null, error: null,
        awaiting_approval: false, approval_type: null, approval_payload: null,
        pending_doc_id: null, pending_version_id: null, pending_doc_type: null, pending_next_doc_type: null,
        pending_decisions: null,
      });
      return respondWithJob(supabase, jobId, "run-next");
    }

    // ═══════════════════════════════════════
    // ACTION: run-next (core state machine step)
    // ═══════════════════════════════════════
    if (action === "run-next") {
      if (!jobId) return respond({ error: "jobId required" }, 400);

      const { data: job, error: jobErr } = await supabase.from("auto_run_jobs").select("*").eq("id", jobId).eq("user_id", userId).single();
      if (jobErr || !job) return respond({ error: "Job not found" }, 404);
      if (job.awaiting_approval) return respond({ job, latest_steps: [], next_action_hint: "awaiting-approval" });
      if (job.status !== "running") return respond({ job, latest_steps: [], next_action_hint: getHint(job) });

      const currentDoc = job.current_document as DocStage;
      const stepCount = job.step_count;
      const stageLoopCount = job.stage_loop_count;

      // ── Guard: max steps — pause with actionable choices ──
      if (stepCount >= job.max_total_steps) {
        const stepLimitDecisions = [
          {
            id: "raise_step_limit_once",
            question: `Step limit (${job.max_total_steps}) reached. Continue with 6 more steps?`,
            options: [
              { value: "yes", why: "Add 6 more steps and continue the current development cycle" },
              { value: "no", why: "Stop the run here" },
            ],
            recommended: "yes",
            impact: "blocking" as const,
          },
          {
            id: "run_exec_strategy",
            question: "Run Executive Strategy to diagnose and reposition?",
            options: [
              { value: "yes", why: "Recommended when progress has stalled — analyses lane, budget, and qualifications" },
              { value: "no", why: "Skip strategic review" },
            ],
            recommended: "yes",
            impact: "non_blocking" as const,
          },
          {
            id: "force_promote",
            question: "Force-promote to the next document stage?",
            options: [
              { value: "yes", why: "Skip remaining loops and advance to the next stage immediately" },
              { value: "no", why: "Stay at current stage" },
            ],
            impact: "non_blocking" as const,
          },
        ];

        const pendingBundle = {
          reason: "step_limit_reached",
          current_document: currentDoc,
          last_ci: job.last_ci,
          last_gp: job.last_gp,
          last_gap: job.last_gap,
          last_readiness: job.last_readiness,
          last_risk_flags: job.last_risk_flags,
          choices: stepLimitDecisions,
        };

        await updateJob(supabase, jobId, {
          status: "paused",
          stop_reason: "Approval required to continue",
          pending_decisions: stepLimitDecisions,
        });
        await logStep(supabase, jobId, stepCount + 1, currentDoc, "pause_for_approval",
          `Step limit (${job.max_total_steps}) reached — awaiting user decision`,
          { ci: job.last_ci, gp: job.last_gp, gap: job.last_gap, readiness: job.last_readiness },
          undefined, pendingBundle
        );
        return respondWithJob(supabase, jobId, "approve-decision");
      }

      // ── Guard: already at target ──
      if (currentDoc === job.target_document && stageLoopCount > 0) {
        await updateJob(supabase, jobId, { status: "completed", stop_reason: "Reached target document" });
        await logStep(supabase, jobId, stepCount + 1, currentDoc, "stop", "Target document reached");
        return respondWithJob(supabase, jobId);
      }

      // ── Preflight qualification resolver before every cycle ──
      const { data: project } = await supabase.from("projects")
        .select("title, format, development_behavior, episode_target_duration_seconds, season_episode_count, guardrails_config, assigned_lane, budget_range, genres")
        .eq("id", job.project_id).single();
      const format = (project?.format || "film").toLowerCase().replace(/_/g, "-");
      const behavior = project?.development_behavior || "market";

      const preflight = await runPreflight(supabase, job.project_id, format, currentDoc);
      if (preflight.changed) {
        await logStep(supabase, jobId, stepCount, currentDoc, "preflight_resolve",
          `Resolved: ${Object.keys(preflight.resolved).join(", ")}`,
        );
      }

      // Re-fetch project after preflight may have updated it
      const { data: freshProject } = await supabase.from("projects")
        .select("episode_target_duration_seconds, season_episode_count, guardrails_config")
        .eq("id", job.project_id).single();
      let episodeDuration = freshProject?.episode_target_duration_seconds ||
        freshProject?.guardrails_config?.overrides?.qualifications?.episode_target_duration_seconds;

      // Hard fallback: if still falsy for a series format, use FORMAT_DEFAULTS
      if (!episodeDuration && FORMAT_DEFAULTS[format]?.episode_target_duration_seconds) {
        episodeDuration = FORMAT_DEFAULTS[format].episode_target_duration_seconds;
      }

      // ── IDEA auto-upshift: skip thin ideas directly to concept_brief ──
      if (currentDoc === "idea") {
        const { data: ideaDocs } = await supabase.from("project_documents")
          .select("id, plaintext, extracted_text")
          .eq("project_id", job.project_id).eq("doc_type", "idea")
          .order("created_at", { ascending: false }).limit(1);
        const ideaDoc = ideaDocs?.[0];
        const ideaText = ideaDoc?.extracted_text || ideaDoc?.plaintext || "";
        const wordCount = ideaText.trim().split(/\s+/).filter(Boolean).length;

        if (ideaText.length < 400 || wordCount < 80) {
          // Thin idea — convert to concept brief directly
          if (ideaDoc) {
            const { data: ideaVersions } = await supabase.from("project_document_versions")
              .select("id").eq("document_id", ideaDoc.id)
              .order("version_number", { ascending: false }).limit(1);
            const ideaVersion = ideaVersions?.[0];

            if (ideaVersion) {
              try {
                await callEdgeFunctionWithRetry(
                  supabase, supabaseUrl, "dev-engine-v2", {
                    action: "convert",
                    projectId: job.project_id,
                    documentId: ideaDoc.id,
                    versionId: ideaVersion.id,
                    targetOutput: "CONCEPT_BRIEF",
                  }, token, job.project_id, format, currentDoc, jobId, stepCount + 1
                );
              } catch (_e) {
                // conversion failed — continue anyway at concept_brief
              }
            }
          }

          const upshiftStep = stepCount + 1;
          await logStep(supabase, jobId, upshiftStep, "idea", "auto_skip_thin_idea",
            `Idea too thin (${wordCount} words, ${ideaText.length} chars); converting to concept brief`
          );
          await updateJob(supabase, jobId, {
            current_document: "concept_brief",
            stage_loop_count: 0,
            step_count: upshiftStep,
          });
          return respondWithJob(supabase, jobId, "run-next");
        }
      }

      // ── Fetch latest document for current stage ──
      const { data: docs } = await supabase.from("project_documents").select("id, doc_type, plaintext, extracted_text").eq("project_id", job.project_id).eq("doc_type", currentDoc).order("created_at", { ascending: false }).limit(1);
      const doc = docs?.[0];

      // If no document exists for current stage, generate one
      if (!doc) {
        const ladderIdx = LADDER.indexOf(currentDoc);
        if (ladderIdx <= 0) {
          await updateJob(supabase, jobId, { status: "failed", error: "No source document found for initial stage" });
          return respondWithJob(supabase, jobId);
        }

        const prevStage = LADDER[ladderIdx - 1];
        const { data: prevDocs } = await supabase.from("project_documents").select("id").eq("project_id", job.project_id).eq("doc_type", prevStage).order("created_at", { ascending: false }).limit(1);
        const prevDoc = prevDocs?.[0];
        if (!prevDoc) {
          await updateJob(supabase, jobId, { status: "failed", error: `No document for ${prevStage} to convert from` });
          return respondWithJob(supabase, jobId);
        }

        const { data: prevVersions } = await supabase.from("project_document_versions").select("id").eq("document_id", prevDoc.id).order("version_number", { ascending: false }).limit(1);
        const prevVersion = prevVersions?.[0];
        if (!prevVersion) {
          await updateJob(supabase, jobId, { status: "failed", error: `No version for ${prevStage} document` });
          return respondWithJob(supabase, jobId);
        }

        try {
          const { result: convertResult } = await callEdgeFunctionWithRetry(
            supabase, supabaseUrl, "dev-engine-v2", {
              action: "convert",
              projectId: job.project_id,
              documentId: prevDoc.id,
              versionId: prevVersion.id,
              targetOutput: currentDoc.toUpperCase(),
            }, token, job.project_id, format, currentDoc, jobId, stepCount + 1
          );

          const newStep = stepCount + 1;
          await logStep(supabase, jobId, newStep, currentDoc, "generate", `Generated ${currentDoc} from ${prevStage}`, {}, convertResult?.newDoc?.id ? `Created doc ${convertResult.newDoc.id}` : undefined, convertResult?.newDoc ? { docId: convertResult.newDoc.id } : undefined);
          await updateJob(supabase, jobId, { step_count: newStep, stage_loop_count: 0 });

          // ── APPROVAL GATE: after convert, pause for user to review ──
          const convertedDocId = convertResult?.newDoc?.id || convertResult?.documentId || null;
          let convertedVersionId: string | null = null;
          if (convertedDocId) {
            const { data: cvs } = await supabase.from("project_document_versions")
              .select("id").eq("document_id", convertedDocId)
              .order("version_number", { ascending: false }).limit(1);
            convertedVersionId = cvs?.[0]?.id || null;
          }
          // If we couldn't find the new doc, try the current stage doc
          if (!convertedDocId) {
            const { data: newDocs } = await supabase.from("project_documents")
              .select("id").eq("project_id", job.project_id).eq("doc_type", currentDoc)
              .order("created_at", { ascending: false }).limit(1);
            const newDocRow = newDocs?.[0];
            if (newDocRow) {
              const { data: newVers } = await supabase.from("project_document_versions")
                .select("id").eq("document_id", newDocRow.id)
                .order("version_number", { ascending: false }).limit(1);
              convertedVersionId = newVers?.[0]?.id || null;
            }
          }

          await logStep(supabase, jobId, newStep + 1, currentDoc, "approval_required",
            `Review generated ${currentDoc} before continuing`,
            {}, undefined, { docId: convertedDocId, versionId: convertedVersionId, doc_type: currentDoc, from_stage: prevStage }
          );
          await updateJob(supabase, jobId, {
            step_count: newStep + 1,
            status: "paused",
            stop_reason: `Approval required: review generated ${currentDoc}`,
            awaiting_approval: true,
            approval_type: "convert",
            pending_doc_id: convertedDocId || prevDoc.id,
            pending_version_id: convertedVersionId,
            pending_doc_type: currentDoc,
            pending_next_doc_type: currentDoc, // stay at same stage after approval (editorial loop starts)
          });
          return respondWithJob(supabase, jobId, "awaiting-approval");
        } catch (e: any) {
          await updateJob(supabase, jobId, { status: "failed", error: `Generate failed: ${e.message}` });
          await logStep(supabase, jobId, stepCount + 1, currentDoc, "stop", `Generate failed: ${e.message}`);
          return respondWithJob(supabase, jobId);
        }
      }

      // ── Document exists — run editorial loop ──
      const { data: versions } = await supabase.from("project_document_versions")
        .select("id, plaintext, version_number")
        .eq("document_id", doc.id)
        .order("version_number", { ascending: false }).limit(1);
      const latestVersion = versions?.[0];
      if (!latestVersion) {
        await updateJob(supabase, jobId, { status: "failed", error: "No version for current document" });
        return respondWithJob(supabase, jobId);
      }

      // Resolve the actual text being fed into analysis (version plaintext > doc extracted_text > doc plaintext)
      const reviewText = latestVersion.plaintext || doc.extracted_text || doc.plaintext || "";
      const reviewCharCount = reviewText.length;

      // ── review_input visibility step ──
      const simpleHash = reviewCharCount > 0
        ? reviewText.slice(0, 64).replace(/\s+/g, " ").trim()
        : "(empty)";
      await logStep(supabase, jobId, stepCount, currentDoc, "review_input",
        `Reviewing ${currentDoc} docId=${doc.id} versionId=${latestVersion.id} chars=${reviewCharCount}`,
        {}, reviewText.slice(0, 500),
        { docId: doc.id, versionId: latestVersion.id, doc_type: currentDoc, char_count: reviewCharCount, preview_hash: simpleHash }
      );

      // Step A: Run review (analyze + notes) with retry
      try {
        const { result: analyzeResult } = await callEdgeFunctionWithRetry(
          supabase, supabaseUrl, "dev-engine-v2", {
            action: "analyze",
            projectId: job.project_id,
            documentId: doc.id,
            versionId: latestVersion.id,
            deliverableType: currentDoc,
            developmentBehavior: behavior,
            format,
            episodeTargetDurationSeconds: episodeDuration,
          }, token, job.project_id, format, currentDoc, jobId, stepCount
        );

        const scoreRiskFlags: string[] = [];
        const ci = pickNumber(analyzeResult, ["ci_score", "scores.ci", "scores.ci_score", "ci"], 50, scoreRiskFlags);
        const gp = pickNumber(analyzeResult, ["gp_score", "scores.gp", "scores.gp_score", "gp"], 50, scoreRiskFlags);
        const gap = pickNumber(analyzeResult, ["gap", "scores.gap"], Math.abs(ci - gp), scoreRiskFlags);
        const trajectory = analyzeResult?.trajectory ?? null;
        const blockersCount = (analyzeResult?.blocking_issues || []).length;
        const highImpactCount = (analyzeResult?.high_impact_notes || []).length;

        const newStep = stepCount + 1;
        await logStep(supabase, jobId, newStep, currentDoc, "review",
          `CI:${ci} GP:${gp} Gap:${gap} Traj:${trajectory || "?"} B:${blockersCount} HI:${highImpactCount}`,
          { ci, gp, gap, readiness: 0, confidence: 0, risk_flags: [] },
          analyzeResult?.executive_snapshot || analyzeResult?.verdict || undefined
        );

        // Step B: Generate notes with retry
        await callEdgeFunctionWithRetry(
          supabase, supabaseUrl, "dev-engine-v2", {
            action: "notes",
            projectId: job.project_id,
            documentId: doc.id,
            versionId: latestVersion.id,
            analysisJson: analyzeResult,
          }, token, job.project_id, format, currentDoc, jobId, newStep
        );

        // Step C: Compute promotion intelligence
        const promo = computePromotion(ci, gp, gap, trajectory, currentDoc, blockersCount, highImpactCount, stageLoopCount + 1);

        await logStep(supabase, jobId, newStep + 1, currentDoc, "promotion_check",
          `${promo.recommendation} (readiness: ${promo.readiness_score}, flags: ${promo.risk_flags.join(",") || "none"})`,
          { ci, gp, gap, readiness: promo.readiness_score, confidence: promo.confidence, risk_flags: promo.risk_flags }
        );

        // Update job scores
        await updateJob(supabase, jobId, {
          step_count: newStep + 1,
          last_ci: ci, last_gp: gp, last_gap: gap,
          last_readiness: promo.readiness_score, last_confidence: promo.confidence,
          last_risk_flags: promo.risk_flags,
        });

        // ── HARD STOPS ──
        if (promo.risk_flags.includes("hard_gate:thrash")) {
          await updateJob(supabase, jobId, { status: "stopped", stop_reason: "Thrash detected — run Executive Strategy Loop" });
          await logStep(supabase, jobId, newStep + 2, currentDoc, "stop", "Thrash detected");
          return respondWithJob(supabase, jobId);
        }
        if (promo.risk_flags.includes("hard_gate:eroding_trajectory") || promo.recommendation === "escalate") {
          // Pause with actionable decisions — never call session-based engines
          const escalateDecisions = [
            {
              id: "force_promote",
              question: `Escalation at ${currentDoc} (CI:${ci} GP:${gp}). Force-promote to next stage?`,
              options: [
                { value: "yes", why: "Skip remaining loops and advance to the next document stage" },
                { value: "no", why: "Stay at current stage" },
              ],
              recommended: currentDoc === "idea" ? "yes" : undefined,
              impact: "blocking" as const,
            },
            {
              id: "run_exec_strategy",
              question: "Run Executive Strategy to diagnose and reposition?",
              options: [
                { value: "yes", why: "Recommended — analyses lane, budget, and qualifications" },
                { value: "no", why: "Skip strategic review" },
              ],
              recommended: "yes",
              impact: "non_blocking" as const,
            },
            {
              id: "raise_step_limit_once",
              question: "Add 6 more steps and continue?",
              options: [
                { value: "yes", why: "Continue the current development cycle with more steps" },
                { value: "no", why: "Stop the run" },
              ],
              impact: "non_blocking" as const,
            },
          ];

          const escalateReason = promo.risk_flags.includes("hard_gate:eroding_trajectory")
            ? "Trajectory eroding"
            : `Escalation: readiness ${promo.readiness_score}/100`;

          await logStep(supabase, jobId, newStep + 2, currentDoc, "pause_for_approval",
            `${escalateReason} — awaiting user decision`,
            { ci, gp, gap, readiness: promo.readiness_score, confidence: promo.confidence, risk_flags: promo.risk_flags },
          );
          await updateJob(supabase, jobId, {
            step_count: newStep + 2,
            status: "paused",
            stop_reason: `Approval required: ${escalateReason}`,
            pending_decisions: escalateDecisions,
          });
          return respondWithJob(supabase, jobId, "approve-decision");
        }

        // ── STABILISE: run rewrite if loops remain ──
        if (promo.recommendation === "stabilise") {
          const newLoopCount = stageLoopCount + 1;
          if (newLoopCount >= job.max_stage_loops) {
            if (blockersCount > 0) {
              await updateJob(supabase, jobId, { status: "paused", stop_reason: "Blockers persist — manual decision required", stage_loop_count: newLoopCount });
              await logStep(supabase, jobId, newStep + 2, currentDoc, "stop", "Blockers persist after max loops");
              return respondWithJob(supabase, jobId);
            }
            const next = nextDoc(currentDoc);
            if (next && LADDER.indexOf(next) <= LADDER.indexOf(job.target_document as DocStage)) {
              // ── APPROVAL GATE: pause before force-promoting after max loops ──
              await logStep(supabase, jobId, newStep + 2, currentDoc, "approval_required",
                `Max loops reached. Review ${currentDoc} before promoting to ${next}`,
                {}, undefined, { docId: doc.id, versionId: latestVersion.id, doc_type: currentDoc, next_doc_type: next }
              );
              await updateJob(supabase, jobId, {
                stage_loop_count: newLoopCount, step_count: newStep + 2,
                status: "paused", stop_reason: `Approval required: review ${currentDoc} before promoting to ${next}`,
                awaiting_approval: true, approval_type: "promote",
                pending_doc_id: doc.id, pending_version_id: latestVersion.id,
                pending_doc_type: currentDoc, pending_next_doc_type: next,
              });
              return respondWithJob(supabase, jobId, "awaiting-approval");
            }
          }

          // Apply rewrite with all notes (with retry)
          const notesResult = await supabase.from("development_runs").select("output_json").eq("document_id", doc.id).eq("run_type", "NOTES").order("created_at", { ascending: false }).limit(1).single();
          const notes = notesResult.data?.output_json;
          const approvedNotes = [
            ...(notes?.blocking_issues || analyzeResult?.blocking_issues || []),
            ...(notes?.high_impact_notes || analyzeResult?.high_impact_notes || []),
          ];
          const protectItems = notes?.protect || analyzeResult?.protect || [];

          try {
            const rewriteResult = await callEdgeFunctionWithRetry(
              supabase, supabaseUrl, "dev-engine-v2", {
                action: "rewrite",
                projectId: job.project_id,
                documentId: doc.id,
                versionId: latestVersion.id,
                approvedNotes,
                protectItems,
                deliverableType: currentDoc,
                developmentBehavior: behavior,
                format,
              }, token, job.project_id, format, currentDoc, jobId, newStep + 2
            );

            // Re-fetch latest version after rewrite to track new versionId
            const { data: postRewriteVersions } = await supabase.from("project_document_versions")
              .select("id, version_number")
              .eq("document_id", doc.id)
              .order("version_number", { ascending: false }).limit(1);
            const newVersionId = postRewriteVersions?.[0]?.id || rewriteResult?.result?.newVersion?.id || "unknown";

            await updateJob(supabase, jobId, { stage_loop_count: newLoopCount, step_count: newStep + 2 });
            await logStep(supabase, jobId, newStep + 2, currentDoc, "rewrite", `Applied rewrite (loop ${newLoopCount}/${job.max_stage_loops})`);
            await logStep(supabase, jobId, newStep + 3, currentDoc, "rewrite_output_ref",
              `Rewrite created new versionId=${newVersionId}`,
              {}, undefined, { docId: doc.id, newVersionId }
            );
            return respondWithJob(supabase, jobId, "run-next");
          } catch (e: any) {
            await updateJob(supabase, jobId, { status: "failed", error: `Rewrite failed: ${e.message}` });
            return respondWithJob(supabase, jobId);
          }
        }

        // ── PROMOTE ──
        if (promo.recommendation === "promote") {
          const modeConf = MODE_CONFIG[job.mode] || MODE_CONFIG.balanced;
          if (modeConf.require_readiness && promo.readiness_score < modeConf.require_readiness) {
            await updateJob(supabase, jobId, { stage_loop_count: stageLoopCount + 1, step_count: newStep + 1 });
            await logStep(supabase, jobId, newStep + 2, currentDoc, "stabilise", `Readiness ${promo.readiness_score} < ${modeConf.require_readiness} (premium threshold)`);
            return respondWithJob(supabase, jobId, "run-next");
          }

          const next = nextDoc(currentDoc);
          if (next && LADDER.indexOf(next) <= LADDER.indexOf(job.target_document as DocStage)) {
            // ── APPROVAL GATE: pause before promoting to next stage ──
            await logStep(supabase, jobId, newStep + 2, currentDoc, "approval_required",
              `Promote recommended: ${currentDoc} → ${next}. Review before advancing.`,
              { ci, gp, gap, readiness: promo.readiness_score, confidence: promo.confidence },
              undefined, { docId: doc.id, versionId: latestVersion.id, doc_type: currentDoc, next_doc_type: next }
            );
            await updateJob(supabase, jobId, {
              step_count: newStep + 2, status: "paused",
              stop_reason: `Approval required: review ${currentDoc} before promoting to ${next}`,
              awaiting_approval: true, approval_type: "promote",
              pending_doc_id: doc.id, pending_version_id: latestVersion.id,
              pending_doc_type: currentDoc, pending_next_doc_type: next,
            });
            return respondWithJob(supabase, jobId, "awaiting-approval");
          } else {
            await updateJob(supabase, jobId, { status: "completed", stop_reason: "Reached target document" });
            await logStep(supabase, jobId, newStep + 2, currentDoc, "stop", "Target reached");
            return respondWithJob(supabase, jobId);
          }
        }
      } catch (e: any) {
        await updateJob(supabase, jobId, { status: "failed", error: `Step failed: ${e.message}` });
        await logStep(supabase, jobId, stepCount + 1, currentDoc, "stop", `Error: ${e.message}`);
        return respondWithJob(supabase, jobId);
      }

      return respondWithJob(supabase, jobId);
    }

    return respond({ error: `Unknown action: ${action}` }, 400);
  } catch (e: any) {
    return respond({ error: e.message || "Internal error" }, 500);
  }
});

// ── Response Helpers ──

function respond(data: any, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

async function respondWithJob(supabase: any, jobId: string, hint?: string): Promise<Response> {
  const { data: job } = await supabase.from("auto_run_jobs").select("*").eq("id", jobId).single();
  const { data: steps } = await supabase.from("auto_run_steps").select("*").eq("job_id", jobId).order("step_index", { ascending: false }).limit(10);
  return respond({
    job,
    latest_steps: (steps || []).reverse(),
    next_action_hint: hint || getHint(job),
  });
}

function getHint(job: any): string {
  if (!job) return "none";
  if (job.awaiting_approval) return "awaiting-approval";
  if (job.status === "running") return "run-next";
  if (job.status === "paused") {
    if (job.pending_decisions && Array.isArray(job.pending_decisions) && job.pending_decisions.length > 0) {
      return "approve-decision";
    }
    return "resume";
  }
  if (job.status === "completed") return "none";
  if (job.status === "stopped") return "none";
  if (job.status === "failed") return "none";
  return "run-next";
}
