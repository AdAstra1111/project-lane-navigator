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
  const map: Record<string, DeliverableType> = {
    idea: 'idea',
    logline: 'concept_brief',
    treatment: 'blueprint',
    script: 'script',
    one_pager: 'market_sheet',
    outline: 'beat_sheet',
    blueprint: 'blueprint',
    architecture: 'architecture',
    deck_text: 'deck',
    notes: 'concept_brief',
    other: 'concept_brief',
  };
  return map[docType] || 'script';
}
