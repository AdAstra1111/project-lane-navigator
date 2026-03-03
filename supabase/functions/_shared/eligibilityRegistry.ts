/**
 * Canonical Eligibility Registry
 *
 * Single source of truth for stage-scoped eligibility checks.
 * Duration criteria (episode runtime targets) MUST ONLY apply to
 * runtime-bearing deliverables — never to planning artifacts.
 *
 * NON-NEGOTIABLE INVARIANT:
 *   Runtime targets are canonical to the PRODUCT (viewer-facing runtime),
 *   NOT to the length of development documents.
 */

/** Runtime-bearing doc types by format where viewer-facing duration is meaningful. */
const DURATION_ELIGIBLE_BY_FORMAT: Record<string, Set<string>> = {
  'vertical-drama': new Set([
    'episode_script',
    'season_script',
  ]),
  'tv-series': new Set([
    'episode_script',
    'season_script',
    'season_master_script',
  ]),
  'limited-series': new Set([
    'episode_script',
    'season_script',
    'season_master_script',
  ]),
  'film': new Set([
    'feature_script',
  ]),
  'short-film': new Set([
    'feature_script',
  ]),
};

/** Fallback set used when format is unknown or not in the map. */
const DURATION_ELIGIBLE_FALLBACK = new Set([
  'feature_script',
  'episode_script',
  'season_script',
  'season_master_script',
  'pilot_script',
  'script',
]);

/**
 * Canonical check: is this doc type eligible for duration enforcement?
 *
 * Fail-closed: if docType is null/undefined/empty, returns false.
 * If format is unknown, uses conservative fallback whitelist.
 *
 * @param docType  The current document type key (e.g. 'idea', 'episode_script')
 * @param format   The project format (e.g. 'vertical-drama', 'film')
 * @returns true ONLY for runtime-bearing deliverables
 */
export function isDurationEligibleDocType(
  docType: string | null | undefined,
  format?: string | null,
): boolean {
  if (!docType) return false;
  const eligible = (format && DURATION_ELIGIBLE_BY_FORMAT[format]) || DURATION_ELIGIBLE_FALLBACK;
  return eligible.has(docType);
}

// ── Deprecated target guard ────────────────────────────────────────────────
/**
 * Doc types that MUST NOT be used as pipeline targets (generation, promotion,
 * packaging). They exist only as legacy aliases for back-compat label
 * resolution. Any pipeline action attempting to target one of these MUST
 * resolve via alias first; if it still resolves to a deprecated key, the
 * action must be rejected.
 */
const DEPRECATED_TARGET_DOC_TYPES = new Set([
  'complete_season_script',
]);

/**
 * Returns true if the given docType is a deprecated target that pipelines
 * must NOT generate, promote to, or package as.
 *
 * Use this guard in auto-run, dev-engine, season-package, and any promotion
 * flow BEFORE accepting a target doc type. If this returns true, the caller
 * must either resolve via alias or reject the action.
 */
export function isDeprecatedTargetDocType(
  docType: string | null | undefined,
): boolean {
  if (!docType) return false;
  return DEPRECATED_TARGET_DOC_TYPES.has(docType);
}
