/**
 * Nuance Control Stack — Fingerprinting & diversity defense
 */
import type { NuanceFingerprint, StoryEngine, CausalGrammar, ConflictMode } from './types';
import { getDefaultConflictMode } from './defaults';

/**
 * Compute a fingerprint from generated text + profile settings.
 */
export function computeFingerprint(
  text: string,
  lane: string,
  storyEngine: StoryEngine,
  causalGrammar: CausalGrammar,
  conflictMode?: ConflictMode,
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
    conflict_mode: conflictMode || getDefaultConflictMode(lane),
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
  lane?: string,
): number {
  if (recent.length === 0) return 0;

  const l = (lane || current.lane || '').toLowerCase();

  // Lane-aware field weighting
  let fields: (keyof NuanceFingerprint)[];
  let weights: number[];

  if (l.includes('vertical')) {
    // Vertical drama: diversify primarily by conflict_mode and inciting_incident_category
    fields = ['conflict_mode', 'inciting_incident_category', 'story_engine', 'causal_grammar', 'stakes_type', 'antagonist_type', 'ending_type'];
    weights = [3, 3, 1, 1, 1, 1, 1]; // conflict_mode & inciting weighted 3x
  } else if (l.includes('feature')) {
    // Feature film: diversify primarily by story_engine and causal_grammar
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

/**
 * Get diversification suggestions based on recent fingerprints.
 */
export function getDiversificationHints(recent: NuanceFingerprint[], lane?: string): {
  avoidEngines: StoryEngine[];
  avoidGrammars: CausalGrammar[];
  avoidStakesTypes: string[];
  avoidConflictModes: ConflictMode[];
  avoidIncitingCategories: string[];
} {
  if (recent.length === 0) return { avoidEngines: [], avoidGrammars: [], avoidStakesTypes: [], avoidConflictModes: [], avoidIncitingCategories: [] };

  const engineCounts: Record<string, number> = {};
  const grammarCounts: Record<string, number> = {};
  const stakesCounts: Record<string, number> = {};
  const conflictCounts: Record<string, number> = {};
  const incitingCounts: Record<string, number> = {};

  for (const fp of recent) {
    engineCounts[fp.story_engine] = (engineCounts[fp.story_engine] || 0) + 1;
    grammarCounts[fp.causal_grammar] = (grammarCounts[fp.causal_grammar] || 0) + 1;
    stakesCounts[fp.stakes_type] = (stakesCounts[fp.stakes_type] || 0) + 1;
    if (fp.conflict_mode) conflictCounts[fp.conflict_mode] = (conflictCounts[fp.conflict_mode] || 0) + 1;
    incitingCounts[fp.inciting_incident_category] = (incitingCounts[fp.inciting_incident_category] || 0) + 1;
  }

  const threshold = recent.length * 0.4;
  const l = (lane || '').toLowerCase();

  const avoidEngines = Object.entries(engineCounts).filter(([, c]) => c >= threshold).map(([k]) => k as StoryEngine);
  const avoidGrammars = Object.entries(grammarCounts).filter(([, c]) => c >= threshold).map(([k]) => k as CausalGrammar);
  const avoidStakesTypes = Object.entries(stakesCounts).filter(([, c]) => c >= threshold).map(([k]) => k);
  const avoidConflictModes = Object.entries(conflictCounts).filter(([, c]) => c >= threshold).map(([k]) => k as ConflictMode);
  const avoidIncitingCategories = Object.entries(incitingCounts).filter(([, c]) => c >= threshold).map(([k]) => k);

  // For vertical_drama, lower threshold for conflict_mode + inciting (prioritize diversity there)
  if (l.includes('vertical')) {
    const vtThreshold = recent.length * 0.3;
    const vtConflict = Object.entries(conflictCounts).filter(([, c]) => c >= vtThreshold).map(([k]) => k as ConflictMode);
    const vtInciting = Object.entries(incitingCounts).filter(([, c]) => c >= vtThreshold).map(([k]) => k);
    return { avoidEngines, avoidGrammars, avoidStakesTypes, avoidConflictModes: vtConflict, avoidIncitingCategories: vtInciting };
  }

  return { avoidEngines, avoidGrammars, avoidStakesTypes, avoidConflictModes, avoidIncitingCategories };
}
