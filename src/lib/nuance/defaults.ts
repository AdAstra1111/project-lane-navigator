/**
 * Nuance Control Stack — Lane-aware defaults
 */
import type { NuanceProfile, NuanceCaps, AntiTrope } from './types';

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
  return {
    dramaBudget: l.includes('vertical') ? 3 : l.includes('documentary') ? 1 : 2,
    twistCap: 1,
    newCharacterCap: 5,
    plotThreadCap: 3,
    stakesScaleEarly: true,
  };
}

export const MELODRAMA_THRESHOLDS: Record<string, number> = {
  documentary: 0.15,
  vertical_drama: 0.45,
  series: 0.35,
  feature_film: 0.30,
  default: 0.35,
};

export function getMelodramaThreshold(lane?: string): number {
  const l = (lane || '').toLowerCase();
  if (l.includes('documentary')) return MELODRAMA_THRESHOLDS.documentary;
  if (l.includes('vertical')) return MELODRAMA_THRESHOLDS.vertical_drama;
  if (l.includes('series')) return MELODRAMA_THRESHOLDS.series;
  if (l.includes('feature')) return MELODRAMA_THRESHOLDS.feature_film;
  return MELODRAMA_THRESHOLDS.default;
}
