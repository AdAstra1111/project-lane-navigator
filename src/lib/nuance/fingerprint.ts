/**
 * Nuance Control Stack — Fingerprinting & diversity defense
 */
import type { NuanceFingerprint, StoryEngine, CausalGrammar } from './types';

/**
 * Compute a fingerprint from generated text + profile settings.
 * Uses heuristic keyword detection.
 */
export function computeFingerprint(
  text: string,
  lane: string,
  storyEngine: StoryEngine,
  causalGrammar: CausalGrammar,
): NuanceFingerprint {
  const lower = text.toLowerCase();

  // Stakes type detection
  let stakesType: NuanceFingerprint['stakes_type'] = 'personal';
  if (/\b(world|global|humanity|civilization|nation|country|war)\b/.test(lower)) stakesType = 'global';
  else if (/\b(systemic|institution|policy|government|corporate|structural)\b/.test(lower)) stakesType = 'systemic';
  else if (/\b(community|social|group|family|neighborhood|town)\b/.test(lower)) stakesType = 'social';

  // Twist count
  const twistCount = (lower.match(/\b(reveals?|turns? out|twist|secretly|all along)\b/g) || []).length;
  const twistBucket: NuanceFingerprint['twist_count_bucket'] = twistCount === 0 ? '0' : twistCount === 1 ? '1' : '2+';

  // Antagonist type
  let antagonistType: NuanceFingerprint['antagonist_type'] = 'person';
  if (/\b(inner|internal|self-?destruct|own worst|addiction|denial)\b/.test(lower)) antagonistType = 'self';
  else if (/\b(system|institution|bureaucra|corporate|government|structural)\b/.test(lower)) antagonistType = 'system';
  else if (/\b(relationship|marriage|partner|family dynamic|toxic)\b/.test(lower)) antagonistType = 'relationship';

  // Ending type
  let endingType: NuanceFingerprint['ending_type'] = 'ambiguous';
  if (/\b(reconcil|reunite|forgive|heal|together again)\b/.test(lower)) endingType = 'reconciliation';
  else if (/\b(accept|come to terms|peace with|letting go)\b/.test(lower)) endingType = 'acceptance';
  else if (/\b(escape|flee|leave|run away|freedom)\b/.test(lower)) endingType = 'escape';
  else if (/\b(justice|punish|convict|verdict|sentence)\b/.test(lower)) endingType = 'justice';
  else if (/\b(tragic|death|loss|destroy|downfall)\b/.test(lower)) endingType = 'tragedy';

  // Inciting incident
  let inciting: NuanceFingerprint['inciting_incident_category'] = 'discovery';
  if (/\b(loss|death|funeral|fired|bankrupt|divorce)\b/.test(lower)) inciting = 'loss';
  else if (/\b(offer|opportunity|invitation|proposal|chance)\b/.test(lower)) inciting = 'offer';
  else if (/\b(mistake|accident|error|blunder|slip)\b/.test(lower)) inciting = 'mistake';
  else if (/\b(arrives?|moves? to|new town|stranger|newcomer)\b/.test(lower)) inciting = 'arrival';
  else if (/\b(accus|allegation|charged|suspect|blame)\b/.test(lower)) inciting = 'accusation';

  // Setting tags
  const settingTags: string[] = [];
  if (/\b(urban|city|metropolis)\b/.test(lower)) settingTags.push('urban');
  if (/\b(rural|countryside|village|farm)\b/.test(lower)) settingTags.push('rural');
  if (/\b(office|corporate|workplace)\b/.test(lower)) settingTags.push('workplace');
  if (/\b(domestic|home|apartment|house)\b/.test(lower)) settingTags.push('domestic');
  if (/\b(hospital|medical|clinic)\b/.test(lower)) settingTags.push('medical');
  if (/\b(school|university|campus)\b/.test(lower)) settingTags.push('educational');
  if (/\b(court|legal|prison|jail)\b/.test(lower)) settingTags.push('legal');

  return {
    lane,
    story_engine: storyEngine,
    causal_grammar: causalGrammar,
    stakes_type: stakesType,
    twist_count_bucket: twistBucket,
    antagonist_type: antagonistType,
    ending_type: endingType,
    inciting_incident_category: inciting,
    setting_texture_tags: settingTags.slice(0, 5),
  };
}

/**
 * Compute similarity risk (0–1) between a fingerprint and an array of recent fingerprints.
 */
export function computeSimilarityRisk(
  current: NuanceFingerprint,
  recent: NuanceFingerprint[],
): number {
  if (recent.length === 0) return 0;

  let totalOverlap = 0;
  const fields: (keyof NuanceFingerprint)[] = [
    'story_engine', 'causal_grammar', 'stakes_type',
    'twist_count_bucket', 'antagonist_type', 'ending_type',
    'inciting_incident_category',
  ];

  for (const prev of recent) {
    let matchCount = 0;
    for (const f of fields) {
      if (current[f] === prev[f]) matchCount++;
    }
    totalOverlap += matchCount / fields.length;
  }

  return Math.min(1, totalOverlap / recent.length);
}

/**
 * Get diversification suggestions based on recent fingerprints.
 */
export function getDiversificationHints(recent: NuanceFingerprint[]): {
  avoidEngines: StoryEngine[];
  avoidGrammars: CausalGrammar[];
  avoidStakesTypes: string[];
} {
  if (recent.length === 0) return { avoidEngines: [], avoidGrammars: [], avoidStakesTypes: [] };

  // Count frequency
  const engineCounts: Record<string, number> = {};
  const grammarCounts: Record<string, number> = {};
  const stakesCounts: Record<string, number> = {};

  for (const fp of recent) {
    engineCounts[fp.story_engine] = (engineCounts[fp.story_engine] || 0) + 1;
    grammarCounts[fp.causal_grammar] = (grammarCounts[fp.causal_grammar] || 0) + 1;
    stakesCounts[fp.stakes_type] = (stakesCounts[fp.stakes_type] || 0) + 1;
  }

  const threshold = recent.length * 0.4;
  return {
    avoidEngines: Object.entries(engineCounts).filter(([, c]) => c >= threshold).map(([k]) => k as StoryEngine),
    avoidGrammars: Object.entries(grammarCounts).filter(([, c]) => c >= threshold).map(([k]) => k as CausalGrammar),
    avoidStakesTypes: Object.entries(stakesCounts).filter(([, c]) => c >= threshold).map(([k]) => k),
  };
}
