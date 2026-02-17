/**
 * Format episode duration as a range string.
 * Prefers min–max display; falls back to scalar.
 */
export function formatEpisodeDurationRange(
  min?: number | null,
  max?: number | null,
  scalar?: number | null
): string {
  if (min && max && min !== max) return `${min}–${max}s`;
  if (min) return `${min}s`;
  if (max) return `${max}s`;
  if (scalar) return `${scalar}s`;
  return '—';
}

/**
 * Format with midpoint annotation for prompts/system blocks.
 */
export function formatEpisodeDurationRangeWithMidpoint(
  min?: number | null,
  max?: number | null,
  scalar?: number | null
): string {
  if (min && max && min !== max) {
    const mid = Math.round((min + max) / 2);
    return `${min}–${max}s (midpoint ${mid}s)`;
  }
  if (min) return `${min}s`;
  if (max) return `${max}s`;
  if (scalar) return `${scalar}s`;
  return 'N/A';
}
