/**
 * Cinematic Intelligence Kernel — Universal quality gate
 * One bounded repair attempt. No infinite loops. No LLM scoring.
 */
import type { CinematicUnit, CinematicScore } from "./cinematic-model.ts";
import type { AdapterResult } from "./cinematic-adapters.ts";
import { scoreCinematic } from "./cinematic-score.ts";
import { extractStyleAnchors } from "./cinematic-style-lock.ts";
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
  adapter_mode?: string;
}

export interface CinematicQualityOpts<T> {
  handler: string;
  phase: string;
  model: string;
  rawOutput: T;
  /** Adapter returning units, or units + mode. */
  adapter: (raw: T) => CinematicUnit[] | AdapterResult;
  buildRepairInstruction: (score: CinematicScore) => string;
  regenerateOnce: (repairInstruction: string) => Promise<T>;
  telemetry?: (eventName: string, payload: CinematicQualityGateEvent) => void;
}

function defaultTelemetry(eventName: string, payload: CinematicQualityGateEvent): void {
  console.error(JSON.stringify({ type: eventName, ...payload }));
}

/** Normalize adapter return to { units, mode }. */
function runAdapter<T>(adapter: (raw: T) => CinematicUnit[] | AdapterResult, raw: T): { units: CinematicUnit[]; mode: string } {
  const result = adapter(raw);
  if (Array.isArray(result)) return { units: result, mode: "unknown" };
  return { units: result.units, mode: result.mode };
}

function buildGateEvent(
  handler: string, phase: string, model: string,
  attempt: number, score: CinematicScore, adapterMode: string,
): CinematicQualityGateEvent {
  return {
    handler, phase, model, attempt,
    pass: score.pass,
    score: score.score,
    failures: score.failures,
    metrics: score.metrics as unknown as Record<string, number>,
    adapter_mode: adapterMode,
  };
}

/** Return the last n characters of a string. */
function takeTail(str: string, n: number): string {
  return str.length <= n ? str : str.slice(-n);
}

/** Build a bounded text snapshot from units for fail logging. */
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
  return {
    head: headTexts.slice(0, 200),
    tail: takeTail(tailTexts, 200),
  };
}

export async function enforceCinematicQuality<T>(opts: CinematicQualityOpts<T>): Promise<T> {
  const { handler, phase, model, adapter, buildRepairInstruction, regenerateOnce } = opts;
  const log = opts.telemetry || defaultTelemetry;

  // Attempt 0
  const { units: units0, mode: mode0 } = runAdapter(adapter, opts.rawOutput);
  const score0 = scoreCinematic(units0);
  const evt0 = buildGateEvent(handler, phase, model, 0, score0, mode0);

  log("CINEMATIC_QUALITY_GATE", evt0);
  recordAttempt0(evt0);

  // Warn if adapter fell back to heuristic on attempt 0
  if (mode0 === "heuristic") {
    console.error(JSON.stringify({ type: "CINEMATIC_ADAPTER_FALLBACK", handler, phase, model }));
  }

  if (score0.pass) {
    recordFinal(evt0, "attempt0");
    flushCinematicSummaryIfDue({ handler, phase, model });
    return stripCik(opts.rawOutput);
  }

  // Repair attempt (exactly once)
  let instruction = buildRepairInstruction(score0);
  const anchors = extractStyleAnchors(opts.rawOutput);
  if (anchors.length > 0) {
    instruction += `\n\nSTYLE LOCK (MUST PRESERVE):\n${anchors.map((a) => `• ${a}`).join("\n")}\nDo not rename, swap, or remove these anchors.`;
  }

  // Size guard: prevent token bloat
  if (instruction.length > 4000) {
    const trimmedAnchors = anchors.slice(0, 4);
    const styleLockStart = instruction.indexOf("\n\nSTYLE LOCK (MUST PRESERVE):");
    if (styleLockStart !== -1) {
      const base = instruction.slice(0, styleLockStart);
      instruction = base + `\n\nSTYLE LOCK (MUST PRESERVE):\n${trimmedAnchors.map((a) => `• ${a}`).join("\n")}\nDo not rename, swap, or remove these anchors.`;
      if (instruction.length > 4000) {
        instruction = base.slice(0, 4000);
      }
    }
  }

  const repaired = await regenerateOnce(instruction);

  // Style drift telemetry (only when anchors existed)
  if (anchors.length > 0) {
    const repairedStr = JSON.stringify(repaired).toLowerCase();
    const preserved = anchors.filter((a) => repairedStr.includes(a)).length;
    const missing = anchors.length - preserved;
    const driftScore = preserved / anchors.length;
    console.error(JSON.stringify({
      type: "CINEMATIC_STYLE_DRIFT_SCORE",
      handler, phase, model, attempt: 1,
      anchors_total: anchors.length, anchors_preserved: preserved,
      anchors_missing: missing, drift_score: driftScore,
      adapter_mode: mode0,
    }));
  }

  const { units: units1, mode: mode1 } = runAdapter(adapter, repaired);
  const score1 = scoreCinematic(units1);
  const evt1 = buildGateEvent(handler, phase, model, 1, score1, mode1);

  log("CINEMATIC_QUALITY_GATE", evt1);
  recordFinal(evt1, "attempt1");
  flushCinematicSummaryIfDue({ handler, phase, model });

  if (score1.pass) {
    return stripCik(repaired);
  }

  // Fail snapshot — one bounded log before throwing
  const snapshot = buildSnapshot(units1, repaired);
  console.error(JSON.stringify({
    type: "CINEMATIC_QUALITY_FAIL_SNAPSHOT",
    handler, phase, model,
    failures: score1.failures,
    metrics: score1.metrics,
    final_score: score1.score,
    adapter_mode: mode1,
    snapshot,
  }));

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
