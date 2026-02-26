/**
 * Team Voice prompt block builder — shared across edge functions.
 */

export interface TeamVoiceProfile {
  summary?: string;
  do?: string[];
  dont?: string[];
  knobs?: Record<string, any>;
  signature_moves?: string[];
  banned_moves?: string[];
  examples?: { micro_example?: string; rewrite_rule_example?: string };
}

export function buildTeamVoicePromptBlock(
  label: string,
  profile: TeamVoiceProfile,
  hasWritingVoice = false,
): string {
  const lines: string[] = [];
  lines.push(`=== TEAM VOICE (Paradox House) ===`);
  lines.push(`Label: ${label}`);
  if (profile.summary) lines.push(`Summary: ${profile.summary}`);
  if (profile.knobs) {
    const knobStr = Object.entries(profile.knobs)
      .filter(([_, v]) => v != null)
      .map(([k, v]) => `${k}=${Array.isArray(v) ? v.join('-') : v}`)
      .join(', ');
    if (knobStr) lines.push(`Knobs: ${knobStr}`);
  }
  if (profile.do?.length) lines.push(`DO: ${profile.do.join('; ')}`);
  if (profile.dont?.length) lines.push(`DON'T: ${profile.dont.join('; ')}`);
  if (profile.signature_moves?.length) lines.push(`Signature Moves: ${profile.signature_moves.join('; ')}`);
  if (profile.banned_moves?.length) lines.push(`Banned Moves: ${profile.banned_moves.join('; ')}`);
  lines.push(`=== END TEAM VOICE ===`);
  if (hasWritingVoice) {
    lines.push(`Note: Team Voice has priority over generic Writing Voice preset if conflict.`);
  }
  return lines.join('\n');
}
