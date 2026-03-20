/**
 * lookbookLayoutFamilies — Canonical layout family definitions + resolver
 * for lookbook slides. Enables portrait-led pages inside landscape decks.
 *
 * NO rendering logic here. This is pure data/resolution.
 * Renderer consumes the resolved family key to select composition.
 */
import { classifyOrientation, type Orientation } from '@/lib/images/orientationUtils';

// ── Layout Family Keys ──────────────────────────────────────────────────────

export type LayoutFamilyKey =
  | 'landscape_standard'
  | 'landscape_portrait_hero'
  | 'landscape_two_up_portrait'
  | 'landscape_mixed_editorial'
  | 'landscape_character_portraits';

// ── Slot Blueprint ──────────────────────────────────────────────────────────

export interface SlotBlueprint {
  slotKey: string;
  expectedOrientation: Orientation | 'any';
  optional: boolean;
  /** Relative size weight: 1 = normal, 2 = hero/dominant */
  sizeWeight: number;
  /** Content intent hint */
  intent: 'hero' | 'supporting' | 'accent' | 'background';
}

// ── Layout Family Definition ────────────────────────────────────────────────

export interface LayoutFamilyDef {
  familyKey: LayoutFamilyKey;
  label: string;
  deckOrientation: 'landscape';
  /** Which image orientations this family is designed for */
  supportedImageOrientations: Orientation[];
  minImages: number;
  maxImages: number;
  /** Section types this family is naturally suited to */
  preferredSectionKinds: string[];
  slots: SlotBlueprint[];
}

// ── Family Definitions ──────────────────────────────────────────────────────

export const LAYOUT_FAMILIES: Record<LayoutFamilyKey, LayoutFamilyDef> = {
  landscape_standard: {
    familyKey: 'landscape_standard',
    label: 'Landscape Standard',
    deckOrientation: 'landscape',
    supportedImageOrientations: ['landscape', 'square'],
    minImages: 0,
    maxImages: 4,
    preferredSectionKinds: ['world', 'overview', 'themes', 'visual_language', 'story_engine', 'key_moments'],
    slots: [
      { slotKey: 'hero', expectedOrientation: 'landscape', optional: false, sizeWeight: 2, intent: 'hero' },
      { slotKey: 'support_1', expectedOrientation: 'any', optional: true, sizeWeight: 1, intent: 'supporting' },
      { slotKey: 'support_2', expectedOrientation: 'any', optional: true, sizeWeight: 1, intent: 'supporting' },
      { slotKey: 'support_3', expectedOrientation: 'any', optional: true, sizeWeight: 1, intent: 'accent' },
    ],
  },

  landscape_portrait_hero: {
    familyKey: 'landscape_portrait_hero',
    label: 'Portrait Hero',
    deckOrientation: 'landscape',
    supportedImageOrientations: ['portrait'],
    minImages: 1,
    maxImages: 1,
    preferredSectionKinds: ['cover', 'characters', 'poster_directions', 'key_moments'],
    slots: [
      { slotKey: 'hero', expectedOrientation: 'portrait', optional: false, sizeWeight: 2, intent: 'hero' },
    ],
  },

  landscape_two_up_portrait: {
    familyKey: 'landscape_two_up_portrait',
    label: 'Two-Up Portrait',
    deckOrientation: 'landscape',
    supportedImageOrientations: ['portrait'],
    minImages: 2,
    maxImages: 2,
    preferredSectionKinds: ['characters', 'key_moments', 'poster_directions'],
    slots: [
      { slotKey: 'left', expectedOrientation: 'portrait', optional: false, sizeWeight: 1, intent: 'hero' },
      { slotKey: 'right', expectedOrientation: 'portrait', optional: false, sizeWeight: 1, intent: 'hero' },
    ],
  },

  landscape_mixed_editorial: {
    familyKey: 'landscape_mixed_editorial',
    label: 'Mixed Editorial',
    deckOrientation: 'landscape',
    supportedImageOrientations: ['portrait', 'landscape', 'square'],
    minImages: 2,
    maxImages: 4,
    preferredSectionKinds: ['themes', 'visual_language', 'world', 'key_moments', 'story_engine'],
    slots: [
      { slotKey: 'primary', expectedOrientation: 'any', optional: false, sizeWeight: 2, intent: 'hero' },
      { slotKey: 'secondary', expectedOrientation: 'any', optional: false, sizeWeight: 1, intent: 'supporting' },
      { slotKey: 'accent_1', expectedOrientation: 'any', optional: true, sizeWeight: 1, intent: 'accent' },
      { slotKey: 'accent_2', expectedOrientation: 'any', optional: true, sizeWeight: 1, intent: 'accent' },
    ],
  },

  landscape_character_portraits: {
    familyKey: 'landscape_character_portraits',
    label: 'Character Portraits',
    deckOrientation: 'landscape',
    supportedImageOrientations: ['portrait', 'square'],
    minImages: 1,
    maxImages: 3,
    preferredSectionKinds: ['characters'],
    slots: [
      { slotKey: 'lead', expectedOrientation: 'portrait', optional: false, sizeWeight: 2, intent: 'hero' },
      { slotKey: 'support_1', expectedOrientation: 'portrait', optional: true, sizeWeight: 1, intent: 'supporting' },
      { slotKey: 'support_2', expectedOrientation: 'portrait', optional: true, sizeWeight: 1, intent: 'supporting' },
    ],
  },
};

// ── Resolved Layout ─────────────────────────────────────────────────────────

export interface ResolvedLayoutFamily {
  familyKey: LayoutFamilyKey;
  definition: LayoutFamilyDef;
  /** Resolution reason for audit trail */
  reason: string;
}

// ── Image Orientation Summary ───────────────────────────────────────────────

export interface OrientationSummary {
  portrait: number;
  landscape: number;
  square: number;
  unknown: number;
  total: number;
}

export function summarizeOrientations(
  images: Array<{ width?: number | null; height?: number | null }>,
): OrientationSummary {
  const summary: OrientationSummary = { portrait: 0, landscape: 0, square: 0, unknown: 0, total: images.length };
  for (const img of images) {
    const o = classifyOrientation(img.width, img.height);
    summary[o]++;
  }
  return summary;
}

// ── Resolver ────────────────────────────────────────────────────────────────

export interface LayoutResolutionInput {
  slideType: string;
  /** Selected images for this slide, with dimensions */
  images: Array<{ width?: number | null; height?: number | null; signedUrl?: string }>;
  /** Project lane */
  lane?: string | null;
  /** Project format */
  format?: string;
  /** Whether the section is character-focused */
  isCharacterSection?: boolean;
}

/**
 * Deterministically resolve the best layout family for a landscape slide
 * based on section type and available image orientations.
 *
 * Resolution order:
 * 1. Explicit section-type mapping (characters → character_portraits)
 * 2. Portrait inventory check
 * 3. Image orientation distribution
 * 4. Conservative fallback to landscape_standard
 */
export function resolveLookbookLayoutFamily(input: LayoutResolutionInput): ResolvedLayoutFamily {
  const { slideType, images, isCharacterSection } = input;
  const summary = summarizeOrientations(images);
  const portraitRatio = summary.total > 0 ? summary.portrait / summary.total : 0;

  // 1. Characters — prefer portrait-led layouts
  if (slideType === 'characters' || isCharacterSection) {
    if (summary.portrait >= 2) {
      return {
        familyKey: 'landscape_character_portraits',
        definition: LAYOUT_FAMILIES.landscape_character_portraits,
        reason: `Character section with ${summary.portrait} portrait images`,
      };
    }
    if (summary.portrait === 1) {
      return {
        familyKey: 'landscape_portrait_hero',
        definition: LAYOUT_FAMILIES.landscape_portrait_hero,
        reason: 'Character section with 1 portrait hero',
      };
    }
  }

  // 2. Single strong portrait — portrait hero layout
  if (summary.total === 1 && summary.portrait === 1) {
    return {
      familyKey: 'landscape_portrait_hero',
      definition: LAYOUT_FAMILIES.landscape_portrait_hero,
      reason: 'Single portrait image available',
    };
  }

  // 3. Exactly 2 portrait images — two-up
  if (summary.portrait >= 2 && summary.total <= 3 && portraitRatio >= 0.6) {
    return {
      familyKey: 'landscape_two_up_portrait',
      definition: LAYOUT_FAMILIES.landscape_two_up_portrait,
      reason: `${summary.portrait} portrait images, portrait-dominant set`,
    };
  }

  // 4. Mixed orientation set — editorial layout
  if (summary.portrait >= 1 && summary.landscape >= 1 && summary.total >= 2) {
    return {
      familyKey: 'landscape_mixed_editorial',
      definition: LAYOUT_FAMILIES.landscape_mixed_editorial,
      reason: `Mixed set: ${summary.portrait}P + ${summary.landscape}L`,
    };
  }

  // 5. Portrait-dominant but more than 2 — mixed editorial
  if (summary.portrait >= 2 && portraitRatio > 0.5) {
    return {
      familyKey: 'landscape_mixed_editorial',
      definition: LAYOUT_FAMILIES.landscape_mixed_editorial,
      reason: `Portrait-dominant set (${portraitRatio.toFixed(1)} ratio)`,
    };
  }

  // 6. Default — landscape standard
  return {
    familyKey: 'landscape_standard',
    definition: LAYOUT_FAMILIES.landscape_standard,
    reason: 'Default landscape layout',
  };
}
