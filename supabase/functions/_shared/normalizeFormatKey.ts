/**
 * Canonical format-key normalizer — shared between edge functions.
 * Mirrors src/lib/stages/registry.ts normalizeFormatKey but does NOT default to 'film'.
 * Returns empty string if input is empty/null so callers can fail closed.
 */
export function normalizeFormatKey(format: string | null | undefined): string {
  const raw = (format ?? '').trim();
  if (!raw) return '';
  return raw.toLowerCase().replace(/[_ ]+/g, '-');
}
