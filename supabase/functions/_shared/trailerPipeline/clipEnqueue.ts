/**
 * Clip Enqueue — Upsert options builder
 * ⚠️ DRIFT-LOCKED: Must stay identical to src/lib/trailerPipeline/clipEnqueue.ts
 * A vitest drift-lock test enforces this automatically.
 */

/** Build upsert options ensuring idempotency via idempotency_key. */
export function buildUpsertOptions(force: boolean): { onConflict: "idempotency_key"; ignoreDuplicates: boolean } {
  return {
    onConflict: "idempotency_key",
    ignoreDuplicates: !force,
  };
}

/**
 * Upsert clip jobs idempotently.
 * @returns The error from the upsert call, or null on success.
 */
export async function upsertClipJobs(db: any, jobs: any[], force: boolean): Promise<{ error: any }> {
  const { error } = await db
    .from("trailer_clip_jobs")
    .upsert(jobs, buildUpsertOptions(force));
  return { error };
}
