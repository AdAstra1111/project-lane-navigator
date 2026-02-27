/**
 * impact — deterministic heuristics for script change impact analysis.
 * No LLM calls. Pure text analysis.
 */

import { type ParsedScene, extractCharacterCues, extractLocations } from './sceneParser';

export interface ImpactFlag {
  code: 'CONTINUITY_RISK' | 'NEC_RISK' | 'TONE_SHIFT' | 'SETUP_PAYOFF_RISK' | 'CHARACTER_CHANGE' | 'LOCATION_CHANGE';
  detail: string;
}

export interface StaleDoc {
  doc_type: string;
  reason: string;
}

export interface FixPlanItem {
  action: string;
  detail: string;
}

const NEC_KEYWORDS = [
  'blackmail', 'assassination', 'bomb', 'massacre', 'hostage', 'kidnap',
  'torture', 'suicide', 'murder', 'rape', 'terrorism', 'genocide',
  'drug deal', 'trafficking', 'nuclear', 'biological weapon', 'chemical weapon',
  'child abuse', 'mass shooting', 'execution', 'war crime',
];

/**
 * Compute impact flags from old vs new script text.
 */
export function computeImpactFlags(
  oldText: string,
  newText: string,
  oldScenes: ParsedScene[],
  newScenes: ParsedScene[],
): ImpactFlag[] {
  const flags: ImpactFlag[] = [];

  // Character changes
  const oldChars = new Set(extractCharacterCues(oldText));
  const newChars = new Set(extractCharacterCues(newText));
  const removedChars = [...oldChars].filter(c => !newChars.has(c));
  const addedChars = [...newChars].filter(c => !oldChars.has(c));

  if (removedChars.length > 0) {
    flags.push({ code: 'CHARACTER_CHANGE', detail: `Removed characters: ${removedChars.join(', ')}` });

    // Continuity risk: removed character still referenced in new text
    for (const ch of removedChars) {
      if (newText.includes(ch)) {
        flags.push({ code: 'CONTINUITY_RISK', detail: `Removed character "${ch}" still referenced in script` });
      }
    }
  }
  if (addedChars.length > 0) {
    flags.push({ code: 'CHARACTER_CHANGE', detail: `Added characters: ${addedChars.join(', ')}` });
  }

  // Location changes
  const oldLocs = new Set(extractLocations(oldScenes));
  const newLocs = new Set(extractLocations(newScenes));
  const removedLocs = [...oldLocs].filter(l => !newLocs.has(l));
  if (removedLocs.length > 0) {
    flags.push({ code: 'LOCATION_CHANGE', detail: `Removed locations: ${removedLocs.join(', ')}` });
  }

  // NEC risk: new escalation keywords
  const oldLower = oldText.toLowerCase();
  const newLower = newText.toLowerCase();
  const newNecKeywords = NEC_KEYWORDS.filter(kw => newLower.includes(kw) && !oldLower.includes(kw));
  if (newNecKeywords.length > 0) {
    flags.push({ code: 'NEC_RISK', detail: `New escalation keywords: ${newNecKeywords.join(', ')}` });
  }

  // Scene count change → structural shift
  if (Math.abs(oldScenes.length - newScenes.length) >= 2) {
    flags.push({ code: 'SETUP_PAYOFF_RISK', detail: `Scene count changed from ${oldScenes.length} to ${newScenes.length}` });
  }

  return flags;
}

/**
 * Determine which existing docs may be stale after this change.
 */
export function computeStaleDocs(
  changePct: number,
  flags: ImpactFlag[],
  changedSceneCount: number,
  existingDocTypes: string[],
): StaleDoc[] {
  const stale: StaleDoc[] = [];
  const has = (dt: string) => existingDocTypes.includes(dt);
  const hasCharChange = flags.some(f => f.code === 'CHARACTER_CHANGE');
  const hasNecRisk = flags.some(f => f.code === 'NEC_RISK');

  if (hasCharChange && has('character_bible')) {
    stale.push({ doc_type: 'character_bible', reason: 'Character set changed' });
  }
  if (hasCharChange && has('beat_sheet')) {
    stale.push({ doc_type: 'beat_sheet', reason: 'Character set changed — beat assignments may be affected' });
  }
  if ((changePct > 1 || hasNecRisk) && has('deck')) {
    stale.push({ doc_type: 'deck', reason: hasNecRisk ? 'Escalation keywords added' : `${changePct.toFixed(1)}% change detected` });
  }
  if ((changePct > 1 || changedSceneCount >= 3) && has('season_arc')) {
    stale.push({ doc_type: 'season_arc', reason: 'Multiple scene changes may affect arc' });
  }
  if ((changePct > 1 || changedSceneCount >= 3) && has('episode_grid')) {
    stale.push({ doc_type: 'episode_grid', reason: 'Multiple scene changes may affect grid' });
  }

  return stale;
}

/**
 * Generate a fix plan based on impact flags.
 */
export function computeFixPlan(flags: ImpactFlag[]): FixPlanItem[] {
  const plan: FixPlanItem[] = [];

  for (const f of flags) {
    switch (f.code) {
      case 'CONTINUITY_RISK':
        plan.push({ action: 'CHECK_NEARBY_REFERENCES', detail: f.detail });
        break;
      case 'NEC_RISK':
        plan.push({ action: 'REVIEW_NEC_COMPLIANCE', detail: f.detail });
        break;
      case 'CHARACTER_CHANGE':
        plan.push({ action: 'UPDATE_CHARACTER_BIBLE', detail: f.detail });
        break;
      case 'SETUP_PAYOFF_RISK':
        plan.push({ action: 'VERIFY_SETUP_PAYOFF_CHAINS', detail: f.detail });
        break;
    }
  }

  return plan;
}
