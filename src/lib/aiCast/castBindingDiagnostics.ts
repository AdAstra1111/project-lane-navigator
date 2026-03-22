/**
 * castBindingDiagnostics — Pure evaluator for cast binding freshness.
 *
 * Computes binding freshness by comparing project_ai_cast pinned version
 * against the actor's current canonical approved_version_id.
 *
 * This is a pure function — does NOT persist anything.
 */

export type BindingFreshness =
  | 'current'
  | 'stale_newer_version_available'
  | 'stale_roster_revoked'
  | 'invalid_missing_version'
  | 'unbound';

export interface BindingFreshnessInput {
  /** From project_ai_cast row */
  binding: {
    ai_actor_version_id: string | null;
  } | null;
  /** From ai_actors row */
  actor: {
    approved_version_id: string | null;
    roster_ready: boolean;
  } | null;
}

/**
 * Evaluate the freshness of a project cast binding against current roster truth.
 */
export function evaluateCastBindingFreshness(input: BindingFreshnessInput): BindingFreshness {
  const { binding, actor } = input;

  // No binding exists
  if (!binding) return 'unbound';

  // Actor not found or no longer exists
  if (!actor) return 'invalid_missing_version';

  // Actor roster was revoked
  if (!actor.roster_ready) return 'stale_roster_revoked';

  // Binding has no pinned version (should not happen but handle explicitly)
  if (!binding.ai_actor_version_id) return 'invalid_missing_version';

  // Actor has a newer approved version
  if (
    actor.approved_version_id &&
    binding.ai_actor_version_id !== actor.approved_version_id
  ) {
    return 'stale_newer_version_available';
  }

  // Actor has no approved version (edge case: roster_ready but no approved_version)
  if (!actor.approved_version_id) return 'invalid_missing_version';

  return 'current';
}
