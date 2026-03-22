/**
 * assertCastResolution — Runtime anti-drift guard for cast identity resolution.
 *
 * Ensures that downstream generation flows always use the canonical castResolver
 * and never bypass project_ai_cast bindings.
 *
 * Integrate into any generation pipeline that references characters with projectId context.
 */
import type { CastContextResult } from './castResolver';

/**
 * Assert that cast resolution was performed correctly.
 * Throws if a binding exists but resolver returned unbound (drift detection).
 *
 * Usage: call AFTER resolving cast context, BEFORE injecting identity into generation.
 */
export function assertCastResolved(params: {
  projectId: string;
  characterKey: string;
  resolved: CastContextResult;
}): void {
  // Guard: if resolved is bound, the contract is satisfied
  if (params.resolved.bound) return;

  // If unbound with explicit reason, that's acceptable — no binding exists
  if (!params.resolved.bound && 'reason' in params.resolved && params.resolved.reason === 'no_cast_binding') return;

  // Any other unbound state without a reason is suspicious
  throw new Error(
    `[CastGuard] Cast resolution returned unexpected unbound state for ` +
    `character="${params.characterKey}" in project="${params.projectId}". ` +
    `This may indicate a resolver bypass.`
  );
}

/**
 * Assert that a generation flow using character identity actually went through
 * the canonical resolver. Call this when identity payload is being built.
 *
 * @param characterKey - The character being generated
 * @param hasResolverResult - Whether the resolver was actually called
 * @param hasIdentityPayload - Whether identity anchors are being injected
 */
export function assertIdentityFromResolver(params: {
  characterKey: string;
  resolverWasCalled: boolean;
  identityBeingInjected: boolean;
}): void {
  if (params.identityBeingInjected && !params.resolverWasCalled) {
    throw new Error(
      `[CastGuard] Identity is being injected for character="${params.characterKey}" ` +
      `but the canonical cast resolver was NOT called. This is a forbidden bypass.`
    );
  }
}
