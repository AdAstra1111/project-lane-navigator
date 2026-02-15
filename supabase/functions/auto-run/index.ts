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
    const { action, projectId, jobId, mode, start_document, target_document, max_stage_loops, max_total_steps } = body;

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
    // ACTION: run-next (core state machine step)
    // ═══════════════════════════════════════
    if (action === "run-next") {
      if (!jobId) return respond({ error: "jobId required" }, 400);

      const { data: job, error: jobErr } = await supabase.from("auto_run_jobs").select("*").eq("id", jobId).eq("user_id", userId).single();
      if (jobErr || !job) return respond({ error: "Job not found" }, 404);
      if (job.status !== "running") return respond({ job, latest_steps: [], next_action_hint: getHint(job) });

      const currentDoc = job.current_document as DocStage;
      const stepCount = job.step_count;
      const stageLoopCount = job.stage_loop_count;

      // ── Guard: max steps ──
      if (stepCount >= job.max_total_steps) {
        await updateJob(supabase, jobId, { status: "paused", stop_reason: "Step limit reached — manual decision required" });
        await logStep(supabase, jobId, stepCount + 1, currentDoc, "stop", "Step limit reached");
        return respondWithJob(supabase, jobId);
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
          return respondWithJob(supabase, jobId, "run-next");
        } catch (e: any) {
          await updateJob(supabase, jobId, { status: "failed", error: `Generate failed: ${e.message}` });
          await logStep(supabase, jobId, stepCount + 1, currentDoc, "stop", `Generate failed: ${e.message}`);
          return respondWithJob(supabase, jobId);
        }
      }

      // ── Document exists — run editorial loop ──
      const { data: versions } = await supabase.from("project_document_versions").select("id").eq("document_id", doc.id).order("version_number", { ascending: false }).limit(1);
      const latestVersion = versions?.[0];
      if (!latestVersion) {
        await updateJob(supabase, jobId, { status: "failed", error: "No version for current document" });
        return respondWithJob(supabase, jobId);
      }

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

        const ci = analyzeResult?.ci_score ?? analyzeResult?.scores?.ci_score ?? 0;
        const gp = analyzeResult?.gp_score ?? analyzeResult?.scores?.gp_score ?? 0;
        const gap = analyzeResult?.gap ?? analyzeResult?.scores?.gap ?? 0;
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
        if (promo.risk_flags.includes("hard_gate:eroding_trajectory")) {
          await updateJob(supabase, jobId, { status: "stopped", stop_reason: "Trajectory eroding — run Executive Strategy Loop" });
          await logStep(supabase, jobId, newStep + 2, currentDoc, "stop", "Trajectory eroding");
          return respondWithJob(supabase, jobId);
        }
        if (promo.recommendation === "escalate") {
          // ── Executive Strategy: call development-engine for reposition plan ──
          try {
            const docText = (doc.plaintext || doc.extracted_text || "").slice(0, 15000);
            const strategyResult = await callEdgeFunction(supabaseUrl, "development-engine", {
              action: "review",
              sessionId: null,
              projectId: job.project_id,
              inputText: docText,
              format,
              genres: project?.genres || [],
              lane: project?.assigned_lane || "independent-film",
              budget: project?.budget_range || "low",
              title: project?.title || "Untitled",
            }, token);

            const stratParsed = strategyResult?.parsed || strategyResult?.iteration?.raw_ai_response || strategyResult || {};

            // Apply deterministic project field fixes from strategy result
            const projectUpdates: Record<string, any> = {};
            if (stratParsed.recommended_lane && typeof stratParsed.recommended_lane === "string") {
              projectUpdates.assigned_lane = stratParsed.recommended_lane;
            }
            if (stratParsed.recommended_budget && typeof stratParsed.recommended_budget === "string") {
              projectUpdates.budget_range = stratParsed.recommended_budget;
            }
            // Only update format if explicitly recommended and it's a known format
            const SAFE_FORMATS = ["film","tv-series","limited-series","vertical-drama","anim-series","anim-feature","documentary","documentary-series","short-film","digital-series","reality"];
            if (stratParsed.recommended_format && SAFE_FORMATS.includes(stratParsed.recommended_format)) {
              projectUpdates.format = stratParsed.recommended_format;
            }

            // Apply qualification overrides from strategy
            if (stratParsed.qualifications && typeof stratParsed.qualifications === "object") {
              const { data: curProj } = await supabase.from("projects").select("guardrails_config").eq("id", job.project_id).single();
              const gc = curProj?.guardrails_config || {};
              gc.overrides = gc.overrides || {};
              gc.overrides.qualifications = { ...(gc.overrides.qualifications || {}), ...stratParsed.qualifications };
              projectUpdates.guardrails_config = gc;
            }

            if (Object.keys(projectUpdates).length > 0) {
              await supabase.from("projects").update(projectUpdates).eq("id", job.project_id);
            }

            // Log as executive_strategy_applied
            await logStep(supabase, jobId, newStep + 2, currentDoc, "executive_strategy_applied",
              `Strategy applied: ${Object.keys(projectUpdates).join(", ") || "no field changes"}. CI:${stratParsed.ci_score ?? "?"} GP:${stratParsed.gp_score ?? "?"}`,
              { ci: stratParsed.ci_score, gp: stratParsed.gp_score, gap: stratParsed.gap, readiness: promo.readiness_score, confidence: promo.confidence, risk_flags: [...promo.risk_flags, "executive_strategy_applied"] },
              stratParsed.summary || stratParsed.primary_creative_risk || undefined,
              { strategy: stratParsed, updates: projectUpdates }
            );

            // Re-run preflight after strategy updates (format may have changed)
            const updatedFormat = (projectUpdates.format || format);
            await runPreflight(supabase, job.project_id, updatedFormat, currentDoc);

            // Continue auto-run at same stage (reset stage loop to allow fresh pass)
            await updateJob(supabase, jobId, { step_count: newStep + 2, stage_loop_count: 0 });
            return respondWithJob(supabase, jobId, "run-next");
          } catch (stratErr: any) {
            // If executive strategy fails, fall back to stopping
            console.error("[auto-run] Executive strategy failed:", stratErr.message);
            await updateJob(supabase, jobId, { status: "stopped", stop_reason: `Escalate: executive strategy failed (${stratErr.message})` });
            await logStep(supabase, jobId, newStep + 2, currentDoc, "stop", `Executive strategy failed: ${stratErr.message}`);
            return respondWithJob(supabase, jobId);
          }
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
              await updateJob(supabase, jobId, { current_document: next, stage_loop_count: 0 });
              await logStep(supabase, jobId, newStep + 2, currentDoc, "promote", `Force-promoting to ${next} after max loops`);
              return respondWithJob(supabase, jobId, "run-next");
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
            await callEdgeFunctionWithRetry(
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

            await updateJob(supabase, jobId, { stage_loop_count: newLoopCount, step_count: newStep + 2 });
            await logStep(supabase, jobId, newStep + 2, currentDoc, "rewrite", `Applied rewrite (loop ${newLoopCount}/${job.max_stage_loops})`);
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
            await updateJob(supabase, jobId, { current_document: next, stage_loop_count: 0, step_count: newStep + 1 });
            await logStep(supabase, jobId, newStep + 2, currentDoc, "promote", `Promoted: ${currentDoc} → ${next}`);
            return respondWithJob(supabase, jobId, "run-next");
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
  if (job.status === "running") return "run-next";
  if (job.status === "paused") return "resume";
  if (job.status === "completed") return "none";
  if (job.status === "stopped") return "none";
  if (job.status === "failed") return "none";
  return "run-next";
}
