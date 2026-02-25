/**
 * CIK — Quality History Persistence (Slice 2)
 * Single entrypoint: persistCinematicQualityRun
 * Calls RPC insert_cinematic_quality_run_with_attempts.
 * Fire-and-forget: errors are logged but never thrown.
 */

export interface QualityAttemptPayload {
  model: string;
  promptVersion?: string;
  inputSummaryJson?: Record<string, unknown>;
  outputJson?: unknown;
  score: number;
  pass: boolean;
  failures?: string[];
  hardFailures?: string[];
  diagnosticFlags?: string[];
  unitCount?: number;
  expectedUnitCount?: number;
  adapterMetricsJson?: Record<string, unknown>;
  timingJson?: Record<string, unknown>;
}

export interface QualityFinalPayload {
  pass: boolean;
  finalScore: number;
  hardFailures: string[];
  diagnosticFlags: string[];
  metricsJson: Record<string, unknown>;
}

export interface PersistQualityRunParams {
  projectId: string;
  documentId?: string | null;
  runSource: string;
  lane: string;
  adapterMode?: string | null;
  strictnessMode?: string;
  settingsJson?: Record<string, unknown>;
  attempt0: QualityAttemptPayload;
  repairInstruction?: string;
  attempt1?: QualityAttemptPayload;
  final: QualityFinalPayload;
}

function buildAttemptRpc(
  attempt: QualityAttemptPayload,
  attemptIndex: number,
  repairInstruction?: string,
): Record<string, unknown> {
  const inputSummary: Record<string, unknown> = {
    ...(attempt.inputSummaryJson || {}),
  };
  if (attemptIndex === 1 && repairInstruction) {
    inputSummary.repair_instruction = repairInstruction;
  }
  return {
    attempt_index: attemptIndex,
    model: attempt.model,
    prompt_version: attempt.promptVersion || null,
    input_summary_json: inputSummary,
    output_json: attempt.outputJson || {},
    score: attempt.score,
    pass: attempt.pass,
    failures: attempt.failures || [],
    hard_failures: attempt.hardFailures || [],
    diagnostic_flags: attempt.diagnosticFlags || [],
    unit_count: attempt.unitCount ?? null,
    expected_unit_count: attempt.expectedUnitCount ?? null,
    adapter_metrics_json: attempt.adapterMetricsJson || {},
    timing_json: attempt.timingJson || {},
  };
}

/**
 * Persist a CIK quality run via the RPC.
 * Fire-and-forget: errors are logged but never thrown.
 * Returns the run UUID on success, null on failure.
 */
export async function persistCinematicQualityRun(
  db: any,
  params: PersistQualityRunParams,
): Promise<string | null> {
  try {
    const p_run = {
      project_id: params.projectId,
      doc_id: params.documentId || null,
      engine: params.runSource.includes("storyboard") ? "storyboard" : "trailer",
      lane: params.lane || "unknown",
      model: params.attempt0.model,
      run_source: params.runSource,
      adapter_mode: params.adapterMode || null,
      strictness_mode: params.strictnessMode || "standard",
      settings_json: params.settingsJson || { lane: params.lane, run_source: params.runSource },
      final_pass: params.final.pass,
      final_score: params.final.finalScore,
      hard_failures: params.final.hardFailures,
      diagnostic_flags: params.final.diagnosticFlags,
      metrics_json: params.final.metricsJson,
      attempt_count: params.attempt1 ? 2 : 1,
    };

    const p_attempt0 = buildAttemptRpc(params.attempt0, 0);
    const p_attempt1 = params.attempt1
      ? buildAttemptRpc(params.attempt1, 1, params.repairInstruction)
      : null;

    const { data, error } = await db.rpc("insert_cinematic_quality_run_with_attempts", {
      p_run: p_run,
      p_attempt0: p_attempt0,
      p_attempt1: p_attempt1,
    });

    if (error) {
      console.error(JSON.stringify({
        type: "QUALITY_HISTORY_RPC_ERROR",
        error: error.message,
        run_source: params.runSource,
        lane: params.lane,
      }));
      return null;
    }

    return data as string;
  } catch (e: any) {
    console.error(JSON.stringify({
      type: "QUALITY_HISTORY_ERROR",
      error: e?.message || "unknown",
      run_source: params.runSource,
      lane: params.lane,
    }));
    return null;
  }
}
