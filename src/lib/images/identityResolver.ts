/**
 * Character Identity Resolver — deterministic resolver for locked identity anchors.
 * Reusable across identity generation, cinematic reference generation, state variants, etc.
 *
 * Identity is LOCKED when both primary identity_headshot and primary identity_full_body exist.
 * 
 * Supports optional AI Actor binding: if an ai_actor_id is associated with the character,
 * the resolver includes actor reference assets for downstream generation consistency.
 */
import { supabase } from '@/integrations/supabase/client';
import type { ProjectImage } from './types';
import { resolveCharacterTraits, detectTraitContradictions } from './characterTraits';

export interface IdentityLockState {
  locked: boolean;
  headshot: ProjectImage | null;
  fullBody: ProjectImage | null;
  profile: ProjectImage | null;
  /** Signed URLs for injection into generation */
  headshotUrl: string | null;
  fullBodyUrl: string | null;
}

/**
 * Resolve the current identity lock state for a character.
 * Returns the primary identity_headshot and identity_full_body if they exist.
 */
export async function resolveCharacterIdentity(
  projectId: string,
  characterName: string,
): Promise<IdentityLockState> {
  const { data: identityImages } = await (supabase as any)
    .from('project_images')
    .select('*')
    .eq('project_id', projectId)
    .eq('asset_group', 'character')
    .eq('subject', characterName)
    .eq('generation_purpose', 'character_identity')
    .eq('is_primary', true)
    .in('shot_type', ['identity_headshot', 'identity_full_body', 'identity_profile']);

  const images = (identityImages || []) as ProjectImage[];

  const headshot = images.find(i => i.shot_type === 'identity_headshot') || null;
  const fullBody = images.find(i => i.shot_type === 'identity_full_body') || null;
  const profile = images.find(i => i.shot_type === 'identity_profile') || null;

  // Resolve signed URLs for the primaries
  let headshotUrl: string | null = null;
  let fullBodyUrl: string | null = null;

  if (headshot) {
    const { data } = await supabase.storage
      .from(headshot.storage_bucket || 'project-posters')
      .createSignedUrl(headshot.storage_path, 3600);
    headshotUrl = data?.signedUrl || null;
  }
  if (fullBody) {
    const { data } = await supabase.storage
      .from(fullBody.storage_bucket || 'project-posters')
      .createSignedUrl(fullBody.storage_path, 3600);
    fullBodyUrl = data?.signedUrl || null;
  }

  return {
    locked: !!headshot && !!fullBody,
    headshot,
    fullBody,
    profile,
    headshotUrl,
    fullBodyUrl,
  };
}

/**
 * Check identity notes against canon character data.
 * Now uses trait-level contradiction detection for precision.
 */
export interface CanonCheckResult {
  status: 'pass' | 'uncertain' | 'contradiction';
  messages: string[];
}

export function checkIdentityNotesAgainstCanon(
  notes: string,
  canonCharacter: { name: string; role?: string; traits?: string; [key: string]: unknown } | null,
  canonJson: Record<string, unknown> | null,
): CanonCheckResult {
  if (!notes.trim()) return { status: 'pass', messages: [] };
  if (!canonCharacter && !canonJson) return { status: 'uncertain', messages: ['No canon data available for validation'] };

  // Use trait-level detection
  const allTraits = resolveCharacterTraits(canonCharacter, canonJson, notes);
  const contradictions = detectTraitContradictions(allTraits);

  if (contradictions.length === 0) {
    // Check for period/world warnings (non-trait-level)
    const messages: string[] = [];
    const notesLower = notes.toLowerCase();
    const worldRules = String(canonJson?.world_rules || '').toLowerCase();
    const periodKeywords = ['modern', 'contemporary', 'futuristic', 'medieval', 'victorian', 'period', 'historical'];
    for (const kw of periodKeywords) {
      if (notesLower.includes(kw) && worldRules && !worldRules.includes(kw)) {
        messages.push(`Notes mention "${kw}" — verify this aligns with the project's world/period setting`);
      }
    }
    if (messages.length > 0) return { status: 'uncertain', messages };
    return { status: 'pass', messages: [] };
  }

  const messages = contradictions.map(c => c.message);
  const hasHard = contradictions.some(c => c.severity === 'contradiction');
  return {
    status: hasHard ? 'contradiction' : 'uncertain',
    messages,
  };
}
