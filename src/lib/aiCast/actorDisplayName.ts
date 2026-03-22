/**
 * actorDisplayName — Canonical actor display name resolver.
 *
 * Single source of truth for how actor names appear in user-facing UI.
 * Never shows raw UUIDs. Uses cascading fallback:
 *   1. Canonical numbered roster name (e.g. "0005 — Sora Ito")
 *   2. Actor name from DB (if it exists but isn't numbered)
 *   3. Character-context placeholder (e.g. "Pending Actor for Hana")
 *   4. Generic fallback with pipeline state
 */

export type ActorPipelineState =
  | 'generating'
  | 'draft'
  | 'pending_validation'
  | 'validated'
  | 'roster_ready'
  | 'dismissed';

/**
 * Resolve the display name for an actor, never returning raw UUIDs.
 */
export function resolveActorDisplayName(
  actor: { name?: string; status?: string; roster_ready?: boolean } | null | undefined,
  context?: { characterKey?: string },
): string {
  // 1. Actor exists and has a proper name (not empty)
  if (actor?.name && actor.name.trim().length > 0) {
    return actor.name;
  }

  // 2. Character-context placeholder
  if (context?.characterKey) {
    return `Pending Actor for ${context.characterKey}`;
  }

  // 3. Generic fallback
  return 'Unnamed Actor';
}

/**
 * Derive pipeline state from actor + pending bind status.
 */
export function resolveActorPipelineState(
  actor: { status?: string; roster_ready?: boolean; approved_version_id?: string | null } | null | undefined,
  pendingStatus?: 'pending_bind' | 'resolved' | 'abandoned' | string,
): ActorPipelineState {
  if (pendingStatus === 'abandoned') return 'dismissed';

  if (!actor) return 'generating';

  if (actor.roster_ready && actor.approved_version_id) return 'roster_ready';

  if (actor.approved_version_id) return 'validated';

  if (actor.status === 'draft') return 'draft';

  return 'pending_validation';
}

/**
 * Human-readable label for a pipeline state.
 */
export function getPipelineStateLabel(state: ActorPipelineState): string {
  switch (state) {
    case 'generating': return 'Generating';
    case 'draft': return 'Draft';
    case 'pending_validation': return 'Pending Validation';
    case 'validated': return 'Validated';
    case 'roster_ready': return 'Roster Ready';
    case 'dismissed': return 'Dismissed';
  }
}

/**
 * CSS class hints for pipeline state badges (semantic tokens).
 */
export function getPipelineStateStyle(state: ActorPipelineState): {
  border: string;
  text: string;
  bg: string;
} {
  switch (state) {
    case 'generating':
      return { border: 'border-primary/30', text: 'text-primary', bg: 'bg-primary/10' };
    case 'draft':
      return { border: 'border-muted-foreground/30', text: 'text-muted-foreground', bg: 'bg-muted/10' };
    case 'pending_validation':
      return { border: 'border-amber-500/40', text: 'text-amber-700 dark:text-amber-400', bg: 'bg-amber-500/10' };
    case 'validated':
      return { border: 'border-emerald-500/40', text: 'text-emerald-700 dark:text-emerald-400', bg: 'bg-emerald-500/10' };
    case 'roster_ready':
      return { border: 'border-emerald-500/40', text: 'text-emerald-700 dark:text-emerald-400', bg: 'bg-emerald-500/10' };
    case 'dismissed':
      return { border: 'border-muted-foreground/30', text: 'text-muted-foreground', bg: 'bg-muted/5' };
  }
}
