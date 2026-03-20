/**
 * lookbookLayoutResolutionState — Canonical helpers for layout family
 * override state, effective family computation, and override validation.
 *
 * Single source of truth. No UI component should duplicate this logic.
 */
import { LAYOUT_FAMILIES, type LayoutFamilyKey, type LayoutFamilyDef } from './lookbookLayoutFamilies';
import type { SlideContent } from './types';

// ── Override Validation ─────────────────────────────────────────────────────

export type OverrideFitStatus = 'valid' | 'weak-fit' | 'invalid';

export interface OverrideValidation {
  status: OverrideFitStatus;
  reason: string;
}

/**
 * Validate whether a layout family override is compatible with the slide's
 * current image inventory and section type.
 */
export function validateLayoutFamilyOverride(
  slide: SlideContent,
  familyKey: LayoutFamilyKey,
): OverrideValidation {
  const family = LAYOUT_FAMILIES[familyKey];
  if (!family) {
    return { status: 'invalid', reason: 'Unknown layout family' };
  }

  // Count images
  const imageCount = (slide.imageUrls?.length || 0) + (slide.imageUrl && !slide.imageUrls?.length ? 1 : 0);

  // Check minimum image requirement
  if (imageCount < family.minImages) {
    return {
      status: 'invalid',
      reason: `Requires at least ${family.minImages} image${family.minImages > 1 ? 's' : ''}, have ${imageCount}`,
    };
  }

  // Check orientation summary compatibility
  const summary = slide.imageOrientationSummary;
  const slideType = slide.type;

  // Section-type compatibility checks
  if (familyKey === 'landscape_character_portraits') {
    if (slideType !== 'characters') {
      if (summary && summary.portrait === 0) {
        return { status: 'invalid', reason: 'No portrait images for character layout' };
      }
      return { status: 'weak-fit', reason: 'Character layout on non-character slide' };
    }
  }

  // Portrait-requiring families need at least one portrait image
  if (familyKey === 'landscape_portrait_hero' || familyKey === 'landscape_two_up_portrait') {
    const requiredPortrait = familyKey === 'landscape_two_up_portrait' ? 2 : 1;
    const portraitCount = summary?.portrait ?? 0;
    if (portraitCount < requiredPortrait) {
      return {
        status: portraitCount > 0 ? 'weak-fit' : 'invalid',
        reason: `Needs ${requiredPortrait} portrait image${requiredPortrait > 1 ? 's' : ''}, have ${portraitCount}`,
      };
    }
  }

  return { status: 'valid', reason: 'Compatible' };
}

// ── Effective Family Resolution ─────────────────────────────────────────────

/**
 * Return the effective layout family for a slide, respecting overrides.
 * Override wins if present and valid, otherwise resolved family, otherwise default.
 */
export function getEffectiveLayoutFamily(slide: SlideContent): LayoutFamilyKey {
  // Priority: user_decisions.layout_family > layoutFamilyOverride > layoutFamily > default
  const userDecision = slide.user_decisions?.layout_family;
  if (userDecision && userDecision in LAYOUT_FAMILIES) {
    return userDecision as LayoutFamilyKey;
  }
  const override = (slide as SlideContentWithOverride).layoutFamilyOverride;
  if (override && override in LAYOUT_FAMILIES) {
    return override as LayoutFamilyKey;
  }
  if (slide.layoutFamily && slide.layoutFamily in LAYOUT_FAMILIES) {
    return slide.layoutFamily as LayoutFamilyKey;
  }
  return 'landscape_standard';
}

/**
 * Whether the slide is currently using a user override rather than auto-resolution.
 */
export function isLayoutFamilyOverrideActive(slide: SlideContent): boolean {
  const userDecision = slide.user_decisions?.layout_family;
  if (userDecision && userDecision in LAYOUT_FAMILIES) return true;
  const override = (slide as SlideContentWithOverride).layoutFamilyOverride;
  return !!override && override in LAYOUT_FAMILIES;
}

// ── Extended slide type with override fields ────────────────────────────────

export interface SlideContentWithOverride extends SlideContent {
  /** User-selected override family, if any */
  layoutFamilyOverride?: LayoutFamilyKey | null;
  /** Provenance of override */
  layoutFamilyOverrideSource?: 'user' | null;
  /** Resolver reason (audit trail) */
  layoutFamilyReason?: string;
}

// ── Family options for UI ───────────────────────────────────────────────────

export interface LayoutFamilyOption {
  key: LayoutFamilyKey;
  label: string;
  description: string;
  validation: OverrideValidation;
}

const FAMILY_DESCRIPTIONS: Record<LayoutFamilyKey, string> = {
  landscape_standard: 'Wide hero image with support grid',
  landscape_portrait_hero: 'Single tall portrait, centered',
  landscape_two_up_portrait: 'Two portrait images side by side',
  landscape_mixed_editorial: 'Mixed orientation editorial grid',
  landscape_character_portraits: 'Portrait-led character display',
};

/**
 * Get all available layout family options for a slide, with validation.
 */
export function getLayoutFamilyOptions(slide: SlideContent): LayoutFamilyOption[] {
  return (Object.keys(LAYOUT_FAMILIES) as LayoutFamilyKey[]).map(key => ({
    key,
    label: LAYOUT_FAMILIES[key].label,
    description: FAMILY_DESCRIPTIONS[key],
    validation: validateLayoutFamilyOverride(slide, key),
  }));
}
