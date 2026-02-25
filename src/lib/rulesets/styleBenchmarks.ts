/**
 * Style Benchmarks — Comparable-engine-driven pacing presets.
 *
 * Users pick a Style Benchmark (creative archetype) + Pacing Feel.
 * Comps may SUGGEST a benchmark/feel but must never set raw BPM directly.
 */

export type PacingFeel = 'calm' | 'standard' | 'punchy' | 'frenetic';

export type StyleBenchmark =
  | 'glossy_comedy'
  | 'romantic_banter'
  | 'kdrama_romance'
  | 'workplace_power_games'
  | 'thriller_mystery'
  | 'prestige_intimate'
  | 'soap_melodrama'
  | 'youth_aspirational'
  | 'satire_systems'
  | 'action_pulse';

export const PACING_FEEL_LABELS: Record<PacingFeel, string> = {
  calm: 'Calm',
  standard: 'Standard',
  punchy: 'Punchy',
  frenetic: 'Frenetic',
};

export const STYLE_BENCHMARK_LABELS: Record<StyleBenchmark, { name: string; description: string }> = {
  glossy_comedy:          { name: 'Glossy Comedy',          description: 'Light, fast, aspirational comedy energy' },
  romantic_banter:        { name: 'Romantic Banter',        description: 'Dialogue-driven romance with verbal sparring' },
  kdrama_romance:         { name: 'K-Drama Romance',        description: 'Yearning + misalignment + emotional beats' },
  workplace_power_games:  { name: 'Workplace Power Games',  description: 'Leverage, status moves, and subtext-heavy scenes' },
  thriller_mystery:       { name: 'Thriller / Mystery',     description: 'Controlled reveals and suspense architecture' },
  prestige_intimate:      { name: 'Prestige Intimate',      description: 'Restrained, character-driven, high subtext' },
  soap_melodrama:         { name: 'Soap / Melodrama',       description: 'High emotion turns, cliffhangers, fast reversals' },
  youth_aspirational:     { name: 'Youth Aspirational',     description: 'Glossy coming-of-age, micro-turns, identity' },
  satire_systems:         { name: 'Satire / Systems',       description: 'Institutional antagonists, dark comedy, irony' },
  action_pulse:           { name: 'Action Pulse',           description: 'Obstacle/solution cadence, physical tension' },
};

export interface BenchmarkResult {
  beats_per_minute: { min: number; target: number; max: number };
  quiet_beats_min: number;
  subtext_scenes_min: number;
  meaning_shifts_min_per_act: number;
  dialogue?: {
    subtext_ratio_target: number;
    monologue_max_lines: number;
  };
}

// ── Baselines by lane × feel ──

interface FeelBaseline {
  bpm: { min: number; target: number; max: number };
  quiet: number;
  subtext: number;
  meaning: number;
}

const LANE_BASELINES: Record<string, Record<PacingFeel, FeelBaseline>> = {
  vertical_drama: {
    calm:     { bpm: { min: 2.5, target: 3.0, max: 4.0 }, quiet: 2, subtext: 3, meaning: 1 },
    standard: { bpm: { min: 2.8, target: 3.6, max: 4.8 }, quiet: 1, subtext: 2, meaning: 1 },
    punchy:   { bpm: { min: 3.2, target: 4.2, max: 5.5 }, quiet: 1, subtext: 2, meaning: 1 },
    frenetic: { bpm: { min: 4.0, target: 5.2, max: 6.2 }, quiet: 0, subtext: 1, meaning: 1 },
  },
  feature_film: {
    calm:     { bpm: { min: 0.8, target: 1.4, max: 2.4 }, quiet: 4, subtext: 5, meaning: 1 },
    standard: { bpm: { min: 1.0, target: 2.0, max: 3.2 }, quiet: 3, subtext: 4, meaning: 1 },
    punchy:   { bpm: { min: 1.6, target: 2.6, max: 4.0 }, quiet: 2, subtext: 3, meaning: 1 },
    frenetic: { bpm: { min: 2.0, target: 3.2, max: 4.8 }, quiet: 1, subtext: 2, meaning: 1 },
  },
  series: {
    calm:     { bpm: { min: 1.0, target: 2.0, max: 3.0 }, quiet: 3, subtext: 4, meaning: 1 },
    standard: { bpm: { min: 1.5, target: 2.5, max: 3.8 }, quiet: 2, subtext: 3, meaning: 1 },
    punchy:   { bpm: { min: 2.0, target: 3.0, max: 4.5 }, quiet: 1, subtext: 2, meaning: 1 },
    frenetic: { bpm: { min: 2.5, target: 3.8, max: 5.5 }, quiet: 1, subtext: 1, meaning: 1 },
  },
  documentary: {
    calm:     { bpm: { min: 0.5, target: 1.0, max: 1.8 }, quiet: 4, subtext: 3, meaning: 1 },
    standard: { bpm: { min: 0.8, target: 1.4, max: 2.2 }, quiet: 3, subtext: 2, meaning: 1 },
    punchy:   { bpm: { min: 1.0, target: 1.8, max: 3.0 }, quiet: 2, subtext: 2, meaning: 1 },
    frenetic: { bpm: { min: 1.2, target: 2.2, max: 3.5 }, quiet: 1, subtext: 1, meaning: 1 },
  },
};

// ── Benchmark modifiers ──

interface BenchmarkModifier {
  /** Delta applied to target BPM. min/max shift proportionally (half). */
  targetDelta: { vertical: number; feature: number; other: number };
  quietDelta?: number;
  subtextDelta?: number;
  meaningMin?: number;
  dialogue?: { subtext_ratio_target: number; monologue_max_lines: number };
}

const BENCHMARK_MODIFIERS: Record<StyleBenchmark, BenchmarkModifier> = {
  glossy_comedy: {
    targetDelta: { vertical: 0.3, feature: 0.2, other: 0.2 },
    dialogue: { subtext_ratio_target: 0.40, monologue_max_lines: 4 },
  },
  romantic_banter: {
    targetDelta: { vertical: 0.1, feature: 0.1, other: 0.1 },
    subtextDelta: 1,
    dialogue: { subtext_ratio_target: 0.60, monologue_max_lines: 4 },
  },
  kdrama_romance: {
    targetDelta: { vertical: 0, feature: 0, other: 0 },
    quietDelta: 1,
    subtextDelta: 1,
    meaningMin: 1,
    dialogue: { subtext_ratio_target: 0.55, monologue_max_lines: 5 },
  },
  workplace_power_games: {
    targetDelta: { vertical: 0, feature: 0, other: 0 },
    subtextDelta: 1,
    dialogue: { subtext_ratio_target: 0.65, monologue_max_lines: 5 },
  },
  thriller_mystery: {
    targetDelta: { vertical: 0, feature: 0, other: 0 },
    meaningMin: 1,
    dialogue: { subtext_ratio_target: 0.50, monologue_max_lines: 6 },
  },
  prestige_intimate: {
    targetDelta: { vertical: -0.4, feature: -0.4, other: -0.3 },
    quietDelta: 1,
    subtextDelta: 1,
    dialogue: { subtext_ratio_target: 0.70, monologue_max_lines: 8 },
  },
  soap_melodrama: {
    targetDelta: { vertical: 0.6, feature: 0.4, other: 0.5 },
    dialogue: { subtext_ratio_target: 0.35, monologue_max_lines: 5 },
  },
  youth_aspirational: {
    targetDelta: { vertical: 0, feature: 0, other: 0 },
    subtextDelta: 1,
    dialogue: { subtext_ratio_target: 0.45, monologue_max_lines: 4 },
  },
  satire_systems: {
    targetDelta: { vertical: 0, feature: 0, other: 0 },
    subtextDelta: 1,
    meaningMin: 2,
    dialogue: { subtext_ratio_target: 0.55, monologue_max_lines: 6 },
  },
  action_pulse: {
    targetDelta: { vertical: 0.4, feature: 0.4, other: 0.3 },
    quietDelta: -1,
    dialogue: { subtext_ratio_target: 0.30, monologue_max_lines: 3 },
  },
};

function getDeltaKey(lane: string): 'vertical' | 'feature' | 'other' {
  if (lane === 'vertical_drama') return 'vertical';
  if (lane === 'feature_film') return 'feature';
  return 'other';
}

/**
 * Returns pacing defaults for a lane + feel + optional style benchmark.
 */
export function getBenchmarkDefaults(
  lane: string,
  benchmark: StyleBenchmark | null,
  feel: PacingFeel,
): BenchmarkResult {
  const laneTable = LANE_BASELINES[lane] || LANE_BASELINES.feature_film;
  const base = laneTable[feel];

  const result: BenchmarkResult = {
    beats_per_minute: { ...base.bpm },
    quiet_beats_min: base.quiet,
    subtext_scenes_min: base.subtext,
    meaning_shifts_min_per_act: base.meaning,
  };

  if (!benchmark) return result;

  const mod = BENCHMARK_MODIFIERS[benchmark];
  if (!mod) return result;

  const key = getDeltaKey(lane);
  const td = mod.targetDelta[key];

  result.beats_per_minute.target = +(result.beats_per_minute.target + td).toFixed(1);
  result.beats_per_minute.min = +(result.beats_per_minute.min + td * 0.5).toFixed(1);
  result.beats_per_minute.max = +(result.beats_per_minute.max + td * 0.5).toFixed(1);

  if (mod.quietDelta) {
    result.quiet_beats_min = Math.max(0, result.quiet_beats_min + mod.quietDelta);
  }
  if (mod.subtextDelta) {
    result.subtext_scenes_min = Math.max(0, result.subtext_scenes_min + mod.subtextDelta);
  }
  if (mod.meaningMin != null) {
    result.meaning_shifts_min_per_act = Math.max(result.meaning_shifts_min_per_act, mod.meaningMin);
  }
  if (mod.dialogue) {
    result.dialogue = { ...mod.dialogue };
  }

  return result;
}

/** Default feel for a lane */
export function getDefaultFeel(lane: string): PacingFeel {
  if (lane === 'vertical_drama') return 'punchy';
  if (lane === 'documentary') return 'calm';
  return 'standard';
}

/** Default benchmark for a lane */
export function getDefaultBenchmark(lane: string): StyleBenchmark {
  if (lane === 'vertical_drama') return 'workplace_power_games';
  if (lane === 'documentary') return 'prestige_intimate';
  return 'thriller_mystery';
}
