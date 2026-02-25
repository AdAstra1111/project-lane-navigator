/**
 * Pacing Presets — Lane-aware pacing feel + genre presets.
 *
 * Provides curated pacing configurations that users can apply
 * instead of manually setting BPM values.
 */

export type PacingFeel = 'calm' | 'standard' | 'punchy' | 'frenetic';
export type GenrePreset =
  | 'comedy_romcom'
  | 'thriller_mystery'
  | 'prestige_intimate'
  | 'workplace_power'
  | 'action'
  | 'soap_melodrama';

export interface PacingPresetResult {
  beats_per_minute: { min: number; target: number; max: number };
  quiet_beats_min: number;
  subtext_scenes_min: number;
  meaning_shifts_min_per_act: number;
}

export const PACING_FEEL_LABELS: Record<PacingFeel, string> = {
  calm: 'Calm',
  standard: 'Standard',
  punchy: 'Punchy',
  frenetic: 'Frenetic',
};

export const GENRE_PRESET_LABELS: Record<GenrePreset, string> = {
  comedy_romcom: 'Comedy / Romcom',
  thriller_mystery: 'Thriller / Mystery',
  prestige_intimate: 'Prestige / Intimate',
  workplace_power: 'Workplace Power',
  action: 'Action',
  soap_melodrama: 'Soap / Melodrama',
};

// ── Base presets by lane × feel ──

type LaneFeelTable = Record<string, Record<PacingFeel, PacingPresetResult>>;

const BASE_PRESETS: LaneFeelTable = {
  vertical_drama: {
    calm: {
      beats_per_minute: { min: 2.5, target: 3.0, max: 4.0 },
      quiet_beats_min: 2,
      subtext_scenes_min: 3,
      meaning_shifts_min_per_act: 1,
    },
    standard: {
      beats_per_minute: { min: 2.8, target: 3.6, max: 4.8 },
      quiet_beats_min: 1,
      subtext_scenes_min: 2,
      meaning_shifts_min_per_act: 1,
    },
    punchy: {
      beats_per_minute: { min: 3.2, target: 4.2, max: 5.5 },
      quiet_beats_min: 1,
      subtext_scenes_min: 2,
      meaning_shifts_min_per_act: 1,
    },
    frenetic: {
      beats_per_minute: { min: 4.0, target: 5.2, max: 6.2 },
      quiet_beats_min: 0,
      subtext_scenes_min: 1,
      meaning_shifts_min_per_act: 1,
    },
  },
  feature_film: {
    calm: {
      beats_per_minute: { min: 0.8, target: 1.4, max: 2.4 },
      quiet_beats_min: 4,
      subtext_scenes_min: 5,
      meaning_shifts_min_per_act: 1,
    },
    standard: {
      beats_per_minute: { min: 1.0, target: 2.0, max: 3.2 },
      quiet_beats_min: 3,
      subtext_scenes_min: 4,
      meaning_shifts_min_per_act: 1,
    },
    punchy: {
      beats_per_minute: { min: 1.6, target: 2.6, max: 4.0 },
      quiet_beats_min: 2,
      subtext_scenes_min: 3,
      meaning_shifts_min_per_act: 1,
    },
    frenetic: {
      beats_per_minute: { min: 2.0, target: 3.2, max: 4.8 },
      quiet_beats_min: 1,
      subtext_scenes_min: 2,
      meaning_shifts_min_per_act: 1,
    },
  },
  series: {
    calm: {
      beats_per_minute: { min: 1.0, target: 2.0, max: 3.0 },
      quiet_beats_min: 3,
      subtext_scenes_min: 4,
      meaning_shifts_min_per_act: 1,
    },
    standard: {
      beats_per_minute: { min: 1.5, target: 2.5, max: 3.8 },
      quiet_beats_min: 2,
      subtext_scenes_min: 3,
      meaning_shifts_min_per_act: 1,
    },
    punchy: {
      beats_per_minute: { min: 2.0, target: 3.0, max: 4.5 },
      quiet_beats_min: 1,
      subtext_scenes_min: 2,
      meaning_shifts_min_per_act: 1,
    },
    frenetic: {
      beats_per_minute: { min: 2.5, target: 3.8, max: 5.5 },
      quiet_beats_min: 1,
      subtext_scenes_min: 1,
      meaning_shifts_min_per_act: 1,
    },
  },
  documentary: {
    calm: {
      beats_per_minute: { min: 0.5, target: 1.0, max: 1.8 },
      quiet_beats_min: 4,
      subtext_scenes_min: 3,
      meaning_shifts_min_per_act: 1,
    },
    standard: {
      beats_per_minute: { min: 0.8, target: 1.4, max: 2.2 },
      quiet_beats_min: 3,
      subtext_scenes_min: 2,
      meaning_shifts_min_per_act: 1,
    },
    punchy: {
      beats_per_minute: { min: 1.0, target: 1.8, max: 3.0 },
      quiet_beats_min: 2,
      subtext_scenes_min: 2,
      meaning_shifts_min_per_act: 1,
    },
    frenetic: {
      beats_per_minute: { min: 1.2, target: 2.2, max: 3.5 },
      quiet_beats_min: 1,
      subtext_scenes_min: 1,
      meaning_shifts_min_per_act: 1,
    },
  },
};

// ── Genre adjustments (deltas) ──

interface GenreDelta {
  targetDelta: { vertical: number; feature: number; other: number };
  quietBeatsDelta?: number;
  subtextDelta?: number;
  meaningShiftMin?: number;
}

const GENRE_DELTAS: Record<GenrePreset, GenreDelta> = {
  comedy_romcom: {
    targetDelta: { vertical: 0.3, feature: 0.2, other: 0.2 },
  },
  thriller_mystery: {
    targetDelta: { vertical: 0, feature: 0, other: 0 },
    meaningShiftMin: 1,
  },
  prestige_intimate: {
    targetDelta: { vertical: -0.4, feature: -0.4, other: -0.3 },
    quietBeatsDelta: 1,
    subtextDelta: 1,
  },
  workplace_power: {
    targetDelta: { vertical: 0, feature: 0, other: 0 },
    subtextDelta: 1,
  },
  action: {
    targetDelta: { vertical: 0.4, feature: 0.4, other: 0.3 },
    quietBeatsDelta: -1,
  },
  soap_melodrama: {
    targetDelta: { vertical: 0.6, feature: 0.4, other: 0.5 },
  },
};

function getDeltaKey(lane: string): 'vertical' | 'feature' | 'other' {
  if (lane === 'vertical_drama') return 'vertical';
  if (lane === 'feature_film') return 'feature';
  return 'other';
}

/**
 * Returns a full pacing preset for a given lane, feel, and optional genre.
 */
export function getPacingPreset(
  lane: string,
  feel: PacingFeel,
  genrePreset?: GenrePreset | null,
): PacingPresetResult {
  const laneTable = BASE_PRESETS[lane] || BASE_PRESETS.feature_film;
  const base = JSON.parse(JSON.stringify(laneTable[feel])) as PacingPresetResult;

  if (!genrePreset) return base;

  const delta = GENRE_DELTAS[genrePreset];
  if (!delta) return base;

  const key = getDeltaKey(lane);
  const td = delta.targetDelta[key];

  base.beats_per_minute.target = +(base.beats_per_minute.target + td).toFixed(1);
  // Shift min/max proportionally (half delta)
  base.beats_per_minute.min = +(base.beats_per_minute.min + td * 0.5).toFixed(1);
  base.beats_per_minute.max = +(base.beats_per_minute.max + td * 0.5).toFixed(1);

  if (delta.quietBeatsDelta) {
    base.quiet_beats_min = Math.max(0, base.quiet_beats_min + delta.quietBeatsDelta);
  }
  if (delta.subtextDelta) {
    base.subtext_scenes_min = Math.max(0, base.subtext_scenes_min + delta.subtextDelta);
  }
  if (delta.meaningShiftMin != null) {
    base.meaning_shifts_min_per_act = Math.max(base.meaning_shifts_min_per_act, delta.meaningShiftMin);
  }

  return base;
}

/** Default feel for a lane */
export function getDefaultFeel(lane: string): PacingFeel {
  if (lane === 'vertical_drama') return 'punchy';
  if (lane === 'documentary') return 'calm';
  return 'standard';
}
