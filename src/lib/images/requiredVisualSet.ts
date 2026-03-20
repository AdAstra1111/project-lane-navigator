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
import {
  resolveIdentityAnchorsFromImages,
  type IdentityAnchorMap,
} from './characterIdentityAnchorSet';
import { rankCharacterCandidates } from './characterCandidateRanking';

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
/**
 * Portrait overrides for vertical drama — ALL non-identity slots forced to 9:16.
 * This is the strict vertical-drama contract: native phone-screen composition,
 * not cropped landscape or weak portrait.
 *
 * Identity exceptions (headshot 1:1, profile 3:4, full_body 2:3) are NOT listed
 * here because they retain their reference-specific ratios by design.
 */
export const PORTRAIT_SHOT_OVERRIDE: Record<string, AspectRatio> = {
  // ── ALL non-identity slots → strict 9:16 for vertical drama ──
  wide: '9:16',
  atmospheric: '9:16',
  time_variant: '9:16',
  lighting_ref: '9:16',
  composition_ref: '9:16',
  tableau: '9:16',
  medium: '9:16',           // was 3:4 — VD requires true vertical
  emotional_variant: '9:16', // was 3:4 — VD requires true vertical
  over_shoulder: '9:16',     // was 3:4 — VD requires true vertical
  close_up: '9:16',          // was 1:1 — VD requires true vertical
  full_body: '9:16',         // was 2:3 — VD requires true vertical
  profile: '9:16',           // was 3:4 — VD requires true vertical
  detail: '9:16',            // was 1:1 — VD requires true vertical
  texture_ref: '9:16',       // was 1:1 — VD requires true vertical
  color_ref: '9:16',         // was 1:1 — VD requires true vertical
  // Poster stays 2:3 (already portrait-native)
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
  /** Canonical reason for recommendation from ranking helper */
  recommendedReason: string | null;
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

/**
 * Related shot types that can serve as fallback candidates for a given slot.
 * This allows the scoring engine (which already has partial-match scoring)
 * to consider images with related shot types instead of leaving slots empty.
 */
const BROADENED_SHOT_TYPES: Record<string, string[]> = {
  wide: ['atmospheric', 'tableau', 'composition_ref'],
  atmospheric: ['wide', 'lighting_ref', 'time_variant'],
  close_up: ['identity_headshot', 'medium', 'emotional_variant'],
  medium: ['close_up', 'full_body', 'over_shoulder'],
  tableau: ['wide', 'medium'],
  identity_headshot: ['close_up', 'medium', 'profile'],
  identity_profile: ['profile', 'medium', 'close_up'],
  identity_full_body: ['full_body', 'medium'],
  lighting_ref: ['atmospheric', 'composition_ref'],
  texture_ref: ['detail', 'color_ref'],
  composition_ref: ['wide', 'lighting_ref'],
  color_ref: ['texture_ref', 'detail'],
  detail: ['texture_ref', 'close_up'],
  time_variant: ['atmospheric', 'wide'],
  emotional_variant: ['close_up', 'medium'],
  full_body: ['identity_full_body', 'medium'],
  profile: ['identity_profile', 'close_up'],
};

function buildSlot(
  key: string,
  assetGroup: AssetGroup,
  subject: string | null,
  shotType: ShotType,
  label: string,
  isIdentity: boolean,
  existingImages: ProjectImage[],
  matchFn: (img: ProjectImage) => boolean,
  isPortrait = false,
  anchorMap?: IdentityAnchorMap,
): RequiredSlot {
  // Primary pool: exact match
  const exactMatching = existingImages.filter(matchFn);
  const primary = exactMatching.find(i => i.is_primary && i.curation_state === 'active') || null;

  // Broadened pool: same asset_group + subject but related shot_types
  // This feeds the scoring engine which already handles partial-match scoring
  const relatedTypes = BROADENED_SHOT_TYPES[shotType] || [];
  const broadenedMatching = existingImages.filter(i => {
    if (matchFn(i)) return true; // already in exact pool
    if (i.asset_group !== assetGroup) return false;
    if (subject && i.subject !== subject) return false;
    if (!subject && i.subject) return false; // null-subject slots shouldn't grab entity-scoped images
    if (!relatedTypes.includes(i.shot_type || '')) return false;
    return (i.curation_state === 'active' || i.curation_state === 'candidate');
  });

  const candidates = [
    ...exactMatching.filter(i => i.curation_state === 'active' || i.curation_state === 'candidate'),
    ...broadenedMatching.filter(i => !exactMatching.includes(i)),
  ];

  const dims = getDimensionsForShot(shotType, isPortrait);

  // Identity-aware recommendation using canonical ranking helper
  let recommended: ProjectImage | null = primary;
  let recommendedReason: string | null = primary ? 'Active primary' : null;
  if (!recommended && candidates.length > 0) {
    if (assetGroup === 'character' && subject && anchorMap) {
      const anchorSet = anchorMap[subject] || null;
      const ranking = rankCharacterCandidates(candidates, anchorSet);
      recommended = ranking.top?.image ?? candidates[0];
      recommendedReason = ranking.top?.rankReason ?? null;
    } else {
      recommended = candidates[0];
      recommendedReason = 'Most recent candidate';
    }
  }

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
    recommended,
    recommendedReason,
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
  isPortrait = false,
): RequiredVisualSet {
  const slots: RequiredSlot[] = [];

  // Resolve identity anchors once for all character recommendation logic
  const anchorMap = resolveIdentityAnchorsFromImages(existingImages);

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
        isPortrait,
        anchorMap,
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
        isPortrait,
        anchorMap,
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
        isPortrait,
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
      isPortrait,
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
      isPortrait,
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
