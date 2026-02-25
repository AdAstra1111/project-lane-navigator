/**
 * Ruleset Engine — Fingerprinting + diversity defense
 */
import type { RulesetFingerprint, StoryEngine, CausalGrammar, ConflictMode, EngineProfile } from './types';

/**
 * Compute a fingerprint from generated text + resolved rules.
 */
export function computeRulesetFingerprint(
  text: string,
  profile: EngineProfile,
): RulesetFingerprint {
  const lower = text.toLowerCase();

  let stakesType: RulesetFingerprint['stakes_type'] = 'personal';
  if (/\b(world|global|humanity|civilization|nation|country|war)\b/.test(lower)) stakesType = 'global';
  else if (/\b(systemic|institution|policy|government|corporate|structural)\b/.test(lower)) stakesType = 'systemic';
  else if (/\b(community|social|group|family|neighborhood|town)\b/.test(lower)) stakesType = 'social';

  const twistCount = (lower.match(/\b(reveals?|turns? out|twist|secretly|all along)\b/g) || []).length;
  const twistBucket: RulesetFingerprint['twist_count_bucket'] = twistCount === 0 ? '0' : twistCount === 1 ? '1' : '2+';

  let antagonistType: RulesetFingerprint['antagonist_type'] = 'person';
  if (/\b(inner|internal|self-?destruct|own worst|addiction|denial)\b/.test(lower)) antagonistType = 'self';
  else if (/\b(system|institution|bureaucra|corporate|government|structural)\b/.test(lower)) antagonistType = 'system';
  else if (/\b(relationship|marriage|partner|family dynamic|toxic)\b/.test(lower)) antagonistType = 'relationship';

  let endingType: RulesetFingerprint['ending_type'] = 'ambiguous';
  if (/\b(reconcil|reunite|forgive|heal|together again)\b/.test(lower)) endingType = 'reconciliation';
  else if (/\b(accept|come to terms|peace with|letting go)\b/.test(lower)) endingType = 'acceptance';
  else if (/\b(escape|flee|leave|run away|freedom)\b/.test(lower)) endingType = 'escape';
  else if (/\b(justice|punish|convict|verdict|sentence)\b/.test(lower)) endingType = 'justice';
  else if (/\b(tragic|death|loss|destroy|downfall)\b/.test(lower)) endingType = 'tragedy';

  let inciting: RulesetFingerprint['inciting_incident_category'] = 'discovery';
  if (/\b(loss|death|funeral|fired|bankrupt|divorce)\b/.test(lower)) inciting = 'loss';
  else if (/\b(offer|opportunity|invitation|proposal|chance)\b/.test(lower)) inciting = 'offer';
  else if (/\b(mistake|accident|error|blunder|slip)\b/.test(lower)) inciting = 'mistake';
  else if (/\b(arrives?|moves? to|new town|stranger|newcomer)\b/.test(lower)) inciting = 'arrival';
  else if (/\b(accus|allegation|charged|suspect|blame)\b/.test(lower)) inciting = 'accusation';

  const settingTags: string[] = [];
  if (/\b(urban|city|metropolis)\b/.test(lower)) settingTags.push('urban');
  if (/\b(rural|countryside|village|farm)\b/.test(lower)) settingTags.push('rural');
  if (/\b(office|corporate|workplace)\b/.test(lower)) settingTags.push('workplace');
  if (/\b(domestic|home|apartment|house)\b/.test(lower)) settingTags.push('domestic');
  if (/\b(hospital|medical|clinic)\b/.test(lower)) settingTags.push('medical');
  if (/\b(school|university|campus)\b/.test(lower)) settingTags.push('educational');
  if (/\b(court|legal|prison|jail)\b/.test(lower)) settingTags.push('legal');

  return {
    lane: profile.lane,
    story_engine: profile.engine.story_engine,
    causal_grammar: profile.engine.causal_grammar,
    conflict_mode: profile.engine.conflict_mode,
    stakes_type: stakesType,
    twist_count_bucket: twistBucket,
    antagonist_type: antagonistType,
    ending_type: endingType,
    inciting_incident_category: inciting,
    setting_texture_tags: settingTags.slice(0, 5),
  };
}

/**
 * Compute similarity risk (0–1) between current fingerprint and recent ones.
 * Lane-aware weighting.
 */
export function computeRulesetSimilarityRisk(
  current: RulesetFingerprint,
  recent: RulesetFingerprint[],
): number {
  if (recent.length === 0) return 0;

  const l = current.lane.toLowerCase();
  let fields: (keyof RulesetFingerprint)[];
  let weights: number[];

  if (l.includes('vertical')) {
    fields = ['conflict_mode', 'inciting_incident_category', 'story_engine', 'causal_grammar', 'stakes_type', 'antagonist_type', 'ending_type'];
    weights = [3, 3, 1, 1, 1, 1, 1];
  } else if (l.includes('feature')) {
    fields = ['story_engine', 'causal_grammar', 'conflict_mode', 'inciting_incident_category', 'stakes_type', 'antagonist_type', 'ending_type'];
    weights = [3, 3, 1, 1, 1, 1, 1];
  } else {
    fields = ['story_engine', 'causal_grammar', 'conflict_mode', 'stakes_type', 'twist_count_bucket', 'antagonist_type', 'ending_type', 'inciting_incident_category'];
    weights = fields.map(() => 1);
  }

  const totalWeight = weights.reduce((a, b) => a + b, 0);
  let totalOverlap = 0;

  for (const prev of recent) {
    let matchScore = 0;
    for (let i = 0; i < fields.length; i++) {
      if (current[fields[i]] === prev[fields[i]]) matchScore += weights[i];
    }
    totalOverlap += matchScore / totalWeight;
  }

  return Math.min(1, totalOverlap / recent.length);
}
