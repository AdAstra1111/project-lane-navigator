export interface RecoverableAutoRunConflict {
  code: 'job_already_running';
  recoverable: true;
  job_id: string;
  status: string;
  current_document: string | null;
  step_count: number | null;
  project_id: string;
  stop_reason?: string | null;
  pause_reason?: string | null;
  converge_target_json?: { ci: number; gp: number } | null;
}

type JsonRecord = Record<string, any>;

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function toNullableNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

export function extractRecoverableAutoRunConflict(
  value: unknown,
  fallbackProjectId?: string,
): RecoverableAutoRunConflict | null {
  if (!isRecord(value)) return null;

  const jobId = typeof value.job_id === 'string'
    ? value.job_id
    : typeof value.existing_job_id === 'string'
      ? value.existing_job_id
      : null;

  const status = typeof value.status === 'string'
    ? value.status
    : typeof value.existing_status === 'string'
      ? value.existing_status
      : null;

  const code = value.code === 'job_already_running' || value.error === 'RESUMABLE_JOB_EXISTS'
    ? 'job_already_running'
    : null;

  const projectId = typeof value.project_id === 'string' ? value.project_id : fallbackProjectId ?? null;
  const recoverable = value.recoverable === true || Boolean(jobId);

  if (!code || !recoverable || !jobId || !status || !projectId) {
    return null;
  }

  const target = isRecord(value.converge_target_json)
    && typeof value.converge_target_json.ci === 'number'
    && typeof value.converge_target_json.gp === 'number'
    ? {
        ci: value.converge_target_json.ci,
        gp: value.converge_target_json.gp,
      }
    : null;

  return {
    code: 'job_already_running',
    recoverable: true,
    job_id: jobId,
    status,
    current_document: typeof value.current_document === 'string' ? value.current_document : null,
    step_count: toNullableNumber(value.step_count),
    project_id: projectId,
    stop_reason: typeof value.stop_reason === 'string' ? value.stop_reason : null,
    pause_reason: typeof value.pause_reason === 'string' ? value.pause_reason : null,
    converge_target_json: target,
  };
}
