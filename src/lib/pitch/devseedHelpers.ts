/**
 * Shared helpers for DevSeed data extraction.
 * Used by ApplyDevSeedDialog and SeedAppliedBanner.
 */
import type { RulesetPrefs } from '@/lib/rulesets/uiState';
import type { StyleBenchmark } from '@/lib/rulesets/styleBenchmarks';

// ── Lane-specific default comps toggles ──────────────────────────────
const COMPS_DEFAULTS: Record<string, { include_films: boolean; include_series: boolean; include_vertical: boolean }> = {
  vertical_drama:   { include_films: false, include_series: true,  include_vertical: true  },
  'vertical-drama': { include_films: false, include_series: true,  include_vertical: true  },
  'fast-turnaround':{ include_films: false, include_series: true,  include_vertical: true  },
  series:           { include_films: true,  include_series: true,  include_vertical: false },
  'tv-series':      { include_films: true,  include_series: true,  include_vertical: false },
  'limited-series': { include_films: true,  include_series: true,  include_vertical: false },
  'digital-series': { include_films: true,  include_series: true,  include_vertical: false },
  feature_film:     { include_films: true,  include_series: false, include_vertical: false },
  'independent-film':{ include_films: true, include_series: false, include_vertical: false },
  'studio-film':    { include_films: true,  include_series: false, include_vertical: false },
};

// ── Tone → Style Benchmark heuristic mapping ─────────────────────────
const TONE_BENCHMARK_MAP: Record<string, StyleBenchmark> = {
  comedy: 'glossy_comedy',
  romcom: 'romantic_banter',
  romance: 'kdrama_romance',
  thriller: 'thriller_mystery',
  mystery: 'thriller_mystery',
  drama: 'prestige_intimate',
  prestige: 'prestige_intimate',
  melodrama: 'soap_melodrama',
  soap: 'soap_melodrama',
  action: 'action_pulse',
  satire: 'satire_systems',
  'dark comedy': 'satire_systems',
  youth: 'youth_aspirational',
  'coming of age': 'youth_aspirational',
  workplace: 'workplace_power_games',
  corporate: 'workplace_power_games',
  power: 'workplace_power_games',
};

function inferBenchmarkFromSeed(devSeed: any): StyleBenchmark | null {
  // 1. Explicit benchmark in seed
  if (devSeed?.style_benchmark) return devSeed.style_benchmark;

  // 2. Try tone_tag from raw_response
  const toneTag = (devSeed?.tone_tag || devSeed?.bible_starter?.tone_and_style || '').toLowerCase();
  if (!toneTag) return null;

  for (const [keyword, benchmark] of Object.entries(TONE_BENCHMARK_MAP)) {
    if (toneTag.includes(keyword)) return benchmark;
  }
  return null;
}

// ── Default pacing feel per lane ──────────────────────────────────────
function getDefaultPacingFeel(lane: string): string {
  const norm = lane.toLowerCase().replace(/[-_\s]+/g, '');
  if (norm.includes('verticaldrama') || norm.includes('fastturnaround')) return 'punchy';
  if (norm.includes('documentary')) return 'calm';
  return 'standard';
}

/**
 * Build a prefs draft from a DevSeed, using lane to set smart defaults
 * for pacing_feel, style_benchmark, and comps format toggles.
 */
export function buildPrefsDraft(devSeed: any, lane?: string): Partial<RulesetPrefs> {
  const prefs: Partial<RulesetPrefs> = {};
  const nuance = devSeed?.nuance_contract;

  // 1. Last UI settings from nuance contract
  if (nuance) {
    if (nuance.restraint_level != null || nuance.conflict_mode) {
      prefs.last_ui = {};
      if (nuance.restraint_level != null) prefs.last_ui.restraint = nuance.restraint_level;
      if (nuance.conflict_mode) prefs.last_ui.conflict_mode = nuance.conflict_mode;
    }
  }

  // 2. Pacing feel: explicit seed value > lane default
  const seedPacingFeel = devSeed?.pacing_feel;
  if (seedPacingFeel) {
    prefs.pacing_feel = seedPacingFeel;
  } else if (lane) {
    prefs.pacing_feel = getDefaultPacingFeel(lane);
  }

  // 3. Style benchmark: try to infer from seed tone data
  const benchmark = inferBenchmarkFromSeed(devSeed);
  if (benchmark) {
    prefs.style_benchmark = benchmark;
  }

  // 4. Comps format toggles: lane-specific defaults
  if (lane) {
    const normLane = lane.toLowerCase();
    const defaults = COMPS_DEFAULTS[normLane];
    if (defaults) {
      prefs.comps = { ...defaults };
    }
  }

  return prefs;
}
