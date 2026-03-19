/**
 * Character Identity Resolver — deterministic resolver for locked identity anchors.
 * Reusable across identity generation, cinematic reference generation, state variants, etc.
 *
 * Identity is LOCKED when both primary identity_headshot and primary identity_full_body exist.
 */
import { supabase } from '@/integrations/supabase/client';
import type { ProjectImage } from './types';

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
 * Returns structured canon check result.
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

  const messages: string[] = [];
  const notesLower = notes.toLowerCase();

  // Extract canon constraints
  const canonTraits = (canonCharacter?.traits || '').toString().toLowerCase();
  const canonRole = (canonCharacter?.role || '').toString().toLowerCase();
  const canonDesc = Object.entries(canonCharacter || {})
    .filter(([k]) => ['description', 'appearance', 'physical', 'age', 'gender', 'ethnicity', 'background'].includes(k))
    .map(([, v]) => String(v).toLowerCase())
    .join(' ');

  // World/period constraints from canon
  const worldRules = String(canonJson?.world_rules || '').toLowerCase();
  const toneStyle = String(canonJson?.tone_style || '').toLowerCase();
  const forbiddenChanges = String(canonJson?.forbidden_changes || '').toLowerCase();

  // Age contradiction detection
  const agePatterns = [
    { note: /\b(young|youthful|teenage|teen|child|kid)\b/, canon: /\b(old|elderly|aged|mature|senior|middle.?aged)\b/ },
    { note: /\b(old|elderly|aged|senior)\b/, canon: /\b(young|youthful|teenage|teen|child)\b/ },
  ];
  for (const { note, canon } of agePatterns) {
    if (note.test(notesLower) && canon.test(canonDesc + ' ' + canonTraits)) {
      messages.push(`Age contradiction: notes suggest "${notesLower.match(note)?.[0]}" but canon describes character differently`);
    }
  }

  // Gender presentation contradiction
  const genderPatterns = [
    { note: /\b(masculine|male.?presenting|rugged|bearded)\b/, canon: /\b(feminine|female|woman|she\/her)\b/ },
    { note: /\b(feminine|female.?presenting|delicate)\b/, canon: /\b(masculine|male|man|he\/him|rugged)\b/ },
  ];
  for (const { note, canon } of genderPatterns) {
    if (note.test(notesLower) && canon.test(canonDesc + ' ' + canonTraits + ' ' + canonRole)) {
      messages.push(`Gender presentation contradiction detected between notes and canon`);
    }
  }

  // Build type contradiction (lean vs heavy, etc.)
  const buildPatterns = [
    { note: /\b(lean|thin|slim|slender|wiry)\b/, canon: /\b(heavy|large|stocky|muscular|bulky|heavyset)\b/ },
    { note: /\b(heavy|large|stocky|bulky|heavyset)\b/, canon: /\b(lean|thin|slim|slender|wiry|petite)\b/ },
  ];
  for (const { note, canon } of buildPatterns) {
    if (note.test(notesLower) && canon.test(canonDesc + ' ' + canonTraits)) {
      messages.push(`Build/body type contradiction detected between notes and canon`);
    }
  }

  // Forbidden elements check
  if (forbiddenChanges) {
    const forbiddenTerms = forbiddenChanges.split(/[,;.\n]+/).map(t => t.trim()).filter(Boolean);
    for (const term of forbiddenTerms) {
      if (term.length > 3 && notesLower.includes(term)) {
        messages.push(`Notes reference "${term}" which is listed as a forbidden/locked canon element`);
      }
    }
  }

  // Period/world constraint warnings
  const periodKeywords = ['modern', 'contemporary', 'futuristic', 'medieval', 'victorian', 'period', 'historical'];
  for (const kw of periodKeywords) {
    if (notesLower.includes(kw) && worldRules && !worldRules.includes(kw)) {
      messages.push(`Notes mention "${kw}" — verify this aligns with the project's world/period setting`);
    }
  }

  if (messages.some(m => m.includes('contradiction'))) {
    return { status: 'contradiction', messages };
  }
  if (messages.length > 0) {
    return { status: 'uncertain', messages };
  }
  return { status: 'pass', messages: [] };
}
