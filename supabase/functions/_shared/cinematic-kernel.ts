/**
 * Cinematic Intelligence Kernel — Universal quality gate
 * One bounded repair attempt. No infinite loops. No LLM scoring.
 */
import type { CinematicUnit, CinematicScore } from "./cinematic-model.ts";
import { scoreCinematic } from "./cinematic-score.ts";
import { recordAttempt0, recordFinal, flushCinematicSummaryIfDue } from "./cinematic-telemetry.ts";

export interface CinematicQualityGateEvent {
  handler: string;
  phase: string;
  model: string;
  attempt: number;
  pass: boolean;
  score: number;
  failures: string[];
  metrics: Record<string, number>;
}

export interface CinematicQualityOpts<T> {
  handler: string;
  phase: string;
  model: string;
  rawOutput: T;
  adapter: (raw: T) => CinematicUnit[];
  buildRepairInstruction: (score: CinematicScore) => string;
  /** Must return a new output of the same shape after one bounded regeneration. */
  regenerateOnce: (repairInstruction: string) => Promise<T>;
  /** Optional telemetry callback. Defaults to console.error JSON log. */
  telemetry?: (eventName: string, payload: CinematicQualityGateEvent) => void;
}

function defaultTelemetry(eventName: string, payload: CinematicQualityGateEvent): void {
  console.error(JSON.stringify({ type: eventName, ...payload }));
}

function buildGateEvent(
  handler: string, phase: string, model: string,
  attempt: number, score: CinematicScore,
): CinematicQualityGateEvent {
  return {
    handler, phase, model, attempt,
    pass: score.pass,
    score: score.score,
    failures: score.failures,
    metrics: score.metrics as unknown as Record<string, number>,
  };
}

/**
 * enforceCinematicQuality — Score output, optionally repair once, or throw.
 *
 * - Attempt 0: score rawOutput
 * - If pass: return rawOutput (with cik stripped)
 * - Else: regenerate once with repair instruction
 * - Attempt 1: score repaired output
 * - If pass: return repaired (with cik stripped)
 * - Else: throw structured AI_CINEMATIC_QUALITY_FAIL
 */
export async function enforceCinematicQuality<T>(opts: CinematicQualityOpts<T>): Promise<T> {
  const { handler, phase, model, adapter, buildRepairInstruction, regenerateOnce } = opts;
  const log = opts.telemetry || defaultTelemetry;

  // Attempt 0
  const units0 = adapter(opts.rawOutput);
  const score0 = scoreCinematic(units0);
  const evt0 = buildGateEvent(handler, phase, model, 0, score0);

  log("CINEMATIC_QUALITY_GATE", evt0);
  recordAttempt0(evt0);

  if (score0.pass) {
    recordFinal(evt0, "attempt0");
    flushCinematicSummaryIfDue({ handler, phase, model });
    return stripCik(opts.rawOutput);
  }

  // Repair attempt (exactly once)
  const instruction = buildRepairInstruction(score0);
  const repaired = await regenerateOnce(instruction);

  const units1 = adapter(repaired);
  const score1 = scoreCinematic(units1);
  const evt1 = buildGateEvent(handler, phase, model, 1, score1);

  log("CINEMATIC_QUALITY_GATE", evt1);
  recordFinal(evt1, "attempt1");
  flushCinematicSummaryIfDue({ handler, phase, model });

  if (score1.pass) {
    return stripCik(repaired);
  }

  // Hard fail
  const err = new Error(`AI_CINEMATIC_QUALITY_FAIL [${handler}]: post_quality_gate score=${score1.score.toFixed(2)} failures=${score1.failures.join(",")}`);
  (err as any).type = "AI_CINEMATIC_QUALITY_FAIL";
  (err as any).handler = handler;
  (err as any).phase = "post_quality_gate";
  (err as any).model = model;
  (err as any).attempt = 1;
  (err as any).score = score1;
  throw err;
}

/** Strip internal cik metadata from output before returning to callers. */
function stripCik<T>(output: T): T {
  if (output && typeof output === "object" && !Array.isArray(output)) {
    const copy = { ...output } as any;
    delete copy.cik;
    return copy as T;
  }
  return output;
}
