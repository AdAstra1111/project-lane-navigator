/**
 * Cinematic Intelligence Kernel — Universal quality gate
 * One bounded repair attempt. No infinite loops. No LLM scoring.
 */
import type { CinematicUnit, CinematicScore } from "./cinematic-model.ts";
import type { AdapterResult } from "./cinematic-adapters.ts";
import { scoreCinematic, CINEMATIC_THRESHOLDS, type ScoringContext } from "./cinematic-score.ts";
import { extractFeatures } from "./cinematic-features.ts";
import { analyzeLadder } from "./cik/ladderLock.ts";
import { extractStyleAnchors } from "./cinematic-style-lock.ts";
import { sanitizeUnits, type AdapterQualityMetrics } from "./cik/adapterSanitize.ts";
import {
  recordAttempt0, recordFinal, recordFeatureSummary,
  recordDiagnosticFlags, flushCinematicSummaryIfDue,
} from "./cinematic-telemetry.ts";
import { persistCinematicQualityRun, type PersistQualityRunParams } from "./cik/qualityHistory.ts";

export interface CinematicQualityGateEvent {
  handler: string;
  phase: string;
  model: string;
  attempt: number;
  pass: boolean;
  score: number;
  failures: string[];
  metrics: Record<string, number>;
  adapter_mode?: string;
  distinct_intents?: number;
  lane?: string;
  adapter_quality?: AdapterQualityMetrics;
}

export interface CinematicQualityOpts<T> {
  handler: string;
  phase: string;
  model: string;
  rawOutput: T;
  adapter: ((raw: T) => CinematicUnit[] | AdapterResult) | ((raw: T, expectedUnitCount?: number) => CinematicUnit[] | AdapterResult);
  buildRepairInstruction: (score: CinematicScore, unitCount?: number, lane?: string) => string;
  regenerateOnce: (repairInstruction: string) => Promise<T>;
  telemetry?: (eventName: string, payload: CinematicQualityGateEvent) => void;
  isStoryboard?: boolean;
  expected_unit_count?: number;
  /** Product lane for lane-aware CIK checks (e.g. "feature_film", "vertical_drama") */
  lane?: string;
  /** Supabase client for quality history persistence (optional; no-op if omitted) */
  db?: any;
  /** Project ID for quality history (required if db is set) */
  projectId?: string;
  /** Document ID for quality history */
  documentId?: string;
}

function defaultTelemetry(eventName: string, payload: CinematicQualityGateEvent): void {
  console.error(JSON.stringify({ type: eventName, ...payload }));
}

function runAdapter<T>(
  adapter: ((raw: T) => CinematicUnit[] | AdapterResult) | ((raw: T, expectedUnitCount?: number) => CinematicUnit[] | AdapterResult),
  raw: T,
  expectedUnitCount?: number,
): AdapterResult {
  const result = adapter.length >= 2 ? adapter(raw, expectedUnitCount) : adapter(raw);
  if (Array.isArray(result)) return { units: result, mode: "heuristic" };
  return result;
}

function buildGateEvent(
  handler: string, phase: string, model: string,
  attempt: number, score: CinematicScore, adapterMode: string,
  units: CinematicUnit[],
  lane?: string,
  adapterQuality?: AdapterQualityMetrics,
): CinematicQualityGateEvent {
  return {
    handler, phase, model, attempt,
    pass: score.pass,
    score: score.score,
    failures: score.failures,
    metrics: score.metrics as unknown as Record<string, number>,
    adapter_mode: adapterMode,
    distinct_intents: new Set(units.map(u => u.intent)).size,
    lane,
    adapter_quality: adapterQuality,
  };
}

function takeTail(str: string, n: number): string {
  return str.length <= n ? str : str.slice(-n);
}

function buildSnapshot(units: CinematicUnit[], rawOutput: unknown): { head: string; tail: string } {
  const texts: string[] = [];
  const raw = rawOutput as any;
  const items: any[] = raw?.beats || raw?.segments || raw?.panels || raw?.items || (Array.isArray(raw) ? raw : []);
  for (const item of items) {
    const t = item.text || item.line || item.description || item.emotional_intent || item.title || item.prompt || item.composition || "";
    if (t) texts.push(t);
  }
  const headTexts = texts.slice(0, 3).join(" | ");
  const tailTexts = texts.slice(-3).join(" | ");
  return { head: headTexts.slice(0, 200), tail: takeTail(tailTexts, 200) };
}

/** Record feature + diagnostic telemetry through the bucketing system. */
function recordTelemetryAtFinal(
  handler: string, phase: string, model: string,
  adapterMode: string, units: CinematicUnit[], score: CinematicScore,
  lane?: string,
): void {
  const features = extractFeatures(units, CINEMATIC_THRESHOLDS.min_arc_peak_in_last_n, lane);
  const ladder = analyzeLadder(units.map(u => u.energy), units.map(u => u.tension), units.map(u => u.density), lane);
  recordFeatureSummary(handler, phase, model, features, ladder.n >= 3 ? {
    meaningfulDownSteps: ladder.meaningfulDownSteps,
    lateDownSteps: ladder.lateDownSteps,
    upStepFrac: ladder.upStepFrac,
    zigzagFlips: ladder.zigzagFlips,
    peakLate25: ladder.peakLate25,
  } : undefined);
  if (score.hard_failures.length > 0 || score.diagnostic_flags.length > 0) {
    recordDiagnosticFlags(handler, phase, model, score.hard_failures, score.diagnostic_flags);
  }
}

export async function enforceCinematicQuality<T>(opts: CinematicQualityOpts<T>): Promise<T> {
  const { handler, phase, model, adapter, buildRepairInstruction, regenerateOnce } = opts;
  const log = opts.telemetry || defaultTelemetry;
  const scoringCtx: ScoringContext = { isStoryboard: opts.isStoryboard, lane: opts.lane };
  const runSource = opts.isStoryboard ? "storyboard-engine" : "trailer-engine";

  // Attempt 0: adapt + sanitize + score
  const adapterResult0 = runAdapter(adapter, opts.rawOutput, opts.expected_unit_count);
  const sanitized0 = sanitizeUnits(adapterResult0.units, opts.expected_unit_count);
  const units0 = sanitized0.units;
  const mode0 = adapterResult0.mode;
  const score0 = scoreCinematic(units0, scoringCtx);
  const evt0 = buildGateEvent(handler, phase, model, 0, score0, mode0, units0, opts.lane, sanitized0.quality);

  log("CINEMATIC_QUALITY_GATE", evt0);
  recordAttempt0(evt0);

  // Log structured fallback reasons
  if (adapterResult0.fallbackReasons && adapterResult0.fallbackReasons.length > 0) {
    console.error(JSON.stringify({
      type: "CINEMATIC_ADAPTER_FALLBACK",
      handler, phase, model,
      reasons: adapterResult0.fallbackReasons,
    }));
  } else if (mode0 === "heuristic") {
    console.error(JSON.stringify({ type: "CINEMATIC_ADAPTER_FALLBACK", handler, phase, model }));
  }

  // Helper to build attempt payload from gate event + score
  const buildAttemptPayload = (score: CinematicScore, adapterMode: string, adapterQuality: AdapterQualityMetrics | undefined) => ({
    model,
    score: score.score,
    pass: score.pass,
    failures: score.failures,
    hardFailures: score.hard_failures,
    diagnosticFlags: score.diagnostic_flags,
    unitCount: units0.length,
    expectedUnitCount: opts.expected_unit_count,
    adapterMetricsJson: adapterQuality ? (adapterQuality as unknown as Record<string, unknown>) : {},
  });

  if (score0.pass) {
    recordFinal(evt0, "attempt0");
    recordTelemetryAtFinal(handler, phase, model, mode0, units0, score0, opts.lane);
    flushCinematicSummaryIfDue({ handler, phase, model });

    // Persist: single attempt pass
    if (opts.db && opts.projectId) {
      persistCinematicQualityRun(opts.db, {
        projectId: opts.projectId,
        documentId: opts.documentId,
        runSource,
        lane: opts.lane || "unknown",
        adapterMode: mode0,
        attempt0: buildAttemptPayload(score0, mode0, sanitized0.quality),
        final: { pass: true, finalScore: score0.score, hardFailures: score0.hard_failures, diagnosticFlags: score0.diagnostic_flags, metricsJson: score0.metrics as unknown as Record<string, unknown> },
      }).catch(() => {}); // fire-and-forget
    }

    return stripCik(opts.rawOutput);
  }

  // Repair attempt (exactly once)
  let instruction = buildRepairInstruction(score0, opts.expected_unit_count, opts.lane);
  const anchors = extractStyleAnchors(opts.rawOutput);
  if (anchors.length > 0) {
    instruction += `\n\nSTYLE LOCK (MUST PRESERVE):\n${anchors.map((a) => `• ${a}`).join("\n")}\nDo not rename, swap, or remove these anchors.`;
  }

  // Size guard: only trim STYLE LOCK, never base
  if (instruction.length > 4000) {
    const styleLockStart = instruction.indexOf("\n\nSTYLE LOCK (MUST PRESERVE):");
    if (styleLockStart !== -1) {
      const base = instruction.slice(0, styleLockStart);
      const trimmedAnchors = anchors.slice(0, 4);
      instruction = base + `\n\nSTYLE LOCK (MUST PRESERVE):\n${trimmedAnchors.map((a) => `• ${a}`).join("\n")}\nDo not rename, swap, or remove these anchors.`;
      if (instruction.length > 4000) {
        instruction = base + `\n\nSTYLE LOCK (MUST PRESERVE): (omitted due to size cap)`;
      }
    }
  }

  const repaired = await regenerateOnce(instruction);

  // Attempt 1: adapt + sanitize + score
  const adapterResult1 = runAdapter(adapter, repaired, opts.expected_unit_count);
  const sanitized1 = sanitizeUnits(adapterResult1.units, opts.expected_unit_count);
  const units1 = sanitized1.units;
  const mode1 = adapterResult1.mode;

  if (adapterResult1.fallbackReasons && adapterResult1.fallbackReasons.length > 0) {
    console.error(JSON.stringify({
      type: "CINEMATIC_ADAPTER_FALLBACK",
      handler, phase, model, attempt: 1,
      reasons: adapterResult1.fallbackReasons,
    }));
  }

  // Style drift telemetry
  if (anchors.length > 0) {
    const repairedStr = JSON.stringify(repaired).toLowerCase();
    const preserved = anchors.filter((a) => repairedStr.includes(a.toLowerCase())).length;
    const missing = anchors.length - preserved;
    const driftScore = preserved / anchors.length;
    console.error(JSON.stringify({
      type: "CINEMATIC_STYLE_DRIFT_SCORE",
      handler, phase, model, attempt: 1,
      anchors_total: anchors.length, anchors_preserved: preserved,
      anchors_missing: missing, drift_score: driftScore,
      adapter_mode: mode1,
    }));
  }

  const score1 = scoreCinematic(units1, { ...scoringCtx, adapterMode: mode1 });
  const evt1 = buildGateEvent(handler, phase, model, 1, score1, mode1, units1, opts.lane, sanitized1.quality);

  // Repair validation telemetry (before/after delta)
  console.error(JSON.stringify({
    type: "CINEMATIC_REPAIR_VALIDATION",
    handler, phase, model, lane: opts.lane,
    attempt_before_failures: score0.failures,
    attempt_after_failures: score1.failures,
    failure_delta_count: score1.hard_failures.length - score0.hard_failures.length,
    score_delta: score1.score - score0.score,
    score_before: score0.score,
    score_after: score1.score,
  }));

  log("CINEMATIC_QUALITY_GATE", evt1);
  recordFinal(evt1, "attempt1");
  recordTelemetryAtFinal(handler, phase, model, mode1, units1, score1, opts.lane);
  flushCinematicSummaryIfDue({ handler, phase, model });

  // Build attempt1 payload for persistence
  const attempt1Payload = {
    model,
    score: score1.score,
    pass: score1.pass,
    failures: score1.failures,
    hardFailures: score1.hard_failures,
    diagnosticFlags: score1.diagnostic_flags,
    unitCount: units1.length,
    expectedUnitCount: opts.expected_unit_count,
    adapterMetricsJson: sanitized1.quality ? (sanitized1.quality as unknown as Record<string, unknown>) : {},
  };

  // Persist: two-attempt run (pass or fail)
  const persistFn = () => {
    if (!opts.db || !opts.projectId) return;
    persistCinematicQualityRun(opts.db, {
      projectId: opts.projectId,
      documentId: opts.documentId,
      runSource,
      lane: opts.lane || "unknown",
      adapterMode: mode1,
      attempt0: buildAttemptPayload(score0, mode0, sanitized0.quality),
      repairInstruction: instruction,
      attempt1: attempt1Payload,
      final: {
        pass: score1.pass,
        finalScore: score1.score,
        hardFailures: score1.hard_failures,
        diagnosticFlags: score1.diagnostic_flags,
        metricsJson: score1.metrics as unknown as Record<string, unknown>,
      },
    }).catch(() => {}); // fire-and-forget
  };

  if (score1.pass) {
    persistFn();
    return stripCik(repaired);
  }

  // Fail snapshot
  const snapshot = buildSnapshot(units1, repaired);
  console.error(JSON.stringify({
    type: "CINEMATIC_QUALITY_FAIL_SNAPSHOT",
    handler, phase, model,
    failures: score1.failures,
    hard_failures: score1.hard_failures,
    diagnostic_flags: score1.diagnostic_flags,
    metrics: score1.metrics,
    final_score: score1.score,
    adapter_mode: mode1,
    snapshot,
  }));

  persistFn();

  const err = new Error(`AI_CINEMATIC_QUALITY_FAIL [${handler}]: post_quality_gate score=${score1.score.toFixed(2)} failures=${score1.failures.join(",")}`);
  (err as any).type = "AI_CINEMATIC_QUALITY_FAIL";
  (err as any).handler = handler;
  (err as any).phase = "post_quality_gate";
  (err as any).model = model;
  (err as any).attempt = 1;
  (err as any).score = score1;
  throw err;
}

function stripCik<T>(output: T): T {
  if (output && typeof output === "object" && !Array.isArray(output)) {
    const copy = { ...output } as any;
    delete copy.cik;
    return copy as T;
  }
  return output;
}
