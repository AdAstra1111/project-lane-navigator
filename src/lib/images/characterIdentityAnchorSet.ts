/**
 * Character Identity Anchor Set — canonical upstream constraint for all
 * character-slot image generation, scoring, and approval.
 *
 * Establishes a deterministic identity anchor set per character from
 * approved/primary images, then provides:
 * - anchor resolution for generation
 * - anchor completeness classification
 * - identity-aware recommendation filtering
 */

import { supabase } from '@/integrations/supabase/client';
import type { ProjectImage } from './types';

// ── Types ──

export type AnchorCompleteness =
  | 'full_lock'           // headshot + profile + full_body all present
  | 'partial_lock'        // at least headshot present
  | 'no_anchors';         // nothing locked

export interface IdentityAnchorSet {
  characterName: string;
  headshot: ProjectImage | null;
  profile: ProjectImage | null;
  fullBody: ProjectImage | null;
  completeness: AnchorCompleteness;
  /** Storage paths for injection into generation requests */
  anchorPaths: {
    headshot?: string;
    fullBody?: string;
  };
}

export interface IdentityAnchorMap {
  [characterName: string]: IdentityAnchorSet;
}

// ── Resolution ──

/**
 * Resolve identity anchor set for all characters in a project.
 * Uses primary identity images as the canonical anchor source.
 */
export async function resolveProjectIdentityAnchors(
  projectId: string,
): Promise<IdentityAnchorMap> {
  const { data: anchorImages } = await (supabase as any)
    .from('project_images')
    .select('*')
    .eq('project_id', projectId)
    .eq('asset_group', 'character')
    .eq('generation_purpose', 'character_identity')
    .eq('is_primary', true)
    .in('shot_type', ['identity_headshot', 'identity_profile', 'identity_full_body'])
    .in('curation_state', ['active']);

  const images = (anchorImages || []) as ProjectImage[];
  const map: IdentityAnchorMap = {};

  for (const img of images) {
    const name = img.subject;
    if (!name) continue;
    if (!map[name]) {
      map[name] = {
        characterName: name,
        headshot: null,
        profile: null,
        fullBody: null,
        completeness: 'no_anchors',
        anchorPaths: {},
      };
    }
    const entry = map[name];
    if (img.shot_type === 'identity_headshot') {
      entry.headshot = img;
      entry.anchorPaths.headshot = img.storage_path;
    } else if (img.shot_type === 'identity_profile') {
      entry.profile = img;
    } else if (img.shot_type === 'identity_full_body') {
      entry.fullBody = img;
      entry.anchorPaths.fullBody = img.storage_path;
    }
  }

  // Classify completeness
  for (const entry of Object.values(map)) {
    if (entry.headshot && entry.profile && entry.fullBody) {
      entry.completeness = 'full_lock';
    } else if (entry.headshot) {
      entry.completeness = 'partial_lock';
    } else {
      entry.completeness = 'no_anchors';
    }
  }

  return map;
}

/**
 * Resolve identity anchor set from already-loaded project images (no DB call).
 */
export function resolveIdentityAnchorsFromImages(
  images: ProjectImage[],
): IdentityAnchorMap {
  const map: IdentityAnchorMap = {};

  const identityPrimaries = images.filter(
    i => i.asset_group === 'character' &&
      i.generation_purpose === 'character_identity' &&
      i.is_primary &&
      (i.curation_state === 'active') &&
      i.shot_type && ['identity_headshot', 'identity_profile', 'identity_full_body'].includes(i.shot_type),
  );

  for (const img of identityPrimaries) {
    const name = img.subject;
    if (!name) continue;
    if (!map[name]) {
      map[name] = {
        characterName: name,
        headshot: null,
        profile: null,
        fullBody: null,
        completeness: 'no_anchors',
        anchorPaths: {},
      };
    }
    const entry = map[name];
    if (img.shot_type === 'identity_headshot') {
      entry.headshot = img;
      entry.anchorPaths.headshot = img.storage_path;
    } else if (img.shot_type === 'identity_profile') {
      entry.profile = img;
    } else if (img.shot_type === 'identity_full_body') {
      entry.fullBody = img;
      entry.anchorPaths.fullBody = img.storage_path;
    }
  }

  for (const entry of Object.values(map)) {
    if (entry.headshot && entry.profile && entry.fullBody) {
      entry.completeness = 'full_lock';
    } else if (entry.headshot) {
      entry.completeness = 'partial_lock';
    } else {
      entry.completeness = 'no_anchors';
    }
  }

  return map;
}

// ── Identity-Aware Recommendation ──

export type IdentityContinuityStatus =
  | 'strong_match'       // Generated with identity lock, anchor paths used
  | 'partial_match'      // Some identity context used
  | 'no_anchor_context'  // No anchors existed when generated
  | 'identity_drift'     // Generated without anchors despite them existing
  | 'unknown';           // Cannot determine

/**
 * Classify a candidate image's identity continuity relative to the anchor set.
 */
export function classifyIdentityContinuity(
  image: ProjectImage,
  anchorSet: IdentityAnchorSet | null,
): { status: IdentityContinuityStatus; reason: string } {
  if (image.asset_group !== 'character') {
    return { status: 'unknown', reason: 'Non-character image' };
  }

  const gc = (image.generation_config || {}) as Record<string, unknown>;
  const hasLock = !!(gc.identity_locked);
  const hasAnchors = !!(gc.identity_anchor_paths);

  // Generated with full identity context
  if (hasLock && hasAnchors) {
    return { status: 'strong_match', reason: 'Generated with identity lock and anchor references' };
  }
  if (hasLock) {
    return { status: 'strong_match', reason: 'Generated with identity lock' };
  }
  if (hasAnchors) {
    return { status: 'partial_match', reason: 'Generated using anchor references' };
  }

  // No identity metadata on image — check if anchors existed when it could have used them
  if (!anchorSet || anchorSet.completeness === 'no_anchors') {
    return { status: 'no_anchor_context', reason: 'No identity anchors existed for this character' };
  }

  // Anchors exist but image wasn't generated with them → drift
  return { status: 'identity_drift', reason: 'Generated without identity anchors despite anchors being available' };
}

/**
 * Check if a candidate should be penalized for identity drift.
 * Returns a score penalty (0 = no penalty, negative = penalty).
 */
export function computeIdentityDriftPenalty(
  image: ProjectImage,
  anchorSet: IdentityAnchorSet | null,
): { penalty: number; reason: string } {
  const { status } = classifyIdentityContinuity(image, anchorSet);

  switch (status) {
    case 'strong_match':
      return { penalty: 0, reason: 'Strong identity continuity' };
    case 'partial_match':
      return { penalty: -5, reason: 'Partial identity context — minor penalty' };
    case 'no_anchor_context':
      return { penalty: 0, reason: 'No anchors available — no penalty' };
    case 'identity_drift':
      return { penalty: -25, reason: 'Identity drift — generated without available anchors' };
    default:
      return { penalty: 0, reason: 'Unknown continuity status' };
  }
}

/**
 * Determine if character auto-populate should prioritize identity anchor slots.
 * Returns true if identity anchors are incomplete and should be generated first.
 */
export function shouldPrioritizeIdentityGeneration(
  characterName: string,
  anchorMap: IdentityAnchorMap,
): { prioritize: boolean; missingSlots: string[]; reason: string } {
  const anchors = anchorMap[characterName];
  if (!anchors || anchors.completeness === 'no_anchors') {
    return {
      prioritize: true,
      missingSlots: ['identity_headshot', 'identity_profile', 'identity_full_body'],
      reason: 'No identity anchors exist — generate identity pack first',
    };
  }
  if (anchors.completeness === 'partial_lock') {
    const missing: string[] = [];
    if (!anchors.headshot) missing.push('identity_headshot');
    if (!anchors.profile) missing.push('identity_profile');
    if (!anchors.fullBody) missing.push('identity_full_body');
    return {
      prioritize: missing.length > 0,
      missingSlots: missing,
      reason: `Partial identity lock — missing: ${missing.join(', ')}`,
    };
  }
  return { prioritize: false, missingSlots: [], reason: 'Full identity lock — proceed normally' };
}
