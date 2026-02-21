import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';

// ---- Types ----

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

  // Drift alerts are producer-only. In future phases these must be
  // role-filtered so only users with the "producer" role see them.
  const { data: alerts = [] } = useQuery({
    queryKey: ['drift-alerts', projectId],
    queryFn: async () => {
      if (!projectId) return [];
      const { data, error } = await supabase
        .from('drift_alerts')
        .select('*')
        .eq('project_id', projectId)
        .eq('acknowledged', false)
        .order('created_at', { ascending: false })
        .limit(20);
      if (error) throw error;
      return (data || []) as DriftAlert[];
    },
    enabled: !!projectId,
  });

  const invalidateAll = () => {
    queryClient.invalidateQueries({ queryKey: ['state-graph', projectId] });
    queryClient.invalidateQueries({ queryKey: ['scenarios', projectId] });
    queryClient.invalidateQueries({ queryKey: ['drift-alerts', projectId] });
  };

  const initialize = useMutation({
    mutationFn: async (creativeState?: Partial<CreativeState>) => {
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

  return {
    stateGraph,
    scenarios,
    alerts,
    isLoading: graphLoading || scenariosLoading,
    initialize,
    cascade,
    createScenario,
    generateSystemScenarios,
    acknowledgeAlert,
    togglePin,
    archiveScenario,
    baseline: scenarios.find(s => s.scenario_type === 'baseline'),
  };
}
