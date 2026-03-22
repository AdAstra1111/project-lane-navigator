/**
 * identityStrength — Classify actor identity strength from assets.
 */
import type { AIActorVersion, AIActorAsset } from './aiCastApi';

export type IdentityStrength = 'strong' | 'partial' | 'weak';

export interface IdentityStrengthResult {
  strength: IdentityStrength;
  hasHeadshot: boolean;
  hasFullBody: boolean;
  totalAssets: number;
  label: string;
}

/**
 * Determine identity strength from an actor's approved version assets.
 */
export function getIdentityStrength(versions: AIActorVersion[] | undefined, approvedVersionId?: string | null): IdentityStrengthResult {
  if (!versions || versions.length === 0) {
    return { strength: 'weak', hasHeadshot: false, hasFullBody: false, totalAssets: 0, label: 'No versions' };
  }

  // Use Phase 4 canonical approved_version_id only, then latest as display fallback
  const approved = (approvedVersionId ? versions.find(v => v.id === approvedVersionId) : null)
    || versions[versions.length - 1];
  const assets = approved?.ai_actor_assets || [];

  let hasHeadshot = false;
  let hasFullBody = false;

  for (const asset of assets) {
    const assetType = (asset.asset_type || '').toLowerCase();
    const metaShotType = ((asset.meta_json as any)?.shot_type || '').toLowerCase();

    if (
      assetType === 'reference_headshot' ||
      metaShotType === 'identity_headshot' ||
      metaShotType === 'headshot' ||
      (assetType === 'reference_image' && !hasHeadshot)
    ) {
      hasHeadshot = true;
    }

    if (
      assetType === 'reference_full_body' ||
      metaShotType === 'identity_full_body' ||
      metaShotType === 'full_body'
    ) {
      hasFullBody = true;
    }
  }

  const strength: IdentityStrength = (hasHeadshot && hasFullBody)
    ? 'strong'
    : (hasHeadshot || hasFullBody)
      ? 'partial'
      : assets.length > 0
        ? 'partial'
        : 'weak';

  const label = strength === 'strong'
    ? 'Strong identity'
    : strength === 'partial'
      ? 'Partial identity'
      : 'Weak — needs references';

  return { strength, hasHeadshot, hasFullBody, totalAssets: assets.length, label };
}

/**
 * Get best thumbnail URL from an actor's versions/assets.
 */
export function getActorThumbnail(versions: AIActorVersion[] | undefined, approvedVersionId?: string | null): string | null {
  if (!versions || versions.length === 0) return null;
  const approved = (approvedVersionId ? versions.find(v => v.id === approvedVersionId) : null)
    || versions[versions.length - 1];
  const assets = approved?.ai_actor_assets || [];

  // Prefer headshot, then reference_image, then any asset with a URL
  const headshot = assets.find(a =>
    a.asset_type === 'reference_headshot' ||
    (a.meta_json as any)?.shot_type === 'identity_headshot' ||
    (a.meta_json as any)?.shot_type === 'headshot'
  );
  if (headshot?.public_url) return headshot.public_url;

  const ref = assets.find(a => a.asset_type === 'reference_image');
  if (ref?.public_url) return ref.public_url;

  const any = assets.find(a => !!a.public_url);
  return any?.public_url || null;
}
