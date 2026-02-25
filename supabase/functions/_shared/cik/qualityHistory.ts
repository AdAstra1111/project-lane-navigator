/**
 * CIK — Quality History Persistence
 * Writes run + attempt rows to cinematic_quality_runs / cinematic_quality_attempts.
 * Called from kernel after each attempt.
 */
import type { CinematicScore } from "../cinematic-model.ts";
import type { AdapterQualityMetrics } from "./adapterSanitize.ts";

export interface QualityRunContext {
  projectId: string;
  docId?: string;
  engine: "trailer" | "storyboard";
  lane?: string;
  model: string;
  createdBy?: string;
  settingsJson?: Record<string, unknown>;
}

export interface QualityAttemptData {
  attemptIndex: number;
  score: number;
  pass: boolean;
  failures: string[];
  hardFailures: string[];
  diagnosticFlags: string[];
  unitCount: number;
  expectedUnitCount?: number;
  repairInstruction?: string;
  unitsJson?: unknown;
  metricsJson?: unknown;
}

/**
 * Persist a quality run + its attempts to the database.
 * Uses the provided supabase client (service role).
 * Fire-and-forget: errors are logged but do not block the pipeline.
 */
export async function persistQualityRun(
  db: any,
  ctx: QualityRunContext,
  attempts: QualityAttemptData[],
  finalPass: boolean,
  finalScore: number,
): Promise<string | null> {
  try {
    const { data: run, error: runErr } = await db
      .from("cinematic_quality_runs")
      .insert({
        project_id: ctx.projectId,
        doc_id: ctx.docId || null,
        engine: ctx.engine,
        lane: ctx.lane || null,
        model: ctx.model,
        attempt_count: attempts.length,
        final_pass: finalPass,
        final_score: finalScore,
        settings_json: ctx.settingsJson || {},
        created_by: ctx.createdBy || null,
      })
      .select("id")
      .single();

    if (runErr || !run) {
      console.error(JSON.stringify({ type: "QUALITY_HISTORY_RUN_ERROR", error: runErr?.message }));
      return null;
    }

    const attemptRows = attempts.map((a) => ({
      run_id: run.id,
      attempt_index: a.attemptIndex,
      score: a.score,
      pass: a.pass,
      failures: a.failures,
      hard_failures: a.hardFailures,
      diagnostic_flags: a.diagnosticFlags,
      unit_count: a.unitCount,
      expected_unit_count: a.expectedUnitCount || null,
      repair_instruction: a.repairInstruction || null,
      units_json: a.unitsJson || null,
      metrics_json: a.metricsJson || null,
    }));

    const { error: attErr } = await db
      .from("cinematic_quality_attempts")
      .insert(attemptRows);

    if (attErr) {
      console.error(JSON.stringify({ type: "QUALITY_HISTORY_ATTEMPT_ERROR", error: attErr.message }));
    }

    return run.id;
  } catch (e: any) {
    console.error(JSON.stringify({ type: "QUALITY_HISTORY_ERROR", error: e.message }));
    return null;
  }
}
