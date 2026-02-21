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

// ---- Approval decision helpers (Phase 5.5) ----

async function getLatestApprovalDecision(
  supabase: any,
  projectId: string,
  sourceId: string,
  targetId: string,
): Promise<{ approved: boolean; created_at: string; note?: string } | null> {
  try {
    const { data, error } = await supabase
      .from("scenario_decision_events")
      .select("payload, created_at")
      .eq("project_id", projectId)
      .eq("event_type", "merge_approval_decided")
      .eq("scenario_id", targetId)
      .eq("previous_scenario_id", sourceId)
      .order("created_at", { ascending: false })
      .limit(1);
    if (error || !data || data.length === 0) return null;
    const row = data[0];
    const payload = row.payload as any;
    return {
      approved: payload?.approved === true,
      created_at: row.created_at,
      note: payload?.note ?? undefined,
    };
  } catch {
    return null;
  }
}

function isApprovalValid(
  decision: { approved: boolean; created_at: string } | null,
  ttlHours = 24,
): boolean {
  if (!decision) return false;
  if (decision.approved !== true) return false;
  const decidedAt = new Date(decision.created_at).getTime();
  const now = Date.now();
  if (now - decidedAt > ttlHours * 60 * 60 * 1000) return false;
  return true;
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

// ---- Deep override diff helpers ----

interface OverrideDiffChange {
  path: string;
  a: unknown;
  b: unknown;
}

function diffOverridesDeep(
  a: Record<string, unknown>,
  b: Record<string, unknown>,
  prefix = "",
): OverrideDiffChange[] {
  const changes: OverrideDiffChange[] = [];
  const allKeys = new Set([...Object.keys(a), ...Object.keys(b)]);
  for (const key of allKeys) {
    const path = prefix ? `${prefix}.${key}` : key;
    const av = a[key] ?? null;
    const bv = b[key] ?? null;
    if (isPlainObject(av) && isPlainObject(bv)) {
      changes.push(...diffOverridesDeep(av as Record<string, unknown>, bv as Record<string, unknown>, path));
    } else if (!deepEqual(av, bv)) {
      changes.push({ path, a: av, b: bv });
    }
  }
  return changes;
}

function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (a === null || b === null) return false;
  if (typeof a !== typeof b) return false;
  if (typeof a === "number" && typeof b === "number") return a === b;
  if (typeof a === "string" && typeof b === "string") return a === b;
  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) return false;
    return a.every((v, i) => deepEqual(v, b[i]));
  }
  if (isPlainObject(a) && isPlainObject(b)) {
    const aObj = a as Record<string, unknown>;
    const bObj = b as Record<string, unknown>;
    const keys = new Set([...Object.keys(aObj), ...Object.keys(bObj)]);
    for (const k of keys) {
      if (!deepEqual(aObj[k], bObj[k])) return false;
    }
    return true;
  }
  return false;
}

// ---- Governance Helpers (Phase 5.3) ----

interface NormalizedGovernance {
  critical_paths: string[];
  suggested_protected_paths: string[];
  risk_memory: {
    path_weights: Record<string, number>;
    merge_outcomes: Array<{
      at: string;
      sourceScenarioId?: string;
      targetScenarioId?: string;
      risk_score?: number;
      required_approval?: boolean;
      forced?: boolean;
      paths?: string[];
      drift_critical?: number;
      drift_warning?: number;
      confidence_before?: number;
      confidence_after?: number;
    }>;
  };
  governance_confidence_score: number | null;
  merge_policy?: {
    require_approval?: boolean;
    risk_threshold?: number;
  };
  last_governance_scan_at?: string;
  last_governance_scan_by?: string;
}

function normalizeGovernance(g: unknown): NormalizedGovernance {
  const raw = (g && typeof g === "object" && !Array.isArray(g)) ? g as Record<string, unknown> : {};
  const rm = (raw.risk_memory && typeof raw.risk_memory === "object" && !Array.isArray(raw.risk_memory)) ? raw.risk_memory as Record<string, unknown> : {};
  return {
    critical_paths: Array.isArray(raw.critical_paths) ? raw.critical_paths as string[] : [],
    suggested_protected_paths: Array.isArray(raw.suggested_protected_paths) ? raw.suggested_protected_paths as string[] : [],
    risk_memory: {
      path_weights: (rm.path_weights && typeof rm.path_weights === "object" && !Array.isArray(rm.path_weights)) ? rm.path_weights as Record<string, number> : {},
      merge_outcomes: Array.isArray(rm.merge_outcomes) ? rm.merge_outcomes : [],
    },
    governance_confidence_score: typeof raw.governance_confidence_score === "number" ? raw.governance_confidence_score : null,
    merge_policy: (raw.merge_policy && typeof raw.merge_policy === "object") ? raw.merge_policy as NormalizedGovernance["merge_policy"] : undefined,
    last_governance_scan_at: typeof raw.last_governance_scan_at === "string" ? raw.last_governance_scan_at : undefined,
    last_governance_scan_by: typeof raw.last_governance_scan_by === "string" ? raw.last_governance_scan_by : undefined,
  };
}

function computeGovernanceConfidence(params: {
  protected_paths_count: number;
  approvals_required_last10: number;
  unacknowledged_drift_alerts_count: number;
  risk_score_last: number;
}): number {
  let score = 100;
  score -= 5 * params.protected_paths_count;
  score -= 3 * params.approvals_required_last10;
  score -= 1 * params.unacknowledged_drift_alerts_count;
  score -= (params.risk_score_last / 10);
  return Math.max(0, Math.min(100, Math.round(score)));
}

function maybeEscalatePolicy(
  governance: NormalizedGovernance,
  score: number,
  recentHighRiskCount: number,
): { governance: NormalizedGovernance; escalated: boolean } {
  const shouldEscalate = score < 50 || recentHighRiskCount >= 3;
  if (!shouldEscalate) return { governance, escalated: false };

  const updated = { ...governance };
  const existingPolicy = updated.merge_policy ?? {};
  updated.merge_policy = {
    ...existingPolicy,
    require_approval: true,
    risk_threshold: Math.min(existingPolicy.risk_threshold ?? 100, 40),
  };
  return { governance: updated, escalated: true };
}
function getNestedValue(obj: Record<string, unknown>, path: string): unknown {
  const parts = path.split(".");
  let cur: unknown = obj;
  for (const p of parts) {
    if (cur === null || cur === undefined || typeof cur !== "object") return undefined;
    cur = (cur as Record<string, unknown>)[p];
  }
  return cur ?? null;
}

function setNestedValue(obj: Record<string, unknown>, path: string, value: unknown): void {
  const parts = path.split(".");
  let cur = obj;
  for (let i = 0; i < parts.length - 1; i++) {
    const p = parts[i];
    if (!isPlainObject(cur[p])) {
      cur[p] = {};
    }
    cur = cur[p] as Record<string, unknown>;
  }
  cur[parts[parts.length - 1]] = value;
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

// ---- Metrics Contract ----

const REQUIRED_METRIC_KEYS = [
  "irr", "npv", "payback_months", "schedule_months",
  "budget", "projection_risk_score", "composite_score",
] as const;

interface NormalizedSummaryMetrics {
  irr: number | null;
  npv: number | null;
  payback_months: number | null;
  schedule_months: number | null;
  budget: number | null;
  projection_risk_score: number | null;
  composite_score: number | null;
  [key: string]: unknown;
}

function normalizeSummaryMetrics(
  input: any,
  fallback?: { months?: number; projection_risk_score?: number | null },
): NormalizedSummaryMetrics {
  const src = (input && typeof input === "object") ? input : {};

  const safeNum = (v: unknown): number | null => {
    if (v === null || v === undefined) return null;
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  };

  const result: NormalizedSummaryMetrics = {
    irr: safeNum(src.irr),
    npv: safeNum(src.npv),
    payback_months: safeNum(src.payback_months),
    schedule_months: safeNum(src.schedule_months) ?? (fallback?.months ?? null),
    budget: safeNum(src.budget),
    projection_risk_score: safeNum(src.projection_risk_score) ?? (fallback?.projection_risk_score ?? null),
    composite_score: safeNum(src.composite_score),
  };

  // Pass through extra keys (start_budget, end_confidence, etc.)
  for (const k of Object.keys(src)) {
    if (!(k in result)) {
      result[k] = src[k];
    }
  }

  return result;
}

function validateMetricsContract(sm: NormalizedSummaryMetrics): string[] {
  const warnings: string[] = [];
  for (const key of REQUIRED_METRIC_KEYS) {
    if (sm[key] === null || sm[key] === undefined) {
      warnings.push(`missing_${key}`);
    }
  }
  return warnings;
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

// ---- Safe Timer (Deno Edge compatible) ----

const now = (): number => globalThis.performance?.now?.() ?? Date.now();

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
  const t0 = now();
  const tests: TestResult[] = [];
  const timings: Record<string, number> = {};

  // 1) Rank score monotonicity — higher hook_intensity should not decrease rank_score
  {
    const t1 = now();
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
    timings["rank_score_monotonicity"] = Math.round(now() - t1);
  }

  // 2) Projection trend — budget should increase with positive inflation
  {
    const t1 = now();
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
    timings["projection_budget_inflates"] = Math.round(now() - t1);
  }

  // 3) Lock keys respected — optimizer must not change locked key
  {
    const t1 = now();
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
    timings["lock_keys_respected"] = Math.round(now() - t1);
  }

  // 4) Determinism — same seed produces same rank score
  {
    const t1 = now();
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
    timings["determinism_cascade"] = Math.round(now() - t1);
  }

  // 5) Deep merge correctness
  {
    const t1 = now();
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
    timings["deep_merge_correctness"] = Math.round(now() - t1);
  }

  timings["total"] = Math.round(now() - t0);

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

      // Capture previous active before deactivation
      const { data: prevGraphSnap } = await supabase
        .from("project_state_graphs")
        .select("active_scenario_id")
        .eq("project_id", projectId)
        .single();
      const previousActiveId = prevGraphSnap?.active_scenario_id ?? null;

      const { data: scenario } = await supabase
        .from("project_scenarios")
        .select("id, name, computed_state")
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

      // Decision event: active_scenario_changed
      if (targetScenarioId !== previousActiveId) {
        try {
          await supabase.from("scenario_decision_events").insert({
            project_id: projectId,
            event_type: "active_scenario_changed",
            scenario_id: targetScenarioId,
            previous_scenario_id: previousActiveId,
            created_by: userId,
            payload: {
              scenario_name: scenario?.name ?? null,
            },
          });
        } catch (e: unknown) {
          console.warn("decision_event_insert_failed", "active_scenario_changed", projectId, e instanceof Error ? e.message : e);
        }
      }

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

      // Compute deterministic summary_metrics from numeric series
      const endPt = result.series[result.series.length - 1];
      const startPt = result.series[0];
      const summaryMetrics = normalizeSummaryMetrics({
        irr: null,
        npv: null,
        payback_months: null,
        schedule_months: months,
        budget: endPt?.budget_estimate ?? null,
        projection_risk_score: result.projection_risk_score,
        composite_score: null,
        start_budget: startPt?.budget_estimate ?? null,
        end_confidence: endPt?.confidence_score ?? null,
        end_downside: endPt?.downside_exposure ?? null,
        end_stress: endPt?.capital_stack_stress ?? null,
      }, { months, projection_risk_score: result.projection_risk_score });

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
          summary_metrics: summaryMetrics,
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

      // Decision event: projection_completed
      try {
        await supabase.from("scenario_decision_events").insert({
          project_id: projectId,
          event_type: "projection_completed",
          scenario_id: targetId,
          created_by: userId,
          payload: {
            months,
            summary_metrics: summaryMetrics,
            projection_risk_score: result.projection_risk_score,
          },
        });
      } catch (e: unknown) {
        console.warn("decision_event_insert_failed", "projection_completed", projectId, e instanceof Error ? e.message : e);
      }

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

    // ══════════════════════════════════════
    // ACTION: recommend_scenario
    // ══════════════════════════════════════
    if (action === "recommend_scenario") {
      if (!projectId) throw new Error("projectId required");

      const baselineScenarioId = body?.baselineScenarioId || null;
      const activeScenarioId = body?.activeScenarioId || null;

      // 1) Load scenarios
      const { data: scenarios, error: sErr } = await supabase
        .from("project_scenarios")
        .select("*")
        .eq("project_id", projectId)
        .eq("is_archived", false)
        .order("created_at", { ascending: true });

      if (sErr) throw sErr;
      const list = scenarios || [];
      if (list.length === 0) {
        return json({ error: "No scenarios found for project" }, 200);
      }

      // 2) Baseline
      const baseline =
        (baselineScenarioId ? list.find((s: any) => s.id === baselineScenarioId) : null) ||
        list.find((s: any) => s.scenario_type === "baseline") ||
        null;

      // helper: get latest projection
      async function latestProjection(scenarioId: string) {
        const { data, error } = await supabase
          .from("scenario_projections")
          .select("*")
          .eq("project_id", projectId)
          .eq("scenario_id", scenarioId)
          .order("created_at", { ascending: false })
          .limit(1)
          .maybeSingle();
        if (error) throw error;
        return data;
      }

      // helper: get latest stress test (within 24h)
      async function latestStressTest(scenarioId: string) {
        const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
        const { data, error } = await supabase
          .from("scenario_stress_tests")
          .select("fragility_score, volatility_index")
          .eq("project_id", projectId)
          .eq("scenario_id", scenarioId)
          .gte("created_at", cutoff)
          .order("created_at", { ascending: false })
          .limit(1)
          .maybeSingle();
        if (error) throw error;
        return data as { fragility_score: number; volatility_index: number } | null;
      }

      // helper: drift counts
      async function driftCounts(scenarioId: string) {
        const { data, error } = await supabase
          .from("drift_alerts")
          .select("severity")
          .eq("project_id", projectId)
          .eq("scenario_id", scenarioId)
          .eq("acknowledged", false);

        if (error) throw error;
        const items = data || [];
        const critical = items.filter((x: any) => x.severity === "critical").length;
        const warning = items.filter((x: any) => x.severity === "warning").length;
        const info = items.filter((x: any) => x.severity === "info").length;
        return { critical, warning, info, total: items.length };
      }

      // helper: clamp
      const clamp = (n: number, a = 0, b = 100) => Math.max(a, Math.min(b, n));
      const round = (n: number) => Math.round(n);

      // helper: extract metrics (deterministic; prefers normalized summary_metrics)
      function extractMetrics(s: any, proj: any) {
        const assumptions = proj?.assumptions || null;

        // If projection has normalized summary_metrics, use it as primary source
        const sm = proj?.summary_metrics;
        if (sm && typeof sm === "object") {
          const normalized = normalizeSummaryMetrics(sm, {
            months: proj?.months,
            projection_risk_score: proj?.projection_risk_score,
          });
          return {
            irr: normalized.irr,
            npv: normalized.npv,
            payback_months: normalized.payback_months,
            schedule_months: normalized.schedule_months,
            budget: normalized.budget ?? s?.computed_state?.finance_state?.budget_estimate ?? null,
            inflation_rate: assumptions?.inflation_rate ?? null,
            schedule_slip_risk: assumptions?.schedule_slip_risk ?? null,
            platform_appetite_decay: assumptions?.platform_appetite_decay ?? null,
            has_projection: true,
          };
        }

        // Fallback: legacy extraction for old projections without summary_metrics
        const irr =
          proj?.metrics?.irr ??
          s?.computed_state?.revenue_state?.irr ??
          null;

        const npv =
          proj?.metrics?.npv ??
          s?.computed_state?.revenue_state?.npv ??
          null;

        const payback_months =
          proj?.metrics?.payback_months ??
          null;

        const schedule_months =
          proj?.metrics?.schedule_months ??
          (s?.computed_state?.production_state?.estimated_shoot_days
            ? Math.round(Number(s.computed_state.production_state.estimated_shoot_days) / 30)
            : null);

        const budget =
          proj?.metrics?.budget ??
          s?.computed_state?.finance_state?.budget_estimate ??
          null;

        const inflation_rate = assumptions?.inflation_rate ?? null;
        const schedule_slip_risk = assumptions?.schedule_slip_risk ?? null;
        const platform_appetite_decay = assumptions?.platform_appetite_decay ?? null;

        return {
          irr,
          npv,
          payback_months,
          schedule_months,
          budget,
          inflation_rate,
          schedule_slip_risk,
          platform_appetite_decay,
          has_projection: !!proj,
        };
      }

      // scoring (0..100) — deterministic, now with stress test robustness
      function scoreScenario(m: any, drift: any, stress: { fragility_score: number; volatility_index: number } | null) {
        let roi = 50;
        if (typeof m.irr === "number") roi = clamp(50 + m.irr * 5);
        else if (typeof m.npv === "number") roi = clamp(50 + (m.npv / 1_000_000) * 5);

        let risk = 60;
        if (typeof m.schedule_slip_risk === "number") risk = clamp(100 - m.schedule_slip_risk * 100);
        risk = clamp(risk - drift.warning * 4 - drift.critical * 12);

        // Incorporate stress test robustness into risk score
        if (stress) {
          // Lower volatility = better risk score (up to +10)
          risk = clamp(risk + Math.round((100 - stress.volatility_index) * 0.1));
          // Lower fragility = better risk score (up to +10)
          risk = clamp(risk + Math.round((100 - stress.fragility_score) * 0.1));
        }

        let timeline = 50;
        if (typeof m.payback_months === "number") timeline = clamp(100 - m.payback_months * 3);
        if (typeof m.schedule_months === "number") timeline = clamp((timeline + (100 - m.schedule_months * 4)) / 2);

        let appetite = 50;
        if (typeof m.platform_appetite_decay === "number") appetite = clamp(100 - m.platform_appetite_decay * 500);

        const composite = round(roi * 0.4 + risk * 0.3 + timeline * 0.2 + appetite * 0.1);

        return { roi, risk, timeline, appetite, composite };
      }

      // 3) Score all scenarios (with stress test data)
      const scored: any[] = [];
      for (const s of list) {
        const [proj, drift, stress] = await Promise.all([
          latestProjection(s.id),
          driftCounts(s.id),
          latestStressTest(s.id),
        ]);
        const metrics = extractMetrics(s, proj);
        const scores = scoreScenario(metrics, drift, stress);

        scored.push({ scenarioId: s.id, scenario: s, projection: proj, drift, stress, metrics, scores });
      }

      // 4) Pick winner (max composite)
      scored.sort((a, b) => (b.scores.composite ?? 0) - (a.scores.composite ?? 0));
      const winner = scored[0];

      // 5) Confidence
      let confidence = 60;
      if (!baseline) confidence -= 10;
      if (winner && !winner.metrics.has_projection) confidence -= 10;
      if (winner && winner.drift.critical > 0) confidence -= 20;
      confidence = clamp(confidence);

      // 6) Reasons/tradeoffs vs baseline
      const reasons: string[] = [];
      const riskFlags: string[] = [];

      const baseRow = baseline ? scored.find((x: any) => x.scenarioId === baseline.id) : null;

      function pushDelta(label: string, delta: number, unit = "", minAbs = 0.01) {
        if (!Number.isFinite(delta)) return;
        if (Math.abs(delta) < minAbs) return;
        const sign = delta > 0 ? "+" : "";
        reasons.push(`${label} ${sign}${delta}${unit} vs baseline`);
      }

      if (baseRow) {
        if (typeof winner.metrics.irr === "number" && typeof baseRow.metrics.irr === "number") {
          pushDelta("IRR", round((winner.metrics.irr - baseRow.metrics.irr) * 10) / 10, " pts", 0.1);
        }
        if (typeof winner.metrics.payback_months === "number" && typeof baseRow.metrics.payback_months === "number") {
          pushDelta("Payback", round(baseRow.metrics.payback_months - winner.metrics.payback_months), " months", 1);
        }
        if (typeof winner.metrics.schedule_months === "number" && typeof baseRow.metrics.schedule_months === "number") {
          pushDelta("Schedule", round(baseRow.metrics.schedule_months - winner.metrics.schedule_months), " months", 1);
        }
        if (typeof winner.metrics.schedule_slip_risk === "number" && typeof baseRow.metrics.schedule_slip_risk === "number") {
          pushDelta("Slip risk", round((baseRow.metrics.schedule_slip_risk - winner.metrics.schedule_slip_risk) * 100), "%", 1);
        }
      }

      if (!winner.metrics.has_projection) riskFlags.push("MISSING_PROJECTION");
      if (winner.drift.critical > 0) riskFlags.push("HIGH_DRIFT");
      if (typeof winner.metrics.platform_appetite_decay === "number" && winner.metrics.platform_appetite_decay > 0.1) {
        riskFlags.push("HIGH_APPETITE_DECAY");
      }
      // Stress test risk flags
      if (winner.stress) {
        if (winner.stress.fragility_score > 70) riskFlags.push("HIGH_FRAGILITY");
        if (winner.stress.volatility_index > 70) riskFlags.push("HIGH_VOLATILITY");
        reasons.push(`Robust under stress: fragility ${winner.stress.fragility_score}, volatility ${winner.stress.volatility_index}`);
      }

      const tradeoffs: Record<string, number | null> = {
        budget_delta: baseRow && typeof winner.metrics.budget === "number" && typeof baseRow.metrics.budget === "number"
          ? winner.metrics.budget - baseRow.metrics.budget
          : null,
        composite_delta: baseRow ? winner.scores.composite - baseRow.scores.composite : null,
        drift_total: winner.drift.total,
        fragility_score: winner.stress?.fragility_score ?? null,
        volatility_index: winner.stress?.volatility_index ?? null,
      };

      // 7) Upsert scenario_scores for all scenarios
      const upserts = scored.map((x: any) => ({
        project_id: projectId,
        scenario_id: x.scenarioId,
        as_of: new Date().toISOString(),
        metrics: x.metrics,
        scores: x.scores,
        notes: `roi=${x.scores.roi} risk=${x.scores.risk} timeline=${x.scores.timeline} appetite=${x.scores.appetite}`,
      }));

      const { error: upErr } = await supabase.from("scenario_scores").upsert(upserts, {
        onConflict: "project_id,scenario_id",
      });
      if (upErr) throw upErr;

      // 8) Insert scenario_recommendations row
      const { error: recErr } = await supabase.from("scenario_recommendations").insert({
        project_id: projectId,
        recommended_scenario_id: winner.scenarioId,
        confidence,
        reasons,
        tradeoffs,
        risk_flags: riskFlags,
      });
      if (recErr) throw recErr;

      // Contract warnings for winner metrics
      const winnerSm = winner.projection?.summary_metrics;
      const contractWarnings = winnerSm
        ? validateMetricsContract(normalizeSummaryMetrics(winnerSm))
        : ["missing_projection_metrics"];

      // Get previous recommendation for change_reasons
      const { data: prevRec } = await supabase
        .from("scenario_recommendations")
        .select("recommended_scenario_id")
        .eq("project_id", projectId)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      const prevRecScenarioId = prevRec?.recommended_scenario_id ?? null;

      // Compute deterministic change_reasons
      const changeReasons: string[] = [];
      if (prevRecScenarioId && prevRecScenarioId !== winner.scenarioId) {
        const prevRow = scored.find((x: any) => x.scenarioId === prevRecScenarioId);
        if (prevRow) {
          if (winner.scores.roi > prevRow.scores.roi) changeReasons.push("roi_improved");
          if (winner.scores.risk > prevRow.scores.risk) changeReasons.push("robustness_preferred");
          if (winner.drift.critical < prevRow.drift.critical) changeReasons.push("drift_improved");
          if (winner.scores.timeline > prevRow.scores.timeline) changeReasons.push("timeline_improved");
        }
      }

      // Build scenario snapshot for replay/branching
      const winnerScenario = winner.scenario;
      const scenarioSnapshot = {
        recommended_scenario_id: winner.scenarioId,
        recommended_scenario_name: winnerScenario?.name ?? null,
        recommended_state_overrides: winnerScenario?.state_overrides ?? {},
        baseline_scenario_id: baselineScenarioId ?? null,
        active_scenario_id: activeScenarioId ?? null,
      };

      // Decision event: recommendation_computed
      try {
        await supabase.from("scenario_decision_events").insert({
          project_id: projectId,
          event_type: "recommendation_computed",
          scenario_id: winner.scenarioId,
          previous_scenario_id: prevRecScenarioId,
          created_by: userId,
          payload: {
            confidence,
            reasons,
            tradeoffs,
            riskFlags,
            contract_warnings: contractWarnings.length > 0 ? contractWarnings : undefined,
            change_reasons: changeReasons.length > 0 ? changeReasons.slice(0, 3) : undefined,
            scenario_snapshot: scenarioSnapshot,
            scoresByScenario: scored.map((x: any) => ({
              scenarioId: x.scenarioId,
              composite: x.scores.composite,
              roi: x.scores.roi,
              risk: x.scores.risk,
              timeline: x.scores.timeline,
              appetite: x.scores.appetite,
            })),
          },
        });
      } catch (e: unknown) {
        console.warn("decision_event_insert_failed", "recommendation_computed", projectId, e instanceof Error ? e.message : e);
      }

      return json({
        recommendedScenarioId: winner.scenarioId,
        confidence,
        reasons,
        tradeoffs,
        riskFlags,
        contract_warnings: contractWarnings.length > 0 ? contractWarnings : undefined,
        scoresByScenario: scored.map((x: any) => ({
          scenarioId: x.scenarioId,
          scores: x.scores,
          metrics: x.metrics,
        })),
      });
    }

    // ══════════════════════════════════════
    // ACTION: stress_test_scenario
    // ══════════════════════════════════════
    if (action === "stress_test_scenario") {
      const targetScenarioId = body.scenarioId || scenarioId;
      if (!targetScenarioId)
        return json({ error: "scenarioId required" }, 400);

      const { data: targetScenario } = await supabase
        .from("project_scenarios")
        .select("id, computed_state")
        .eq("id", targetScenarioId)
        .eq("project_id", projectId)
        .single();

      if (!targetScenario)
        return json({ error: "Scenario not found in this project" }, 404);

      const cs = targetScenario.computed_state as unknown as CascadedState | null;
      if (!cs?.creative_state)
        return json({ error: "Scenario has no computed state" }, 400);

      const months = body.months ?? 12;
      const sweeps = body.sweeps ?? {};
      const inflationRates: number[] = sweeps.inflation_rates ?? [0.02, 0.04, 0.06, 0.08];
      const slipRisks: number[] = sweeps.schedule_slip_risks ?? [0.10, 0.20, 0.30, 0.40];
      const appetiteDecays: number[] = sweeps.appetite_decays ?? [0.05, 0.10, 0.15];

      const grid = { inflation_rates: inflationRates, schedule_slip_risks: slipRisks, appetite_decays: appetiteDecays };

      // Run sweep
      interface SweepResult {
        inflation_rate: number;
        schedule_slip_risk: number;
        platform_appetite_decay: number;
        projection_risk_score: number;
        end_confidence: number;
        end_budget: number;
        end_downside: number;
        composite: number;
        summary_metrics: NormalizedSummaryMetrics;
        contract_warnings?: string[];
      }

      const results: SweepResult[] = [];
      const composites: number[] = [];

      // Compute a baseline composite for breakpoint detection
      const baselineAssumptions: ProjectionAssumptions = {
        inflation_rate: inflationRates[0],
        schedule_slip_risk: slipRisks[0],
        platform_appetite_decay: appetiteDecays[0],
      };
      const baseProj = runForwardProjection(cs, months, baselineAssumptions);
      const baseEnd = baseProj.series[baseProj.series.length - 1];
      const baseComposite = Math.round(
        (baseEnd.confidence_score * 0.4 +
         (10 - baseEnd.downside_exposure) * 10 * 0.3 +
         (10 - baseEnd.capital_stack_stress) * 10 * 0.2 +
         (10 - baseEnd.schedule_compression_risk) * 10 * 0.1)
      );

      for (const ir of inflationRates) {
        for (const sr of slipRisks) {
          for (const ad of appetiteDecays) {
            const assumptions: ProjectionAssumptions = {
              inflation_rate: ir,
              schedule_slip_risk: sr,
              platform_appetite_decay: ad,
            };
            const proj = runForwardProjection(cs, months, assumptions);
            const endPt = proj.series[proj.series.length - 1];

            const composite = Math.round(
              (endPt.confidence_score * 0.4 +
               (10 - endPt.downside_exposure) * 10 * 0.3 +
               (10 - endPt.capital_stack_stress) * 10 * 0.2 +
               (10 - endPt.schedule_compression_risk) * 10 * 0.1)
            );

            composites.push(composite);
            const sweepStartPt = proj.series[0];
            const sweepMetrics = normalizeSummaryMetrics({
              schedule_months: months,
              budget: endPt.budget_estimate,
              projection_risk_score: proj.projection_risk_score,
              end_confidence: endPt.confidence_score,
              end_downside: endPt.downside_exposure,
              start_budget: sweepStartPt?.budget_estimate ?? null,
            }, { months, projection_risk_score: proj.projection_risk_score });
            const sweepWarnings = validateMetricsContract(sweepMetrics);
            results.push({
              inflation_rate: ir,
              schedule_slip_risk: sr,
              platform_appetite_decay: ad,
              projection_risk_score: proj.projection_risk_score,
              end_confidence: endPt.confidence_score,
              end_budget: endPt.budget_estimate,
              end_downside: endPt.downside_exposure,
              composite,
              summary_metrics: sweepMetrics,
              contract_warnings: sweepWarnings.length > 0 ? sweepWarnings : undefined,
            });
          }
        }
      }

      // Volatility index: normalized standard deviation of composites (0..100)
      const mean = composites.reduce((a, b) => a + b, 0) / composites.length;
      const variance = composites.reduce((a, b) => a + (b - mean) ** 2, 0) / composites.length;
      const stddev = Math.sqrt(variance);
      const volatilityIndex = Math.round(Math.min(100, stddev * 2));

      // Fragility score: how quickly results degrade as assumptions worsen
      // Sort results by worsening assumptions (sum of rates)
      const sorted = [...results].sort(
        (a, b) =>
          (a.inflation_rate + a.schedule_slip_risk + a.platform_appetite_decay) -
          (b.inflation_rate + b.schedule_slip_risk + b.platform_appetite_decay)
      );
      const firstQuarter = sorted.slice(0, Math.max(1, Math.floor(sorted.length / 4)));
      const lastQuarter = sorted.slice(-Math.max(1, Math.floor(sorted.length / 4)));
      const avgFirst = firstQuarter.reduce((a, b) => a + b.composite, 0) / firstQuarter.length;
      const avgLast = lastQuarter.reduce((a, b) => a + b.composite, 0) / lastQuarter.length;
      const fragilityScore = Math.round(Math.min(100, Math.max(0, (avgFirst - avgLast) * 1.5)));

      // Breakpoints: first points where composite drops below 45 or below baseline
      const breakpoints: Record<string, unknown> = {};
      const belowThreshold = results.find((r) => r.composite < 45);
      if (belowThreshold) {
        breakpoints.below_45 = {
          inflation_rate: belowThreshold.inflation_rate,
          schedule_slip_risk: belowThreshold.schedule_slip_risk,
          platform_appetite_decay: belowThreshold.platform_appetite_decay,
          composite: belowThreshold.composite,
        };
      }
      const belowBaseline = results.find((r) => r.composite < baseComposite);
      if (belowBaseline) {
        breakpoints.below_baseline = {
          inflation_rate: belowBaseline.inflation_rate,
          schedule_slip_risk: belowBaseline.schedule_slip_risk,
          platform_appetite_decay: belowBaseline.platform_appetite_decay,
          composite: belowBaseline.composite,
          baseline_composite: baseComposite,
        };
      }

      // Persist
      const { error: insertErr } = await supabase
        .from("scenario_stress_tests")
        .insert({
          project_id: projectId,
          scenario_id: targetScenarioId,
          grid,
          results,
          fragility_score: fragilityScore,
          volatility_index: volatilityIndex,
          breakpoints,
        });
      if (insertErr) throw insertErr;

      // Decision event: stress_test_completed
      try {
        await supabase.from("scenario_decision_events").insert({
          project_id: projectId,
          event_type: "stress_test_completed",
          scenario_id: targetScenarioId,
          created_by: userId,
          payload: {
            fragility_score: fragilityScore,
            volatility_index: volatilityIndex,
            breakpoints,
            sweep_count: results.length,
          },
        });
      } catch (e: unknown) {
        console.warn("decision_event_insert_failed", "stress_test_completed", projectId, e instanceof Error ? e.message : e);
      }

      return json({
        scenarioId: targetScenarioId,
        months,
        grid,
        results,
        volatility_index: volatilityIndex,
        fragility_score: fragilityScore,
        breakpoints,
      });
    }

    // ══════════════════════════════════════
    // ACTION: branch_from_decision_event
    // ══════════════════════════════════════
    if (action === "branch_from_decision_event") {
      const eventId = body.eventId;
      if (!eventId) return json({ error: "eventId required" }, 400);

      const { data: evt, error: evtErr } = await supabase
        .from("scenario_decision_events")
        .select("*")
        .eq("id", eventId)
        .eq("project_id", projectId)
        .single();
      if (evtErr || !evt) return json({ error: "Decision event not found" }, 404);
      if (evt.event_type !== "recommendation_computed")
        return json({ error: "Only recommendation_computed events can be branched" }, 400);

      const payload = evt.payload as any;
      const snapshot = payload?.scenario_snapshot;
      if (!snapshot)
        return json({ error: "Event has no scenario_snapshot (pre-4.8 event)" }, 400);

      const overrides = snapshot.recommended_state_overrides ?? {};
      const changeReasons: string[] = payload.change_reasons ?? [];
      const confidence: number = payload.confidence ?? 0;
      const evtDate = new Date(evt.created_at);
      const dateStr = `${evtDate.getFullYear()}-${String(evtDate.getMonth() + 1).padStart(2, "0")}-${String(evtDate.getDate()).padStart(2, "0")} ${String(evtDate.getHours()).padStart(2, "0")}:${String(evtDate.getMinutes()).padStart(2, "0")}`;
      const reasonTag = changeReasons.length > 0 ? changeReasons[0].replace(/_/g, " ") : "snapshot";
      const name = body.nameOverride || `Branch — ${dateStr} — ${reasonTag}`;
      const description = `Branched from decision ${eventId}. Confidence ${confidence}. ${changeReasons.length > 0 ? "Reasons: " + changeReasons.join(", ") : ""}`.trim();

      const { data: newScenario, error: insErr } = await supabase
        .from("project_scenarios")
        .insert({
          project_id: projectId,
          name,
          description,
          scenario_type: "custom",
          pinned: false,
          is_active: false,
          is_archived: false,
          state_overrides: overrides,
        })
        .select("id")
        .single();
      if (insErr) throw insErr;

      const newScenarioId = newScenario.id;

      // Cascade overrides to compute state for the new scenario
      const { data: graph } = await supabase
        .from("project_state_graphs")
        .select("*")
        .eq("project_id", projectId)
        .single();
      if (graph) {
        const baseState: CascadedState = {
          creative_state: graph.creative_state as unknown as CreativeState,
          execution_state: graph.execution_state as unknown as ExecutionState,
          production_state: graph.production_state as unknown as ProductionState,
          finance_state: graph.finance_state as unknown as FinanceState,
          revenue_state: graph.revenue_state as unknown as RevenueState,
        };
        const merged = deepMerge(baseState as unknown as Record<string, unknown>, overrides ?? {}) as unknown as CascadedState;
        const cascaded = cascadeAll(merged);
        await supabase
          .from("project_scenarios")
          .update({ computed_state: cascaded as any })
          .eq("id", newScenarioId);
      }

      // Decision event: branch_created
      try {
        await supabase.from("scenario_decision_events").insert({
          project_id: projectId,
          event_type: "branch_created",
          scenario_id: newScenarioId,
          previous_scenario_id: snapshot.recommended_scenario_id ?? null,
          created_by: userId,
          payload: {
            source_event_id: eventId,
            source_event_type: evt.event_type,
            change_reasons: changeReasons,
            confidence,
          },
        });
      } catch (e: unknown) {
        console.warn("decision_event_insert_failed", "branch_created", projectId, e instanceof Error ? e.message : e);
      }

      return json({ newScenarioId });
    }

    // ══════════════════════════════════════
    // ACTION: diff_scenarios
    // ══════════════════════════════════════
    if (action === "diff_scenarios") {
      const aId = body.aScenarioId;
      const bId = body.bScenarioId;
      if (!aId || !bId) return json({ error: "aScenarioId and bScenarioId required" }, 400);

      const [{ data: scenA }, { data: scenB }] = await Promise.all([
        supabase.from("project_scenarios").select("id, state_overrides").eq("id", aId).eq("project_id", projectId).single(),
        supabase.from("project_scenarios").select("id, state_overrides").eq("id", bId).eq("project_id", projectId).single(),
      ]);
      if (!scenA) return json({ error: "Scenario A not found" }, 404);
      if (!scenB) return json({ error: "Scenario B not found" }, 404);

      const overA = (scenA.state_overrides ?? {}) as Record<string, unknown>;
      const overB = (scenB.state_overrides ?? {}) as Record<string, unknown>;

      const changes = diffOverridesDeep(overA, overB);
      const truncated = changes.length > 300;
      return json({
        aScenarioId: aId,
        bScenarioId: bId,
        changes: truncated ? changes.slice(0, 300) : changes,
        truncated,
      });
    }

    // ══════════════════════════════════════
    // ACTION: merge_scenario_overrides
    // ══════════════════════════════════════
    if (action === "merge_scenario_overrides") {
      const sourceId = body.sourceScenarioId;
      const targetId = body.targetScenarioId;
      if (!sourceId || !targetId) return json({ error: "sourceScenarioId and targetScenarioId required" }, 400);
      if (sourceId === targetId) return json({ error: "Source and target must differ" }, 400);

      const selectedPaths: string[] | undefined = body.paths;
      const strategy: string = body.strategy ?? "overwrite";
      const isPreview: boolean = body.preview === true;
      const isForce: boolean = body.force === true;

      const [{ data: srcScen }, { data: tgtScen }] = await Promise.all([
        supabase.from("project_scenarios").select("id, state_overrides, name").eq("id", sourceId).eq("project_id", projectId).single(),
        supabase.from("project_scenarios").select("id, state_overrides, name, is_locked, protected_paths, governance, merge_policy").eq("id", targetId).eq("project_id", projectId).single(),
      ]);
      if (!srcScen) return json({ error: "Source scenario not found" }, 404);
      if (!tgtScen) return json({ error: "Target scenario not found" }, 404);

      const srcOver = (srcScen.state_overrides ?? {}) as Record<string, unknown>;
      const tgtOver = JSON.parse(JSON.stringify(tgtScen.state_overrides ?? {})) as Record<string, unknown>;

      const allChanges = diffOverridesDeep(srcOver, tgtOver);
      const pathsToApply = selectedPaths
        ? allChanges.filter(c => selectedPaths.includes(c.path))
        : allChanges;

      // Check protected paths
      const protectedPaths: string[] = (tgtScen.protected_paths ?? []) as string[];
      const protectedHits = pathsToApply
        .map(c => c.path)
        .filter(p => protectedPaths.some(pp => p === pp || p.startsWith(pp + ".")));

      // Preview mode
      if (isPreview) {
        return json({
          targetScenarioId: targetId,
          sourceScenarioId: sourceId,
          strategy,
          paths_applied: pathsToApply.map(c => c.path),
          protected_hits: protectedHits,
          would_change_count: pathsToApply.length,
          is_locked: !!(tgtScen as any).is_locked,
        });
      }

      // Approval gate (Phase 5.4 + 5.5): check merge_policy.require_approval with TTL unlock
      const tgtMergePolicy = (tgtScen as any).merge_policy ?? (normalizeGovernance((tgtScen as any).governance).merge_policy ?? {});
      let approvalBypassed = false;
      let approvalDecisionUsed: { approved: boolean; created_at: string; note?: string } | null = null;
      if (tgtMergePolicy.require_approval === true && !isForce) {
        const decision = await getLatestApprovalDecision(supabase, projectId, sourceId, targetId);
        if (isApprovalValid(decision, 24)) {
          approvalBypassed = true;
          approvalDecisionUsed = decision;
        } else {
          return json({ error: "Merge requires approval", requires_approval: true, approval_valid: false }, 403);
        }
      }

      // Lock checks
      if ((tgtScen as any).is_locked && !isForce) {
        return json({ error: "Target scenario is locked" }, 403);
      }
      if (protectedHits.length > 0 && !isForce) {
        return json({ error: "Protected paths require force", protected_hits: protectedHits }, 403);
      }

      for (const change of pathsToApply) {
        const srcVal = getNestedValue(srcOver, change.path);
        if (strategy === "fill_missing") {
          const curVal = getNestedValue(tgtOver, change.path);
          if (curVal !== null && curVal !== undefined) continue;
        }
        setNestedValue(tgtOver, change.path, srcVal);
      }

      // Persist updated overrides
      const { error: updErr } = await supabase
        .from("project_scenarios")
        .update({ state_overrides: tgtOver })
        .eq("id", targetId);
      if (updErr) throw updErr;

      // Recompute computed_state
      let postMergeCs: CascadedState | null = null;
      const { data: graph } = await supabase
        .from("project_state_graphs")
        .select("*")
        .eq("project_id", projectId)
        .single();
      if (graph) {
        const creative = {
          ...(graph.creative_state as unknown as CreativeState),
          ...((tgtOver as any).creative_state ?? {}),
        };
        const cascaded = runFullCascade(creative, tgtOver as StateOverrides);
        postMergeCs = cascaded;
        await supabase
          .from("project_scenarios")
          .update({ computed_state: cascaded as any })
          .eq("id", targetId);
      }

      // Phase 5.3: Update governance risk memory
      try {
        // Re-fetch target scenario to get current governance
        const { data: updatedTgt } = await supabase
          .from("project_scenarios")
          .select("governance, computed_state, protected_paths")
          .eq("id", targetId)
          .single();

        if (updatedTgt) {
          const gov = normalizeGovernance(updatedTgt.governance);

          // Get drift counts for confidence calculation
          const { data: driftData } = await supabase
            .from("drift_alerts")
            .select("severity")
            .eq("project_id", projectId)
            .eq("scenario_id", targetId)
            .eq("acknowledged", false);
          const driftCritical = (driftData ?? []).filter((d: any) => d.severity === "critical").length;
          const driftWarning = (driftData ?? []).filter((d: any) => d.severity === "warning").length;

          // Compute confidence before/after from computed_state
          const preMergeCs = tgtScen.computed_state as unknown as CascadedState | null;
          const confidenceBefore = preMergeCs?.revenue_state?.confidence_score ?? null;
          const confidenceAfter = postMergeCs?.revenue_state?.confidence_score ?? null;

          // Update path_weights
          const pathWeights = { ...gov.risk_memory.path_weights };
          const appliedPaths = pathsToApply.map(c => c.path);
          for (const p of appliedPaths) {
            const current = pathWeights[p] ?? 0;
            let increment = 0;
            if (isForce) increment += 2;
            if (protectedHits.includes(p)) increment += 2;
            if (confidenceBefore !== null && confidenceAfter !== null && confidenceAfter < confidenceBefore) increment += 2;
            if (driftCritical > 0 || driftWarning > 0) increment += 3;
            if (increment > 0) {
              pathWeights[p] = Math.min(20, current + increment);
            }
          }

          // Append merge outcome (keep last 20)
          const mergeOutcome = {
            at: new Date().toISOString(),
            sourceScenarioId: sourceId,
            targetScenarioId: targetId,
            risk_score: undefined as number | undefined,
            required_approval: false,
            forced: isForce,
            paths: appliedPaths.slice(0, 20),
            drift_critical: driftCritical,
            drift_warning: driftWarning,
            confidence_before: confidenceBefore ?? undefined,
            confidence_after: confidenceAfter ?? undefined,
          };
          const outcomes = [...gov.risk_memory.merge_outcomes, mergeOutcome].slice(-20);

          // Recompute governance confidence
          const protCount = ((updatedTgt.protected_paths ?? []) as string[]).length;
          const recentOutcomes = outcomes.slice(-10);
          const approvalsReq = recentOutcomes.filter(o => o.required_approval).length;
          const lastRisk = recentOutcomes.length > 0 ? (recentOutcomes[recentOutcomes.length - 1].risk_score ?? 0) : 0;
          const newScore = computeGovernanceConfidence({
            protected_paths_count: protCount,
            approvals_required_last10: approvalsReq,
            unacknowledged_drift_alerts_count: (driftData ?? []).length,
            risk_score_last: lastRisk,
          });

          let updatedGov: NormalizedGovernance = {
            ...gov,
            risk_memory: { path_weights: pathWeights, merge_outcomes: outcomes },
            governance_confidence_score: newScore,
          };

          // Check for escalation
          const recentHighRisk = outcomes.slice(-5).filter(o => (o.risk_score ?? 0) >= 70 || o.forced).length;
          const { governance: escalatedGov, escalated } = maybeEscalatePolicy(updatedGov, newScore, recentHighRisk);
          updatedGov = escalatedGov;

          // Persist governance
          await supabase
            .from("project_scenarios")
            .update({ governance: updatedGov as any, merge_policy: updatedGov.merge_policy ?? {} })
            .eq("id", targetId);

          // Log escalation event if escalated
          if (escalated) {
            try {
              await supabase.from("scenario_decision_events").insert({
                project_id: projectId,
                event_type: "governance_policy_escalated",
                scenario_id: targetId,
                created_by: userId,
                payload: {
                  score: newScore,
                  recentHighRiskCount: recentHighRisk,
                  new_policy: updatedGov.merge_policy,
                },
              });
            } catch (_) { /* non-fatal */ }
          }

          // Log governance_memory_updated event
          const topWeightsChanged = appliedPaths
            .filter(p => pathWeights[p] > 0)
            .sort((a, b) => (pathWeights[b] ?? 0) - (pathWeights[a] ?? 0))
            .slice(0, 8)
            .map(p => ({ path: p, new_weight: pathWeights[p] }));

          try {
            await supabase.from("scenario_decision_events").insert({
              project_id: projectId,
              event_type: "governance_memory_updated",
              scenario_id: targetId,
              previous_scenario_id: sourceId,
              created_by: userId,
              payload: {
                paths_count: appliedPaths.length,
                forced: isForce,
                required_approval: false,
                score: newScore,
                top_weighted_paths_changed: topWeightsChanged,
              },
            });
          } catch (_) { /* non-fatal */ }
        }
      } catch (govErr) {
        console.warn("governance_memory_update_failed", govErr instanceof Error ? govErr.message : govErr);
      }

      // Decision event: merge_approval_consumed (Phase 5.5)
      if (approvalBypassed && approvalDecisionUsed) {
        try {
          await supabase.from("scenario_decision_events").insert({
            project_id: projectId,
            event_type: "merge_approval_consumed",
            scenario_id: targetId,
            previous_scenario_id: sourceId,
            created_by: userId,
            payload: {
              approved_at: approvalDecisionUsed.created_at,
              ttl_hours: 24,
            },
          });
        } catch (_) { /* non-fatal */ }
      }

      // Decision event: scenario_merged
      try {
        await supabase.from("scenario_decision_events").insert({
          project_id: projectId,
          event_type: "scenario_merged",
          scenario_id: targetId,
          previous_scenario_id: sourceId,
          created_by: userId,
          payload: {
            paths_applied: pathsToApply.map(c => c.path),
            strategy,
            sourceScenarioId: sourceId,
            targetScenarioId: targetId,
            change_count: pathsToApply.length,
            forced: isForce,
            approval_bypassed: approvalBypassed,
            protected_hits: protectedHits,
          },
        });
      } catch (e: unknown) {
        console.warn("decision_event_insert_failed", "scenario_merged", projectId, e instanceof Error ? e.message : e);
      }

      return json({
        targetScenarioId: targetId,
        paths_applied: pathsToApply.map(c => c.path),
        change_count: pathsToApply.length,
      });
    }

    // ══════════════════════════════════════
    // ACTION: set_scenario_lock
    // ══════════════════════════════════════
    if (action === "set_scenario_lock") {
      const lockScenarioId = body.scenarioId;
      if (!lockScenarioId) return json({ error: "scenarioId required" }, 400);
      const isLocked: boolean = !!body.isLocked;
      const protectedPaths: string[] = Array.isArray(body.protectedPaths)
        ? body.protectedPaths.filter((p: unknown) => typeof p === "string" && p.trim().length > 0).map((p: string) => p.trim())
        : [];

      const updatePayload: Record<string, unknown> = {
        is_locked: isLocked,
        protected_paths: protectedPaths,
        locked_at: isLocked ? new Date().toISOString() : null,
        locked_by: isLocked ? userId : null,
      };

      const { error: lockErr } = await supabase
        .from("project_scenarios")
        .update(updatePayload)
        .eq("id", lockScenarioId)
        .eq("project_id", projectId);
      if (lockErr) throw lockErr;

      // Decision event
      try {
        await supabase.from("scenario_decision_events").insert({
          project_id: projectId,
          event_type: "scenario_lock_changed",
          scenario_id: lockScenarioId,
          created_by: userId,
          payload: {
            is_locked: isLocked,
            protected_paths_count: protectedPaths.length,
          },
        });
      } catch (e: unknown) {
        console.warn("decision_event_insert_failed", "scenario_lock_changed", projectId, e instanceof Error ? e.message : e);
      }

      return json({ scenarioId: lockScenarioId, is_locked: isLocked, protected_paths: protectedPaths });
    }

    // ══════════════════════════════════════
    // ACTION: scan_override_governance
    // ══════════════════════════════════════
    if (action === "scan_override_governance") {
      const govScenarioId = body.scenarioId;
      if (!govScenarioId) return json({ error: "scenarioId required" }, 400);

      const { data: govScen } = await supabase
        .from("project_scenarios")
        .select("id, computed_state, state_overrides, governance, is_locked, protected_paths")
        .eq("id", govScenarioId)
        .eq("project_id", projectId)
        .single();
      if (!govScen) return json({ error: "Scenario not found" }, 404);

      // Always-critical paths
      const suggestedProtected: string[] = [
        "creative_state.format",
        "creative_state.runtime_minutes",
        "creative_state.episode_count",
        "finance_state.budget_band",
        "finance_state.budget_estimate",
        "production_state.estimated_shoot_days",
      ];

      // Check drift alerts for this scenario
      const { data: driftAlerts } = await supabase
        .from("drift_alerts")
        .select("metric_key")
        .eq("project_id", projectId)
        .eq("scenario_id", govScenarioId)
        .eq("acknowledged", false);

      const driftMetricPathMap: Record<string, string> = {
        budget_estimate: "finance_state.budget_estimate",
        estimated_shoot_days: "production_state.estimated_shoot_days",
        schedule_compression_risk: "production_state.schedule_compression_risk",
        platform_appetite_strength: "revenue_state.platform_appetite_strength",
        confidence_score: "revenue_state.confidence_score",
      };

      if (driftAlerts) {
        for (const alert of driftAlerts) {
          const mapped = driftMetricPathMap[alert.metric_key];
          if (mapped && !suggestedProtected.includes(mapped)) {
            suggestedProtected.push(mapped);
          }
        }
      }

      // Critical paths = paths that exist in overrides AND are in suggested list
      const overrides = (govScen.state_overrides ?? {}) as Record<string, unknown>;
      const criticalPaths: string[] = [];
      for (const sp of suggestedProtected) {
        const val = getNestedValue(overrides, sp);
        if (val !== null && val !== undefined) {
          criticalPaths.push(sp);
        }
      }

      // Risk hotspots: paths with high-drift metric keys
      const riskHotspots: string[] = (driftAlerts ?? [])
        .map((a: any) => driftMetricPathMap[a.metric_key])
        .filter((p: string | undefined): p is string => !!p);

      // Normalize existing governance
      const existingGov = normalizeGovernance((govScen as any).governance);

      // Compute governance confidence score
      const unackDriftCount = (driftAlerts ?? []).length;
      const protPathsCount = ((govScen as any).protected_paths ?? []).length;
      const recentOutcomes = existingGov.risk_memory.merge_outcomes.slice(-10);
      const approvalsRequired = recentOutcomes.filter(o => o.required_approval).length;
      const lastRiskScore = recentOutcomes.length > 0 ? (recentOutcomes[recentOutcomes.length - 1].risk_score ?? 0) : 0;
      const governanceConfidenceScore = computeGovernanceConfidence({
        protected_paths_count: protPathsCount,
        approvals_required_last10: approvalsRequired,
        unacknowledged_drift_alerts_count: unackDriftCount,
        risk_score_last: lastRiskScore,
      });

      // Top risky paths
      const topRiskyPaths = Object.entries(existingGov.risk_memory.path_weights)
        .sort(([, a], [, b]) => b - a)
        .slice(0, 10)
        .map(([path, weight]) => ({ path, weight }));

      // Persist governance data
      const governanceData = {
        ...existingGov,
        suggested_protected_paths: suggestedProtected,
        critical_paths: criticalPaths,
        governance_confidence_score: governanceConfidenceScore,
        last_governance_scan_at: new Date().toISOString(),
        last_governance_scan_by: userId,
      };

      const shouldApply = body.apply === true && !(govScen as any).is_locked;

      if (shouldApply) {
        await supabase
          .from("project_scenarios")
          .update({ governance: governanceData })
          .eq("id", govScenarioId)
          .eq("project_id", projectId);
      }

      // Decision event
      try {
        await supabase.from("scenario_decision_events").insert({
          project_id: projectId,
          event_type: "governance_scanned",
          scenario_id: govScenarioId,
          created_by: userId,
          payload: {
            suggested_count: suggestedProtected.length,
            critical_count: criticalPaths.length,
            risk_hotspot_count: riskHotspots.length,
            governance_confidence_score: governanceConfidenceScore,
            applied: shouldApply,
          },
        });
      } catch (e: unknown) {
        console.warn("decision_event_insert_failed", "governance_scanned", projectId, e instanceof Error ? e.message : e);
      }

      return json({
        scenarioId: govScenarioId,
        suggested_protected_paths: suggestedProtected,
        critical_paths: criticalPaths,
        risk_hotspots: riskHotspots,
        governance_confidence_score: governanceConfidenceScore,
        top_risky_paths: topRiskyPaths,
        merge_policy: existingGov.merge_policy ?? {},
        updated: shouldApply,
      });
    }

    // ══════════════════════════════════════
    // ACTION: evaluate_merge_risk
    // ══════════════════════════════════════
    if (action === "evaluate_merge_risk") {
      const srcId = body.sourceScenarioId;
      const tgtId = body.targetScenarioId;
      const evalPaths: string[] = body.paths ?? [];
      const evalStrategy: string = body.strategy ?? "overwrite";
      const evalForce: boolean = body.force === true;

      if (!srcId || !tgtId) return json({ error: "sourceScenarioId and targetScenarioId required" }, 400);

      const [{ data: srcScen }, { data: tgtScen }] = await Promise.all([
        supabase.from("project_scenarios").select("id, state_overrides, computed_state, name").eq("id", srcId).eq("project_id", projectId).single(),
        supabase.from("project_scenarios").select("id, state_overrides, computed_state, name, is_locked, protected_paths, governance, merge_policy").eq("id", tgtId).eq("project_id", projectId).single(),
      ]);
      if (!srcScen) return json({ error: "Source scenario not found" }, 404);
      if (!tgtScen) return json({ error: "Target scenario not found" }, 404);

      const srcOver = (srcScen.state_overrides ?? {}) as Record<string, unknown>;
      const tgtOver = JSON.parse(JSON.stringify(tgtScen.state_overrides ?? {})) as Record<string, unknown>;
      const protPaths: string[] = ((tgtScen as any).protected_paths ?? []) as string[];
      const governance = normalizeGovernance((tgtScen as any).governance);
      const mergePolicy = (tgtScen as any).merge_policy ?? {};
      const criticalPaths: string[] = governance.critical_paths ?? [];

      // Compute which paths would be applied
      const allChanges = diffOverridesDeep(srcOver, tgtOver);
      const pathsToApply = evalPaths.length > 0
        ? allChanges.filter(c => evalPaths.includes(c.path))
        : allChanges;

      const protectedHits = pathsToApply
        .map(c => c.path)
        .filter(p => protPaths.some(pp => p === pp || p.startsWith(pp + ".")));

      const criticalHits = pathsToApply
        .map(c => c.path)
        .filter(p => criticalPaths.some(cp => p === cp || p.startsWith(cp + ".")));

      // Risk scoring
      let riskScore = 10;
      const affectedDomains = new Set<string>();
      for (const c of pathsToApply) {
        const domain = c.path.split(".")[0];
        affectedDomains.add(domain);
      }
      if (affectedDomains.has("finance_state") || affectedDomains.has("production_state")) riskScore += 25;
      const touchesRuntime = pathsToApply.some(c => c.path === "creative_state.runtime_minutes" || c.path === "creative_state.episode_count");
      if (touchesRuntime) riskScore += 20;
      if ((tgtScen as any).is_locked) riskScore += 20;
      if (protectedHits.length > 0) riskScore += 15;
      if (pathsToApply.length > 12) riskScore += 10;

      // Phase 5.3: Add risk memory weighting
      const riskMemoryHits: Array<{ path: string; weight: number }> = [];
      const pathWeights = governance.risk_memory.path_weights;
      for (const c of pathsToApply) {
        let matchWeight = 0;
        // Exact match
        if (pathWeights[c.path]) {
          matchWeight = pathWeights[c.path];
        } else {
          // Prefix match
          for (const [storedPath, w] of Object.entries(pathWeights)) {
            if (c.path.startsWith(storedPath + ".") || storedPath.startsWith(c.path + ".")) {
              matchWeight = Math.max(matchWeight, w);
            }
          }
        }
        if (matchWeight > 0) {
          riskScore += Math.min(5, matchWeight);
          riskMemoryHits.push({ path: c.path, weight: matchWeight });
        }
      }
      riskMemoryHits.sort((a, b) => b.weight - a.weight);

      // Conflict detection via cascade
      const conflicts: { type: string; message: string; paths: string[] }[] = [];

      const tgtCs = tgtScen.computed_state as unknown as CascadedState | null;
      if (tgtCs?.creative_state) {
        const mergedOverrides = JSON.parse(JSON.stringify(tgtOver));
        for (const change of pathsToApply) {
          const srcVal = getNestedValue(srcOver, change.path);
          if (evalStrategy === "fill_missing") {
            const curVal = getNestedValue(mergedOverrides, change.path);
            if (curVal !== null && curVal !== undefined) continue;
          }
          setNestedValue(mergedOverrides, change.path, srcVal);
        }

        const { data: graph } = await supabase
          .from("project_state_graphs")
          .select("creative_state")
          .eq("project_id", projectId)
          .single();

        if (graph) {
          const mergedCreative: CreativeState = {
            ...(graph.creative_state as unknown as CreativeState),
            ...((mergedOverrides as any).creative_state ?? {}),
          };
          const postMerge = runFullCascade(mergedCreative, mergedOverrides as StateOverrides);

          if (postMerge.finance_state.budget_estimate > tgtCs.finance_state.budget_estimate &&
              postMerge.revenue_state.platform_appetite_strength < tgtCs.revenue_state.platform_appetite_strength) {
            conflicts.push({
              type: "economics_misalignment",
              message: "Budget increases but platform appetite decreases",
              paths: pathsToApply.filter(c => c.path.startsWith("finance_state") || c.path.startsWith("creative_state")).map(c => c.path),
            });
          }
          if (postMerge.production_state.estimated_shoot_days > tgtCs.production_state.estimated_shoot_days &&
              postMerge.production_state.schedule_compression_risk > tgtCs.production_state.schedule_compression_risk) {
            conflicts.push({
              type: "schedule_stress",
              message: "Shoot days increase and schedule compression risk rises",
              paths: pathsToApply.filter(c => c.path.startsWith("production_state") || c.path.startsWith("execution_state")).map(c => c.path),
            });
          }
          if (postMerge.revenue_state.downside_exposure > tgtCs.revenue_state.downside_exposure &&
              postMerge.revenue_state.confidence_score < tgtCs.revenue_state.confidence_score) {
            conflicts.push({
              type: "risk_confidence_drop",
              message: "Downside exposure increases while confidence drops",
              paths: pathsToApply.filter(c => c.path.startsWith("revenue_state") || c.path.startsWith("finance_state")).map(c => c.path),
            });
          }
        }
      }

      const riskLevel = riskScore < 25 ? "low" : riskScore < 45 ? "medium" : riskScore < 70 ? "high" : "critical";

      const requiresApproval =
        riskLevel === "high" || riskLevel === "critical" ||
        conflicts.length >= 2 ||
        criticalHits.length > 0 ||
        mergePolicy.require_approval === true;

      const recommendedActions: string[] = [];
      if (protectedHits.length > 0) recommendedActions.push("Review protected paths or force intentionally");
      if (conflicts.some(c => c.type === "schedule_stress")) recommendedActions.push("Consider reducing execution complexity or adjusting schedule assumptions");
      if (conflicts.some(c => c.type === "economics_misalignment")) recommendedActions.push("Review budget vs platform appetite alignment");
      if (conflicts.some(c => c.type === "risk_confidence_drop")) recommendedActions.push("Assess downside exposure before committing");

      const result = {
        risk_score: Math.min(100, riskScore),
        risk_level: riskLevel,
        conflicts,
        affected_domains: Array.from(affectedDomains),
        recommended_actions: recommendedActions,
        requires_approval: requiresApproval,
        approval_reason: requiresApproval
          ? (criticalHits.length > 0 ? "Touches critical governance paths" : riskLevel === "critical" ? "Critical risk level" : conflicts.length >= 2 ? "Multiple conflicts detected" : mergePolicy.require_approval ? "Merge policy requires approval" : "High risk")
          : undefined,
        protected_hits: protectedHits,
        critical_hits: criticalHits,
        risk_memory_hits: riskMemoryHits.slice(0, 8),
        governance_confidence_score: governance.governance_confidence_score,
      };

      // Decision event
      try {
        await supabase.from("scenario_decision_events").insert({
          project_id: projectId,
          event_type: "merge_risk_evaluated",
          scenario_id: tgtId,
          previous_scenario_id: srcId,
          created_by: userId,
          payload: {
            risk_score: result.risk_score,
            risk_level: result.risk_level,
            conflict_count: conflicts.length,
            requires_approval: result.requires_approval,
            risk_memory_hits_count: riskMemoryHits.length,
            governance_confidence_score: governance.governance_confidence_score,
          },
        });
      } catch (e: unknown) {
        console.warn("decision_event_insert_failed", "merge_risk_evaluated", projectId, e instanceof Error ? e.message : e);
      }

      return json(result);
    }

    // ══════════════════════════════════════
    // ACTION: request_merge_approval
    // ══════════════════════════════════════
    if (action === "request_merge_approval") {
      const sourceId = body.sourceScenarioId;
      const targetId = body.targetScenarioId ?? body.scenarioId;
      if (!targetId) return json({ error: "targetScenarioId or scenarioId required" }, 400);
      const riskReport = body.riskReport ?? body.payload ?? {};

      // Decision event (non-fatal)
      try {
        await supabase.from("scenario_decision_events").insert({
          project_id: projectId,
          event_type: "merge_approval_requested",
          scenario_id: targetId,
          previous_scenario_id: sourceId ?? null,
          created_by: userId,
          payload: {
            risk_score: riskReport.risk_score ?? null,
            risk_level: riskReport.risk_level ?? null,
            conflicts_count: riskReport.conflicts?.length ?? riskReport.conflicts_count ?? 0,
            requested_at: new Date().toISOString(),
          },
        });
      } catch (e: unknown) {
        console.warn("decision_event_insert_failed", "merge_approval_requested", projectId, e instanceof Error ? e.message : e);
      }

      return json({ requested: true });
    }

    // ══════════════════════════════════════
    // ACTION: decide_merge_approval
    // ══════════════════════════════════════
    if (action === "decide_merge_approval") {
      const sourceId = body.sourceScenarioId;
      const targetId = body.targetScenarioId;
      const approved: boolean = body.approved === true;
      const note: string | undefined = body.note;
      if (!targetId) return json({ error: "targetScenarioId required" }, 400);

      // Decision event (non-fatal)
      try {
        await supabase.from("scenario_decision_events").insert({
          project_id: projectId,
          event_type: "merge_approval_decided",
          scenario_id: targetId,
          previous_scenario_id: sourceId ?? null,
          created_by: userId,
          payload: {
            approved,
            decided_at: new Date().toISOString(),
            note: note ?? null,
            sourceScenarioId: sourceId ?? null,
            targetScenarioId: targetId,
          },
        });
      } catch (e: unknown) {
        console.warn("decision_event_insert_failed", "merge_approval_decided", projectId, e instanceof Error ? e.message : e);
      }

      return json({ approved });
    }

    return json({ error: `Unknown action: ${action}` }, 400);
  } catch (err: unknown) {
    const message =
      err instanceof Error ? err.message : "Internal error";
    console.error("simulation-engine error:", err);
    return json({ error: message }, 500);
  }
});
