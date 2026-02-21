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

// ---- Cascade Logic (deterministic, no LLM) ----

function cascadeCreativeToExecution(c: CreativeState): Partial<ExecutionState> {
  const baseSetups = c.runtime_minutes * 0.8;
  const densityMultiplier = 1 + (c.structural_density - 5) * 0.1;
  return {
    setup_count: Math.round(baseSetups * densityMultiplier),
    coverage_density: Math.min(10, c.structural_density * 0.8 + c.hook_intensity * 0.2),
    movement_intensity: Math.min(10, c.hook_intensity * 0.7 + c.structural_density * 0.3),
    lighting_complexity: c.tone_classification === "noir" || c.tone_classification === "thriller" ? 8 : 5,
    editorial_fragility: Math.min(10, c.character_density * 0.4 + c.structural_density * 0.6),
    equipment_load_multiplier: 1 + (c.hook_intensity - 5) * 0.05,
  };
}

function cascadeExecutionToProduction(e: ExecutionState): Partial<ProductionState> {
  const baseDays = Math.ceil(e.setup_count / 25);
  const nightPenalty = 1 + e.night_exterior_ratio * 0.3;
  return {
    estimated_shoot_days: Math.round(baseDays * nightPenalty),
    crew_intensity_band: e.equipment_load_multiplier > 1.3 ? "premium" : e.equipment_load_multiplier > 1.15 ? "heavy" : e.equipment_load_multiplier > 1.0 ? "standard" : "lean",
    schedule_compression_risk: Math.min(10, Math.max(0, (e.setup_count / Math.max(1, baseDays) - 20) * 0.5 + e.vfx_stunt_density * 0.3)),
    overtime_probability: Math.min(1, (e.movement_intensity + e.lighting_complexity) / 20 + e.night_exterior_ratio * 0.2),
  };
}

function cascadeProductionToFinance(p: ProductionState, creative: CreativeState): Partial<FinanceState> {
  const crewCostMap: Record<string, number> = { lean: 0.7, standard: 1.0, heavy: 1.4, premium: 2.0 };
  const crewMult = crewCostMap[p.crew_intensity_band] || 1.0;
  const baseBudget = p.estimated_shoot_days * 50000 * crewMult;
  const budgetBand = baseBudget < 1_000_000 ? "micro" : baseBudget < 5_000_000 ? "low" : baseBudget < 15_000_000 ? "mid" : baseBudget < 40_000_000 ? "mid-high" : "high";
  return {
    budget_band: budgetBand,
    budget_estimate: Math.round(baseBudget),
    budget_elasticity: Math.max(0, 10 - p.schedule_compression_risk),
    drift_sensitivity: Math.min(10, p.schedule_compression_risk * 0.6 + p.overtime_probability * 10 * 0.4),
    insurance_load_proxy: Math.min(10, p.weather_exposure * 0.4 + p.overtime_probability * 10 * 0.3 + (creative.hook_intensity > 7 ? 3 : 0)),
    capital_stack_stress: Math.min(10, (baseBudget > 20_000_000 ? 7 : baseBudget > 10_000_000 ? 5 : 3) + p.schedule_compression_risk * 0.2),
  };
}

function cascadeFinanceToRevenue(f: FinanceState, creative: CreativeState): Partial<RevenueState> {
  const hookBonus = creative.hook_intensity > 7 ? 2 : creative.hook_intensity > 5 ? 1 : 0;
  const baseConfidence = 50 + hookBonus * 5 - f.capital_stack_stress * 3 - f.drift_sensitivity * 2;
  return {
    roi_probability_bands: {
      low: Math.max(0, baseConfidence - 20),
      mid: Math.max(0, baseConfidence),
      high: Math.min(100, baseConfidence + 15),
    },
    downside_exposure: Math.min(10, f.capital_stack_stress * 0.5 + f.drift_sensitivity * 0.5),
    upside_potential: Math.min(10, creative.hook_intensity * 0.5 + (10 - f.capital_stack_stress) * 0.3 + hookBonus),
    platform_appetite_strength: Math.min(10, creative.hook_intensity * 0.4 + (creative.behaviour_mode === "commercial" ? 3 : creative.behaviour_mode === "prestige" ? 2 : 1)),
    confidence_score: Math.max(0, Math.min(100, Math.round(baseConfidence))),
  };
}

function runFullCascade(creative: CreativeState, overrides: StateOverrides = {}): CascadedState {
  const execBase = cascadeCreativeToExecution(creative);
  const execution: ExecutionState = {
    setup_count: 0, coverage_density: 0, movement_intensity: 0,
    lighting_complexity: 5, night_exterior_ratio: 0.1, vfx_stunt_density: 0,
    editorial_fragility: 5, equipment_load_multiplier: 1.0,
    ...execBase,
    ...overrides.execution_state,
  };

  const prodBase = cascadeExecutionToProduction(execution);
  const production: ProductionState = {
    estimated_shoot_days: 25, crew_intensity_band: "standard",
    schedule_compression_risk: 5, location_clustering: 5, weather_exposure: 3, overtime_probability: 0.2,
    ...prodBase,
    ...overrides.production_state,
  };

  const finBase = cascadeProductionToFinance(production, creative);
  const finance: FinanceState = {
    budget_band: "mid", budget_estimate: 0, budget_elasticity: 5,
    drift_sensitivity: 5, insurance_load_proxy: 3, capital_stack_stress: 5,
    ...finBase,
    ...overrides.finance_state,
  };

  const revBase = cascadeFinanceToRevenue(finance, creative);
  const revenue: RevenueState = {
    roi_probability_bands: { low: 30, mid: 50, high: 65 },
    downside_exposure: 5, upside_potential: 5, platform_appetite_strength: 5,
    comparable_alignment_delta: 0, confidence_score: 50,
    ...revBase,
    ...overrides.revenue_state,
  };

  return { creative_state: creative, execution_state: execution, production_state: production, finance_state: finance, revenue_state: revenue };
}

function generateConfidenceBands(state: CascadedState) {
  return {
    budget: { low: Math.round(state.finance_state.budget_estimate * 0.85), mid: state.finance_state.budget_estimate, high: Math.round(state.finance_state.budget_estimate * 1.2) },
    shoot_days: { low: Math.max(1, state.production_state.estimated_shoot_days - 5), mid: state.production_state.estimated_shoot_days, high: state.production_state.estimated_shoot_days + 8 },
    confidence: state.revenue_state.confidence_score,
  };
}

function diffNumberObject(from: Record<string, number> | undefined, to: Record<string, number> | undefined): Record<string, { from: number; to: number; delta: number }> | null {
  if (!from || !to) return null;
  const result: Record<string, { from: number; to: number; delta: number }> = {};
  for (const key of new Set([...Object.keys(from), ...Object.keys(to)])) {
    const fv = typeof from[key] === "number" ? from[key] : 0;
    const tv = typeof to[key] === "number" ? to[key] : 0;
    if (fv !== tv) {
      result[key] = { from: fv, to: tv, delta: +(tv - fv).toFixed(2) };
    }
  }
  return Object.keys(result).length > 0 ? result : null;
}

function computeDelta(baseline: CascadedState, computed: CascadedState): Record<string, any> {
  const delta: Record<string, any> = {};
  for (const layer of ["creative_state", "execution_state", "production_state", "finance_state", "revenue_state"] as const) {
    const b = (baseline as any)[layer] || {};
    const c = (computed as any)[layer] || {};
    const layerDelta: Record<string, any> = {};
    for (const key of new Set([...Object.keys(b), ...Object.keys(c)])) {
      const bv = b[key];
      const cv = c[key];
      if (typeof cv === "object" && cv !== null && !Array.isArray(cv) && typeof bv === "object" && bv !== null) {
        const nested = diffNumberObject(bv, cv);
        if (nested) layerDelta[key] = nested;
      } else if (typeof cv === "number" && typeof bv === "number" && cv !== bv) {
        layerDelta[key] = { from: bv, to: cv, delta: +(cv - bv).toFixed(2) };
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

  if ((exec.setup_count ?? 0) > 200 && prod.estimated_shoot_days != null && prod.estimated_shoot_days < 15) {
    flags.push("High setup count with very short schedule — likely unrealistic");
  }
  if (fin.budget_band === "micro" && (exec.vfx_stunt_density ?? 0) > 7) {
    flags.push("Micro budget with high VFX density — funding gap risk");
  }
  if ((prod.overtime_probability ?? 0) > 0.7 && (fin.drift_sensitivity ?? 999) < 3) {
    flags.push("High overtime probability but low drift sensitivity — underestimating budget risk");
  }
  return flags;
}

/** Apply cascaded state layers + confidence bands to the canonical project_state_graphs row */
async function syncGraphToState(supabase: any, projectId: string, cascaded: CascadedState, bands: any) {
  await supabase.from("project_state_graphs").update({
    ...cascaded,
    confidence_bands: bands,
    last_cascade_at: new Date().toISOString(),
  }).eq("project_id", projectId);
}

// ---- Request Handler ----

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const json = (data: any, status = 200) =>
    new Response(JSON.stringify(data), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

  try {
    // ── Auth: verify JWT and get user ──
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return json({ error: "Unauthorized" }, 401);
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } }
    );

    const { data: { user }, error: userErr } = await supabase.auth.getUser();
    if (userErr || !user) {
      return json({ error: "Unauthorized" }, 401);
    }
    const userId = user.id;

    const body = await req.json();
    const { action, projectId, scenarioId, overrides, creativeState } = body as {
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

    // ── ACTION: initialize ──
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

      // Upsert or find baseline scenario
      const { data: existing } = await supabase
        .from("project_scenarios")
        .select("id")
        .eq("project_id", projectId)
        .eq("scenario_type", "baseline")
        .maybeSingle();

      let baselineId: string;

      if (!existing) {
        // Clear any stale is_active flags first
        await supabase.from("project_scenarios")
          .update({ is_active: false })
          .eq("project_id", projectId);

        const { data: newBaseline, error: bErr } = await supabase.from("project_scenarios").insert({
          project_id: projectId,
          user_id: userId,
          name: "Baseline",
          scenario_type: "baseline",
          is_active: true,
          computed_state: cascaded,
          state_overrides: {},
          delta_vs_baseline: {},
        }).select("id").single();

        if (bErr) throw bErr;
        baselineId = newBaseline.id;
      } else {
        baselineId = existing.id;
        // Ensure only baseline is active
        await supabase.from("project_scenarios")
          .update({ is_active: false })
          .eq("project_id", projectId);
        await supabase.from("project_scenarios")
          .update({ computed_state: cascaded, delta_vs_baseline: {}, is_active: true })
          .eq("id", baselineId);
      }

      // Upsert state graph with active scenario
      const { data: graph, error: graphErr } = await supabase
        .from("project_state_graphs")
        .upsert({
          project_id: projectId,
          user_id: userId,
          ...cascaded,
          confidence_bands: bands,
          assumption_multipliers: {},
          last_cascade_at: new Date().toISOString(),
          active_scenario_id: baselineId,
          active_scenario_set_at: new Date().toISOString(),
          active_scenario_set_by: userId,
        }, { onConflict: "project_id" })
        .select()
        .single();

      if (graphErr) throw graphErr;

      return json({ stateGraph: graph, cascaded, confidence_bands: bands });
    }

    // ── ACTION: set_active_scenario ──
    if (action === "set_active_scenario") {
      const targetScenarioId = body.scenarioId || scenarioId;
      if (!targetScenarioId) return json({ error: "scenarioId required" }, 400);

      // Confirm scenario belongs to project
      const { data: scenario } = await supabase
        .from("project_scenarios")
        .select("id, computed_state")
        .eq("id", targetScenarioId)
        .eq("project_id", projectId)
        .single();

      if (!scenario) return json({ error: "Scenario not found or not in this project" }, 404);

      // Deactivate all, activate target
      await supabase.from("project_scenarios")
        .update({ is_active: false })
        .eq("project_id", projectId);

      await supabase.from("project_scenarios")
        .update({ is_active: true })
        .eq("id", targetScenarioId);

      // Sync canonical state graph to match scenario's computed_state
      const cs = scenario.computed_state as unknown as CascadedState;
      const bands = generateConfidenceBands(cs);

      await supabase.from("project_state_graphs").update({
        ...cs,
        confidence_bands: bands,
        last_cascade_at: new Date().toISOString(),
        active_scenario_id: targetScenarioId,
        active_scenario_set_at: new Date().toISOString(),
        active_scenario_set_by: userId,
      }).eq("project_id", projectId);

      // Fetch updated graph
      const { data: graph } = await supabase
        .from("project_state_graphs")
        .select("*")
        .eq("project_id", projectId)
        .single();

      return json({ activeScenarioId: targetScenarioId, stateGraph: graph });
    }

    // ── ACTION: cascade ──
    if (action === "cascade") {
      const { data: graph } = await supabase
        .from("project_state_graphs")
        .select("*")
        .eq("project_id", projectId)
        .single();

      if (!graph) return json({ error: "State graph not initialized" }, 400);

      const activeScenarioId = graph.active_scenario_id as string | null;

      // Determine which scenario to cascade into
      const targetScenarioId = scenarioId || activeScenarioId;

      const creative: CreativeState = { ...(graph.creative_state as unknown as CreativeState), ...overrides?.creative_state };
      const cascaded = runFullCascade(creative, overrides || {});
      const bands = generateConfidenceBands(cascaded);
      const coherence = checkCoherence(overrides || {});

      // Only update canonical state graph if cascading the active scenario
      const isActiveScenario = targetScenarioId && targetScenarioId === activeScenarioId;
      if (!targetScenarioId || isActiveScenario) {
        await syncGraphToState(supabase, projectId, cascaded, bands);
      }

      if (targetScenarioId) {
        const { data: baseline } = await supabase
          .from("project_scenarios")
          .select("computed_state")
          .eq("project_id", projectId)
          .eq("scenario_type", "baseline")
          .single();

        const delta = baseline ? computeDelta(baseline.computed_state as unknown as CascadedState, cascaded) : {};

        await supabase.from("project_scenarios").update({
          computed_state: cascaded,
          state_overrides: overrides || {},
          delta_vs_baseline: delta,
          coherence_flags: coherence,
        }).eq("id", targetScenarioId);

        await supabase.from("scenario_snapshots").insert({
          scenario_id: targetScenarioId,
          project_id: projectId,
          user_id: userId,
          trigger_reason: "cascade",
          snapshot_state: cascaded,
          confidence_bands: bands,
        });
      }

      // Drift alerts tied to the active scenario context
      const alertScenarioId = activeScenarioId || targetScenarioId || null;
      const alerts: Array<{ alert_type: string; severity: string; layer: string; metric_key: string; current_value: number; threshold: number; message: string }> = [];
      if (cascaded.production_state.schedule_compression_risk > 7) {
        alerts.push({ alert_type: "schedule_drift", severity: "warning", layer: "production", metric_key: "schedule_compression_risk", current_value: cascaded.production_state.schedule_compression_risk, threshold: 7, message: "Schedule compression risk exceeds safe threshold" });
      }
      if (cascaded.finance_state.capital_stack_stress > 7) {
        alerts.push({ alert_type: "budget_drift", severity: "warning", layer: "finance", metric_key: "capital_stack_stress", current_value: cascaded.finance_state.capital_stack_stress, threshold: 7, message: "Capital stack stress is elevated" });
      }
      if (cascaded.revenue_state.confidence_score < 30) {
        alerts.push({ alert_type: "revenue_risk", severity: "critical", layer: "revenue", metric_key: "confidence_score", current_value: cascaded.revenue_state.confidence_score, threshold: 30, message: "Revenue confidence below critical threshold" });
      }

      if (alerts.length > 0) {
        await supabase.from("drift_alerts").insert(alerts.map(a => ({
          ...a, project_id: projectId, user_id: userId, scenario_id: alertScenarioId,
        })));
      }

      return json({ cascaded, confidence_bands: bands, coherence_flags: coherence, alerts });
    }

    // ── ACTION: create_scenario ──
    if (action === "create_scenario") {
      const { name, description, scenario_type: sType } = body;

      const { data: baseline } = await supabase
        .from("project_scenarios")
        .select("computed_state")
        .eq("project_id", projectId)
        .eq("scenario_type", "baseline")
        .single();

      if (!baseline) return json({ error: "Initialize baseline first" }, 400);

      const creative: CreativeState = { ...(baseline.computed_state as any).creative_state, ...overrides?.creative_state };
      const cascaded = runFullCascade(creative, overrides || {});
      const delta = computeDelta(baseline.computed_state as unknown as CascadedState, cascaded);
      const coherence = checkCoherence(overrides || {});

      // New scenarios are NOT active by default
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
      return json({ scenario, delta, coherence_flags: coherence });
    }

    // ── ACTION: generate_system_scenarios ──
    if (action === "generate_system_scenarios") {
      const { data: baseline } = await supabase
        .from("project_scenarios")
        .select("computed_state")
        .eq("project_id", projectId)
        .eq("scenario_type", "baseline")
        .single();

      if (!baseline) return json({ error: "Initialize baseline first" }, 400);

      const bc = (baseline.computed_state as any).creative_state as CreativeState;
      const lanes: Array<{ name: string; description: string; overrides: StateOverrides }> = [
        {
          name: "Contained Prestige",
          description: "Minimize production footprint, maximize creative density",
          overrides: { creative_state: { behaviour_mode: "prestige", hook_intensity: Math.min(10, bc.hook_intensity + 1) }, execution_state: { night_exterior_ratio: 0.05, vfx_stunt_density: 1 }, production_state: { location_clustering: 8 } },
        },
        {
          name: "Premium Commercial Push",
          description: "Invest in execution for maximum audience reach",
          overrides: { creative_state: { behaviour_mode: "commercial", hook_intensity: Math.min(10, bc.hook_intensity + 2) }, execution_state: { vfx_stunt_density: 6, movement_intensity: 7 } },
        },
        {
          name: "Efficiency Optimised",
          description: "Shortest schedule, tightest budget, fastest delivery",
          overrides: { creative_state: { behaviour_mode: "efficiency" }, execution_state: { setup_count: Math.round(bc.runtime_minutes * 0.6), night_exterior_ratio: 0.05 }, production_state: { location_clustering: 9 } },
        },
      ];

      const results = [];
      for (const lane of lanes) {
        const creative: CreativeState = { ...bc, ...lane.overrides.creative_state };
        const cascaded = runFullCascade(creative, lane.overrides);
        const delta = computeDelta(baseline.computed_state as unknown as CascadedState, cascaded);
        const coherence = checkCoherence(lane.overrides);

        // System scenarios are NOT active by default
        const { data: sc } = await supabase
          .from("project_scenarios")
          .insert({
            project_id: projectId, user_id: userId,
            name: lane.name, description: lane.description,
            scenario_type: "system",
            is_active: false,
            state_overrides: lane.overrides, computed_state: cascaded,
            delta_vs_baseline: delta, coherence_flags: coherence,
          })
          .select()
          .single();

        results.push({ scenario: sc, delta, coherence_flags: coherence });
      }

      return json({ scenarios: results });
    }

    return json({ error: `Unknown action: ${action}` }, 400);
  } catch (err: any) {
    console.error("simulation-engine error:", err);
    return json({ error: err.message || "Internal error" }, 500);
  }
});
