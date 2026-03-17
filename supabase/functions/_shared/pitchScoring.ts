/**
 * Canonical Pitch Idea Scoring Module
 * ────────────────────────────────────
 * Single source of truth for pitch-idea scoring weights, rubric text,
 * and composite score calculation. Used by generate-pitch and ci-blueprint-engine.
 *
 * ARCHITECTURAL RULE: No other file may define pitch scoring weights or
 * composite formulas. All scoring paths MUST import from this module.
 */

// ── Authoritative Weights ──────────────────────────────────────────────
export const PITCH_SCORE_WEIGHTS = {
  market_heat: 0.30,
  feasibility: 0.25,
  lane_fit: 0.20,
  saturation_risk: 0.15,
  company_fit: 0.10,
} as const;

/** Sum of weights — must equal 1.0. Used for invariant checks. */
const WEIGHT_SUM = Object.values(PITCH_SCORE_WEIGHTS).reduce((a, b) => a + b, 0);

// ── Types ──────────────────────────────────────────────────────────────
export interface PitchScorePayload {
  score_market_heat: number;
  score_feasibility: number;
  score_lane_fit: number;
  score_saturation_risk: number;
  score_company_fit: number;
}

export interface PitchScoreResult extends PitchScorePayload {
  score_total: number;
}

// ── Composite Calculator ───────────────────────────────────────────────
/**
 * Deterministic weighted composite score calculation.
 * Clamps each sub-score to [0, 100] before weighting.
 */
export function calculatePitchScoreTotal(scores: PitchScorePayload): number {
  const clamp = (v: number) => Math.max(0, Math.min(100, v));

  return (
    clamp(scores.score_market_heat) * PITCH_SCORE_WEIGHTS.market_heat +
    clamp(scores.score_feasibility) * PITCH_SCORE_WEIGHTS.feasibility +
    clamp(scores.score_lane_fit) * PITCH_SCORE_WEIGHTS.lane_fit +
    clamp(scores.score_saturation_risk) * PITCH_SCORE_WEIGHTS.saturation_risk +
    clamp(scores.score_company_fit) * PITCH_SCORE_WEIGHTS.company_fit
  );
}

// ── Score Normalizer ───────────────────────────────────────────────────
/**
 * Coerces raw LLM output into valid PitchScoreResult.
 * Ensures all fields are numbers in [0, 100] and recalculates score_total.
 */
export function normalizePitchScores(raw: Record<string, unknown>): PitchScoreResult {
  const toNum = (v: unknown): number => {
    const n = Number(v);
    return Number.isFinite(n) ? Math.max(0, Math.min(100, n)) : 0;
  };

  const payload: PitchScorePayload = {
    score_market_heat: toNum(raw.score_market_heat),
    score_feasibility: toNum(raw.score_feasibility),
    score_lane_fit: toNum(raw.score_lane_fit),
    score_saturation_risk: toNum(raw.score_saturation_risk),
    score_company_fit: toNum(raw.score_company_fit),
  };

  return {
    ...payload,
    score_total: calculatePitchScoreTotal(payload),
  };
}

// ── Rubric Text Builder ────────────────────────────────────────────────
/**
 * Returns the canonical scoring rubric text for LLM prompts.
 * Used by both generation (self-score) and independent evaluation prompts.
 */
export function buildPitchScoringRubric(options?: { includeFormulaWarning?: boolean }): string {
  const formulaStr = `(market_heat × ${PITCH_SCORE_WEIGHTS.market_heat}) + (feasibility × ${PITCH_SCORE_WEIGHTS.feasibility}) + (lane_fit × ${PITCH_SCORE_WEIGHTS.lane_fit}) + (saturation_risk × ${PITCH_SCORE_WEIGHTS.saturation_risk}) + (company_fit × ${PITCH_SCORE_WEIGHTS.company_fit})`;

  const lines = [
    `For each idea, provide weighted scores (0-100):`,
    `- score_market_heat (0-100): Current market demand for this concept. Consider genre cycles, buyer appetite, platform needs, audience trends. 90+ = urgent market gap this fills.`,
    `- score_feasibility (0-100): Production feasibility given budget band. Consider cast requirements, locations, VFX, schedule complexity. 90+ = easily producible at stated budget.`,
    `- score_lane_fit (0-100): How well this fits the stated monetization lane. Consider buyer expectations, format norms, audience positioning. 90+ = perfect lane alignment.`,
    `- score_saturation_risk (0-100): INVERSE of saturation — higher = LESS saturated/more distinctive. 90+ = highly original in current market.`,
    `- score_company_fit (0-100): Suitability for an independent production company. Consider packaging difficulty, financing complexity, sales potential. 90+ = ideal indie producer project.`,
    `- score_total: Weighted composite. Formula: ${formulaStr}. Calculate precisely.`,
  ];

  if (options?.includeFormulaWarning) {
    lines.push(`\nCRITICAL: Be rigorous. Most ideas score 50-80. Only genuinely exceptional ideas score 90+. Do not inflate.`);
  }

  return lines.join("\n");
}

// ── Invariant Check ────────────────────────────────────────────────────
/**
 * Validates that a score_total matches the canonical calculation.
 * Returns null if valid, or a warning string if drift detected.
 */
export function checkScoreDrift(
  scores: PitchScorePayload,
  reportedTotal: number,
  tolerance = 0.5,
): string | null {
  const expected = calculatePitchScoreTotal(scores);
  const diff = Math.abs(expected - reportedTotal);
  if (diff > tolerance) {
    return `score_drift: reported=${reportedTotal.toFixed(2)}, expected=${expected.toFixed(2)}, diff=${diff.toFixed(2)}`;
  }
  return null;
}

// ── Self-check: weights must sum to 1.0 ────────────────────────────────
if (Math.abs(WEIGHT_SUM - 1.0) > 0.001) {
  throw new Error(`PITCH_SCORE_WEIGHTS invariant violated: sum=${WEIGHT_SUM}, expected=1.0`);
}
