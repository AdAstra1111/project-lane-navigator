/**
 * Ruleset Engine — Lane-aware repair instruction builder
 */
import type { EngineProfile, GateFailure } from './types';

/**
 * Build a deterministic, ruleset-aware repair instruction.
 */
export function buildRulesetRepairInstruction(
  failures: GateFailure[],
  profile: EngineProfile,
  foundForbiddenMoves?: string[],
): string {
  const directives: string[] = [];
  const lane = profile.lane;
  const isVertical = lane === 'vertical_drama';
  const isFeature = lane === 'feature_film';

  if (failures.includes('MELODRAMA')) {
    directives.push('REDUCE MELODRAMA:');
    if (isVertical) {
      directives.push(
        '- Replace melodrama with leverage, bureaucracy, or status consequences.',
        '- Ensure the hook remains strong but grounded — NO conspiracy.',
        '- Reduce secrets; increase misalignment and social friction.',
      );
    } else if (isFeature) {
      directives.push(
        '- Remove twists and add quiet beats with teeth.',
        '- Deepen contradiction matrix and subtext density.',
        '- Replace physical threats with social leverage or contractual pressure.',
      );
    } else {
      directives.push(
        '- Convert screaming confessions to withheld corrections or loaded silence.',
        '- Replace physical threats with resource withdrawal or contract clauses.',
      );
    }
    directives.push('- Cut absolute language ("always", "never") by half.');
  }

  if (failures.includes('OVERCOMPLEXITY')) {
    directives.push(
      'REDUCE COMPLEXITY:',
      `- Collapse plot threads to max ${profile.budgets.plot_thread_cap}.`,
      `- Limit core characters to ${profile.budgets.core_character_cap}. Merge excess.`,
      `- Limit factions to ${profile.budgets.faction_cap}. Remove non-essential.`,
      '- Do NOT add new elements — only remove or merge.',
    );
  }

  if (failures.includes('TEMPLATE_SIMILARITY')) {
    directives.push(
      'INCREASE DIFFERENTIATION:',
      '- Change the inciting incident category.',
      '- Shift the central conflict mechanism.',
      '- Alter the ending trajectory.',
    );
  }

  if (failures.includes('STAKES_TOO_BIG_TOO_EARLY')) {
    const pct = Math.round((1 - profile.stakes_ladder.no_global_before_pct) * 100);
    directives.push(
      'REFRAME EARLY STAKES:',
      `- Keep stakes ${profile.stakes_ladder.early_allowed.join('/')} until final ${pct}%.`,
      '- Remove global/life-threatening stakes from early acts.',
    );
  }

  if (failures.includes('TWIST_OVERUSE')) {
    directives.push(
      'REDUCE TWISTS:',
      `- Keep at most ${profile.budgets.twist_cap} twist(s), ${profile.budgets.big_reveal_cap} big reveal(s).`,
      '- Replace removed twists with character insight or consequence.',
    );
  }

  if (failures.includes('SUBTEXT_MISSING')) {
    directives.push(
      'ADD SUBTEXT:',
      `- Include at least ${profile.pacing_profile.subtext_scenes_min} subtext scenes.`,
      '- Each: what they want, what they won\'t say, what they say instead, tactic, tell.',
    );
  }

  if (failures.includes('QUIET_BEATS_MISSING')) {
    directives.push(
      'ADD QUIET BEATS WITH TEETH:',
      `- Include at least ${profile.pacing_profile.quiet_beats_min} quiet beat(s).`,
      '- Tension present but unexpressed. Reveal character through behavior.',
    );
  }

  if (failures.includes('MEANING_SHIFT_MISSING')) {
    directives.push(
      'ADD MEANING SHIFTS:',
      '- At least 1 moment per act reinterpreting existing information.',
      '- No new facts — only new understanding.',
    );
  }

  if (failures.includes('FORBIDDEN_MOVE_PRESENT') && foundForbiddenMoves?.length) {
    directives.push(
      'REMOVE FORBIDDEN MOVES:',
      ...foundForbiddenMoves.map(m => `- Remove or replace "${m.replace(/_/g, ' ')}".`),
    );
  }

  // Lane-specific repair priorities
  if (isVertical) {
    directives.push(
      '', 'VERTICAL DRAMA PRIORITIES:',
      '1. Replace melodrama with leverage/bureaucracy/status consequences.',
      '2. Keep hook strong but grounded (no conspiracy).',
      '3. Reduce secrets; increase misalignment and social friction.',
    );
  } else if (isFeature) {
    directives.push(
      '', 'FEATURE FILM PRIORITIES:',
      '1. Remove twists and add quiet beats with teeth.',
      '2. Enforce personal stakes until late.',
      '3. Deepen contradiction matrix and subtext density.',
    );
  }

  directives.push(
    '', 'CRITICAL RULES:',
    '- Do NOT add new plot elements, characters, or subplots.',
    '- Only remove, replace, or reframe existing elements.',
    '- Ensure opposition is legitimate (values collision, systemic constraint).',
  );

  return directives.join('\n');
}
