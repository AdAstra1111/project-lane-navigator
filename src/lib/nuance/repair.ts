/**
 * Nuance Control Stack — Repair instruction builder
 * Converts gate failures into a deterministic repair instruction for the LLM.
 */
import type { GateFailure, NuanceCaps, AntiTrope } from './types';

const MELODRAMA_TRANSLATIONS: Record<string, string> = {
  'screaming_confession': 'Replace with a withheld correction or silence with consequence.',
  'physical_threat': 'Replace with resource withdrawal, access denial, contract clause, or social leverage.',
  'villain_monologue': 'Replace with a polite email, policy document, or bureaucratic language.',
  'sudden_violence': 'Replace with reputational, financial, procedural, or legal consequence.',
};

/**
 * Build a repair instruction from gate failures.
 * The instruction is deterministic and additive-free (removes/replaces, never adds new events).
 */
export function buildRepairInstruction(
  failures: GateFailure[],
  caps: NuanceCaps,
  antiTropes: AntiTrope[],
): string {
  const directives: string[] = [];

  if (failures.includes('MELODRAMA')) {
    directives.push(
      'REDUCE MELODRAMA:',
      '- Convert any screaming confessions to withheld corrections or loaded silence.',
      '- Replace physical threats with resource withdrawal, contract clauses, or social leverage.',
      '- Replace villain monologues with polite emails, policies, or bureaucratic language.',
      '- Replace sudden violence with reputational/financial/procedural consequences.',
      '- Cut absolute language ("always", "never", "everything", "nothing") by half.',
    );
  }

  if (failures.includes('OVERCOMPLEXITY')) {
    directives.push(
      'REDUCE COMPLEXITY:',
      `- Collapse plot threads to at most ${caps.plotThreadCap} major threads.`,
      `- Limit core characters to ${caps.newCharacterCap}. Merge or remove excess.`,
      '- Remove any faction or organization that is not essential to the central conflict.',
      '- Do NOT add any new elements — only remove or merge.',
    );
  }

  if (failures.includes('TEMPLATE_SIMILARITY')) {
    directives.push(
      'INCREASE DIFFERENTIATION:',
      '- Change the inciting incident to a different category than previous runs.',
      '- Shift the central conflict mechanism to something less familiar.',
      '- Alter the ending trajectory.',
    );
  }

  if (failures.includes('STAKES_TOO_BIG_TOO_EARLY')) {
    directives.push(
      'REFRAME EARLY STAKES:',
      '- Keep stakes personal/relational in the first 80% of the story.',
      '- Remove any global/life-threatening stakes from early acts.',
      '- Replace with professional, social, or domestic consequences.',
    );
  }

  if (failures.includes('TWIST_OVERUSE')) {
    directives.push(
      'REDUCE TWISTS:',
      `- Keep at most ${caps.twistCap} major reveal(s). Remove others.`,
      '- Replace removed twists with character insight or consequence.',
      '- Never use "turns out" or "all along" more than once.',
    );
  }

  if (failures.includes('SUBTEXT_MISSING')) {
    directives.push(
      'ADD SUBTEXT:',
      '- Include at least 3 subtext scenes. For each: what each character wants, what they won\'t say, what they say instead, their tactic, and the tell.',
      '- Subtext must advance the plot without explicit confrontation.',
    );
  }

  if (failures.includes('QUIET_BEATS_MISSING')) {
    directives.push(
      'ADD QUIET BEATS WITH TEETH:',
      '- Include at least 2 quiet beats where tension is present but unexpressed.',
      '- Each quiet beat should reveal character through behavior, not dialogue.',
    );
  }

  if (failures.includes('MEANING_SHIFT_MISSING')) {
    directives.push(
      'ADD MEANING SHIFTS:',
      '- Include at least 1 moment per act where existing information is reinterpreted.',
      '- No new facts — only new understanding of what we already know.',
    );
  }

  if (antiTropes.length > 0) {
    directives.push(
      'AVOID THESE TROPES:',
      ...antiTropes.map(t => `- No ${t.replace(/_/g, ' ')}.`),
    );
  }

  directives.push(
    '',
    'CRITICAL REPAIR RULES:',
    '- Do NOT add new plot elements, characters, or subplots.',
    '- Only remove, replace, or reframe existing elements.',
    '- Maintain the same story structure and emotional trajectory.',
    '- Ensure opposition is legitimate (values collision, systemic constraint) not evil mastermind.',
  );

  return directives.join('\n');
}
