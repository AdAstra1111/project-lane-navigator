/**
 * Clip Enqueue — Upsert options builder
 * Canonical source for idempotent enqueue logic used by edge function and tests.
 * The edge function (Deno) mirrors this logic inline since it can't import from src/.
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
