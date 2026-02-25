/**
 * Nuance Control Stack — Lane-aware repair instruction builder
 */
import type { GateFailure, NuanceCaps, AntiTrope } from './types';

/**
 * Build a lane-aware repair instruction from gate failures.
 * Repairs remove/replace (never add new events).
 */
export function buildRepairInstruction(
  failures: GateFailure[],
  caps: NuanceCaps,
  antiTropes: AntiTrope[],
  lane?: string,
): string {
  const directives: string[] = [];
  const l = (lane || '').toLowerCase();
  const isVertical = l.includes('vertical');
  const isFeature = l.includes('feature');

  if (failures.includes('MELODRAMA')) {
    directives.push('REDUCE MELODRAMA:');
    if (isVertical) {
      directives.push(
        '- Replace melodrama with leverage, bureaucracy, or status consequences.',
        '- Ensure the hook remains strong but grounded — NO conspiracy.',
        '- Reduce secrets; increase misalignment and social friction.',
        '- Convert screaming confessions to loaded silence or withheld corrections.',
      );
    } else if (isFeature) {
      directives.push(
        '- Remove twists and add quiet beats with teeth.',
        '- Deepen contradiction matrix and subtext density.',
        '- Replace physical threats with social leverage or contractual pressure.',
        '- Replace villain monologues with polite emails, policies, or bureaucratic language.',
      );
    } else {
      directives.push(
        '- Convert screaming confessions to withheld corrections or loaded silence.',
        '- Replace physical threats with resource withdrawal, contract clauses, or social leverage.',
        '- Replace villain monologues with polite emails, policies, or bureaucratic language.',
        '- Replace sudden violence with reputational/financial/procedural consequences.',
      );
    }
    directives.push(
      '- Cut absolute language ("always", "never", "everything", "nothing") by half.',
    );
  }

  if (failures.includes('OVERCOMPLEXITY')) {
    directives.push(
      'REDUCE COMPLEXITY:',
      `- Collapse plot threads to at most ${caps.plotThreadCap} major threads.`,
      `- Limit core characters to ${caps.newCharacterCap}. Merge or remove excess.`,
      `- Limit factions/organizations to ${caps.factionCap}. Remove non-essential ones.`,
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
    const pct = Math.round((1 - caps.stakesLateThreshold) * 100);
    directives.push(
      'REFRAME EARLY STAKES:',
      `- Keep stakes personal/relational until the final ${pct}% of the story.`,
      '- Remove any global/life-threatening stakes from early acts.',
      '- Replace with professional, social, or domestic consequences.',
    );
    if (isFeature) {
      directives.push('- Enforce personal stakes until late; no global stakes before final act.');
    }
  }

  if (failures.includes('TWIST_OVERUSE')) {
    directives.push(
      'REDUCE TWISTS:',
      `- Keep at most ${caps.twistCap} major reveal(s). Remove others.`,
      '- Replace removed twists with character insight or consequence.',
      '- Never use "turns out" or "all along" more than once.',
    );
    if (isVertical) {
      directives.push('- Additional twists (beyond 1) must be meaning-shifts or consequence-based, not information reveals.');
    }
  }

  if (failures.includes('SUBTEXT_MISSING')) {
    directives.push(
      'ADD SUBTEXT:',
      `- Include at least ${caps.subtextScenesMin} subtext scenes. For each: what each character wants, what they won't say, what they say instead, their tactic, and the tell.`,
      '- Subtext must advance the plot without explicit confrontation.',
    );
  }

  if (failures.includes('QUIET_BEATS_MISSING')) {
    directives.push(
      'ADD QUIET BEATS WITH TEETH:',
      `- Include at least ${caps.quietBeatsMin} quiet beat(s) where tension is present but unexpressed.`,
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

  // Lane-specific repair priorities
  if (isVertical) {
    directives.push(
      '',
      'VERTICAL DRAMA REPAIR PRIORITIES:',
      '1. Replace melodrama with leverage/bureaucracy/status consequences.',
      '2. Ensure hook remains strong but grounded (no conspiracy).',
      '3. Reduce secrets; increase misalignment and social friction.',
    );
  } else if (isFeature) {
    directives.push(
      '',
      'FEATURE FILM REPAIR PRIORITIES:',
      '1. Remove twists and add quiet beats with teeth.',
      '2. Enforce personal stakes until late.',
      '3. Deepen contradiction matrix and subtext density.',
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
