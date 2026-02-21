import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

// ---- State Layer Types ----

interface CreativeState {
  format: string;
  runtime_minutes: number;
  episode_count: number;
  structural_density: number;
  character_density: number;
  hook_intensity: number;
  tone_classification: string;
  behaviour_mode: string;
}

interface ExecutionState {
  setup_count: number;
  coverage_density: number;
  movement_intensity: number;
  lighting_complexity: number;
  night_exterior_ratio: number;
  vfx_stunt_density: number;
  editorial_fragility: number;
  equipment_load_multiplier: number;
}

interface ProductionState {
  estimated_shoot_days: number;
  crew_intensity_band: string;
  schedule_compression_risk: number;
  location_clustering: number;
  weather_exposure: number;
  overtime_probability: number;
}

interface FinanceState {
  budget_band: string;
  budget_estimate: number;
  budget_elasticity: number;
  drift_sensitivity: number;
  insurance_load_proxy: number;
  capital_stack_stress: number;
}

interface RevenueState {
  roi_probability_bands: { low: number; mid: number; high: number };
  downside_exposure: number;
  upside_potential: number;
  platform_appetite_strength: number;
  comparable_alignment_delta: number;
  confidence_score: number;
}

interface CascadedState {
  creative_state: CreativeState;
  execution_state: ExecutionState;
  production_state: ProductionState;
  finance_state: FinanceState;
  revenue_state: RevenueState;
}

interface StateOverrides {
  creative_state?: Partial<CreativeState>;
  execution_state?: Partial<ExecutionState>;
  production_state?: Partial<ProductionState>;
  finance_state?: Partial<FinanceState>;
  revenue_state?: Partial<RevenueState>;
}

// ---- Helpers ----

function isPlainObject(val: unknown): val is Record<string, unknown> {
  return (
    val !== null &&
    typeof val === "object" &&
    !Array.isArray(val) &&
    !(val instanceof Date) &&
    Object.getPrototypeOf(val) === Object.prototype
  );
}

function deepMerge<T extends Record<string, unknown>>(
  base: T,
  patch: Record<string, unknown>,
): T {
  const result: Record<string, unknown> = { ...base };
  for (const key of Object.keys(patch)) {
    const pv = patch[key];
    // Skip undefined values in patch — do not overwrite with undefined
    if (pv === undefined) continue;
    const bv = (base as Record<string, unknown>)[key];
    if (isPlainObject(bv) && isPlainObject(pv)) {
      result[key] = deepMerge(
        bv as Record<string, unknown>,
        pv as Record<string, unknown>,
      );
    } else {
      // null overwrites, scalars overwrite, arrays overwrite
      result[key] = pv;
    }
  }
  return result as T;
}

function hashStringToInt32(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) {
    h = ((h << 5) - h + s.charCodeAt(i)) | 0;
  }
  return Math.abs(h);
}

function resolveSeed(
  seedParam: number | string | undefined,
  fallback: string,
): number {
  if (typeof seedParam === "number") return Math.abs(seedParam) || 1;
  if (typeof seedParam === "string") return hashStringToInt32(seedParam) || 1;
  return hashStringToInt32(fallback) || 1;
}

// ---- Lock key normalization ----

const LAYER_KEY_MAP: Record<string, string> = {};

function buildLayerKeyMap(
  tunableCreative: Record<string, unknown>,
  tunableExecution: Record<string, unknown>,
  tunableProduction: Record<string, unknown>,
) {
  for (const k of Object.keys(tunableCreative))
    LAYER_KEY_MAP[k] = "creative_state." + k;
  LAYER_KEY_MAP["behaviour_mode"] = "creative_state.behaviour_mode";
  for (const k of Object.keys(tunableExecution))
    LAYER_KEY_MAP[k] = "execution_state." + k;
  for (const k of Object.keys(tunableProduction))
    LAYER_KEY_MAP[k] = "production_state." + k;
}

function normalizeLockKeys(raw: string[]): string[] {
  return raw.map((k) => {
    // Already canonical path
    if (k.includes(".")) return k;
    // Bare key — look up
    return LAYER_KEY_MAP[k] || k;
  });
}

// ---- Cascade Logic (deterministic, no LLM) ----

function cascadeCreativeToExecution(c: CreativeState): Partial<ExecutionState> {
  const baseSetups = c.runtime_minutes * 0.8;
  const densityMultiplier = 1 + (c.structural_density - 5) * 0.1;
  return {
    setup_count: Math.round(baseSetups * densityMultiplier),
    coverage_density: Math.min(
      10,
      c.structural_density * 0.8 + c.hook_intensity * 0.2,
    ),
    movement_intensity: Math.min(
      10,
      c.hook_intensity * 0.7 + c.structural_density * 0.3,
    ),
    lighting_complexity:
      c.tone_classification === "noir" || c.tone_classification === "thriller"
        ? 8
        : 5,
    editorial_fragility: Math.min(
      10,
      c.character_density * 0.4 + c.structural_density * 0.6,
    ),
    equipment_load_multiplier: 1 + (c.hook_intensity - 5) * 0.05,
  };
}

function cascadeExecutionToProduction(
  e: ExecutionState,
): Partial<ProductionState> {
  const baseDays = Math.ceil(e.setup_count / 25);
  const nightPenalty = 1 + e.night_exterior_ratio * 0.3;
  return {
    estimated_shoot_days: Math.round(baseDays * nightPenalty),
    crew_intensity_band:
      e.equipment_load_multiplier > 1.3
        ? "premium"
        : e.equipment_load_multiplier > 1.15
          ? "heavy"
          : e.equipment_load_multiplier > 1.0
            ? "standard"
            : "lean",
    schedule_compression_risk: Math.min(
      10,
      Math.max(
        0,
        (e.setup_count / Math.max(1, baseDays) - 20) * 0.5 +
          e.vfx_stunt_density * 0.3,
      ),
    ),
    overtime_probability: Math.min(
      1,
      (e.movement_intensity + e.lighting_complexity) / 20 +
        e.night_exterior_ratio * 0.2,
    ),
  };
}

function cascadeProductionToFinance(
  p: ProductionState,
  creative: CreativeState,
): Partial<FinanceState> {
  const crewCostMap: Record<string, number> = {
    lean: 0.7,
    standard: 1.0,
    heavy: 1.4,
    premium: 2.0,
  };
  const crewMult = crewCostMap[p.crew_intensity_band] || 1.0;
  const baseBudget = p.estimated_shoot_days * 50000 * crewMult;
  const budgetBand =
    baseBudget < 1_000_000
      ? "micro"
      : baseBudget < 5_000_000
        ? "low"
        : baseBudget < 15_000_000
          ? "mid"
          : baseBudget < 40_000_000
            ? "mid-high"
            : "high";
  return {
    budget_band: budgetBand,
    budget_estimate: Math.round(baseBudget),
    budget_elasticity: Math.max(0, 10 - p.schedule_compression_risk),
    drift_sensitivity: Math.min(
      10,
      p.schedule_compression_risk * 0.6 + p.overtime_probability * 10 * 0.4,
    ),
    insurance_load_proxy: Math.min(
      10,
      p.weather_exposure * 0.4 +
        p.overtime_probability * 10 * 0.3 +
        (creative.hook_intensity > 7 ? 3 : 0),
    ),
    capital_stack_stress: Math.min(
      10,
      (baseBudget > 20_000_000
        ? 7
        : baseBudget > 10_000_000
          ? 5
          : 3) +
        p.schedule_compression_risk * 0.2,
    ),
  };
}

function cascadeFinanceToRevenue(
  f: FinanceState,
  creative: CreativeState,
): Partial<RevenueState> {
  const hookBonus =
    creative.hook_intensity > 7 ? 2 : creative.hook_intensity > 5 ? 1 : 0;
  const baseConfidence =
    50 +
    hookBonus * 5 -
    f.capital_stack_stress * 3 -
    f.drift_sensitivity * 2;
  return {
    roi_probability_bands: {
      low: Math.max(0, baseConfidence - 20),
      mid: Math.max(0, baseConfidence),
      high: Math.min(100, baseConfidence + 15),
    },
    downside_exposure: Math.min(
      10,
      f.capital_stack_stress * 0.5 + f.drift_sensitivity * 0.5,
    ),
    upside_potential: Math.min(
      10,
      creative.hook_intensity * 0.5 +
        (10 - f.capital_stack_stress) * 0.3 +
        hookBonus,
    ),
    platform_appetite_strength: Math.min(
      10,
      creative.hook_intensity * 0.4 +
        (creative.behaviour_mode === "commercial"
          ? 3
          : creative.behaviour_mode === "prestige"
            ? 2
            : 1),
    ),
    confidence_score: Math.max(
      0,
      Math.min(100, Math.round(baseConfidence)),
    ),
  };
}

function runFullCascade(
  creative: CreativeState,
  overrides: StateOverrides = {},
): CascadedState {
  const execBase = cascadeCreativeToExecution(creative);
  const execution: ExecutionState = {
    setup_count: 0,
    coverage_density: 0,
    movement_intensity: 0,
    lighting_complexity: 5,
    night_exterior_ratio: 0.1,
    vfx_stunt_density: 0,
    editorial_fragility: 5,
    equipment_load_multiplier: 1.0,
    ...execBase,
    ...overrides.execution_state,
  };

  const prodBase = cascadeExecutionToProduction(execution);
  const production: ProductionState = {
    estimated_shoot_days: 25,
    crew_intensity_band: "standard",
    schedule_compression_risk: 5,
    location_clustering: 5,
    weather_exposure: 3,
    overtime_probability: 0.2,
    ...prodBase,
    ...overrides.production_state,
  };

  const finBase = cascadeProductionToFinance(production, creative);
  const finance: FinanceState = {
    budget_band: "mid",
    budget_estimate: 0,
    budget_elasticity: 5,
    drift_sensitivity: 5,
    insurance_load_proxy: 3,
    capital_stack_stress: 5,
    ...finBase,
    ...overrides.finance_state,
  };

  const revBase = cascadeFinanceToRevenue(finance, creative);
  const revenue: RevenueState = {
    roi_probability_bands: { low: 30, mid: 50, high: 65 },
    downside_exposure: 5,
    upside_potential: 5,
    platform_appetite_strength: 5,
    comparable_alignment_delta: 0,
    confidence_score: 50,
    ...revBase,
    ...overrides.revenue_state,
  };

  return {
    creative_state: creative,
    execution_state: execution,
    production_state: production,
    finance_state: finance,
    revenue_state: revenue,
  };
}

function generateConfidenceBands(state: CascadedState) {
  return {
    budget: {
      low: Math.round(state.finance_state.budget_estimate * 0.85),
      mid: state.finance_state.budget_estimate,
      high: Math.round(state.finance_state.budget_estimate * 1.2),
    },
    shoot_days: {
      low: Math.max(1, state.production_state.estimated_shoot_days - 5),
      mid: state.production_state.estimated_shoot_days,
      high: state.production_state.estimated_shoot_days + 8,
    },
    confidence: state.revenue_state.confidence_score,
  };
}

function diffNumberObject(
  from: Record<string, number> | undefined,
  to: Record<string, number> | undefined,
): Record<string, { from: number; to: number; delta: number }> | null {
  if (!from || !to) return null;
  const result: Record<string, { from: number; to: number; delta: number }> =
    {};
  for (const key of new Set([...Object.keys(from), ...Object.keys(to)])) {
    const fv = typeof from[key] === "number" ? from[key] : 0;
    const tv = typeof to[key] === "number" ? to[key] : 0;
    if (fv !== tv) {
      result[key] = { from: fv, to: tv, delta: +(tv - fv).toFixed(2) };
    }
  }
  return Object.keys(result).length > 0 ? result : null;
}

function computeDelta(
  baseline: CascadedState,
  computed: CascadedState,
): Record<string, unknown> {
  const delta: Record<string, unknown> = {};
  for (const layer of [
    "creative_state",
    "execution_state",
    "production_state",
    "finance_state",
    "revenue_state",
  ] as const) {
    const b = (baseline as Record<string, unknown>)[layer] as
      | Record<string, unknown>
      | undefined;
    const c = (computed as Record<string, unknown>)[layer] as
      | Record<string, unknown>
      | undefined;
    if (!b || !c) continue;
    const layerDelta: Record<string, unknown> = {};
    for (const key of new Set([...Object.keys(b), ...Object.keys(c)])) {
      const bv = b[key];
      const cv = c[key];
      if (
        isPlainObject(cv) &&
        isPlainObject(bv)
      ) {
        const nested = diffNumberObject(
          bv as Record<string, number>,
          cv as Record<string, number>,
        );
        if (nested) layerDelta[key] = nested;
      } else if (
        typeof cv === "number" &&
        typeof bv === "number" &&
        cv !== bv
      ) {
        layerDelta[key] = {
          from: bv,
          to: cv,
          delta: +(cv - bv).toFixed(2),
        };
      } else if (typeof cv === "string" && cv !== bv) {
        layerDelta[key] = { from: bv, to: cv };
      }
    }
    if (Object.keys(layerDelta).length > 0) delta[layer] = layerDelta;
  }
  return delta;
}

function checkCoherence(overrides: StateOverrides): string[] {
  const flags: string[] = [];
  const exec = overrides.execution_state || {};
  const prod = overrides.production_state || {};
  const fin = overrides.finance_state || {};

  if (
    (exec.setup_count ?? 0) > 200 &&
    prod.estimated_shoot_days != null &&
    prod.estimated_shoot_days < 15
  ) {
    flags.push(
      "High setup count with very short schedule — likely unrealistic",
    );
  }
  if (fin.budget_band === "micro" && (exec.vfx_stunt_density ?? 0) > 7) {
    flags.push("Micro budget with high VFX density — funding gap risk");
  }
  if (
    (prod.overtime_probability ?? 0) > 0.7 &&
    (fin.drift_sensitivity ?? 999) < 3
  ) {
    flags.push(
      "High overtime probability but low drift sensitivity — underestimating budget risk",
    );
  }
  return flags;
}

async function syncGraphToState(
  supabase: ReturnType<typeof createClient>,
  projectId: string,
  cascaded: CascadedState,
  bands: ReturnType<typeof generateConfidenceBands>,
) {
  await supabase
    .from("project_state_graphs")
    .update({
      ...cascaded,
      confidence_bands: bands,
      last_cascade_at: new Date().toISOString(),
    })
    .eq("project_id", projectId);
}

// ---- Shared Rank Scoring ----

const budgetPenaltyMap: Record<string, number> = {
  micro: 0,
  low: 1,
  mid: 2,
  "mid-high": 3,
  high: 4,
};

interface RankResult {
  score: number;
  breakdown: Record<string, number>;
}

function computeRankScore(cs: CascadedState): RankResult | null {
  if (!cs?.revenue_state || !cs?.finance_state || !cs?.production_state)
    return null;

  const confidence = cs.revenue_state.confidence_score ?? 50;
  const downside = cs.revenue_state.downside_exposure ?? 5;
  const drift = cs.finance_state.drift_sensitivity ?? 5;
  const stress = cs.finance_state.capital_stack_stress ?? 5;
  const scheduleRisk = cs.production_state.schedule_compression_risk ?? 5;
  const appetite = cs.revenue_state.platform_appetite_strength ?? 5;
  const budgetBand = cs.finance_state.budget_band ?? "mid";
  const budgetPenalty = budgetPenaltyMap[budgetBand] ?? 2;

  const confidenceComponent = confidence * 0.45;
  const appetiteComponent = appetite * 10 * 0.2;
  const downsideComponent = (10 - downside) * 10 * 0.1;
  const stressComponent = (10 - stress) * 10 * 0.1;
  const driftComponent = (10 - drift) * 10 * 0.1;
  const scheduleComponent = (10 - scheduleRisk) * 10 * 0.05;
  const penalty = budgetPenalty * 2;

  const raw =
    confidenceComponent +
    appetiteComponent +
    downsideComponent +
    stressComponent +
    driftComponent +
    scheduleComponent -
    penalty;
  const score =
    Math.round(Math.max(0, Math.min(100, raw)) * 10) / 10;

  return {
    score,
    breakdown: {
      confidence: Math.round(confidenceComponent * 10) / 10,
      appetite: Math.round(appetiteComponent * 10) / 10,
      downside_safety: Math.round(downsideComponent * 10) / 10,
      stress_safety: Math.round(stressComponent * 10) / 10,
      drift_safety: Math.round(driftComponent * 10) / 10,
      schedule_safety: Math.round(scheduleComponent * 10) / 10,
      budget_penalty: -penalty,
      final_score: score,
    },
  };
}

// ---- Shared Forward Projection (deterministic) ----

interface ProjectionAssumptions {
  inflation_rate: number;
  schedule_slip_risk: number;
  platform_appetite_decay: number;
}

interface MonthlyPoint {
  month: number;
  budget_estimate: number;
  confidence_score: number;
  downside_exposure: number;
  capital_stack_stress: number;
  schedule_compression_risk: number;
}

interface ProjectionResult {
  series: MonthlyPoint[];
  projection_risk_score: number;
  summary: string[];
}

function clampAssumptions(raw: Partial<ProjectionAssumptions>): {
  assumptions: ProjectionAssumptions;
  normalized: boolean;
} {
  let normalized = false;
  const clamp = (v: number | undefined, def: number, lo: number, hi: number) => {
    const val = v ?? def;
    if (val < lo || val > hi) {
      normalized = true;
      return Math.max(lo, Math.min(hi, val));
    }
    return val;
  };
  return {
    assumptions: {
      inflation_rate: clamp(raw.inflation_rate, 0.03, 0, 0.2),
      schedule_slip_risk: clamp(raw.schedule_slip_risk, 0.15, 0, 1),
      platform_appetite_decay: clamp(raw.platform_appetite_decay, 0.05, 0, 0.3),
    },
    normalized,
  };
}

function runForwardProjection(
  cs: CascadedState,
  months: number,
  assumptions: ProjectionAssumptions,
): ProjectionResult {
  const series: MonthlyPoint[] = [];
  let budget = cs.finance_state.budget_estimate;
  let confidence = cs.revenue_state.confidence_score;
  let downside = cs.revenue_state.downside_exposure;
  let stress = cs.finance_state.capital_stack_stress;
  let scheduleRisk = cs.production_state.schedule_compression_risk;
  const driftSens = cs.finance_state.drift_sensitivity;
  const hookInt = cs.creative_state.hook_intensity;

  series.push({
    month: 0,
    budget_estimate: Math.round(budget),
    confidence_score: Math.round(confidence * 10) / 10,
    downside_exposure: Math.round(downside * 100) / 100,
    capital_stack_stress: Math.round(stress * 100) / 100,
    schedule_compression_risk: Math.round(scheduleRisk * 100) / 100,
  });

  for (let m = 1; m <= months; m++) {
    budget *= 1 + assumptions.inflation_rate * (1 + driftSens / 10);

    const baseDecay =
      assumptions.platform_appetite_decay * 100 * (stress / 10) +
      assumptions.schedule_slip_risk * 100 * (scheduleRisk / 10);
    const hookRecovery =
      hookInt > 7 && stress < 4
        ? 0.5
        : hookInt > 5 && stress < 6
          ? 0.2
          : 0;
    confidence = Math.max(
      0,
      Math.min(100, confidence - baseDecay + hookRecovery),
    );

    downside = Math.min(
      10,
      downside +
        (driftSens * 0.02 + scheduleRisk * 0.015) *
          assumptions.schedule_slip_risk *
          10,
    );

    stress = Math.min(10, stress + assumptions.inflation_rate * 0.5);
    scheduleRisk = Math.min(
      10,
      scheduleRisk + assumptions.schedule_slip_risk * 0.3,
    );

    series.push({
      month: m,
      budget_estimate: Math.round(budget),
      confidence_score: Math.round(confidence * 10) / 10,
      downside_exposure: Math.round(downside * 100) / 100,
      capital_stack_stress: Math.round(stress * 100) / 100,
      schedule_compression_risk: Math.round(scheduleRisk * 100) / 100,
    });
  }

  const endState = series[series.length - 1];
  const startState = series[0];

  const confidenceDrop = Math.max(
    0,
    startState.confidence_score - endState.confidence_score,
  );
  const budgetInflation =
    ((endState.budget_estimate - startState.budget_estimate) /
      Math.max(1, startState.budget_estimate)) *
    100;
  const downsideGrowth =
    (endState.downside_exposure - startState.downside_exposure) * 10;

  const projectionRiskScore =
    Math.round(
      Math.min(
        100,
        Math.max(
          0,
          confidenceDrop * 0.4 +
            budgetInflation * 0.3 +
            downsideGrowth * 0.2 +
            endState.capital_stack_stress * 1.0,
        ),
      ) * 10,
    ) / 10;

  const summaryBullets: string[] = [];
  summaryBullets.push(
    `Confidence trend: ${confidenceDrop > 0 ? "down" : "stable"} ${Math.abs(Math.round(confidenceDrop))}pts over ${months}mo`,
  );
  summaryBullets.push(
    `Budget inflation: +${budgetInflation.toFixed(1)}% ($${(startState.budget_estimate / 1e6).toFixed(1)}M → $${(endState.budget_estimate / 1e6).toFixed(1)}M)`,
  );

  if (endState.downside_exposure > 7) {
    summaryBullets.push(
      "Main driver of risk: high downside exposure at projection end",
    );
  } else if (endState.capital_stack_stress > 7) {
    summaryBullets.push(
      "Main driver of risk: capital stack stress accumulation",
    );
  } else if (confidenceDrop > 15) {
    summaryBullets.push(
      "Main driver of risk: significant confidence erosion",
    );
  } else {
    summaryBullets.push(
      "Risk profile: moderate — within manageable bounds",
    );
  }

  return {
    series,
    projection_risk_score: projectionRiskScore,
    summary: summaryBullets,
  };
}

// ---- Drift Alert Generation ----

type DriftAlertItem = {
  alert_type: string;
  severity: string;
  layer: string;
  metric_key: string;
  current_value: number;
  threshold: number;
  message: string;
};

function generateDriftAlerts(cascaded: CascadedState): DriftAlertItem[] {
  const alerts: DriftAlertItem[] = [];
  if (cascaded.production_state.schedule_compression_risk > 7) {
    alerts.push({
      alert_type: "schedule_drift",
      severity: "warning",
      layer: "production",
      metric_key: "schedule_compression_risk",
      current_value: cascaded.production_state.schedule_compression_risk,
      threshold: 7,
      message: "Schedule compression risk exceeds safe threshold",
    });
  }
  if (cascaded.finance_state.capital_stack_stress > 7) {
    alerts.push({
      alert_type: "budget_drift",
      severity: "warning",
      layer: "finance",
      metric_key: "capital_stack_stress",
      current_value: cascaded.finance_state.capital_stack_stress,
      threshold: 7,
      message: "Capital stack stress is elevated",
    });
  }
  if (cascaded.revenue_state.confidence_score < 30) {
    alerts.push({
      alert_type: "revenue_risk",
      severity: "critical",
      layer: "revenue",
      metric_key: "confidence_score",
      current_value: cascaded.revenue_state.confidence_score,
      threshold: 30,
      message: "Revenue confidence below critical threshold",
    });
  }
  return alerts;
}

// ---- Seeded PRNG (Mulberry32) ----

function mulberry32(seed: number) {
  let s = seed | 0;
  return () => {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ---- Optimizer Tunables ----

const tunableCreative: Record<string, [number, number, number]> = {
  hook_intensity: [1, 10, 0.5],
  structural_density: [1, 10, 0.5],
  character_density: [1, 10, 0.5],
  runtime_minutes: [30, 240, 10],
  episode_count: [1, 200, 1],
};
const tunableExecution: Record<string, [number, number, number]> = {
  night_exterior_ratio: [0, 1, 0.05],
  vfx_stunt_density: [0, 10, 0.5],
};
const tunableProduction: Record<string, [number, number, number]> = {
  location_clustering: [1, 10, 0.5],
  weather_exposure: [0, 10, 0.5],
};
const behaviourModes = ["market", "prestige", "commercial", "efficiency"];

// Initialize layer key map for lock-key normalization
buildLayerKeyMap(tunableCreative, tunableExecution, tunableProduction);

// ---- Optimizer Candidate Validation ----

function isCandidateValid(cascaded: CascadedState): boolean {
  const c = cascaded.creative_state;
  const e = cascaded.execution_state;
  const f = cascaded.finance_state;
  if (c.runtime_minutes < 30 || c.runtime_minutes > 240) return false;
  if (c.episode_count < 1 || c.episode_count > 200) return false;
  if (e.night_exterior_ratio < 0 || e.night_exterior_ratio > 1) return false;
  if (e.vfx_stunt_density < 0 || e.vfx_stunt_density > 10) return false;
  if (f.budget_estimate <= 0) return false;
  return true;
}

// ---- Self-Test Suite ----

interface TestResult {
  name: string;
  ok: boolean;
  details: string;
}

function runSelfTestSuite(finalSeed: number): {
  ok: boolean;
  seed_used: number;
  tests: TestResult[];
  timings_ms: Record<string, number>;
} {
  const t0 = performance.now();
  const tests: TestResult[] = [];
  const timings: Record<string, number> = {};

  // 1) Rank score monotonicity — higher hook_intensity should not decrease rank_score
  {
    const t1 = performance.now();
    const baseCreative: CreativeState = {
      format: "film",
      runtime_minutes: 100,
      episode_count: 1,
      structural_density: 5,
      character_density: 5,
      hook_intensity: 5,
      tone_classification: "drama",
      behaviour_mode: "market",
    };
    const cs1 = runFullCascade(baseCreative);
    const r1 = computeRankScore(cs1);

    const boostedCreative: CreativeState = { ...baseCreative, hook_intensity: 7 };
    const cs2 = runFullCascade(boostedCreative);
    const r2 = computeRankScore(cs2);

    const ok = !!(r1 && r2 && r2.score >= r1.score - 0.5);
    tests.push({
      name: "rank_score_monotonicity",
      ok,
      details: `hook 5 → rank ${r1?.score}, hook 7 → rank ${r2?.score}`,
    });
    timings["rank_score_monotonicity"] = Math.round(performance.now() - t1);
  }

  // 2) Projection trend — budget should increase with positive inflation
  {
    const t1 = performance.now();
    const baseCreative: CreativeState = {
      format: "film",
      runtime_minutes: 100,
      episode_count: 1,
      structural_density: 5,
      character_density: 5,
      hook_intensity: 5,
      tone_classification: "drama",
      behaviour_mode: "market",
    };
    const cs = runFullCascade(baseCreative);
    const proj = runForwardProjection(cs, 12, {
      inflation_rate: 0.03,
      schedule_slip_risk: 0.15,
      platform_appetite_decay: 0.05,
    });
    const start = proj.series[0].budget_estimate;
    const end = proj.series[proj.series.length - 1].budget_estimate;
    const ok = end > start;
    tests.push({
      name: "projection_budget_inflates",
      ok,
      details: `start=$${start}, end=$${end}, inflation_rate=0.03`,
    });
    timings["projection_budget_inflates"] = Math.round(performance.now() - t1);
  }

  // 3) Lock keys respected — optimizer must not change locked key
  {
    const t1 = performance.now();
    const seedCreative: CreativeState = {
      format: "film",
      runtime_minutes: 100,
      episode_count: 1,
      structural_density: 5,
      character_density: 5,
      hook_intensity: 6,
      tone_classification: "drama",
      behaviour_mode: "market",
    };
    const lockKeys = ["creative_state.hook_intensity"];
    const rng = mulberry32(finalSeed);
    const projAssumptions: ProjectionAssumptions = {
      inflation_rate: 0.03,
      schedule_slip_risk: 0.15,
      platform_appetite_decay: 0.05,
    };

    let lockViolated = false;
    for (let i = 0; i < 20; i++) {
      const creativeOverrides: Partial<CreativeState> = {};
      const executionOverrides: Partial<ExecutionState> = {};
      const productionOverrides: Partial<ProductionState> = {};

      const allKeys = [
        ...Object.keys(tunableCreative).map(
          (k) => ["creative", "creative_state." + k] as const,
        ),
        ...Object.keys(tunableExecution).map(
          (k) => ["execution", "execution_state." + k] as const,
        ),
        ...Object.keys(tunableProduction).map(
          (k) => ["production", "production_state." + k] as const,
        ),
        ["creative", "creative_state.behaviour_mode"] as const,
      ].filter(([, path]) => !lockKeys.includes(path));

      const numChanges = 2 + Math.floor(rng() * 3);
      const shuffled = [...allKeys]
        .sort(() => rng() - 0.5)
        .slice(0, numChanges);

      for (const [layer, path] of shuffled) {
        const key = path.split(".")[1];
        if (key === "behaviour_mode") {
          (creativeOverrides as Record<string, unknown>).behaviour_mode =
            behaviourModes[Math.floor(rng() * behaviourModes.length)];
          continue;
        }
        if (layer === "creative" && tunableCreative[key]) {
          const [min, max, step] = tunableCreative[key];
          const steps = Math.round((max - min) / step);
          (creativeOverrides as Record<string, unknown>)[key] =
            min + Math.round(rng() * steps) * step;
        } else if (layer === "execution" && tunableExecution[key]) {
          const [min, max, step] = tunableExecution[key];
          const steps = Math.round((max - min) / step);
          (executionOverrides as Record<string, unknown>)[key] =
            min + Math.round(rng() * steps) * step;
        } else if (layer === "production" && tunableProduction[key]) {
          const [min, max, step] = tunableProduction[key];
          const steps = Math.round((max - min) / step);
          (productionOverrides as Record<string, unknown>)[key] =
            min + Math.round(rng() * steps) * step;
        }
      }

      // Check if hook_intensity was changed
      if ("hook_intensity" in creativeOverrides) {
        lockViolated = true;
        break;
      }
    }

    tests.push({
      name: "lock_keys_respected",
      ok: !lockViolated,
      details: lockViolated
        ? "hook_intensity was modified despite lock"
        : "hook_intensity stayed locked across 20 iterations",
    });
    timings["lock_keys_respected"] = Math.round(performance.now() - t1);
  }

  // 4) Determinism — same seed produces same rank score
  {
    const t1 = performance.now();
    const baseCreative: CreativeState = {
      format: "film",
      runtime_minutes: 100,
      episode_count: 1,
      structural_density: 5,
      character_density: 5,
      hook_intensity: 5,
      tone_classification: "drama",
      behaviour_mode: "market",
    };
    const cs1 = runFullCascade(baseCreative);
    const cs2 = runFullCascade(baseCreative);
    const r1 = computeRankScore(cs1);
    const r2 = computeRankScore(cs2);
    const ok = r1?.score === r2?.score;
    tests.push({
      name: "determinism_cascade",
      ok: !!ok,
      details: `run1=${r1?.score}, run2=${r2?.score}`,
    });
    timings["determinism_cascade"] = Math.round(performance.now() - t1);
  }

  // 5) Deep merge correctness
  {
    const t1 = performance.now();
    const base = { a: 1, b: { c: 2, d: 3 }, e: [1, 2] };
    const patch = { b: { c: 99 }, e: [3], f: "new" };
    const merged = deepMerge(base as Record<string, unknown>, patch as Record<string, unknown>);
    const ok =
      (merged as Record<string, unknown>).a === 1 &&
      ((merged as Record<string, unknown>).b as Record<string, unknown>).c === 99 &&
      ((merged as Record<string, unknown>).b as Record<string, unknown>).d === 3 &&
      Array.isArray((merged as Record<string, unknown>).e) &&
      ((merged as Record<string, unknown>).e as number[])[0] === 3 &&
      (merged as Record<string, unknown>).f === "new";
    tests.push({
      name: "deep_merge_correctness",
      ok,
      details: `merged=${JSON.stringify(merged)}`,
    });
    timings["deep_merge_correctness"] = Math.round(performance.now() - t1);
  }

  timings["total"] = Math.round(performance.now() - t0);

  return {
    ok: tests.every((t) => t.ok),
    seed_used: finalSeed,
    tests,
    timings_ms: timings,
  };
}

// ---- Request Handler ----

Deno.serve(async (req) => {
  if (req.method === "OPTIONS")
    return new Response(null, { headers: corsHeaders });

  const json = (data: unknown, status = 200) =>
    new Response(JSON.stringify(data), {
      status,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

  try {
    // ── Auth: verify JWT and get user ──
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return json({ error: "Unauthorized" }, 401);
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } },
    );

    const {
      data: { user },
      error: userErr,
    } = await supabase.auth.getUser();
    if (userErr || !user) {
      return json({ error: "Unauthorized" }, 401);
    }
    const userId = user.id;

    const body = await req.json();
    const {
      action,
      projectId,
      scenarioId,
      overrides,
      creativeState,
    } = body as {
      action: string;
      projectId: string;
      scenarioId?: string;
      overrides?: StateOverrides;
      creativeState?: Partial<CreativeState>;
    };

    if (!projectId) {
      return json({ error: "projectId required" }, 400);
    }

    // ── Access guard: RLS-protected select ──
    const { data: project } = await supabase
      .from("projects")
      .select("id, format, budget_range, tone, genres")
      .eq("id", projectId)
      .single();

    if (!project) {
      return json({ error: "Project not found or access denied" }, 404);
    }

    // ══════════════════════════════════════
    // ACTION: self_test
    // ══════════════════════════════════════
    if (action === "self_test") {
      const finalSeed = resolveSeed(body.seed, projectId);
      const report = runSelfTestSuite(finalSeed);
      return json(report);
    }

    // ══════════════════════════════════════
    // ACTION: initialize
    // ══════════════════════════════════════
    if (action === "initialize") {
      const creative: CreativeState = {
        format: project.format || "film",
        runtime_minutes: 100,
        episode_count: 1,
        structural_density: 5,
        character_density: 5,
        hook_intensity: 5,
        tone_classification: project.tone || "drama",
        behaviour_mode: "market",
        ...creativeState,
      };

      const cascaded = runFullCascade(creative);
      const bands = generateConfidenceBands(cascaded);

      const { data: existing } = await supabase
        .from("project_scenarios")
        .select("id")
        .eq("project_id", projectId)
        .eq("scenario_type", "baseline")
        .maybeSingle();

      let baselineId: string;

      if (!existing) {
        await supabase
          .from("project_scenarios")
          .update({ is_active: false })
          .eq("project_id", projectId);

        const { data: newBaseline, error: bErr } = await supabase
          .from("project_scenarios")
          .insert({
            project_id: projectId,
            user_id: userId,
            name: "Baseline",
            scenario_type: "baseline",
            is_active: true,
            computed_state: cascaded,
            state_overrides: {},
            delta_vs_baseline: {},
          })
          .select("id")
          .single();

        if (bErr) throw bErr;
        baselineId = newBaseline.id;
      } else {
        baselineId = existing.id;
        await supabase
          .from("project_scenarios")
          .update({ is_active: false })
          .eq("project_id", projectId);
        await supabase
          .from("project_scenarios")
          .update({
            computed_state: cascaded,
            delta_vs_baseline: {},
            is_active: true,
          })
          .eq("id", baselineId);
      }

      const { data: graph, error: graphErr } = await supabase
        .from("project_state_graphs")
        .upsert(
          {
            project_id: projectId,
            user_id: userId,
            ...cascaded,
            confidence_bands: bands,
            assumption_multipliers: {},
            last_cascade_at: new Date().toISOString(),
            active_scenario_id: baselineId,
            active_scenario_set_at: new Date().toISOString(),
            active_scenario_set_by: userId,
          },
          { onConflict: "project_id" },
        )
        .select()
        .single();

      if (graphErr) throw graphErr;

      return json({
        stateGraph: graph,
        cascaded,
        confidence_bands: bands,
      });
    }

    // ══════════════════════════════════════
    // ACTION: set_active_scenario
    // ══════════════════════════════════════
    if (action === "set_active_scenario") {
      const targetScenarioId = body.scenarioId || scenarioId;
      if (!targetScenarioId)
        return json({ error: "scenarioId required" }, 400);

      const { data: scenario } = await supabase
        .from("project_scenarios")
        .select("id, computed_state")
        .eq("id", targetScenarioId)
        .eq("project_id", projectId)
        .single();

      if (!scenario)
        return json(
          { error: "Scenario not found or not in this project" },
          404,
        );

      const cs = scenario.computed_state as unknown as CascadedState | null;
      if (!cs || !cs.creative_state) {
        return json(
          {
            error:
              "Scenario has no computed state. Cascade it first or use a different scenario.",
          },
          400,
        );
      }

      const bands = generateConfidenceBands(cs);

      const { error: deactivateErr } = await supabase
        .from("project_scenarios")
        .update({ is_active: false })
        .eq("project_id", projectId);
      if (deactivateErr)
        return json(
          {
            error:
              "Failed to deactivate scenarios: " + deactivateErr.message,
          },
          500,
        );

      const { error: activateErr } = await supabase
        .from("project_scenarios")
        .update({ is_active: true })
        .eq("id", targetScenarioId);
      if (activateErr)
        return json(
          { error: "Failed to activate scenario: " + activateErr.message },
          500,
        );

      const { error: syncErr } = await supabase
        .from("project_state_graphs")
        .update({
          ...cs,
          confidence_bands: bands,
          last_cascade_at: new Date().toISOString(),
          active_scenario_id: targetScenarioId,
          active_scenario_set_at: new Date().toISOString(),
          active_scenario_set_by: userId,
        })
        .eq("project_id", projectId);
      if (syncErr)
        return json(
          { error: "Failed to sync state graph: " + syncErr.message },
          500,
        );

      const { data: graph } = await supabase
        .from("project_state_graphs")
        .select("*")
        .eq("project_id", projectId)
        .single();

      return json({
        activeScenarioId: targetScenarioId,
        stateGraph: graph,
      });
    }

    // ══════════════════════════════════════
    // ACTION: cascade
    // ══════════════════════════════════════
    if (action === "cascade") {
      const { data: graph } = await supabase
        .from("project_state_graphs")
        .select("*")
        .eq("project_id", projectId)
        .single();

      if (!graph)
        return json({ error: "State graph not initialized" }, 400);

      const activeScenarioId = graph.active_scenario_id as string | null;
      const targetScenarioId = scenarioId || activeScenarioId;

      if (!targetScenarioId) {
        return json(
          {
            error:
              "No active scenario set. Initialize first or set an active scenario.",
          },
          400,
        );
      }

      const { data: targetScenario } = await supabase
        .from("project_scenarios")
        .select("id, computed_state, is_active")
        .eq("id", targetScenarioId)
        .eq("project_id", projectId)
        .single();

      if (!targetScenario) {
        return json(
          { error: "Target scenario not found in this project" },
          404,
        );
      }

      const scenarioState =
        targetScenario.computed_state as unknown as CascadedState | null;
      const seedCreative: CreativeState = scenarioState?.creative_state
        ? {
            ...scenarioState.creative_state,
            ...overrides?.creative_state,
          }
        : {
            ...(graph.creative_state as unknown as CreativeState),
            ...overrides?.creative_state,
          };

      const cascaded = runFullCascade(seedCreative, overrides || {});
      const bands = generateConfidenceBands(cascaded);
      const coherence = checkCoherence(overrides || {});

      const isActiveScenario = targetScenarioId === activeScenarioId;
      if (isActiveScenario) {
        await syncGraphToState(supabase, projectId, cascaded, bands);
      }

      const { data: baseline } = await supabase
        .from("project_scenarios")
        .select("computed_state")
        .eq("project_id", projectId)
        .eq("scenario_type", "baseline")
        .single();

      const delta = baseline
        ? computeDelta(
            baseline.computed_state as unknown as CascadedState,
            cascaded,
          )
        : {};

      await supabase
        .from("project_scenarios")
        .update({
          computed_state: cascaded,
          state_overrides: overrides || {},
          delta_vs_baseline: delta,
          coherence_flags: coherence,
        })
        .eq("id", targetScenarioId);

      await supabase.from("scenario_snapshots").insert({
        scenario_id: targetScenarioId,
        project_id: projectId,
        user_id: userId,
        trigger_reason: "cascade",
        snapshot_state: cascaded,
        confidence_bands: bands,
      });

      const alerts =
        isActiveScenario && activeScenarioId
          ? generateDriftAlerts(cascaded)
          : [];
      if (alerts.length > 0 && activeScenarioId) {
        await supabase.from("drift_alerts").insert(
          alerts.map((a) => ({
            ...a,
            project_id: projectId,
            user_id: userId,
            scenario_id: activeScenarioId,
          })),
        );
      }

      return json({
        cascaded,
        confidence_bands: bands,
        coherence_flags: coherence,
        alerts,
      });
    }

    // ══════════════════════════════════════
    // ACTION: create_scenario
    // ══════════════════════════════════════
    if (action === "create_scenario") {
      const { name, description, scenario_type: sType } = body;

      const { data: baseline } = await supabase
        .from("project_scenarios")
        .select("computed_state")
        .eq("project_id", projectId)
        .eq("scenario_type", "baseline")
        .single();

      if (!baseline)
        return json({ error: "Initialize baseline first" }, 400);

      const creative: CreativeState = {
        ...(baseline.computed_state as Record<string, unknown>)
          .creative_state as CreativeState,
        ...overrides?.creative_state,
      };
      const cascaded = runFullCascade(creative, overrides || {});
      const delta = computeDelta(
        baseline.computed_state as unknown as CascadedState,
        cascaded,
      );
      const coherence = checkCoherence(overrides || {});

      const { data: scenario, error: scErr } = await supabase
        .from("project_scenarios")
        .insert({
          project_id: projectId,
          user_id: userId,
          name: name || "Custom Scenario",
          description: description || null,
          scenario_type: sType || "custom",
          is_active: false,
          state_overrides: overrides || {},
          computed_state: cascaded,
          delta_vs_baseline: delta,
          coherence_flags: coherence,
        })
        .select()
        .single();

      if (scErr) throw scErr;
      return json({
        scenario,
        delta,
        coherence_flags: coherence,
      });
    }

    // ══════════════════════════════════════
    // ACTION: generate_system_scenarios
    // ══════════════════════════════════════
    if (action === "generate_system_scenarios") {
      const { data: baseline } = await supabase
        .from("project_scenarios")
        .select("computed_state")
        .eq("project_id", projectId)
        .eq("scenario_type", "baseline")
        .single();

      if (!baseline)
        return json({ error: "Initialize baseline first" }, 400);

      const bc = (baseline.computed_state as Record<string, unknown>)
        .creative_state as CreativeState;
      const lanes: Array<{
        name: string;
        description: string;
        overrides: StateOverrides;
      }> = [
        {
          name: "Contained Prestige",
          description:
            "Minimize production footprint, maximize creative density",
          overrides: {
            creative_state: {
              behaviour_mode: "prestige",
              hook_intensity: Math.min(10, bc.hook_intensity + 1),
            },
            execution_state: {
              night_exterior_ratio: 0.05,
              vfx_stunt_density: 1,
            },
            production_state: { location_clustering: 8 },
          },
        },
        {
          name: "Premium Commercial Push",
          description:
            "Invest in execution for maximum audience reach",
          overrides: {
            creative_state: {
              behaviour_mode: "commercial",
              hook_intensity: Math.min(10, bc.hook_intensity + 2),
            },
            execution_state: {
              vfx_stunt_density: 6,
              movement_intensity: 7,
            },
          },
        },
        {
          name: "Efficiency Optimised",
          description:
            "Shortest schedule, tightest budget, fastest delivery",
          overrides: {
            creative_state: { behaviour_mode: "efficiency" },
            execution_state: {
              setup_count: Math.round(bc.runtime_minutes * 0.6),
              night_exterior_ratio: 0.05,
            },
            production_state: { location_clustering: 9 },
          },
        },
      ];

      const results = [];
      for (const lane of lanes) {
        const creative: CreativeState = {
          ...bc,
          ...lane.overrides.creative_state,
        };
        const cascaded = runFullCascade(creative, lane.overrides);
        const delta = computeDelta(
          baseline.computed_state as unknown as CascadedState,
          cascaded,
        );
        const coherence = checkCoherence(lane.overrides);

        const { data: sc } = await supabase
          .from("project_scenarios")
          .insert({
            project_id: projectId,
            user_id: userId,
            name: lane.name,
            description: lane.description,
            scenario_type: "system",
            is_active: false,
            state_overrides: lane.overrides,
            computed_state: cascaded,
            delta_vs_baseline: delta,
            coherence_flags: coherence,
          })
          .select()
          .single();

        results.push({
          scenario: sc,
          delta,
          coherence_flags: coherence,
        });
      }

      return json({ scenarios: results });
    }

    // ══════════════════════════════════════
    // ACTION: rank_scenarios
    // ══════════════════════════════════════
    if (action === "rank_scenarios") {
      const { data: allScenarios, error: fetchErr } = await supabase
        .from("project_scenarios")
        .select("id, name, scenario_type, computed_state, is_archived")
        .eq("project_id", projectId)
        .eq("is_archived", false);

      if (fetchErr) throw fetchErr;
      if (!allScenarios || allScenarios.length === 0) {
        return json({
          recommendedScenarioId: null,
          rankedCount: 0,
          top5: [],
          updatedAt: null,
          message: "No rankable scenarios",
        });
      }

      interface ScoredScenario {
        id: string;
        name: string;
        score: number;
        breakdown: Record<string, number>;
      }
      const ranked: ScoredScenario[] = [];

      for (const sc of allScenarios) {
        const cs =
          sc.computed_state as unknown as CascadedState | null;
        if (!cs) continue;
        const rank = computeRankScore(cs);
        if (!rank) continue;
        ranked.push({
          id: sc.id,
          name: sc.name,
          score: rank.score,
          breakdown: rank.breakdown,
        });
      }

      if (ranked.length === 0) {
        const now = new Date().toISOString();
        await supabase
          .from("project_scenarios")
          .update({ is_recommended: false })
          .eq("project_id", projectId);
        return json({
          recommendedScenarioId: null,
          rankedCount: 0,
          top5: [],
          updatedAt: now,
          message: "No rankable scenarios",
        });
      }

      ranked.sort((a, b) => b.score - a.score);
      const now = new Date().toISOString();
      const winnerId = ranked[0].id;

      const { error: clearErr } = await supabase
        .from("project_scenarios")
        .update({ is_recommended: false })
        .eq("project_id", projectId);
      if (clearErr)
        return json(
          {
            error:
              "Failed to clear recommended flags: " + clearErr.message,
          },
          500,
        );

      const batchSize = 10;
      for (let i = 0; i < ranked.length; i += batchSize) {
        const batch = ranked.slice(i, i + batchSize);
        const results = await Promise.all(
          batch.map((r) =>
            supabase
              .from("project_scenarios")
              .update({
                rank_score: r.score,
                rank_breakdown: r.breakdown,
                ranked_at: now,
              })
              .eq("id", r.id)
              .eq("project_id", projectId),
          ),
        );
        const failed = results.find((r) => r.error);
        if (failed?.error)
          return json(
            { error: "Failed to update rank: " + failed.error.message },
            500,
          );
      }

      const { error: recErr } = await supabase
        .from("project_scenarios")
        .update({ is_recommended: true })
        .eq("id", winnerId)
        .eq("project_id", projectId);
      if (recErr)
        return json(
          { error: "Failed to set recommended: " + recErr.message },
          500,
        );

      return json({
        recommendedScenarioId: winnerId,
        winner: {
          id: ranked[0].id,
          name: ranked[0].name,
          score: ranked[0].score,
        },
        rankedCount: ranked.length,
        top5: ranked.slice(0, 5),
        updatedAt: now,
      });
    }

    // ══════════════════════════════════════
    // ACTION: optimize_scenario
    // ══════════════════════════════════════
    if (action === "optimize_scenario") {
      const { data: graph } = await supabase
        .from("project_state_graphs")
        .select("active_scenario_id")
        .eq("project_id", projectId)
        .single();

      if (!graph)
        return json({ error: "State graph not initialized" }, 400);

      const targetId = body.scenarioId || graph.active_scenario_id;
      if (!targetId)
        return json(
          { error: "No scenario specified and no active scenario" },
          400,
        );

      const { data: targetScenario } = await supabase
        .from("project_scenarios")
        .select("id, computed_state, state_overrides, scenario_type")
        .eq("id", targetId)
        .eq("project_id", projectId)
        .single();

      if (!targetScenario)
        return json({ error: "Scenario not found in this project" }, 404);

      // Guard: refuse baseline unless explicitly allowed
      if (
        targetScenario.scenario_type === "baseline" &&
        body.allowBaseline !== true
      ) {
        return json(
          {
            error:
              "Refusing to optimize baseline without allowBaseline=true",
          },
          400,
        );
      }

      const seedState =
        targetScenario.computed_state as unknown as CascadedState | null;
      if (!seedState?.creative_state)
        return json({ error: "Scenario has no computed state" }, 400);

      const baseOverrides: StateOverrides =
        (targetScenario.state_overrides as StateOverrides) ?? {};

      const maxIterations = Math.min(body.maxIterations ?? 60, 200);
      const horizonMonths: number = body.horizonMonths ?? 12;
      const searchMode: string = body.search ?? "random";
      const lockKeys: string[] = normalizeLockKeys(body.lockKeys ?? []);
      const objective: string =
        body.objective ?? "rank_score_with_projection";

      const { assumptions: projAssumptions } = clampAssumptions({});

      const seedCreative = seedState.creative_state;

      // Deterministic PRNG
      const finalSeed = resolveSeed(body.seed, targetId);
      const rng = mulberry32(finalSeed);

      interface Candidate {
        overrides: StateOverrides;
        cascaded: CascadedState;
        rank_score: number;
        projection: ProjectionResult;
        objective_score: number;
        breakdown: Record<string, number>;
      }

      const candidates: Candidate[] = [];

      for (let i = 0; i < maxIterations; i++) {
        const creativeOverrides: Partial<CreativeState> = {};
        const executionOverrides: Partial<ExecutionState> = {};
        const productionOverrides: Partial<ProductionState> = {};

        if (searchMode === "random") {
          const allKeys = [
            ...Object.keys(tunableCreative).map(
              (k) =>
                ["creative", "creative_state." + k] as const,
            ),
            ...Object.keys(tunableExecution).map(
              (k) =>
                ["execution", "execution_state." + k] as const,
            ),
            ...Object.keys(tunableProduction).map(
              (k) =>
                [
                  "production",
                  "production_state." + k,
                ] as const,
            ),
            [
              "creative",
              "creative_state.behaviour_mode",
            ] as const,
          ].filter(([, path]) => !lockKeys.includes(path));

          const numChanges = 2 + Math.floor(rng() * 3);
          const shuffled = [...allKeys]
            .sort(() => rng() - 0.5)
            .slice(0, numChanges);

          for (const [layer, path] of shuffled) {
            const key = path.split(".")[1];
            if (key === "behaviour_mode") {
              (
                creativeOverrides as Record<string, unknown>
              ).behaviour_mode =
                behaviourModes[
                  Math.floor(rng() * behaviourModes.length)
                ];
              continue;
            }
            if (layer === "creative" && tunableCreative[key]) {
              const [min, max, step] = tunableCreative[key];
              const steps = Math.round((max - min) / step);
              (creativeOverrides as Record<string, unknown>)[key] =
                min + Math.round(rng() * steps) * step;
            } else if (
              layer === "execution" &&
              tunableExecution[key]
            ) {
              const [min, max, step] = tunableExecution[key];
              const steps = Math.round((max - min) / step);
              (executionOverrides as Record<string, unknown>)[key] =
                min + Math.round(rng() * steps) * step;
            } else if (
              layer === "production" &&
              tunableProduction[key]
            ) {
              const [min, max, step] = tunableProduction[key];
              const steps = Math.round((max - min) / step);
              (productionOverrides as Record<string, unknown>)[key] =
                min + Math.round(rng() * steps) * step;
            }
          }
        } else {
          // Grid search
          const allGridKeys = [
            ...Object.keys(tunableCreative).map((k) => ({
              key: k,
              path: "creative_state." + k,
              layer: "creative",
            })),
            ...Object.keys(tunableExecution).map((k) => ({
              key: k,
              path: "execution_state." + k,
              layer: "execution",
            })),
            ...Object.keys(tunableProduction).map((k) => ({
              key: k,
              path: "production_state." + k,
              layer: "production",
            })),
          ].filter((e) => !lockKeys.includes(e.path));

          if (allGridKeys.length > 0) {
            const keyIdx = i % allGridKeys.length;
            const entry = allGridKeys[keyIdx];
            const stepInKey = Math.floor(i / allGridKeys.length);

            if (
              entry.layer === "creative" &&
              tunableCreative[entry.key]
            ) {
              const [min, max, step] = tunableCreative[entry.key];
              const totalSteps = Math.round((max - min) / step);
              const val =
                min + (stepInKey % (totalSteps + 1)) * step;
              (creativeOverrides as Record<string, unknown>)[
                entry.key
              ] = Math.min(max, val);
            } else if (
              entry.layer === "execution" &&
              tunableExecution[entry.key]
            ) {
              const [min, max, step] =
                tunableExecution[entry.key];
              const totalSteps = Math.round((max - min) / step);
              const val =
                min + (stepInKey % (totalSteps + 1)) * step;
              (executionOverrides as Record<string, unknown>)[
                entry.key
              ] = Math.min(max, val);
            } else if (
              entry.layer === "production" &&
              tunableProduction[entry.key]
            ) {
              const [min, max, step] =
                tunableProduction[entry.key];
              const totalSteps = Math.round((max - min) / step);
              const val =
                min + (stepInKey % (totalSteps + 1)) * step;
              (productionOverrides as Record<string, unknown>)[
                entry.key
              ] = Math.min(max, val);
            }
          }
        }

        const candidateDelta: StateOverrides = {
          ...(Object.keys(creativeOverrides).length > 0
            ? { creative_state: creativeOverrides }
            : {}),
          ...(Object.keys(executionOverrides).length > 0
            ? { execution_state: executionOverrides }
            : {}),
          ...(Object.keys(productionOverrides).length > 0
            ? { production_state: productionOverrides }
            : {}),
        };

        // Deep merge with existing scenario overrides
        const candidateOverrides: StateOverrides = deepMerge(
          baseOverrides as Record<string, unknown>,
          candidateDelta as Record<string, unknown>,
        ) as StateOverrides;

        const mergedCreative: CreativeState = {
          ...seedCreative,
          ...candidateOverrides.creative_state,
        };
        const cascaded = runFullCascade(
          mergedCreative,
          candidateOverrides,
        );

        // Validate candidate sanity
        if (!isCandidateValid(cascaded)) continue;

        const rank = computeRankScore(cascaded);
        if (!rank) continue;

        const projection = runForwardProjection(
          cascaded,
          horizonMonths,
          projAssumptions,
        );

        const trendBonus =
          projection.series.length > 1
            ? Math.max(
                0,
                (projection.series[projection.series.length - 1]
                  .confidence_score -
                  30) *
                  0.05,
              )
            : 0;

        let objectiveScore: number;
        if (objective === "rank_score") {
          objectiveScore = rank.score;
        } else {
          objectiveScore =
            Math.round(
              (rank.score -
                projection.projection_risk_score * 0.25 +
                trendBonus) *
                10,
            ) / 10;
        }

        candidates.push({
          overrides: candidateOverrides,
          cascaded,
          rank_score: rank.score,
          projection,
          objective_score: objectiveScore,
          breakdown: rank.breakdown,
        });
      }

      // Sort by objective score desc, take top 5
      candidates.sort((a, b) => b.objective_score - a.objective_score);
      const top5 = candidates.slice(0, 5).map((c) => ({
        overrides: c.overrides,
        cascaded: c.cascaded,
        rank_score: c.rank_score,
        projection_risk_score: c.projection.projection_risk_score,
        projection_summary: c.projection.summary,
        objective_score: c.objective_score,
        breakdown: c.breakdown,
      }));

      return json({
        candidates: top5,
        iterations: maxIterations,
        objective,
        horizonMonths,
        searchMode,
        seed_used: finalSeed,
      });
    }

    // ══════════════════════════════════════
    // ACTION: apply_optimized_overrides
    // ══════════════════════════════════════
    if (action === "apply_optimized_overrides") {
      const targetId = body.scenarioId;
      if (!targetId)
        return json({ error: "scenarioId required" }, 400);
      if (!overrides)
        return json({ error: "overrides required" }, 400);

      const { data: graph } = await supabase
        .from("project_state_graphs")
        .select("active_scenario_id")
        .eq("project_id", projectId)
        .single();
      if (!graph)
        return json({ error: "State graph not initialized" }, 400);

      const { data: targetScenario } = await supabase
        .from("project_scenarios")
        .select("id, computed_state, scenario_type")
        .eq("id", targetId)
        .eq("project_id", projectId)
        .single();

      if (!targetScenario)
        return json(
          { error: "Scenario not found in this project" },
          404,
        );

      const seedState =
        targetScenario.computed_state as unknown as CascadedState | null;
      if (!seedState?.creative_state)
        return json({ error: "Scenario has no computed state" }, 400);

      const mergedCreative: CreativeState = {
        ...seedState.creative_state,
        ...overrides.creative_state,
      };
      const cascaded = runFullCascade(mergedCreative, overrides);
      const bands = generateConfidenceBands(cascaded);

      const { data: baseline } = await supabase
        .from("project_scenarios")
        .select("computed_state")
        .eq("project_id", projectId)
        .eq("scenario_type", "baseline")
        .single();

      const delta = baseline
        ? computeDelta(
            baseline.computed_state as unknown as CascadedState,
            cascaded,
          )
        : {};

      const { error: updateErr } = await supabase
        .from("project_scenarios")
        .update({
          state_overrides: overrides,
          computed_state: cascaded,
          delta_vs_baseline: delta,
        })
        .eq("id", targetId)
        .eq("project_id", projectId);
      if (updateErr)
        return json(
          {
            error:
              "Failed to update scenario: " + updateErr.message,
          },
          500,
        );

      await supabase.from("scenario_snapshots").insert({
        scenario_id: targetId,
        project_id: projectId,
        user_id: userId,
        trigger_reason: "optimize_apply",
        snapshot_state: cascaded,
        confidence_bands: bands,
      });

      const isActive = targetId === graph.active_scenario_id;
      if (isActive) {
        await syncGraphToState(supabase, projectId, cascaded, bands);
        const alerts = generateDriftAlerts(cascaded);
        if (alerts.length > 0) {
          await supabase.from("drift_alerts").insert(
            alerts.map((a) => ({
              ...a,
              project_id: projectId,
              user_id: userId,
              scenario_id: targetId,
            })),
          );
        }
      }

      return json({
        cascaded,
        confidence_bands: bands,
        delta,
        isActiveScenarioUpdated: isActive,
      });
    }

    // ══════════════════════════════════════
    // ACTION: project_forward
    // ══════════════════════════════════════
    if (action === "project_forward") {
      const { data: graph } = await supabase
        .from("project_state_graphs")
        .select("active_scenario_id")
        .eq("project_id", projectId)
        .single();

      if (!graph)
        return json({ error: "State graph not initialized" }, 400);

      const targetId = body.scenarioId || graph.active_scenario_id;
      if (!targetId)
        return json(
          { error: "No scenario specified and no active scenario" },
          400,
        );

      const { data: targetScenario } = await supabase
        .from("project_scenarios")
        .select("id, computed_state")
        .eq("id", targetId)
        .eq("project_id", projectId)
        .single();

      if (!targetScenario)
        return json(
          { error: "Scenario not found in this project" },
          404,
        );

      const cs =
        targetScenario.computed_state as unknown as CascadedState | null;
      if (!cs?.creative_state)
        return json({ error: "Scenario has no computed state" }, 400);

      const months = body.months ?? 12;
      const { assumptions, normalized: assumptionsNormalized } =
        clampAssumptions({
          inflation_rate: body.assumptions?.inflation_rate,
          schedule_slip_risk: body.assumptions?.schedule_slip_risk,
          platform_appetite_decay:
            body.assumptions?.platform_appetite_decay,
        });

      const result = runForwardProjection(cs, months, assumptions);

      // Persist projection
      const { data: projection, error: insertErr } = await supabase
        .from("scenario_projections")
        .insert({
          project_id: projectId,
          scenario_id: targetId,
          user_id: userId,
          months,
          assumptions,
          series: result.series,
          projection_risk_score: result.projection_risk_score,
          summary: result.summary,
        })
        .select()
        .single();

      if (insertErr)
        return json(
          {
            error:
              "Failed to save projection: " + insertErr.message,
          },
          500,
        );

      return json({
        projection,
        series: result.series,
        projection_risk_score: result.projection_risk_score,
        summary: result.summary,
        ...(assumptionsNormalized
          ? { assumptions_normalized: true }
          : {}),
      });
    }

    return json({ error: `Unknown action: ${action}` }, 400);
  } catch (err: unknown) {
    const message =
      err instanceof Error ? err.message : "Internal error";
    console.error("simulation-engine error:", err);
    return json({ error: message }, 500);
  }
});
