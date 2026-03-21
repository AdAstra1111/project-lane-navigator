/**
 * Layout-Led Image Specifications — Defines what images each layout family requires.
 * 
 * Maps layout family keys to their required image specs per slot.
 * This is the bridge between layout design intent and image generation/selection.
 */
import type { LayoutFamilyKey } from '@/lib/lookbook/lookbookLayoutFamilies';
import type { Orientation } from './orientationUtils';

export interface RequiredImageSpec {
  /** Slot identifier matching SlotBlueprint.slotKey */
  slotId: string;
  /** Preferred shot type for generation */
  shotType: string;
  /** Required orientation */
  orientation: Orientation | 'any';
  /** Subject type to guide generation */
  subjectType: 'character' | 'world' | 'atmosphere' | 'moment' | 'texture' | 'poster' | 'generic';
  /** Priority within the layout (lower = more important) */
  priority: number;
}

/**
 * Image specifications per layout family.
 * Used by the Gap Analyzer and Orchestrator to determine what's needed.
 */
export const LAYOUT_IMAGE_SPECS: Record<LayoutFamilyKey, RequiredImageSpec[]> = {
  landscape_standard: [
    { slotId: 'hero', shotType: 'wide', orientation: 'landscape', subjectType: 'world', priority: 1 },
    { slotId: 'support_1', shotType: 'atmospheric', orientation: 'any', subjectType: 'atmosphere', priority: 3 },
    { slotId: 'support_2', shotType: 'detail', orientation: 'any', subjectType: 'texture', priority: 4 },
    { slotId: 'support_3', shotType: 'detail', orientation: 'any', subjectType: 'texture', priority: 5 },
  ],

  landscape_portrait_hero: [
    { slotId: 'hero', shotType: 'close_up', orientation: 'portrait', subjectType: 'character', priority: 1 },
  ],

  landscape_two_up_portrait: [
    { slotId: 'left', shotType: 'close_up', orientation: 'portrait', subjectType: 'character', priority: 1 },
    { slotId: 'right', shotType: 'medium', orientation: 'portrait', subjectType: 'character', priority: 2 },
  ],

  landscape_mixed_editorial: [
    { slotId: 'primary', shotType: 'wide', orientation: 'any', subjectType: 'world', priority: 1 },
    { slotId: 'secondary', shotType: 'atmospheric', orientation: 'any', subjectType: 'atmosphere', priority: 2 },
    { slotId: 'accent_1', shotType: 'detail', orientation: 'any', subjectType: 'texture', priority: 3 },
    { slotId: 'accent_2', shotType: 'detail', orientation: 'any', subjectType: 'texture', priority: 4 },
  ],

  landscape_character_portraits: [
    { slotId: 'lead', shotType: 'close_up', orientation: 'portrait', subjectType: 'character', priority: 1 },
    { slotId: 'support_1', shotType: 'medium', orientation: 'portrait', subjectType: 'character', priority: 2 },
    { slotId: 'support_2', shotType: 'profile', orientation: 'portrait', subjectType: 'character', priority: 3 },
  ],
};

/**
 * Get required image specs for a specific slide type + layout family combination.
 * Overrides subject types based on slide context.
 */
export function getSlideImageSpecs(
  slideType: string,
  familyKey: LayoutFamilyKey,
): RequiredImageSpec[] {
  const baseSpecs = LAYOUT_IMAGE_SPECS[familyKey] || [];

  // Override subject types based on slide context
  const subjectOverrides: Record<string, string> = {};
  switch (slideType) {
    case 'world':
      subjectOverrides['hero'] = 'world';
      subjectOverrides['support_1'] = 'world';
      subjectOverrides['primary'] = 'world';
      break;
    case 'themes':
      subjectOverrides['hero'] = 'atmosphere';
      subjectOverrides['primary'] = 'atmosphere';
      break;
    case 'key_moments':
      subjectOverrides['hero'] = 'moment';
      subjectOverrides['primary'] = 'moment';
      subjectOverrides['secondary'] = 'moment';
      break;
    case 'visual_language':
      subjectOverrides['hero'] = 'texture';
      subjectOverrides['primary'] = 'texture';
      break;
    case 'cover':
    case 'closing':
      subjectOverrides['hero'] = 'poster';
      break;
  }

  return baseSpecs.map(spec => ({
    ...spec,
    subjectType: (subjectOverrides[spec.slotId] as RequiredImageSpec['subjectType']) || spec.subjectType,
  }));
}
