/**
 * Cinematic Intelligence Kernel — Expected unit count helpers
 * Pure deterministic functions. No LLM. No DB.
 */

/** Compute expected unit count for storyboard from unit_keys list. */
export function computeStoryboardExpectedCount(unitKeys?: string[]): number | undefined {
  if (!unitKeys || unitKeys.length === 0) return undefined;
  return unitKeys.length;
}

/** Compute expected unit count for trailer from raw parsed output. */
export function computeTrailerExpectedCount(parsedRaw: any): number | undefined {
  const beats = parsedRaw?.beats || (Array.isArray(parsedRaw) ? parsedRaw : []);
  return beats.length > 0 ? beats.length : undefined;
}
