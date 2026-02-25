/**
 * Nuance Control Stack — Lane-aware defaults
 */
import type { NuanceProfile, NuanceCaps, AntiTrope, ConflictMode } from './types';

const DEFAULT_ANTI_TROPES: AntiTrope[] = [
  'secret_organization',
  'hidden_bloodline',
  'chosen_one_destiny',
  'kidnapping_as_fuel',
  'sudden_murder_for_stakes',
  'everything_is_connected',
  'villain_monologue',
  'last_minute_double_betrayal',
];

export function getDefaultConflictMode(lane?: string): ConflictMode {
  const l = (lane || '').toLowerCase();
  if (l.includes('vertical')) return 'status_reputation';
  if (l.includes('documentary')) return 'legal_procedural';
  if (l.includes('series')) return 'family_obligation';
  return 'moral_trap'; // feature_film default
}

export function getDefaultProfile(lane?: string): NuanceProfile {
  const l = (lane || '').toLowerCase();
  if (l.includes('documentary')) {
    return {
      restraint: 85,
      storyEngine: 'slow_burn_investigation',
      causalGrammar: 'accumulation',
      dramaBudget: 1,
      antiTropes: DEFAULT_ANTI_TROPES,
      diversify: true,
    };
  }
  if (l.includes('vertical')) {
    return {
      restraint: 60,
      storyEngine: 'pressure_cooker',
      causalGrammar: 'accumulation',
      dramaBudget: 3,
      antiTropes: DEFAULT_ANTI_TROPES,
      diversify: true,
    };
  }
  if (l.includes('series')) {
    return {
      restraint: 70,
      storyEngine: 'pressure_cooker',
      causalGrammar: 'accumulation',
      dramaBudget: 2,
      antiTropes: DEFAULT_ANTI_TROPES,
      diversify: true,
    };
  }
  // feature_film default
  return {
    restraint: 75,
    storyEngine: 'pressure_cooker',
    causalGrammar: 'accumulation',
    dramaBudget: 2,
    antiTropes: DEFAULT_ANTI_TROPES,
    diversify: true,
  };
}

export function getDefaultCaps(lane?: string): NuanceCaps {
  const l = (lane || '').toLowerCase();

  if (l.includes('documentary')) {
    return {
      dramaBudget: 1,
      twistCap: 0,
      newCharacterCap: 5,
      plotThreadCap: 3,
      factionCap: 1,
      subtextScenesMin: 2,
      quietBeatsMin: 3,
      stakesScaleEarly: true,
      stakesLateThreshold: 0.80,
    };
  }
  if (l.includes('vertical')) {
    return {
      dramaBudget: 3,
      twistCap: 2,
      newCharacterCap: 6,
      plotThreadCap: 3,
      factionCap: 2,
      subtextScenesMin: 2,
      quietBeatsMin: 1,
      stakesScaleEarly: true,
      stakesLateThreshold: 0.75,
    };
  }
  if (l.includes('series')) {
    return {
      dramaBudget: 2,
      twistCap: 1,
      newCharacterCap: 5,
      plotThreadCap: 3,
      factionCap: 2,
      subtextScenesMin: 3,
      quietBeatsMin: 2,
      stakesScaleEarly: true,
      stakesLateThreshold: 0.80,
    };
  }
  // feature_film
  return {
    dramaBudget: 2,
    twistCap: 1,
    newCharacterCap: 5,
    plotThreadCap: 3,
    factionCap: 1,
    subtextScenesMin: 4,
    quietBeatsMin: 3,
    stakesScaleEarly: true,
    stakesLateThreshold: 0.80,
  };
}

export const MELODRAMA_THRESHOLDS: Record<string, number> = {
  documentary: 0.15,
  vertical_drama: 0.62,
  series: 0.35,
  feature_film: 0.50,
  default: 0.35,
};

export const SIMILARITY_THRESHOLDS: Record<string, number> = {
  vertical_drama: 0.70,
  feature_film: 0.60,
  series: 0.65,
  documentary: 0.70,
  default: 0.70,
};

export function getMelodramaThreshold(lane?: string): number {
  const l = (lane || '').toLowerCase();
  if (l.includes('documentary')) return MELODRAMA_THRESHOLDS.documentary;
  if (l.includes('vertical')) return MELODRAMA_THRESHOLDS.vertical_drama;
  if (l.includes('series')) return MELODRAMA_THRESHOLDS.series;
  if (l.includes('feature')) return MELODRAMA_THRESHOLDS.feature_film;
  return MELODRAMA_THRESHOLDS.default;
}

export function getSimilarityThreshold(lane?: string): number {
  const l = (lane || '').toLowerCase();
  if (l.includes('vertical')) return SIMILARITY_THRESHOLDS.vertical_drama;
  if (l.includes('feature')) return SIMILARITY_THRESHOLDS.feature_film;
  if (l.includes('series')) return SIMILARITY_THRESHOLDS.series;
  if (l.includes('documentary')) return SIMILARITY_THRESHOLDS.documentary;
  return SIMILARITY_THRESHOLDS.default;
}
