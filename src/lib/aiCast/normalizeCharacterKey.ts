/**
 * normalizeCharacterKey — Canonical character key normalization.
 *
 * SINGLE SOURCE OF TRUTH for all character key comparisons.
 * All cast resolution, binding, and generation paths MUST use this.
 *
 * Rules:
 * - lowercase
 * - trim leading/trailing whitespace
 * - collapse internal whitespace to single space
 */
export function normalizeCharacterKey(input: string): string {
  return input.toLowerCase().trim().replace(/\s+/g, ' ');
}
