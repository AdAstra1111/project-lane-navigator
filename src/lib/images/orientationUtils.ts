/**
 * orientationUtils — Shared orientation utility for image display.
 * Single source of truth for orientation classification and display aspect classes.
 *
 * NO lane logic. NO scoring logic. Pure display-layer utility.
 */

export type Orientation = 'portrait' | 'landscape' | 'square' | 'unknown';

/**
 * Classify image orientation from pixel dimensions.
 */
export function classifyOrientation(width: number | null | undefined, height: number | null | undefined): Orientation {
  if (!width || !height) return 'unknown';
  if (width === height) return 'square';
  if (height > width) return 'portrait';
  return 'landscape';
}

/**
 * Return a Tailwind aspect-ratio class appropriate for displaying this image
 * in a grid context, preserving its natural orientation.
 *
 * @param mode 'grid' — general browsing grid (portrait uses 3:4)
 *             'vd'   — vertical-drama context (portrait uses 9:16)
 */
export function getDisplayAspectClass(
  width: number | null | undefined,
  height: number | null | undefined,
  options?: { mode?: 'grid' | 'vd' },
): string {
  const orientation = classifyOrientation(width, height);
  const mode = options?.mode ?? 'grid';

  switch (orientation) {
    case 'portrait':
      return mode === 'vd' ? 'aspect-[9/16]' : 'aspect-[3/4]';
    case 'landscape':
      return 'aspect-video';
    case 'square':
      return 'aspect-square';
    case 'unknown':
    default:
      return 'aspect-square';
  }
}

/**
 * Human-readable orientation label.
 */
export function getOrientationLabel(width: number | null | undefined, height: number | null | undefined): string {
  const o = classifyOrientation(width, height);
  switch (o) {
    case 'portrait': return 'Portrait';
    case 'landscape': return 'Landscape';
    case 'square': return 'Square';
    default: return 'Unknown';
  }
}
