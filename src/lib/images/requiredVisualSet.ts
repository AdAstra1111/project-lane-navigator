/**
 * Required Visual Set Resolver — Deterministically calculates
 * what visual slots a project needs, based on canon.
 *
 * Each slot = asset_group + subject + shot_type.
 * Returns a manifest of required slots with fill status.
 */

import type { AssetGroup, ShotType, ProjectImage } from './types';
import { SHOT_PACKS, IDENTITY_PACK } from './types';

export interface RequiredSlot {
  /** Unique key for this slot */
  key: string;
  assetGroup: AssetGroup;
  subject: string | null;
  shotType: ShotType | null;
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

/**
 * Resolve the full required visual set for a project.
 * @param characters — array of { name: string }
 * @param locations — array of { name: string }
 * @param existingImages — all project images (any curation state)
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
      const matching = existingImages.filter(
        i => i.asset_group === 'character' &&
          i.subject === char.name &&
          i.shot_type === shotType &&
          i.generation_purpose === 'character_identity'
      );
      const primary = matching.find(i => i.is_primary) || null;
      const candidates = matching.filter(i => i.curation_state === 'active' || i.curation_state === 'candidate');
      slots.push({
        key: `character:${char.name}:identity:${shotType}`,
        assetGroup: 'character',
        subject: char.name,
        shotType,
        label: `${char.name} — ${shotType.replace('identity_', '').replace('_', ' ')}`,
        filled: !!primary,
        primaryImage: primary,
        candidates,
        recommended: primary || candidates[0] || null,
        isIdentity: true,
      });
    }

    // Character reference shots
    for (const shotType of SHOT_PACKS.character) {
      const matching = existingImages.filter(
        i => i.asset_group === 'character' &&
          i.subject === char.name &&
          i.shot_type === shotType &&
          i.generation_purpose !== 'character_identity'
      );
      const primary = matching.find(i => i.is_primary) || null;
      const candidates = matching.filter(i => i.curation_state === 'active' || i.curation_state === 'candidate');
      slots.push({
        key: `character:${char.name}:ref:${shotType}`,
        assetGroup: 'character',
        subject: char.name,
        shotType,
        label: `${char.name} — ${shotType.replace('_', ' ')} (ref)`,
        filled: !!primary,
        primaryImage: primary,
        candidates,
        recommended: primary || candidates[0] || null,
        isIdentity: false,
      });
    }
  }

  // ── World / Location slots ──
  for (const loc of locations) {
    for (const shotType of SHOT_PACKS.world) {
      const matching = existingImages.filter(
        i => i.asset_group === 'world' &&
          i.subject === loc.name &&
          i.shot_type === shotType
      );
      const primary = matching.find(i => i.is_primary) || null;
      const candidates = matching.filter(i => i.curation_state === 'active' || i.curation_state === 'candidate');
      slots.push({
        key: `world:${loc.name}:${shotType}`,
        assetGroup: 'world',
        subject: loc.name,
        shotType,
        label: `${loc.name} — ${shotType.replace('_', ' ')}`,
        filled: !!primary,
        primaryImage: primary,
        candidates,
        recommended: primary || candidates[0] || null,
        isIdentity: false,
      });
    }
  }

  // ── Visual Language slots (project-level, no subject) ──
  for (const shotType of SHOT_PACKS.visual_language) {
    const matching = existingImages.filter(
      i => i.asset_group === 'visual_language' && i.shot_type === shotType
    );
    const primary = matching.find(i => i.is_primary) || null;
    const candidates = matching.filter(i => i.curation_state === 'active' || i.curation_state === 'candidate');
    slots.push({
      key: `visual_language::${shotType}`,
      assetGroup: 'visual_language',
      subject: null,
      shotType,
      label: `Visual Language — ${shotType.replace('_', ' ')}`,
      filled: !!primary,
      primaryImage: primary,
      candidates,
      recommended: primary || candidates[0] || null,
      isIdentity: false,
    });
  }

  // ── Key Moments (project-level, no specific subject) ──
  for (const shotType of SHOT_PACKS.key_moment) {
    const matching = existingImages.filter(
      i => i.asset_group === 'key_moment' && i.shot_type === shotType
    );
    const primary = matching.find(i => i.is_primary) || null;
    const candidates = matching.filter(i => i.curation_state === 'active' || i.curation_state === 'candidate');
    slots.push({
      key: `key_moment::${shotType}`,
      assetGroup: 'key_moment',
      subject: null,
      shotType,
      label: `Key Moment — ${shotType.replace('_', ' ')}`,
      filled: !!primary,
      primaryImage: primary,
      candidates,
      recommended: primary || candidates[0] || null,
      isIdentity: false,
    });
  }

  const filledCount = slots.filter(s => s.filled).length;
  return {
    slots,
    filledCount,
    totalCount: slots.length,
    completionPercent: slots.length > 0 ? Math.round((filledCount / slots.length) * 100) : 0,
  };
}
