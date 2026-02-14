/**
 * Format normalization helpers.
 * DB stores underscores (vertical_drama), TS uses hyphens (vertical-drama).
 * Always normalize to hyphens for internal comparisons.
 */

export function normalizeFormat(format: string): string {
  return (format || '').toLowerCase().replace(/_/g, '-');
}

export function isVerticalDrama(format: string): boolean {
  return normalizeFormat(format) === 'vertical-drama';
}

export function isSeriesFormat(format: string): boolean {
  const f = normalizeFormat(format);
  return ['tv-series', 'limited-series', 'vertical-drama', 'digital-series', 'documentary-series', 'anim-series'].includes(f);
}
