/**
 * Cinematic Intelligence Kernel — In-memory quality rollup telemetry
 * Lightweight counters flushed as CINEMATIC_QUALITY_SUMMARY every N finals.
 */
import type { CinematicQualityGateEvent } from "./cinematic-kernel.ts";

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
  failures_by_code: Record<string, number>;
  final_mode_counts: { explicit: number; heuristic: number; unknown: number };
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
      pass_attempt0: 0,
      pass_attempt1: 0,
      fail_final: 0,
      attempt0_count: 0,
      sum_score_attempt0: 0,
      sum_score_final: 0,
      min_score_final: 1,
      max_score_final: 0,
      failures_by_code: {},
      final_mode_counts: { explicit: 0, heuristic: 0, unknown: 0 },
      last_flush_ts: Date.now(),
    };
    buckets.set(k, b);
  }
  return b;
}

/**
 * Record attempt 0 score (always called).
 * Does NOT count as final unless finalVia="attempt0" is passed to recordFinal.
 */
export function recordAttempt0(payload: CinematicQualityGateEvent): void {
  const b = getBucket(payload.handler, payload.phase, payload.model);
  b.attempt0_count++;
  b.sum_score_attempt0 += payload.score;
}

/**
 * Record the final outcome of a CIK run.
 * @param finalVia "attempt0" if passed on first try, "attempt1" if repair was needed
 */
export function recordFinal(
  payload: CinematicQualityGateEvent,
  finalVia: "attempt0" | "attempt1",
): void {
  const b = getBucket(payload.handler, payload.phase, payload.model);
  b.total_runs++;
  b.sum_score_final += payload.score;
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

/**
 * Flush a CINEMATIC_QUALITY_SUMMARY if enough finals have accumulated or enough time elapsed.
 */
export function flushCinematicSummaryIfDue(opts: { handler: string; phase: string; model: string }): void {
  const k = bucketKey(opts.handler, opts.phase, opts.model);
  const b = buckets.get(k);
  if (!b || b.total_runs === 0) return;

  const elapsed = Date.now() - b.last_flush_ts;
  if (b.total_runs < FLUSH_EVERY_FINALS && elapsed < FLUSH_MAX_MS) return;

  const total = b.total_runs;
  const summary = {
    type: "CINEMATIC_QUALITY_SUMMARY",
    handler: opts.handler,
    phase: opts.phase,
    model: opts.model,
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
    },
    failures: { ...b.failures_by_code },
    adapter_modes: {
      explicit: total > 0 ? b.final_mode_counts.explicit / total : 0,
      heuristic: total > 0 ? b.final_mode_counts.heuristic / total : 0,
      unknown: total > 0 ? b.final_mode_counts.unknown / total : 0,
    },
  };

  console.error(JSON.stringify(summary));

  // Reset bucket
  b.total_runs = 0;
  b.pass_attempt0 = 0;
  b.pass_attempt1 = 0;
  b.fail_final = 0;
  b.attempt0_count = 0;
  b.sum_score_attempt0 = 0;
  b.sum_score_final = 0;
  b.min_score_final = 1;
  b.max_score_final = 0;
  b.failures_by_code = {};
  b.final_mode_counts = { explicit: 0, heuristic: 0, unknown: 0 };
  b.last_flush_ts = Date.now();
}
