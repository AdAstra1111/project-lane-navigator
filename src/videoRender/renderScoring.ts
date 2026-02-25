/**
 * Video Render — Deterministic Scoring Rubric
 * Converts render job summary into a quality run payload.
 * Same inputs => identical scores. No randomness.
 * Uses RENDER_ namespace for failure codes — never CIK codes.
 */

/* ── Types ── */

export interface RenderJobSummary {
  projectId: string;
  jobId: string;
  planId: string;
  lane: string;
  providerId: string;
  modelId: string;
  totalShots: number;
  completedShots: number;
  failedShots: number;
  totalRetries: number;
  avgCostPerShot: number;
  continuityWarnings: string[];
  roughCutStatus: "complete" | "error" | "none";
  processingTimeMs: number;
  shotArtifacts: Array<{
    shotIndex: number;
    durationSec: number;
    storagePath: string;
    providerJobId?: string;
  }>;
}

export interface RenderQualityPayload {
  run: {
    project_id: string;
    doc_id: string | null;
    engine: string;
    lane: string;
    model: string;
    attempt_count: number;
    final_pass: boolean;
    final_score: number;
    run_source: string;
    adapter_mode: string;
    strictness_mode: string;
    settings_json: Record<string, unknown>;
    hard_failures: string[];
    diagnostic_flags: string[];
    metrics_json: Record<string, unknown>;
  };
  attempt0: {
    attempt_index: number;
    model: string;
    score: number;
    pass: boolean;
    failures: string[];
    hard_failures: string[];
    diagnostic_flags: string[];
    unit_count: number;
    expected_unit_count: number;
    repair_instruction: string | null;
    input_summary_json: Record<string, unknown>;
    output_json: Record<string, unknown>;
    adapter_metrics_json: Record<string, unknown>;
    timing_json: Record<string, unknown>;
  };
}

/* ── Constants ── */

/** Max continuity warnings before it becomes a hard failure */
const CONTINUITY_WARNING_THRESHOLD = 5;
/** Retry rate above this triggers a diagnostic flag */
const HIGH_RETRY_RATE_THRESHOLD = 0.5;

/* ── Scoring Rubric (Deterministic) ── */

/**
 * Compute a deterministic 0–1 score from job summary.
 * Rubric weights:
 *   - Completion rate: 50%
 *   - Continuity severity: 25% (penalized by warning count)
 *   - Retry rate: 15% (lower is better)
 *   - Rough cut completion: 10%
 */
export function computeRenderScore(summary: RenderJobSummary): number {
  const { totalShots, completedShots, failedShots, totalRetries, continuityWarnings, roughCutStatus } = summary;

  if (totalShots === 0) return 0;

  // Completion rate [0,1]
  const completionRate = completedShots / totalShots;

  // Continuity severity [0,1] — fewer warnings is better
  const maxWarnings = Math.max(totalShots, 1);
  const continuitySeverity = Math.max(0, 1 - (continuityWarnings.length / maxWarnings));

  // Retry rate [0,1] — 0 retries = 1.0, high retries = lower
  const retryRate = totalShots > 0 ? totalRetries / totalShots : 0;
  const retryScore = Math.max(0, 1 - retryRate);

  // Rough cut bonus
  const roughCutScore = roughCutStatus === "complete" ? 1.0 : roughCutStatus === "error" ? 0.3 : 0.5;

  const raw = (completionRate * 0.50) + (continuitySeverity * 0.25) + (retryScore * 0.15) + (roughCutScore * 0.10);

  // Clamp and round to 3 decimal places
  return Math.round(Math.min(1, Math.max(0, raw)) * 1000) / 1000;
}

/**
 * Derive hard failures from job summary.
 * Uses RENDER_ namespace — never CIK failure codes.
 */
export function deriveHardFailures(summary: RenderJobSummary): string[] {
  const failures: string[] = [];

  if (summary.failedShots > 0) {
    failures.push("RENDER_SHOT_FAILED");
  }

  if (summary.continuityWarnings.length >= CONTINUITY_WARNING_THRESHOLD) {
    failures.push("RENDER_CONTINUITY_VIOLATION");
  }

  if (summary.roughCutStatus === "error") {
    failures.push("RENDER_ASSEMBLY_FAILED");
  }

  if (summary.completedShots === 0 && summary.totalShots > 0) {
    failures.push("RENDER_TOTAL_FAILURE");
  }

  return failures;
}

/**
 * Derive diagnostic flags (non-blocking warnings).
 */
export function deriveDiagnosticFlags(summary: RenderJobSummary): string[] {
  const flags: string[] = [];

  const retryRate = summary.totalShots > 0 ? summary.totalRetries / summary.totalShots : 0;
  if (retryRate >= HIGH_RETRY_RATE_THRESHOLD) {
    flags.push("RENDER_HIGH_RETRY_RATE");
  }

  if (summary.continuityWarnings.length > 0 && summary.continuityWarnings.length < CONTINUITY_WARNING_THRESHOLD) {
    flags.push("RENDER_CONTINUITY_WARNINGS");
  }

  if (summary.roughCutStatus === "none") {
    flags.push("RENDER_NO_ROUGH_CUT");
  }

  return flags;
}

/**
 * Determine pass/fail.
 * Pass if all shots complete AND no hard failures.
 */
export function computePass(summary: RenderJobSummary): boolean {
  const hardFailures = deriveHardFailures(summary);
  return hardFailures.length === 0 && summary.completedShots === summary.totalShots;
}

/**
 * Build the full quality run payload for persistence via RPC.
 */
export function buildRenderQualityPayload(summary: RenderJobSummary): RenderQualityPayload {
  const score = computeRenderScore(summary);
  const pass = computePass(summary);
  const hardFailures = deriveHardFailures(summary);
  const diagnosticFlags = deriveDiagnosticFlags(summary);

  const metricsJson = {
    totalShots: summary.totalShots,
    completedShots: summary.completedShots,
    failedShots: summary.failedShots,
    retries: summary.totalRetries,
    avgCost: summary.avgCostPerShot,
    continuityWarningsCount: summary.continuityWarnings.length,
    roughCutStatus: summary.roughCutStatus,
    provider_id: summary.providerId,
    model_id: summary.modelId,
  };

  // Cap shot artifacts in output to avoid bloat
  const cappedArtifacts = summary.shotArtifacts.slice(0, 50);

  return {
    run: {
      project_id: summary.projectId,
      doc_id: null,
      engine: "video_render",
      lane: summary.lane,
      model: summary.modelId,
      attempt_count: 1,
      final_pass: pass,
      final_score: score,
      run_source: "video_render",
      adapter_mode: "deterministic",
      strictness_mode: "standard",
      settings_json: { provider_id: summary.providerId, model_id: summary.modelId },
      hard_failures: hardFailures,
      diagnostic_flags: diagnosticFlags,
      metrics_json: metricsJson,
    },
    attempt0: {
      attempt_index: 0,
      model: summary.modelId,
      score,
      pass,
      failures: hardFailures,
      hard_failures: hardFailures,
      diagnostic_flags: diagnosticFlags,
      unit_count: summary.completedShots,
      expected_unit_count: summary.totalShots,
      repair_instruction: null,
      input_summary_json: {
        jobId: summary.jobId,
        planId: summary.planId,
        totalShots: summary.totalShots,
      },
      output_json: {
        jobSummary: metricsJson,
        shots: cappedArtifacts,
      },
      adapter_metrics_json: {
        avgCostPerShot: summary.avgCostPerShot,
        totalRetries: summary.totalRetries,
        processingTimeMs: summary.processingTimeMs,
      },
      timing_json: {
        totalMs: summary.processingTimeMs,
      },
    },
  };
}
