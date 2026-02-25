/**
 * Stale Job Recovery — Shared constants and query builder
 * ⚠️ DRIFT-LOCKED: Must stay identical to src/lib/trailerPipeline/clipJobRecovery.ts
 * A vitest drift-lock test enforces this automatically.
 */

/** Jobs running longer than this are considered stale and will be re-queued. */
export const STALE_THRESHOLD_MS = 15 * 60 * 1000;

/** Compute the ISO timestamp threshold for stale detection. */
export function computeStaleThresholdIso(nowMs: number = Date.now()): string {
  return new Date(nowMs - STALE_THRESHOLD_MS).toISOString();
}

/**
 * Re-queue jobs stuck in "running" state beyond the stale threshold.
 * @returns Number of recovered jobs.
 */
export async function recoverStaleRunningJobs(
  db: any,
  projectId: string,
  blueprintId: string,
  nowMs: number = Date.now()
): Promise<number> {
  const staleThreshold = computeStaleThresholdIso(nowMs);
  const { data: staleJobs } = await db
    .from("trailer_clip_jobs")
    .update({ status: "queued", claimed_at: null, error: "Auto-recovered from stale running state" })
    .eq("project_id", projectId)
    .eq("blueprint_id", blueprintId)
    .eq("status", "running")
    .lt("claimed_at", staleThreshold)
    .select("id");
  return (staleJobs || []).length;
}
