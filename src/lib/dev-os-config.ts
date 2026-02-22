/**
 * Dev OS Configuration — Single source of truth for the IFFY Development Operating System.
 * Defines deliverable types, behavior modes, format guardrails, and convergence thresholds.
 */

// ── Deliverable Types ──

export type DeliverableType =
  | 'idea'
  | 'topline_narrative'
  | 'concept_brief'
  | 'market_sheet'
  | 'vertical_market_sheet'
  | 'blueprint'
  | 'architecture'
  | 'character_bible'
  | 'beat_sheet'
  | 'script'
  | 'season_master_script'
  | 'production_draft'
  | 'deck'
  | 'documentary_outline'
  | 'format_rules'
  | 'season_arc'
  | 'episode_grid'
  | 'vertical_episode_beats'
  | 'series_writer';

export const DELIVERABLE_LABELS: Record<DeliverableType, string> = {
  idea: 'Idea',
  topline_narrative: 'Topline Narrative',
  concept_brief: 'Concept Brief',
  market_sheet: 'Market Sheet',
  vertical_market_sheet: 'Market Sheet (VD)',
  blueprint: 'Season Blueprint',
  architecture: 'Series Architecture',
  character_bible: 'Character Bible',
  beat_sheet: 'Episode Beat Sheet',
  script: 'Script',
  season_master_script: 'Master Season Script',
  production_draft: 'Production Draft',
  deck: 'Deck',
  documentary_outline: 'Documentary Outline',
  format_rules: 'Format Rules',
  season_arc: 'Season Arc',
  episode_grid: 'Episode Grid',
  vertical_episode_beats: 'Episode Beats',
  series_writer: 'Series Writer',
};

/**
 * Film/feature-specific label overrides.
 * These stages exist in film ladders but should NOT use series terminology.
 */
const FILM_LABEL_OVERRIDES: Partial<Record<DeliverableType, string>> = {
  blueprint: 'Blueprint',
  architecture: 'Architecture',
  beat_sheet: 'Beat Sheet',
  season_arc: 'Story Arc',
};

const NON_SERIES_FORMATS = new Set(['film', 'feature', 'short', 'documentary', 'hybrid-documentary', 'short-film']);

/**
 * Get the display label for a deliverable type, adjusted for the project's format.
 * Film/feature projects get neutral labels (e.g. "Blueprint" not "Season Blueprint").
 */
export function getDeliverableLabel(deliverable: string, format?: string | null): string {
  const normalizedFormat = (format || '').toLowerCase().replace(/_/g, '-');
  if (normalizedFormat && NON_SERIES_FORMATS.has(normalizedFormat)) {
    const override = FILM_LABEL_OVERRIDES[deliverable as DeliverableType];
    if (override) return override;
  }
  return (DELIVERABLE_LABELS as Record<string, string>)[deliverable] || deliverable;
}

export const DELIVERABLE_PIPELINE_ORDER: DeliverableType[] = [
  'idea',
  'concept_brief',
  'market_sheet',
  'blueprint',
  'architecture',
  'character_bible',
  'beat_sheet',
  'script',
  'season_master_script',
  'production_draft',
];

export const VERTICAL_DRAMA_PIPELINE_ORDER: DeliverableType[] = [
  'idea',
  'concept_brief',
  'vertical_market_sheet',
  'format_rules',
  'character_bible',
  'season_arc',
  'episode_grid',
  'vertical_episode_beats',
  'script',
  'season_master_script',
  'series_writer',
];

/**
 * Vertical Drama document ordering — enforces prerequisite chain.
 * Each entry lists its required prerequisites.
 */
export const VERTICAL_DRAMA_DOC_ORDER: Array<{ type: DeliverableType; label: string; prerequisites: DeliverableType[] }> = [
  { type: 'idea', label: 'Idea Brief', prerequisites: [] },
  { type: 'concept_brief', label: 'Concept Brief', prerequisites: ['idea'] },
  { type: 'vertical_market_sheet', label: 'Market Sheet (VD)', prerequisites: ['concept_brief'] },
  { type: 'format_rules', label: 'Format Rules', prerequisites: ['concept_brief'] },
  { type: 'character_bible', label: 'Character Bible', prerequisites: ['concept_brief'] },
  { type: 'season_arc', label: 'Season Arc', prerequisites: ['concept_brief', 'character_bible'] },
  { type: 'episode_grid', label: 'Episode Grid', prerequisites: ['season_arc'] },
  { type: 'vertical_episode_beats', label: 'Episode Beats (Ep 1–3)', prerequisites: ['season_arc', 'episode_grid'] },
  { type: 'script', label: 'Scripts (Ep 1–3)', prerequisites: ['vertical_episode_beats'] },
];

/**
 * Given existing non-stale docs, find the next vertical drama step and any missing prerequisites.
 */
export function getVerticalDramaNextStep(
  existingDocTypes: string[],
  seasonEpisodeCount?: number | null,
  episodeGridRowCount?: number | null,
): { nextStep: DeliverableType | null; missingPrerequisites: DeliverableType[]; reason: string } {
  const existing = new Set(existingDocTypes.map(d => d.toLowerCase().replace(/[\s\-]+/g, '_')));

  for (const step of VERTICAL_DRAMA_DOC_ORDER) {
    if (existing.has(step.type)) continue;

    // Check prerequisites
    const missing = step.prerequisites.filter(p => !existing.has(p));
    if (missing.length > 0) {
      // Suggest the first missing prerequisite instead
      const firstMissing = VERTICAL_DRAMA_DOC_ORDER.find(s => s.type === missing[0]);
      return {
        nextStep: missing[0],
        missingPrerequisites: missing,
        reason: `Cannot create ${step.label} yet — missing ${missing.map(m => DELIVERABLE_LABELS[m] || m).join(', ')}`,
      };
    }

    // Special gating for episode_beats
    if (step.type === 'vertical_episode_beats') {
      if (seasonEpisodeCount && episodeGridRowCount != null && episodeGridRowCount !== seasonEpisodeCount) {
        return {
          nextStep: 'episode_grid',
          missingPrerequisites: ['episode_grid'],
          reason: `Episode grid has ${episodeGridRowCount} rows but canonical season length is ${seasonEpisodeCount}. Regenerate episode grid first.`,
        };
      }
      if (!seasonEpisodeCount) {
        return {
          nextStep: 'episode_grid',
          missingPrerequisites: ['episode_grid'],
          reason: 'season_episode_count not set in qualifications. Set it before generating episode beats.',
        };
      }
    }

    return { nextStep: step.type, missingPrerequisites: [], reason: `Next in vertical drama pipeline: ${step.label}` };
  }

  return { nextStep: null, missingPrerequisites: [], reason: 'All vertical drama documents created' };
}

// ── Development Behavior ──

export type DevelopmentBehavior = 'efficiency' | 'market' | 'prestige' | 'sequential_canon_locked';

export const BEHAVIOR_LABELS: Record<DevelopmentBehavior, string> = {
  efficiency: 'Efficiency',
  market: 'Market',
  prestige: 'Prestige',
  sequential_canon_locked: 'Canon Locked',
};

export const BEHAVIOR_COLORS: Record<DevelopmentBehavior, string> = {
  efficiency: 'bg-sky-500/15 text-sky-400 border-sky-500/30',
  market: 'bg-amber-500/15 text-amber-400 border-amber-500/30',
  prestige: 'bg-purple-500/15 text-purple-400 border-purple-500/30',
  sequential_canon_locked: 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30',
};

export interface BehaviorConfig {
  convergenceMultiplier: number;
  rewriteIntensity: 'direct' | 'balanced' | 'deep';
  packagingDepth: 'light' | 'full' | 'strategic';
  minBeatsPerMinute: number;
  minRewriteCycles?: number;
}

export const behaviorConfig: Record<DevelopmentBehavior, BehaviorConfig> = {
  efficiency: {
    convergenceMultiplier: 0.9,
    rewriteIntensity: 'direct',
    packagingDepth: 'light',
    minBeatsPerMinute: 2.5,
  },
  market: {
    convergenceMultiplier: 1.0,
    rewriteIntensity: 'balanced',
    packagingDepth: 'full',
    minBeatsPerMinute: 3.0,
  },
  prestige: {
    convergenceMultiplier: 1.15,
    rewriteIntensity: 'deep',
    packagingDepth: 'strategic',
    minRewriteCycles: 2,
    minBeatsPerMinute: 2.5,
  },
  sequential_canon_locked: {
    convergenceMultiplier: 1.0,
    rewriteIntensity: 'direct',
    packagingDepth: 'light',
    minBeatsPerMinute: 3.0,
  },
};

// ── Convergence Thresholds (per behavior) ──

export interface ConvergenceThresholds {
  minCI: number;
  minGP: number;
  minRewriteCycles: number;
}

export const convergenceThresholds: Record<DevelopmentBehavior, ConvergenceThresholds> = {
  efficiency: { minCI: 65, minGP: 65, minRewriteCycles: 0 },
  market: { minCI: 75, minGP: 75, minRewriteCycles: 0 },
  prestige: { minCI: 85, minGP: 80, minRewriteCycles: 2 },
  sequential_canon_locked: { minCI: 70, minGP: 70, minRewriteCycles: 0 },
};

export type ConvergenceStatus = 'Not Started' | 'In Progress' | 'Converged';

export function computeConvergenceStatus(
  ciScore: number | null,
  gpScore: number | null,
  gap: number | null,
  allowedGap: number,
  behavior: DevelopmentBehavior = 'market',
  rewriteCycles: number = 0,
  blockersRemaining: number | null = null,
): ConvergenceStatus {
  if (ciScore == null || gpScore == null) return 'Not Started';

  // If we have explicit blocker info from the engine, use blockers-only gating
  if (blockersRemaining !== null) {
    if (blockersRemaining > 0) return 'In Progress';
    // Blockers are zero — check minimum score thresholds
    const t = convergenceThresholds[behavior];
    const meetsCycles = rewriteCycles >= t.minRewriteCycles;
    if (ciScore >= t.minCI && gpScore >= t.minGP && meetsCycles) return 'Converged';
    return 'In Progress';
  }

  // Legacy path: score-based convergence
  const t = convergenceThresholds[behavior];
  const adjustedAllowedGap = allowedGap * behaviorConfig[behavior].convergenceMultiplier;
  const meetsCI = ciScore >= t.minCI;
  const meetsGP = gpScore >= t.minGP;
  const meetsGap = (gap ?? Math.abs(ciScore - gpScore)) <= adjustedAllowedGap;
  const meetsCycles = rewriteCycles >= t.minRewriteCycles;
  if (meetsCI && meetsGP && meetsGap && meetsCycles) return 'Converged';
  return 'In Progress';
}

// ── Vertical Drama Beat Logic ──

export function verticalBeatMinimum(durationSeconds: number): number {
  if (durationSeconds <= 90) return 3;
  if (durationSeconds <= 120) return 4;
  if (durationSeconds <= 150) return 5;
  if (durationSeconds <= 180) return 6;
  return 7;
}

/**
 * Range-aware beat minimum: returns [min, max] beat counts
 * based on the episode duration range.
 */
export function verticalBeatMinimumRange(
  minSeconds?: number | null,
  maxSeconds?: number | null,
  scalarSeconds?: number | null,
): { beatMin: number; beatMax: number; label: string } {
  const lo = minSeconds || scalarSeconds || 120;
  const hi = maxSeconds || scalarSeconds || lo;
  const beatMin = verticalBeatMinimum(lo);
  const beatMax = verticalBeatMinimum(hi);
  const label = beatMin === beatMax ? `${beatMin} beats` : `${beatMin}–${beatMax} beats`;
  return { beatMin, beatMax, label };
}

// ── Vertical Season Architecture ──

export interface SeasonAnchor {
  reveal_index: number;
  mid_index: number;
  pre_finale_index?: number;
  finale_index: number;
}

export interface SeasonAct {
  act: number;
  start_episode: number;
  end_episode: number;
  episode_count: number;
}

export interface SeasonArchitecture {
  model: '5-act' | '3-act';
  episode_count: number;
  acts: SeasonAct[];
  anchors: SeasonAnchor;
}

export function computeSeasonArchitecture(episodeCount: number): SeasonArchitecture {
  if (episodeCount >= 10) {
    // 5-act model
    const actSize = Math.floor(episodeCount * 0.2);
    const remainder = episodeCount - actSize * 5;
    const acts: SeasonAct[] = [];
    let cursor = 1;
    for (let a = 1; a <= 5; a++) {
      const extra = a > (5 - remainder) ? 1 : 0;
      const count = actSize + extra;
      acts.push({ act: a, start_episode: cursor, end_episode: cursor + count - 1, episode_count: count });
      cursor += count;
    }
    return {
      model: '5-act',
      episode_count: episodeCount,
      acts,
      anchors: {
        reveal_index: Math.round(episodeCount * 0.25),
        mid_index: Math.round(episodeCount * 0.50),
        pre_finale_index: Math.round(episodeCount * 0.80),
        finale_index: episodeCount,
      },
    };
  } else {
    // Mini-season 3-act model
    const act1 = Math.round(episodeCount * 0.3);
    const act3 = Math.round(episodeCount * 0.3);
    const act2 = episodeCount - act1 - act3;
    const acts: SeasonAct[] = [
      { act: 1, start_episode: 1, end_episode: act1, episode_count: act1 },
      { act: 2, start_episode: act1 + 1, end_episode: act1 + act2, episode_count: act2 },
      { act: 3, start_episode: act1 + act2 + 1, end_episode: episodeCount, episode_count: act3 },
    ];
    return {
      model: '3-act',
      episode_count: episodeCount,
      acts,
      anchors: {
        reveal_index: Math.round(episodeCount * 0.33),
        mid_index: Math.round(episodeCount * 0.55),
        finale_index: episodeCount,
      },
    };
  }
}

// ── Engine Weight Types ──

export const VERTICAL_ENGINES = ['power_conflict', 'romantic_tension', 'thriller_mystery', 'revenge_arc', 'social_exposure'] as const;
export type VerticalEngine = typeof VERTICAL_ENGINES[number];

export const ENGINE_LABELS: Record<VerticalEngine, string> = {
  power_conflict: 'Power Conflict',
  romantic_tension: 'Romantic Tension',
  thriller_mystery: 'Thriller / Mystery',
  revenge_arc: 'Revenge Arc',
  social_exposure: 'Social Exposure',
};

export const ENGINE_COLORS: Record<VerticalEngine, string> = {
  power_conflict: 'bg-red-500/20 text-red-400 border-red-500/30',
  romantic_tension: 'bg-pink-500/20 text-pink-400 border-pink-500/30',
  thriller_mystery: 'bg-indigo-500/20 text-indigo-400 border-indigo-500/30',
  revenge_arc: 'bg-orange-500/20 text-orange-400 border-orange-500/30',
  social_exposure: 'bg-cyan-500/20 text-cyan-400 border-cyan-500/30',
};

export type VerticalWeights = Record<VerticalEngine, number>;

export interface EpisodeGridRow {
  episode_number: number;
  act_number: number;
  escalation_intensity: number;
  hook: string;
  escalation: string;
  turn: string;
  cliff: string;
  cliff_type: string;
  cliff_tier: 'soft' | 'hard' | 'ultimate';
  anchor_flags: string[];
  beat_minimum: number;
}

export interface EpisodeGridResult {
  architecture: SeasonArchitecture;
  grid: EpisodeGridRow[];
  engine_weights: VerticalWeights;
  beat_minimum: number;
  short_season_warning: string | null;
}

// Legacy compat
export interface LegacyEpisodeGridRow {
  episode: number;
  act: number;
  escalation_intensity: 'low' | 'medium' | 'high' | 'peak';
  required_cliff_tier: 'soft' | 'hard' | 'ultimate';
  is_anchor: boolean;
  anchor_type?: 'reveal' | 'midpoint' | 'pre_finale' | 'finale';
}

export function buildEpisodeGrid(arch: SeasonArchitecture, durationSeconds: number, behavior: DevelopmentBehavior = 'market'): LegacyEpisodeGridRow[] {
  const { acts, anchors, episode_count } = arch;
  const rows: LegacyEpisodeGridRow[] = [];

  for (let ep = 1; ep <= episode_count; ep++) {
    const act = acts.find(a => ep >= a.start_episode && ep <= a.end_episode)!;
    const progress = ep / episode_count;

    let escalation: LegacyEpisodeGridRow['escalation_intensity'] = 'low';
    if (progress > 0.75) escalation = 'peak';
    else if (progress > 0.5) escalation = 'high';
    else if (progress > 0.25) escalation = 'medium';

    let cliff: LegacyEpisodeGridRow['required_cliff_tier'] = 'soft';
    if (ep === anchors.finale_index) cliff = 'ultimate';
    else if (ep === anchors.mid_index || ep === anchors.pre_finale_index) cliff = 'hard';
    else if (progress > 0.5) cliff = 'hard';

    let anchor_type: LegacyEpisodeGridRow['anchor_type'] | undefined;
    if (ep === anchors.reveal_index) anchor_type = 'reveal';
    else if (ep === anchors.mid_index) anchor_type = 'midpoint';
    else if (ep === anchors.pre_finale_index) anchor_type = 'pre_finale';
    else if (ep === anchors.finale_index) anchor_type = 'finale';

    rows.push({
      episode: ep,
      act: act.act,
      escalation_intensity: escalation,
      required_cliff_tier: cliff,
      is_anchor: !!anchor_type,
      anchor_type,
    });
  }

  return rows;
}

// ── Format Guardrails ──

export interface FormatGuardrails {
  softMinMinutes?: number;
  softMaxMinutes?: number;
  requiresThreeActSpine?: boolean;
  requiresMidpointReversal?: boolean;
  requiresCliffhanger?: boolean;
  hookWindowSeconds?: [number, number];
  noFictionalization?: boolean;
}

export const FORMAT_GUARDRAILS: Record<string, FormatGuardrails> = {
  film: { softMinMinutes: 90, softMaxMinutes: 110, requiresThreeActSpine: true, requiresMidpointReversal: true },
  feature: { softMinMinutes: 90, softMaxMinutes: 110, requiresThreeActSpine: true, requiresMidpointReversal: true },
  'tv-series': { requiresThreeActSpine: false },
  'limited-series': { requiresThreeActSpine: false },
  'vertical-drama': { requiresCliffhanger: true, hookWindowSeconds: [3, 10] },
  documentary: { noFictionalization: true },
  'documentary-series': { noFictionalization: true },
  'hybrid-documentary': { noFictionalization: true },
};

export function getFormatGuardrails(format: string): FormatGuardrails {
  return FORMAT_GUARDRAILS[format] || {};
}

// ── Helpers ──

export function isDocumentaryDeliverable(deliverableType: DeliverableType): boolean {
  return deliverableType === 'documentary_outline';
}

export function isNonScriptDeliverable(deliverableType: DeliverableType): boolean {
  return deliverableType !== 'script' && deliverableType !== 'production_draft';
}

export function defaultDeliverableForDocType(docType: string): DeliverableType {
  const normalized = (docType || '').toLowerCase().trim().replace(/[\s\-]+/g, '_');
  const map: Record<string, DeliverableType> = {
    idea: 'idea',
    topline_narrative: 'topline_narrative',
    topline: 'topline_narrative',
    logline_synopsis: 'topline_narrative',
    narrative_summary: 'topline_narrative',
    concept_brief: 'concept_brief',
    logline: 'concept_brief',
    market_sheet: 'market_sheet',
    vertical_market_sheet: 'vertical_market_sheet',
    treatment: 'blueprint',
    script: 'script',
    pilot_script: 'script',
    one_pager: 'market_sheet',
    outline: 'blueprint',
    beat_sheet: 'beat_sheet',
    episode_outline: 'beat_sheet',
    episode_beat_sheet: 'vertical_episode_beats',
    season_outline: 'blueprint',
    season_arc: 'season_arc',
    blueprint: 'blueprint',
    architecture: 'architecture',
    character_bible: 'character_bible',
    production_draft: 'production_draft',
    deck_text: 'deck',
    deck: 'deck',
    documentary_outline: 'documentary_outline',
    notes: 'concept_brief',
    other: 'concept_brief',
    format_rules: 'format_rules',
    episode_grid: 'episode_grid',
    vertical_episode_grid: 'episode_grid',
    vertical_episode_beats: 'vertical_episode_beats',
    series_writer: 'series_writer',
    season_master_script: 'season_master_script',
    complete_season_script: 'season_master_script',
  };
  return map[normalized] || 'concept_brief';
}
