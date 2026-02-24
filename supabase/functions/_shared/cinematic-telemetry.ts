/**
 * Cinematic Intelligence Kernel — In-memory quality rollup telemetry
 * Lightweight counters flushed as CINEMATIC_QUALITY_SUMMARY every N finals.
 * Also routes CINEMATIC_FEATURE_SUMMARY and CINEMATIC_DIAGNOSTIC_FLAGS
 * through the same bounded bucketing/flush system.
 */
import type { CinematicQualityGateEvent } from "./cinematic-kernel.ts";
import type { CinematicFeatures } from "./cinematic-features.ts";
import type { PenaltyEntry, CinematicFailureCode } from "./cinematic-model.ts";

interface RollupBucket {
  total_runs: number;
  pass_attempt0: number;
  pass_attempt1: number;
  fail_final: number;
  attempt0_count: number;
  sum_score_attempt0: number;
  sum_score_final: number;
  min_score_final: number;
  max_score_final: number;
  sum_distinct_intents_final: number;
  sum_tonal_flips_final: number;
  failures_by_code: Record<string, number>;
  final_mode_counts: { explicit: number; heuristic: number; unknown: number };
  // Feature summary accumulators
  sum_peak_index: number;
  peak_late_count: number;
  sum_energy_slope: number;
  sum_direction_reversals: number;
  pacing_mismatch_count: number;
  // Diagnostic flag accumulators
  hard_failures_by_code: Record<string, number>;
  diagnostic_flags_by_code: Record<string, number>;
  last_flush_ts: number;
}

const FLUSH_EVERY_FINALS = 25;
const FLUSH_MAX_MS = 60_000;

const buckets = new Map<string, RollupBucket>();

function bucketKey(handler: string, phase: string, model: string): string {
  return `${handler}::${phase}::${model}`;
}

function getBucket(handler: string, phase: string, model: string): RollupBucket {
  const k = bucketKey(handler, phase, model);
  let b = buckets.get(k);
  if (!b) {
    b = {
      total_runs: 0,
      pass_attempt0: 0, pass_attempt1: 0, fail_final: 0,
      attempt0_count: 0,
      sum_score_attempt0: 0, sum_score_final: 0,
      min_score_final: 1, max_score_final: 0,
      sum_distinct_intents_final: 0, sum_tonal_flips_final: 0,
      failures_by_code: {},
      final_mode_counts: { explicit: 0, heuristic: 0, unknown: 0 },
      sum_peak_index: 0, peak_late_count: 0,
      sum_energy_slope: 0, sum_direction_reversals: 0,
      pacing_mismatch_count: 0,
      hard_failures_by_code: {}, diagnostic_flags_by_code: {},
      last_flush_ts: Date.now(),
    };
    buckets.set(k, b);
  }
  return b;
}

export function recordAttempt0(payload: CinematicQualityGateEvent): void {
  const b = getBucket(payload.handler, payload.phase, payload.model);
  b.attempt0_count++;
  b.sum_score_attempt0 += payload.score;
}

export function recordFinal(
  payload: CinematicQualityGateEvent,
  finalVia: "attempt0" | "attempt1",
): void {
  const b = getBucket(payload.handler, payload.phase, payload.model);
  b.total_runs++;
  b.sum_score_final += payload.score;
  b.sum_distinct_intents_final += payload.distinct_intents ?? 0;
  b.sum_tonal_flips_final += Number(payload.metrics?.tonal_flip_count ?? 0);
  b.min_score_final = Math.min(b.min_score_final, payload.score);
  b.max_score_final = Math.max(b.max_score_final, payload.score);

  const mode = (payload.adapter_mode === "explicit" || payload.adapter_mode === "heuristic")
    ? payload.adapter_mode : "unknown";
  b.final_mode_counts[mode]++;

  if (payload.pass) {
    if (finalVia === "attempt0") b.pass_attempt0++;
    else b.pass_attempt1++;
  } else {
    b.fail_final++;
    for (const code of payload.failures) {
      b.failures_by_code[code] = (b.failures_by_code[code] || 0) + 1;
    }
  }
}

/** Record feature summary data into the rollup bucket. */
export function recordFeatureSummary(
  handler: string, phase: string, model: string,
  features: CinematicFeatures,
): void {
  const b = getBucket(handler, phase, model);
  b.sum_peak_index += features.peakIndex;
  if (features.peakIsLate) b.peak_late_count++;
  b.sum_energy_slope += features.energy.slope;
  b.sum_direction_reversals += features.directionReversalCount;
  if (features.pacingMismatch) b.pacing_mismatch_count++;
}

/** Record diagnostic flags into the rollup bucket. */
export function recordDiagnosticFlags(
  handler: string, phase: string, model: string,
  hardFailures: CinematicFailureCode[],
  diagnosticFlags: CinematicFailureCode[],
): void {
  const b = getBucket(handler, phase, model);
  for (const c of hardFailures) {
    b.hard_failures_by_code[c] = (b.hard_failures_by_code[c] || 0) + 1;
  }
  for (const c of diagnosticFlags) {
    b.diagnostic_flags_by_code[c] = (b.diagnostic_flags_by_code[c] || 0) + 1;
  }
}

export function flushCinematicSummaryIfDue(opts: { handler: string; phase: string; model: string }): void {
  const k = bucketKey(opts.handler, opts.phase, opts.model);
  const b = buckets.get(k);
  if (!b || b.total_runs === 0) return;

  const elapsed = Date.now() - b.last_flush_ts;
  if (b.total_runs < FLUSH_EVERY_FINALS && elapsed < FLUSH_MAX_MS) return;

  const total = b.total_runs;
  const summary = {
    type: "CINEMATIC_QUALITY_SUMMARY",
    handler: opts.handler, phase: opts.phase, model: opts.model,
    window: { finals: total, since_ms: elapsed },
    rates: {
      pass_attempt0: total > 0 ? b.pass_attempt0 / total : 0,
      repaired_pass: total > 0 ? b.pass_attempt1 / total : 0,
      fail_final: total > 0 ? b.fail_final / total : 0,
    },
    scores: {
      avg_attempt0: b.attempt0_count > 0 ? b.sum_score_attempt0 / b.attempt0_count : 0,
      avg_final: total > 0 ? b.sum_score_final / total : 0,
      min_final: b.min_score_final,
      max_final: b.max_score_final,
      intent_distinct_avg_final: total > 0 ? b.sum_distinct_intents_final / total : 0,
      polarity_flip_avg_final: total > 0 ? b.sum_tonal_flips_final / total : 0,
    },
    failures: { ...b.failures_by_code },
    adapter_modes: {
      explicit: total > 0 ? b.final_mode_counts.explicit / total : 0,
      heuristic: total > 0 ? b.final_mode_counts.heuristic / total : 0,
      unknown: total > 0 ? b.final_mode_counts.unknown / total : 0,
    },
    features: {
      avg_peak_index: total > 0 ? b.sum_peak_index / total : 0,
      peak_late_rate: total > 0 ? b.peak_late_count / total : 0,
      avg_energy_slope: total > 0 ? b.sum_energy_slope / total : 0,
      avg_direction_reversals: total > 0 ? b.sum_direction_reversals / total : 0,
      pacing_mismatch_rate: total > 0 ? b.pacing_mismatch_count / total : 0,
    },
    diagnostics: {
      hard_failures: { ...b.hard_failures_by_code },
      diagnostic_flags: { ...b.diagnostic_flags_by_code },
    },
  };

  console.error(JSON.stringify(summary));

  // Reset bucket
  b.total_runs = 0;
  b.pass_attempt0 = 0; b.pass_attempt1 = 0; b.fail_final = 0;
  b.attempt0_count = 0;
  b.sum_score_attempt0 = 0; b.sum_score_final = 0;
  b.min_score_final = 1; b.max_score_final = 0;
  b.sum_distinct_intents_final = 0; b.sum_tonal_flips_final = 0;
  b.failures_by_code = {};
  b.final_mode_counts = { explicit: 0, heuristic: 0, unknown: 0 };
  b.sum_peak_index = 0; b.peak_late_count = 0;
  b.sum_energy_slope = 0; b.sum_direction_reversals = 0;
  b.pacing_mismatch_count = 0;
  b.hard_failures_by_code = {}; b.diagnostic_flags_by_code = {};
  b.last_flush_ts = Date.now();
}
