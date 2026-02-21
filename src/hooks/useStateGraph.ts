import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';

// ---- Types ----

export type ProjectionAssumptions = {
  inflation_rate: number;
  schedule_slip_risk: number;
  platform_appetite_decay: number;
};

export interface CreativeState {
  format: string;
  runtime_minutes: number;
  episode_count: number;
  structural_density: number;
  character_density: number;
  hook_intensity: number;
  tone_classification: string;
  behaviour_mode: string;
}

export interface ExecutionState {
  setup_count: number;
  coverage_density: number;
  movement_intensity: number;
  lighting_complexity: number;
  night_exterior_ratio: number;
  vfx_stunt_density: number;
  editorial_fragility: number;
  equipment_load_multiplier: number;
}

export interface ProductionState {
  estimated_shoot_days: number;
  crew_intensity_band: string;
  schedule_compression_risk: number;
  location_clustering: number;
  weather_exposure: number;
  overtime_probability: number;
}

export interface FinanceState {
  budget_band: string;
  budget_estimate: number;
  budget_elasticity: number;
  drift_sensitivity: number;
  insurance_load_proxy: number;
  capital_stack_stress: number;
}

export interface RevenueState {
  roi_probability_bands: { low: number; mid: number; high: number };
  downside_exposure: number;
  upside_potential: number;
  platform_appetite_strength: number;
  comparable_alignment_delta: number;
  confidence_score: number;
}

export interface ConfidenceBands {
  budget: { low: number; mid: number; high: number };
  shoot_days: { low: number; mid: number; high: number };
  confidence: number;
}

export interface ProjectStateGraph {
  id: string;
  project_id: string;
  creative_state: CreativeState;
  execution_state: ExecutionState;
  production_state: ProductionState;
  finance_state: FinanceState;
  revenue_state: RevenueState;
  confidence_bands: ConfidenceBands;
  assumption_multipliers: any;
  last_cascade_at: string | null;
  active_scenario_id: string | null;
  active_scenario_set_at: string | null;
  active_scenario_set_by: string | null;
}

export interface ProjectScenario {
  id: string;
  project_id: string;
  name: string;
  scenario_type: string;
  is_active: boolean;
  is_archived: boolean;
  pinned: boolean;
  description: string | null;
  state_overrides: any;
  computed_state: any;
  delta_vs_baseline: any;
  coherence_flags: string[];
  created_at: string;
  rank_score: number | null;
  rank_breakdown: any;
  ranked_at: string | null;
  is_recommended: boolean;
}

export interface DriftAlert {
  id: string;
  alert_type: string;
  severity: string;
  layer: string;
  metric_key: string;
  current_value: number | null;
  threshold: number | null;
  message: string;
  acknowledged: boolean;
  scenario_id: string | null;
  created_at: string;
}

export interface ScenarioProjection {
  id: string;
  project_id: string;
  scenario_id: string;
  months: number;
  assumptions: any;
  series: any[];
  projection_risk_score: number;
  summary: string[];
  summary_metrics?: {
    irr?: number | null;
    npv?: number | null;
    payback_months?: number | null;
    schedule_months?: number | null;
    budget?: number | null;
    projection_risk_score?: number | null;
    composite_score?: number | null;
    start_budget?: number | null;
    end_confidence?: number | null;
    end_downside?: number | null;
    end_stress?: number | null;
  } | null;
  created_at: string;
}

// Phase 4.1 types

export interface ScenarioScoreRow {
  id: string;
  project_id: string;
  scenario_id: string;
  as_of: string;
  metrics: any;
  scores: any;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

export interface ScenarioRecommendation {
  id: string;
  project_id: string;
  recommended_scenario_id: string;
  confidence: number;
  reasons: string[];
  tradeoffs: any;
  risk_flags: string[];
  created_at: string;
}

// Phase 4.2 types

export interface ScenarioStressTest {
  id: string;
  project_id: string;
  scenario_id: string;
  base_projection_id: string | null;
  grid: any;
  results: any[];
  fragility_score: number;
  volatility_index: number;
  breakpoints: any;
  created_at: string;
}

// ---- Hooks ----

const MAX_PINNED = 4;

export function useStateGraph(projectId: string | undefined) {
  const queryClient = useQueryClient();

  const { data: stateGraph, isLoading: graphLoading } = useQuery({
    queryKey: ['state-graph', projectId],
    queryFn: async () => {
      if (!projectId) return null;
      const { data, error } = await supabase
        .from('project_state_graphs')
        .select('*')
        .eq('project_id', projectId)
        .maybeSingle();
      if (error) throw error;
      return data as unknown as ProjectStateGraph | null;
    },
    enabled: !!projectId,
  });

  const { data: scenarios = [], isLoading: scenariosLoading } = useQuery({
    queryKey: ['scenarios', projectId],
    queryFn: async () => {
      if (!projectId) return [];
      const { data, error } = await supabase
        .from('project_scenarios')
        .select('*')
        .eq('project_id', projectId)
        .eq('is_archived', false)
        .order('created_at', { ascending: true });
      if (error) throw error;
      return (data || []) as unknown as ProjectScenario[];
    },
    enabled: !!projectId,
  });

  // Drift alerts filtered to the active scenario only.
  const activeScenarioIdForAlerts = stateGraph?.active_scenario_id ?? null;

  const { data: alerts = [] } = useQuery({
    queryKey: ['drift-alerts', projectId, activeScenarioIdForAlerts],
    queryFn: async () => {
      if (!projectId) return [];
      let query = supabase
        .from('drift_alerts')
        .select('*')
        .eq('project_id', projectId)
        .eq('acknowledged', false);

      if (activeScenarioIdForAlerts) {
        query = query.eq('scenario_id', activeScenarioIdForAlerts);
      }

      const { data, error } = await query
        .order('created_at', { ascending: false })
        .limit(20);
      if (error) throw error;
      return (data || []) as DriftAlert[];
    },
    enabled: !!projectId,
  });

  // Phase 4.1: latest recommendation
  const { data: recommendation = null, isLoading: recommendationLoading } = useQuery({
    queryKey: ['scenario-recommendation', projectId],
    queryFn: async () => {
      if (!projectId) return null;
      const { data, error } = await supabase
        .from('scenario_recommendations')
        .select('*')
        .eq('project_id', projectId)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      if (error) throw error;
      return data as unknown as ScenarioRecommendation | null;
    },
    enabled: !!projectId,
  });

  const invalidateAll = () => {
    queryClient.invalidateQueries({ queryKey: ['state-graph', projectId] });
    queryClient.invalidateQueries({ queryKey: ['scenarios', projectId] });
    queryClient.invalidateQueries({ queryKey: ['drift-alerts', projectId] });
    queryClient.invalidateQueries({ queryKey: ['projection', projectId] });
    queryClient.invalidateQueries({ queryKey: ['scenario-recommendation', projectId] });
    queryClient.invalidateQueries({ queryKey: ['scenario-scores', projectId] });
    queryClient.invalidateQueries({ queryKey: ['scenario-stress', projectId] });
    queryClient.invalidateQueries({ queryKey: ['decision-events', projectId] });
  };

  const initialize = useMutation({
    mutationFn: async (creativeState?: Partial<any>) => {
      const { data, error } = await supabase.functions.invoke('simulation-engine', {
        body: { action: 'initialize', projectId, creativeState },
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      return data;
    },
    onSuccess: () => { invalidateAll(); toast.success('State graph initialized'); },
    onError: (e: any) => toast.error(e.message),
  });

  const cascade = useMutation({
    mutationFn: async (params: { overrides: any; scenarioId?: string }) => {
      const { data, error } = await supabase.functions.invoke('simulation-engine', {
        body: { action: 'cascade', projectId, ...params },
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      return data;
    },
    onSuccess: () => { invalidateAll(); },
    onError: (e: any) => toast.error(e.message),
  });

  const createScenario = useMutation({
    mutationFn: async (params: { name: string; description?: string; overrides?: any; scenario_type?: string }) => {
      const { data, error } = await supabase.functions.invoke('simulation-engine', {
        body: { action: 'create_scenario', projectId, ...params },
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      return data;
    },
    onSuccess: () => { invalidateAll(); toast.success('Scenario created'); },
    onError: (e: any) => toast.error(e.message),
  });

  const generateSystemScenarios = useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase.functions.invoke('simulation-engine', {
        body: { action: 'generate_system_scenarios', projectId },
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      return data;
    },
    onSuccess: () => { invalidateAll(); toast.success('Strategic scenarios generated'); },
    onError: (e: any) => toast.error(e.message),
  });

  const setActiveScenario = useMutation({
    mutationFn: async (targetScenarioId: string) => {
      const { data, error } = await supabase.functions.invoke('simulation-engine', {
        body: { action: 'set_active_scenario', projectId, scenarioId: targetScenarioId },
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      return data;
    },
    onSuccess: () => {
      invalidateAll();
      toast.success('Active scenario updated');
    },
    onError: (e: any) => toast.error(e.message),
  });

  const rankScenarios = useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase.functions.invoke('simulation-engine', {
        body: { action: 'rank_scenarios', projectId },
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      return data;
    },
    onSuccess: () => {
      invalidateAll();
      toast.success('Scenarios ranked');
    },
    onError: (e: any) => toast.error(e.message),
  });

  const acknowledgeAlert = useMutation({
    mutationFn: async (alertId: string) => {
      const { error } = await supabase
        .from('drift_alerts')
        .update({ acknowledged: true, acknowledged_at: new Date().toISOString() })
        .eq('id', alertId);
      if (error) throw error;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['drift-alerts', projectId] }),
  });

  const togglePin = useMutation({
    mutationFn: async (scenarioId: string) => {
      const target = scenarios.find(s => s.id === scenarioId);
      if (!target) throw new Error('Scenario not found');

      if (!target.pinned) {
        const pinnedCount = scenarios.filter(s => s.pinned).length;
        if (pinnedCount >= MAX_PINNED) {
          throw new Error(`Maximum ${MAX_PINNED} pinned scenarios allowed`);
        }
      }

      const { error } = await supabase
        .from('project_scenarios')
        .update({ pinned: !target.pinned })
        .eq('id', scenarioId);
      if (error) throw error;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['scenarios', projectId] }),
    onError: (e: any) => toast.error(e.message),
  });

  const archiveScenario = useMutation({
    mutationFn: async (scenarioId: string) => {
      const { error } = await supabase
        .from('project_scenarios')
        .update({ is_archived: true, pinned: false })
        .eq('id', scenarioId);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['scenarios', projectId] });
      toast.success('Scenario archived');
    },
    onError: (e: any) => toast.error(e.message),
  });

  // Phase 3: Optimizer
  const optimizeScenario = useMutation({
    mutationFn: async (params: { scenarioId?: string; objective?: string; maxIterations?: number; horizonMonths?: number; searchMode?: string; lockKeys?: string[]; seed?: string }) => {
      const { searchMode, ...rest } = params;
      const { data, error } = await supabase.functions.invoke('simulation-engine', {
        body: { action: 'optimize_scenario', projectId, ...rest, ...(searchMode ? { search: searchMode } : {}) },
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      return data;
    },
    onError: (e: any) => toast.error(e.message),
  });

  const applyOptimizedOverrides = useMutation({
    mutationFn: async (params: { scenarioId: string; overrides: any }) => {
      const { data, error } = await supabase.functions.invoke('simulation-engine', {
        body: { action: 'apply_optimized_overrides', projectId, ...params },
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      return data;
    },
    onSuccess: () => {
      invalidateAll();
      toast.success('Optimized overrides applied');
    },
    onError: (e: any) => toast.error(e.message),
  });

  // Phase 3: Forward Projection
  const projectForward = useMutation({
    mutationFn: async (params: { scenarioId?: string; months?: number; assumptions?: ProjectionAssumptions }) => {
      const { data, error } = await supabase.functions.invoke('simulation-engine', {
        body: { action: 'project_forward', projectId, scenarioId: params.scenarioId, months: params.months, assumptions: params.assumptions },
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      return data;
    },
    onSuccess: () => {
      invalidateAll();
      toast.success('Projection complete');
    },
    onError: (e: any) => toast.error(e.message),
  });

  // Phase 4.2: Stress Testing
  const { data: latestStressTest = null } = useQuery({
    queryKey: ['scenario-stress', projectId],
    queryFn: async () => {
      if (!projectId) return null;
      const { data, error } = await supabase
        .from('scenario_stress_tests')
        .select('*')
        .eq('project_id', projectId)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      if (error) throw error;
      return data as unknown as ScenarioStressTest | null;
    },
    enabled: !!projectId,
  });

  const runStressTest = useMutation({
    mutationFn: async (params: { scenarioId: string; months?: number; sweeps?: any }) => {
      const { data, error } = await supabase.functions.invoke('simulation-engine', {
        body: { action: 'stress_test_scenario', projectId, ...params },
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      return data;
    },
    onSuccess: () => {
      invalidateAll();
      queryClient.invalidateQueries({ queryKey: ['scenario-stress', projectId] });
      toast.success('Stress test complete');
    },
    onError: (e: any) => toast.error(e.message),
  });

  // Phase 4.1: recompute recommendation
  const recomputeRecommendation = useMutation({
    mutationFn: async (params?: { baselineScenarioId?: string; activeScenarioId?: string }) => {
      const { data, error } = await supabase.functions.invoke('simulation-engine', {
        body: {
          action: 'recommend_scenario',
          projectId,
          ...(params?.baselineScenarioId ? { baselineScenarioId: params.baselineScenarioId } : {}),
          ...(params?.activeScenarioId ? { activeScenarioId: params.activeScenarioId } : {}),
        },
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      return data;
    },
    onSuccess: () => {
      invalidateAll();
      toast.success('Recommendation updated');
    },
    onError: (e: any) => toast.error(e.message),
  });

  const baseline = scenarios.find(s => s.scenario_type === 'baseline');
  const activeScenario = scenarios.find(s => s.is_active);
  const recommendedScenario = scenarios.find(s => s.is_recommended);
  const fallbackRecommended = !recommendedScenario
    ? scenarios
        .filter(s => s.scenario_type !== 'baseline' && s.rank_score != null)
        .sort((a, b) => (b.rank_score ?? 0) - (a.rank_score ?? 0))[0]
    : undefined;
  const validRecommended = recommendedScenario ?? fallbackRecommended ?? undefined;

  return {
    stateGraph,
    scenarios,
    alerts,
    recommendation,
    latestStressTest,
    isLoading: graphLoading || scenariosLoading || recommendationLoading,
    initialize,
    cascade,
    createScenario,
    generateSystemScenarios,
    setActiveScenario,
    rankScenarios,
    acknowledgeAlert,
    togglePin,
    archiveScenario,
    optimizeScenario,
    applyOptimizedOverrides,
    projectForward,
    recomputeRecommendation,
    runStressTest,
    baseline,
    activeScenario,
    recommendedScenario: validRecommended,
  };
}
