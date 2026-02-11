/**
 * Trend Viability Score Engine
 *
 * Calculates a composite Trend Score for a project by:
 * 1. Loading engine weights for the project's production type
 * 2. Applying dynamic modifiers (budget, territory, buyer)
 * 3. Normalising weights back to 1.0
 * 4. Computing: Trend Score = Σ (engine_score × adjusted_weight) × 10
 *
 * Score range: 0–100
 */

export interface TrendEngine {
  id: string;
  engine_name: string;
  engine_type: string;
  description: string;
  base_weight_default: number;
  refresh_frequency: string;
  last_refresh: string | null;
  confidence: string;
  status: string;
}

export interface EngineWeight {
  engine_id: string;
  weight_value: number;
}

export interface EngineScore {
  id: string;
  engine_id: string;
  score: number;
  confidence: string;
  source: string;
  notes: string;
  last_scored_at: string;
}

export interface DynamicModifierContext {
  budget_range: string;
  primary_territory: string;
  target_buyer?: string;
  assigned_lane?: string | null;
}

export type CyclePosition = 'Boom' | 'Growth' | 'Saturation' | 'Trough' | 'Rebound';

export interface TrendViabilityResult {
  trendScore: number;
  confidenceLevel: 'high' | 'medium' | 'low';
  cyclePosition: CyclePosition;
  engineBreakdown: {
    engineName: string;
    engineType: string;
    rawWeight: number;
    adjustedWeight: number;
    score: number;
    contribution: number;
    confidence: string;
    source: string;
    staleDays: number | null;
  }[];
  appliedModifiers: { label: string; engine: string; delta: number }[];
  totalEnginesScored: number;
  totalEngines: number;
}

// ─── Dynamic Modifier Rules ───

interface ModifierRule {
  condition: (ctx: DynamicModifierContext) => boolean;
  engineName: string;
  delta: number;
  label: string;
}

const MODIFIER_RULES: ModifierRule[] = [
  // Budget-based
  { condition: ctx => ['under-250k', 'under-50k', 'under-5k', 'under-10k', 'under-25k'].includes(ctx.budget_range), engineName: 'Box Office ROI', delta: -0.04, label: 'Low budget reduces ROI weight' },
  { condition: ctx => ['under-250k', 'under-50k', 'under-5k', 'under-10k', 'under-25k', '250k-1m', '5k-25k', '50k-250k'].includes(ctx.budget_range), engineName: 'Budget Inflation Tracker', delta: 0.02, label: 'Budget sensitivity increases inflation tracking' },
  { condition: ctx => ['50m-plus', '5m-plus', '1m-plus-ep', '10m-plus-ep', '5m-10m-ep'].includes(ctx.budget_range), engineName: 'Financing Climate Monitor', delta: 0.03, label: 'High budget increases financing sensitivity' },

  // Territory-based
  { condition: ctx => ['United Kingdom', 'UK', 'GB'].includes(ctx.primary_territory), engineName: 'Territory Incentive Tracker', delta: 0.03, label: 'UK territory boosts incentive tracking' },
  { condition: ctx => ['Canada', 'CA'].includes(ctx.primary_territory), engineName: 'Territory Incentive Tracker', delta: 0.04, label: 'Canada strong incentive regime' },
  { condition: ctx => ['Australia', 'AU', 'New Zealand', 'NZ'].includes(ctx.primary_territory), engineName: 'Territory Incentive Tracker', delta: 0.03, label: 'ANZ incentive boost' },
  { condition: ctx => ['Hungary', 'HU', 'Czech Republic', 'CZ', 'Romania', 'RO'].includes(ctx.primary_territory), engineName: 'Territory Incentive Tracker', delta: 0.04, label: 'Eastern Europe incentive boost' },

  // Buyer-based (from lane or explicit)
  { condition: ctx => ctx.assigned_lane === 'studio-streamer', engineName: 'Streamer Appetite Index', delta: 0.05, label: 'Streamer lane boosts appetite tracking' },
  { condition: ctx => ctx.assigned_lane === 'prestige-awards', engineName: 'Festival Heat Predictor', delta: 0.05, label: 'Awards lane boosts festival heat' },
  { condition: ctx => ctx.assigned_lane === 'genre-market', engineName: 'Genre Cycle Engine', delta: 0.04, label: 'Genre lane boosts cycle tracking' },
  { condition: ctx => ctx.assigned_lane === 'international-copro', engineName: 'Exportability Score', delta: 0.04, label: 'Co-pro lane boosts exportability' },
  { condition: ctx => ctx.assigned_lane === 'international-copro', engineName: 'Territory Incentive Tracker', delta: 0.03, label: 'Co-pro lane boosts incentive tracking' },
  { condition: ctx => ctx.assigned_lane === 'fast-turnaround', engineName: 'Social Engagement Velocity', delta: 0.04, label: 'Fast-turnaround boosts social velocity' },
];

// ─── Confidence Decay ───

function computeStaleDays(lastRefresh: string | null): number | null {
  if (!lastRefresh) return null;
  const diff = Date.now() - new Date(lastRefresh).getTime();
  return Math.floor(diff / (1000 * 60 * 60 * 24));
}

function confidenceDecay(engineConfidence: string, staleDays: number | null, refreshFreq: string): string {
  if (staleDays === null) return 'low';
  const maxDays: Record<string, number> = { weekly: 14, monthly: 45, quarterly: 120 };
  const limit = maxDays[refreshFreq] || 45;
  if (staleDays > limit * 2) return 'low';
  if (staleDays > limit) return 'medium';
  return engineConfidence;
}

// ─── Cycle Position ───

function determineCyclePosition(breakdown: TrendViabilityResult['engineBreakdown']): CyclePosition {
  const avgScore = breakdown.length > 0
    ? breakdown.reduce((s, e) => s + e.score, 0) / breakdown.length
    : 5;

  const genreEngine = breakdown.find(e => e.engineName === 'Genre Cycle Engine');
  const socialEngine = breakdown.find(e => e.engineName === 'Social Engagement Velocity');

  if (avgScore >= 8) return 'Boom';
  if (avgScore >= 6.5) {
    if (genreEngine && genreEngine.score < 5) return 'Saturation';
    return 'Growth';
  }
  if (avgScore >= 4.5) {
    if (socialEngine && socialEngine.score >= 7) return 'Rebound';
    return 'Saturation';
  }
  return 'Trough';
}

// ─── Main Calculator ───

export function calculateTrendViability(
  engines: TrendEngine[],
  weights: EngineWeight[],
  scores: EngineScore[],
  modifierContext: DynamicModifierContext,
): TrendViabilityResult {
  // Build weight map
  const weightMap = new Map<string, number>();
  for (const w of weights) weightMap.set(w.engine_id, w.weight_value);

  // Fallback to base_weight_default for engines not in mapping
  for (const e of engines) {
    if (!weightMap.has(e.id)) weightMap.set(e.id, e.base_weight_default);
  }

  // Apply dynamic modifiers
  const appliedModifiers: TrendViabilityResult['appliedModifiers'] = [];
  const adjustedWeights = new Map(weightMap);

  for (const rule of MODIFIER_RULES) {
    if (rule.condition(modifierContext)) {
      const engine = engines.find(e => e.engine_name === rule.engineName);
      if (engine) {
        const current = adjustedWeights.get(engine.id) || 0;
        adjustedWeights.set(engine.id, Math.max(0, current + rule.delta));
        appliedModifiers.push({ label: rule.label, engine: rule.engineName, delta: rule.delta });
      }
    }
  }

  // Normalise to 1.0
  const totalWeight = Array.from(adjustedWeights.values()).reduce((s, v) => s + v, 0);
  if (totalWeight > 0) {
    for (const [k, v] of adjustedWeights) {
      adjustedWeights.set(k, v / totalWeight);
    }
  }

  // Build score map
  const scoreMap = new Map<string, EngineScore>();
  for (const s of scores) scoreMap.set(s.engine_id, s);

  // Calculate breakdown
  const breakdown: TrendViabilityResult['engineBreakdown'] = [];
  let totalScored = 0;

  for (const engine of engines) {
    if (engine.status !== 'active') continue;

    const rawWeight = weightMap.get(engine.id) || engine.base_weight_default;
    const adjWeight = adjustedWeights.get(engine.id) || 0;
    const engineScore = scoreMap.get(engine.id);
    const score = engineScore?.score ?? 5; // default neutral
    const staleDays = computeStaleDays(engine.last_refresh);
    const effectiveConfidence = confidenceDecay(
      engineScore?.confidence || engine.confidence,
      staleDays,
      engine.refresh_frequency,
    );

    if (engineScore) totalScored++;

    breakdown.push({
      engineName: engine.engine_name,
      engineType: engine.engine_type,
      rawWeight,
      adjustedWeight: adjWeight,
      score,
      contribution: score * adjWeight,
      confidence: effectiveConfidence,
      source: engineScore?.source || 'default',
      staleDays,
    });
  }

  // Trend Score = weighted sum × 10 (scores are 0-10, we want 0-100)
  const rawScore = breakdown.reduce((s, e) => s + e.contribution, 0);
  const trendScore = Math.min(100, Math.max(0, Math.round(rawScore * 10)));

  // Overall confidence
  const highConfCount = breakdown.filter(e => e.confidence === 'high').length;
  const lowConfCount = breakdown.filter(e => e.confidence === 'low').length;
  let confidenceLevel: TrendViabilityResult['confidenceLevel'] = 'medium';
  if (highConfCount >= breakdown.length * 0.6) confidenceLevel = 'high';
  if (lowConfCount >= breakdown.length * 0.4 || totalScored < engines.length * 0.3) confidenceLevel = 'low';

  return {
    trendScore,
    confidenceLevel,
    cyclePosition: determineCyclePosition(breakdown),
    engineBreakdown: breakdown.sort((a, b) => b.contribution - a.contribution),
    appliedModifiers,
    totalEnginesScored: totalScored,
    totalEngines: engines.filter(e => e.status === 'active').length,
  };
}
