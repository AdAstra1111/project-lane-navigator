/**
 * Demo Run State Machine — Deterministic step transitions.
 * No randomness. Same inputs => same state path.
 */

export const DEMO_STEPS = ['cik', 'video_plan', 'render_job', 'rough_cut', 'feedback', 'complete'] as const;
export type DemoStep = typeof DEMO_STEPS[number];

export const DEMO_STATUSES = ['queued', 'running', 'complete', 'error', 'canceled'] as const;
export type DemoStatus = typeof DEMO_STATUSES[number];

export interface DemoRunState {
  status: DemoStatus;
  step: DemoStep;
  links: DemoLinks;
  log: DemoLogEntry[];
  lastError: string | null;
}

export interface DemoLinks {
  quality_run_id?: string;
  plan_id?: string;
  job_id?: string;
  rough_cut_id?: string;
  render_quality_run_id?: string;
}

export interface DemoLogEntry {
  step: DemoStep;
  action: string;
  ts: string;
  detail?: string;
}

/**
 * Get the next step after the current one.
 * Returns null if at 'complete' or invalid.
 */
export function nextStep(current: DemoStep): DemoStep | null {
  const idx = DEMO_STEPS.indexOf(current);
  if (idx === -1 || idx >= DEMO_STEPS.length - 1) return null;
  return DEMO_STEPS[idx + 1];
}

/**
 * Get step index (0-based). Returns -1 if invalid.
 */
export function stepIndex(step: DemoStep): number {
  return DEMO_STEPS.indexOf(step);
}

/**
 * Get progress percentage (0–100) based on current step.
 * 'complete' = 100, 'cik' = 0 when queued.
 */
export function stepProgress(step: DemoStep, status: DemoStatus): number {
  if (status === 'complete' || step === 'complete') return 100;
  if (status === 'error' || status === 'canceled') {
    // Show progress up to failed step
    const idx = DEMO_STEPS.indexOf(step);
    return Math.round((idx / (DEMO_STEPS.length - 1)) * 100);
  }
  const idx = DEMO_STEPS.indexOf(step);
  if (idx === -1) return 0;
  // Running step is partially complete
  return Math.round(((idx + 0.5) / (DEMO_STEPS.length - 1)) * 100);
}

/**
 * Validate a state transition.
 * Returns true if transition is valid.
 */
export function isValidTransition(fromStep: DemoStep, toStep: DemoStep): boolean {
  const fromIdx = DEMO_STEPS.indexOf(fromStep);
  const toIdx = DEMO_STEPS.indexOf(toStep);
  // Must advance by exactly 1
  return toIdx === fromIdx + 1;
}

/**
 * Build a log entry deterministically.
 */
export function buildLogEntry(step: DemoStep, action: string, detail?: string): DemoLogEntry {
  return {
    step,
    action,
    ts: new Date().toISOString(),
    ...(detail ? { detail } : {}),
  };
}

/**
 * Compute a deterministic settings hash for idempotency.
 */
export function settingsHash(projectId: string, documentId: string | null, settingsJson: Record<string, unknown>): string {
  const key = JSON.stringify({ projectId, documentId, settings: settingsJson });
  // Simple deterministic hash (FNV-1a style)
  let hash = 0x811c9dc5;
  for (let i = 0; i < key.length; i++) {
    hash ^= key.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16);
}

/** Human-readable step label */
export const STEP_LABELS: Record<DemoStep, string> = {
  cik: 'Quality Gate',
  video_plan: 'Video Plan',
  render_job: 'Render Job',
  rough_cut: 'Rough Cut',
  feedback: 'Feedback Loop',
  complete: 'Complete',
};
