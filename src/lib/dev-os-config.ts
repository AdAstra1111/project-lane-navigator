/**
 * Dev OS Configuration — Single source of truth for the IFFY Development Operating System.
 * Defines deliverable types, behavior modes, format guardrails, and convergence thresholds.
 */

// ── Deliverable Types ──

export type DeliverableType =
  | 'idea'
  | 'concept_brief'
  | 'market_sheet'
  | 'blueprint'
  | 'architecture'
  | 'character_bible'
  | 'beat_sheet'
  | 'script'
  | 'production_draft'
  | 'deck'
  | 'documentary_outline';

export const DELIVERABLE_LABELS: Record<DeliverableType, string> = {
  idea: 'Idea',
  concept_brief: 'Concept Brief',
  market_sheet: 'Market Sheet',
  blueprint: 'Blueprint',
  architecture: 'Architecture',
  character_bible: 'Character Bible',
  beat_sheet: 'Beat Sheet',
  script: 'Script',
  production_draft: 'Production Draft',
  deck: 'Deck',
  documentary_outline: 'Documentary Outline',
};

export const DELIVERABLE_PIPELINE_ORDER: DeliverableType[] = [
  'idea',
  'concept_brief',
  'market_sheet',
  'blueprint',
  'architecture',
  'character_bible',
  'beat_sheet',
  'script',
  'production_draft',
];

// ── Development Behavior ──

export type DevelopmentBehavior = 'efficiency' | 'market' | 'prestige';

export const BEHAVIOR_LABELS: Record<DevelopmentBehavior, string> = {
  efficiency: 'Efficiency',
  market: 'Market',
  prestige: 'Prestige',
};

export const BEHAVIOR_COLORS: Record<DevelopmentBehavior, string> = {
  efficiency: 'bg-sky-500/15 text-sky-400 border-sky-500/30',
  market: 'bg-amber-500/15 text-amber-400 border-amber-500/30',
  prestige: 'bg-purple-500/15 text-purple-400 border-purple-500/30',
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
};

export type ConvergenceStatus = 'Not Started' | 'In Progress' | 'Converged';

export function computeConvergenceStatus(
  ciScore: number | null,
  gpScore: number | null,
  gap: number | null,
  allowedGap: number,
  behavior: DevelopmentBehavior = 'market',
  rewriteCycles: number = 0,
): ConvergenceStatus {
  if (ciScore == null || gpScore == null) return 'Not Started';
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

export interface EpisodeGridRow {
  episode: number;
  act: number;
  escalation_intensity: 'low' | 'medium' | 'high' | 'peak';
  required_cliff_tier: 'soft' | 'hard' | 'ultimate';
  is_anchor: boolean;
  anchor_type?: 'reveal' | 'midpoint' | 'pre_finale' | 'finale';
}

export function buildEpisodeGrid(arch: SeasonArchitecture, durationSeconds: number, behavior: DevelopmentBehavior = 'market'): EpisodeGridRow[] {
  const { acts, anchors, episode_count } = arch;
  const rows: EpisodeGridRow[] = [];

  for (let ep = 1; ep <= episode_count; ep++) {
    const act = acts.find(a => ep >= a.start_episode && ep <= a.end_episode)!;
    const progress = ep / episode_count;

    let escalation: EpisodeGridRow['escalation_intensity'] = 'low';
    if (progress > 0.75) escalation = 'peak';
    else if (progress > 0.5) escalation = 'high';
    else if (progress > 0.25) escalation = 'medium';

    let cliff: EpisodeGridRow['required_cliff_tier'] = 'soft';
    if (ep === anchors.finale_index) cliff = 'ultimate';
    else if (ep === anchors.mid_index || ep === anchors.pre_finale_index) cliff = 'hard';
    else if (progress > 0.5) cliff = 'hard';

    let anchor_type: EpisodeGridRow['anchor_type'] | undefined;
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
  const normalized = (docType || '').toLowerCase().trim();
  const map: Record<string, DeliverableType> = {
    idea: 'idea',
    concept_brief: 'concept_brief',
    'concept brief': 'concept_brief',
    logline: 'concept_brief',
    market_sheet: 'market_sheet',
    'market sheet': 'market_sheet',
    treatment: 'blueprint',
    script: 'script',
    pilot_script: 'script',
    'pilot script': 'script',
    one_pager: 'market_sheet',
    outline: 'beat_sheet',
    beat_sheet: 'beat_sheet',
    'beat sheet': 'beat_sheet',
    blueprint: 'blueprint',
    architecture: 'architecture',
    character_bible: 'character_bible',
    'character bible': 'character_bible',
    production_draft: 'production_draft',
    'production draft': 'production_draft',
    deck_text: 'deck',
    deck: 'deck',
    documentary_outline: 'documentary_outline',
    'documentary outline': 'documentary_outline',
    notes: 'concept_brief',
    other: 'concept_brief',
  };
  return map[normalized] || 'script';
}
