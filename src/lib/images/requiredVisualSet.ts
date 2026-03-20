/**
 * Required Visual Set Resolver — Deterministically calculates
 * what visual slots a project needs, based on canon.
 *
 * Each slot = asset_group + subject + shot_type + aspect_ratio.
 * Returns a manifest of required slots with fill status.
 *
 * Lane-aware aspect ratio enforcement is built into the schema.
 */

import type { AssetGroup, ShotType, ProjectImage } from './types';
import { SHOT_PACKS, IDENTITY_PACK } from './types';

/** Canonical aspect ratio for each slot type */
export type AspectRatio = '1:1' | '2:3' | '3:2' | '3:4' | '4:3' | '9:16' | '16:9';

/** Aspect ratio to pixel dimensions mapping */
export const ASPECT_DIMENSIONS: Record<AspectRatio, { width: number; height: number }> = {
  '1:1':  { width: 1024, height: 1024 },
  '2:3':  { width: 832,  height: 1248 },
  '3:2':  { width: 1248, height: 832 },
  '3:4':  { width: 896,  height: 1152 },
  '4:3':  { width: 1152, height: 896 },
  '9:16': { width: 720,  height: 1280 },
  '16:9': { width: 1280, height: 720 },
};

/** Shot type to canonical aspect ratio mapping */
export const SHOT_ASPECT_RATIO: Record<string, AspectRatio> = {
  // Character identity
  identity_headshot: '1:1',
  identity_profile: '3:4',
  identity_full_body: '2:3',
  // Character reference
  close_up: '1:1',
  medium: '3:2',
  full_body: '2:3',
  profile: '3:4',
  emotional_variant: '16:9',
  over_shoulder: '16:9',
  // World
  wide: '16:9',
  atmospheric: '16:9',
  detail: '1:1',
  time_variant: '16:9',
  // Visual language
  lighting_ref: '16:9',
  texture_ref: '1:1',
  composition_ref: '16:9',
  color_ref: '1:1',
  // Key moments
  tableau: '16:9',
  // Poster
  poster_theatrical: '2:3',
  poster_alt: '2:3',
};
/** Portrait overrides for vertical drama — force portrait-safe ratios */
const PORTRAIT_SHOT_OVERRIDE: Record<string, AspectRatio> = {
  // Landscape shots → portrait equivalents
  wide: '9:16',
  atmospheric: '9:16',
  time_variant: '9:16',
  lighting_ref: '9:16',
  composition_ref: '9:16',
  tableau: '9:16',
  medium: '3:4',
  emotional_variant: '3:4',
  over_shoulder: '3:4',
  // Already portrait-safe: identity_headshot (1:1), identity_profile (3:4),
  // identity_full_body (2:3), close_up (1:1), full_body (2:3), profile (3:4),
  // detail (1:1), texture_ref (1:1), color_ref (1:1), poster_* (2:3)
};

/** Get dimensions for a shot type. When isPortrait=true, forces portrait-safe ratios. */
export function getDimensionsForShot(shotType: string, isPortrait = false): { width: number; height: number; aspectRatio: AspectRatio } {
  const baseAr = SHOT_ASPECT_RATIO[shotType] || '16:9';
  const ar = isPortrait ? (PORTRAIT_SHOT_OVERRIDE[shotType] || baseAr) : baseAr;
  return { ...ASPECT_DIMENSIONS[ar], aspectRatio: ar };
}

export interface RequiredSlot {
  /** Unique key for this slot */
  key: string;
  assetGroup: AssetGroup;
  subject: string | null;
  shotType: ShotType | null;
  /** Canonical aspect ratio for this slot */
  aspectRatio: AspectRatio;
  /** Pixel dimensions for generation */
  width: number;
  height: number;
  label: string;
  /** Whether this slot currently has a primary image */
  filled: boolean;
  /** The primary image filling this slot, if any */
  primaryImage: ProjectImage | null;
  /** All candidate images for this slot */
  candidates: ProjectImage[];
  /** Recommended candidate (most recent active or candidate) */
  recommended: ProjectImage | null;
  /** Whether this slot is identity-critical */
  isIdentity: boolean;
}

export interface RequiredVisualSet {
  slots: RequiredSlot[];
  filledCount: number;
  totalCount: number;
  completionPercent: number;
}

/** Validate whether an image's dimensions match the required aspect ratio (±5% tolerance) */
export function validateAspectRatio(
  imageWidth: number | null,
  imageHeight: number | null,
  requiredAR: AspectRatio,
): boolean {
  if (!imageWidth || !imageHeight) return true; // No dims = skip validation
  const expected = ASPECT_DIMENSIONS[requiredAR];
  const expectedRatio = expected.width / expected.height;
  const actualRatio = imageWidth / imageHeight;
  return Math.abs(actualRatio - expectedRatio) / expectedRatio < 0.05;
}

/** Check all slots for lookbook build readiness */
export function validateLookbookReadiness(set: RequiredVisualSet): {
  ready: boolean;
  missingSlots: string[];
  aspectMismatches: string[];
} {
  const missingSlots: string[] = [];
  const aspectMismatches: string[] = [];

  for (const slot of set.slots) {
    if (!slot.filled) {
      missingSlots.push(slot.label);
      continue;
    }
    if (slot.primaryImage) {
      if (!validateAspectRatio(slot.primaryImage.width, slot.primaryImage.height, slot.aspectRatio)) {
        aspectMismatches.push(`${slot.label} (expected ${slot.aspectRatio})`);
      }
    }
  }

  return {
    ready: missingSlots.length === 0 && aspectMismatches.length === 0,
    missingSlots,
    aspectMismatches,
  };
}

function buildSlot(
  key: string,
  assetGroup: AssetGroup,
  subject: string | null,
  shotType: ShotType,
  label: string,
  isIdentity: boolean,
  existingImages: ProjectImage[],
  matchFn: (img: ProjectImage) => boolean,
): RequiredSlot {
  const matching = existingImages.filter(matchFn);
  const primary = matching.find(i => i.is_primary && i.curation_state === 'active') || null;
  const candidates = matching.filter(i => i.curation_state === 'active' || i.curation_state === 'candidate');
  const dims = getDimensionsForShot(shotType);

  return {
    key,
    assetGroup,
    subject,
    shotType,
    aspectRatio: dims.aspectRatio,
    width: dims.width,
    height: dims.height,
    label,
    filled: !!primary,
    primaryImage: primary,
    candidates,
    recommended: primary || candidates[0] || null,
    isIdentity,
  };
}

/**
 * Resolve the full required visual set for a project.
 */
export function resolveRequiredVisualSet(
  characters: { name: string }[],
  locations: { name: string }[],
  existingImages: ProjectImage[],
): RequiredVisualSet {
  const slots: RequiredSlot[] = [];

  // ── Character Identity slots ──
  for (const char of characters) {
    for (const shotType of IDENTITY_PACK) {
      slots.push(buildSlot(
        `character:${char.name}:identity:${shotType}`,
        'character', char.name, shotType,
        `${char.name} — ${shotType.replace('identity_', '').replace('_', ' ')}`,
        true, existingImages,
        i => i.asset_group === 'character' && i.subject === char.name &&
          i.shot_type === shotType && i.generation_purpose === 'character_identity',
      ));
    }

    // Character reference shots
    for (const shotType of SHOT_PACKS.character) {
      slots.push(buildSlot(
        `character:${char.name}:ref:${shotType}`,
        'character', char.name, shotType,
        `${char.name} — ${shotType.replace('_', ' ')} (ref)`,
        false, existingImages,
        i => i.asset_group === 'character' && i.subject === char.name &&
          i.shot_type === shotType && i.generation_purpose !== 'character_identity',
      ));
    }
  }

  // ── World / Location slots ──
  for (const loc of locations) {
    for (const shotType of SHOT_PACKS.world) {
      slots.push(buildSlot(
        `world:${loc.name}:${shotType}`,
        'world', loc.name, shotType,
        `${loc.name} — ${shotType.replace('_', ' ')}`,
        false, existingImages,
        i => i.asset_group === 'world' && i.subject === loc.name && i.shot_type === shotType,
      ));
    }
  }

  // ── Visual Language slots ──
  for (const shotType of SHOT_PACKS.visual_language) {
    slots.push(buildSlot(
      `visual_language::${shotType}`,
      'visual_language', null, shotType,
      `Visual Language — ${shotType.replace('_', ' ')}`,
      false, existingImages,
      i => i.asset_group === 'visual_language' && i.shot_type === shotType,
    ));
  }

  // ── Key Moments ──
  for (const shotType of SHOT_PACKS.key_moment) {
    slots.push(buildSlot(
      `key_moment::${shotType}`,
      'key_moment', null, shotType,
      `Key Moment — ${shotType.replace('_', ' ')}`,
      false, existingImages,
      i => i.asset_group === 'key_moment' && i.shot_type === shotType,
    ));
  }

  const filledCount = slots.filter(s => s.filled).length;
  return {
    slots,
    filledCount,
    totalCount: slots.length,
    completionPercent: slots.length > 0 ? Math.round((filledCount / slots.length) * 100) : 0,
  };
}
