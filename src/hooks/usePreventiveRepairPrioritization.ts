/**
 * usePreventiveRepairPrioritization — Fetches PRP1 + conditionally NRF1 data.
 * Read-only. TanStack Query pattern.
 * NRF1 is only fetched when axis_debt_map is needed and PRP1 doesn't provide it.
 */
import { useCallback } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';

const FUNC_URL = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/dev-engine-v2`;

export interface PRP1Repair {
  repair_id: string;
  repair_type: string;
  status: string;
  baseline_rank: number;
  preventive_rank: number;
  rank_delta: number;
  baseline_score: number;
  preventive_score: number;
  uplift_amount: number;
  current_priority_signal: number;
  preventive_value_signal: number;
  preventive_confidence_signal: number;
  root_cause_signal: number;
  execution_friction_signal: number;
  explanation_tags: string[];
  forecasted_repair_families: string[];
}

export interface PRP1Data {
  ok: boolean;
  action: string;
  project_id: string;
  current_nsi?: number;
  current_stability_band?: string;
  prp1_prioritization: {
    project_repair_pressure: number;
    project_repair_pressure_raw: number;
    total_repairs_considered: number;
    repairs_with_preventive_uplift: number;
    highest_preventive_uplift_repair_id: string | null;
    prioritized_repairs: PRP1Repair[];
    prioritization_disclaimer: string;
  };
  scoring_notes: Record<string, string>;
  computed_at: string;
  nrf1_degraded?: boolean;
}

export interface AxisDebtEntry {
  axis: string;
  risk_level: string;
  source_repair_count: number;
  max_forecast_confidence: number;
  forecast_repair_families: string[];
  notes: string[];
}

export interface NRF1Data {
  ok: boolean;
  nrf1_forecast: {
    project_repair_pressure: number;
    project_repair_pressure_raw: number;
    forecasted_repair_families: string[];
    per_repair_forecasts: any[];
  };
  axis_debt_map: AxisDebtEntry[];
}

export interface PRP2StrategyOption {
  repair_id: string;
  repair_type: string;
  strategic_priority_score: number;
  recommendation_confidence: number;
  primary_signals: string[];
}

export interface PRP2AxisHotspot {
  axis: string;
  risk_level: string;
  source_repair_count: number;
}

export interface PRP2Data {
  ok: boolean;
  selected_repair_id: string;
  selected_repair_type: string;
  strategic_priority_score: number;
  recommendation_confidence: number;
  selection_rationale: string;
  reduced_axis_debt: string[];
  prevented_repair_families: string[];
  unlocks_repairs: string[];
  ranked_strategy_options: PRP2StrategyOption[];
  axis_debt_hotspots?: PRP2AxisHotspot[];
  scoring_notes?: Record<string, string>;
}

// ── PRP2S types (select_preventive_repair_strategy response contract) ──

export interface PRP2SROIAdvisory {
  intervention_roi_score: number;
  roi_components: {
    prevented_downstream_pressure: number;
    projected_stability_gain: number;
    execution_friction: number;
    blast_radius: number;
  };
  rationale: string;
}

export interface PRP2SRootCauseAdvisory {
  in_cluster: boolean;
  cluster_id: string | null;
  cluster_primary_axis: string | null;
  cluster_combined_pressure: number | null;
  cluster_confidence: number | null;
  cluster_repair_count: number | null;
  root_cause_leverage_score: number | null;
  root_cause_leverage_label: "high" | "medium" | "low" | null;
}

export interface PRP2SStrategyOption {
  repair_id: string;
  repair_type: string;
  status: string;
  path_id: string | null;
  path_label: string | null;
  baseline_rank: number;
  preventive_rank: number;
  strategic_rank: number;
  baseline_score: number;
  preventive_score: number;
  strategic_priority_score: number;
  current_importance_signal: number;
  preventive_uplift_signal: number;
  root_cause_signal: number;
  path_quality_signal: number;
  path_interaction_signal: number;
  axis_debt_reduction_signal: number;
  execution_friction_signal: number;
  recommendation_confidence: string;
  rationale_tags: string[];
  prevented_repair_families: string[];
  reduced_axis_debt: string[];
  unlocks_repairs: string[];
  roi_advisory: PRP2SROIAdvisory | null;
  roi_rank: number;
  root_cause_advisory: PRP2SRootCauseAdvisory;
  root_cause_rank: number | null;
}

export interface PRP2SAxisHotspot {
  axis: string;
  risk_level: string;
  source_repair_count: number;
}

export interface PRP2SData {
  ok: boolean;
  action: string;
  project_id: string;
  current_nsi: number | null;
  current_stability_band: string | null;
  prp2_strategy: {
    project_repair_pressure: number;
    project_repair_pressure_raw: number | null;
    total_repairs_considered: number;
    total_paths_considered: number;
    axis_debt_hotspots: PRP2SAxisHotspot[];
    recommended_first_repair_id: string | null;
    recommended_first_repair_type: string | null;
    recommended_path_id: string | null;
    strategic_priority_score: number | null;
    recommendation_confidence: string;
    rationale_tags: string[];
    reduced_axis_debt: string[];
    prevented_repair_families: string[];
    unlocks_repairs: string[];
    ranked_strategy_options: PRP2SStrategyOption[];
    strategy_disclaimer: string;
  };
  scoring_notes: Record<string, string | boolean | number>;
  computed_at: string;
}

// ── Intervention ROI types (compute_intervention_roi response contract) ──

export interface ROIComponents {
  prevented_downstream_pressure: number;
  projected_stability_gain: number;
  execution_friction: number;
  blast_radius: number | null;
}

export interface ROISupportingSignals {
  repair_preventive_value: number;
  forecast_confidence: number;
  net_priority_score: number;
  expected_stability_gain: number;
  execution_friction_score: number;
  root_cause_score: number;
  blast_risk_score: number;
}

export interface ROIRepairEntry {
  repair_id: string;
  repair_type: string;
  scope_type: string | null;
  scope_key: string | null;
  intervention_roi_score: number;
  roi_components: ROIComponents;
  supporting_signals: ROISupportingSignals;
  rationale: string;
}

export interface ROIFormulaNotes {
  prevented_downstream_pressure: string;
  projected_stability_gain: string;
  execution_friction: string;
  blast_radius: string;
  overall_formula: string;
}

export interface ROIProjectContext {
  candidate_repair_count: number;
  project_repair_pressure?: number;
}

export interface InterventionROIData {
  ok: boolean;
  action: string;
  project_id: string;
  computed_at: string;
  roi_version: string;
  blast_radius_available: boolean;
  roi_formula_notes: ROIFormulaNotes;
  project_context: ROIProjectContext;
  ranked_repairs: ROIRepairEntry[];
}

// ── Root Cause Cluster types (compute_root_cause_clusters response contract) ──

export interface RootCauseCluster {
  cluster_id: string;
  primary_axis: string;
  involved_repairs: string[];
  repair_count: number;
  shared_axes: string[];
  repair_families: string[];
  combined_pressure: number;
  cluster_confidence: number;
}

export interface RootCauseAnalysisResult {
  ok: boolean;
  action: string;
  project_id: string;
  cluster_count: number;
  clusters: RootCauseCluster[];
  unclustered_repairs: string[];
  computed_at: string;
  version: string;
}

// ── Intervention Engine types (compute_intervention_candidates response contract) ──

export interface InterventionSupportingSignals {
  prevented_downstream_pressure: number | null;
  projected_stability_gain: number | null;
  execution_friction: number | null;
  blast_radius: number | null;
  cluster_combined_pressure: number | null;
  cluster_confidence: number | null;
  cluster_repair_count: number | null;
}

export interface InterventionCandidate {
  repair_id: string;
  repair_type: string;
  scope_type: string | null;
  scope_key: string | null;
  strategic_rank: number;
  roi_rank: number | null;
  root_cause_rank: number | null;
  strategic_priority_score: number;
  intervention_roi_score: number | null;
  root_cause_leverage_score: number | null;
  intervention_score: number;
  intervention_label: "high" | "medium" | "low";
  supporting_signals: InterventionSupportingSignals;
  rationale_tags: string[];
  rationale_summary: string;
}

export interface InterventionScoringNotes {
  integration_mode: string;
  formula_reference: string;
  rank_definition: string;
  anti_double_counting_notes: string;
  label_thresholds: string;
}

export interface InterventionAnalysisResult {
  ok: boolean;
  action: string;
  project_id: string;
  candidate_count: number;
  recommended_intervention_repair_id: string | null;
  interventions: InterventionCandidate[];
  computed_at: string;
  version: string;
  scoring_notes: InterventionScoringNotes;
}

// ── PatchTarget Resolver types (resolve_patch_targets response contract) ──

export interface PatchTarget {
  target_id: string;
  target_type: "document" | "section" | "episode_block" | "scene";
  document_id: string;
  doc_type: string;
  version_id: string;
  section_key: string | null;
  episode_number: number | null;
  scene_id: string | null;
  scene_key: string | null;
  content_hash: string;
  start_offset: number | null;
  end_offset: number | null;
  targeting_method: "section_registry" | "episode_block_registry" | "scene_graph" | "mention_offset" | "full_document";
  targeting_confidence: "high" | "medium" | "low";
}

export interface PatchTargetResolutionNotes {
  chosen_strategy: string;
  fallback_used: boolean;
  fallback_reason: string | null;
  doc_types_considered: string[];
  version_binding_mode: "provided_version" | "current_version";
}

export interface PatchTargetResolutionResult {
  ok: boolean;
  action: string;
  project_id: string;
  repair_id: string | null;
  repair_type: string | null;
  source_type: string | null;
  resolved_targets: PatchTarget[];
  resolution_notes: PatchTargetResolutionNotes;
  computed_at: string;
  version: string;
}

export async function fetchPatchTargets(
  projectId: string,
  repairId?: string,
  repairType?: string,
  sourceType?: "intervention" | "prp2s" | "arp1" | "manual",
  versionId?: string,
): Promise<PatchTargetResolutionResult | null> {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) return null;

  const payload: Record<string, string> = {
    action: 'resolve_patch_targets',
    projectId,
  };
  if (repairId) payload.repairId = repairId;
  if (repairType) payload.repairType = repairType;
  if (sourceType) payload.sourceType = sourceType;
  if (versionId) payload.versionId = versionId;

  const resp = await fetch(FUNC_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${session.access_token}`,
    },
    body: JSON.stringify(payload),
  });

  if (!resp.ok) return null;
  const json = await resp.json();
  if (!json?.ok) return null;
  return json as PatchTargetResolutionResult;
}

// ── PatchPlan Types ──

export interface PatchImpactSurface {
  document_id: string;
  doc_type: string;
  version_id: string | null;
  impact_type: "regeneration_required" | "review_required" | "no_action";
  dependency_edge: string | null;
  invalidation_policy: string | null;
  revalidation_policy: string | null;
  affected_sections: string[];
  scope_precision: string | null;
  propagation_path: string[];
}

export interface PatchRevalidationTarget {
  document_id: string;
  doc_type: string;
  version_id: string | null;
  revalidation_type: "full_reanalysis" | "spine_check_only" | "canon_alignment_only" | "section_recheck";
  priority: "immediate" | "deferred";
}

export interface PatchRevalidationPlan {
  revalidation_targets: PatchRevalidationTarget[];
  affected_axes: string[];
  stale_unit_keys: string[];
  downstream_invalidation_triggered: boolean;
}

export interface PatchPlan {
  plan_id: string;
  project_id: string;
  lane: string | null;
  repair_source: {
    source_type: "intervention" | "prp2s" | "arp1" | "manual" | "impact_resolver";
    repair_id: string | null;
    intervention_score: number | null;
    repair_type: string | null;
  };
  direct_targets: PatchTarget[];
  protected_targets: PatchTarget[];
  downstream_regeneration: PatchImpactSurface[];
  revalidation_plan: PatchRevalidationPlan;
  execution_mode: "replace_section" | "regenerate_section" | "scene_rewrite" | "full_doc_rewrite";
  guardrails: string[];
  preserve_entities: string[];
  created_at: string;
  content_hashes: Record<string, string>;
  stale: boolean;
}

export interface PatchPlanBuildResult {
  ok: boolean;
  action: string;
  project_id: string;
  patch_plan: PatchPlan | null;
  planning_notes: {
    target_resolution_source: string;
    execution_mode_reason: string;
    fallback_used: boolean;
    fallback_reason: string | null;
    impact_surface_count: number;
    protected_surface_count: number;
  };
  computed_at: string;
  version: string;
}

export async function fetchPatchPlan(
  projectId: string,
  repairId?: string,
  repairType?: string,
  sourceType?: "intervention" | "prp2s" | "arp1" | "manual",
  versionId?: string,
): Promise<PatchPlanBuildResult | null> {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) return null;

  const payload: Record<string, string> = {
    action: 'build_patch_plan',
    projectId,
  };
  if (repairId) payload.repairId = repairId;
  if (repairType) payload.repairType = repairType;
  if (sourceType) payload.sourceType = sourceType;
  if (versionId) payload.versionId = versionId;

  const resp = await fetch(FUNC_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${session.access_token}`,
    },
    body: JSON.stringify(payload),
  });

  if (!resp.ok) return null;
  const json = await resp.json();
  if (!json?.ok) return null;
  return json as PatchPlanBuildResult;
}

// ── Patch Plan Validation types (validate_patch_plan response contract) ──

export interface PatchPlanValidationIssue {
  code: string;
  severity: "error" | "warning";
  target_id: string | null;
  message: string;
}

export interface PatchPlanValidationResult {
  plan_id: string;
  plan_valid: boolean;
  stale: boolean;
  direct_targets_checked: number;
  protected_targets_checked: number;
  direct_targets_valid: number;
  protected_targets_valid: number;
  issues: PatchPlanValidationIssue[];
  validation_notes: {
    hash_check_performed: boolean;
    version_check_performed: boolean;
    lock_check_performed: boolean;
    fallback_used: boolean;
    fallback_reason: string | null;
  };
}

export interface PatchPlanValidationResponse {
  ok: boolean;
  action: string;
  project_id: string;
  patch_plan: PatchPlan | null;
  validation: PatchPlanValidationResult | null;
  computed_at: string;
  version: string;
}

// ── Patch Execution types (execute_patch_plan response contract) ──

export interface PatchExecutionTargetResult {
  target_id: string;
  target_type: "section";
  document_id: string;
  doc_type: string;
  version_id_before: string;
  version_id_after: string | null;
  status: "executed" | "skipped" | "failed";
  message: string;
}

export interface PostExecutionRevalidationTarget {
  document_id: string;
  doc_type: string;
  version_id: string | null;
  revalidation_type: "full_reanalysis" | "spine_check_only" | "canon_alignment_only" | "section_recheck";
  status: "queued" | "recorded" | "deferred";
}

export interface PostExecutionGovernance {
  patched_document_ids: string[];
  patched_version_ids: string[];
  downstream_invalidation: {
    surfaces_considered: number;
    surfaces_marked_stale: number;
    surfaces_marked_review: number;
    deferred_surfaces: string[];
  };
  immediate_revalidation: {
    targets: PostExecutionRevalidationTarget[];
  };
  governance_notes: {
    invalidation_performed: boolean;
    revalidation_handoff_performed: boolean;
    dry_run_no_governance_writes: boolean;
    governance_error?: string;
  };
}

export interface PatchExecutionResult {
  plan_id: string;
  execution_allowed: boolean;
  executed: boolean;
  dry_run: boolean;
  direct_targets_attempted: number;
  direct_targets_executed: number;
  direct_targets_failed: number;
  target_results: PatchExecutionTargetResult[];
  execution_notes: {
    validation_passed: boolean;
    stale_blocked: boolean;
    unsupported_target_types_blocked: boolean;
    write_performed: boolean;
    downstream_execution_deferred: boolean;
    block_reasons?: string[];
  };
  post_execution?: PostExecutionGovernance | null;
}

export interface PatchExecutionResponse {
  ok: boolean;
  action: string;
  project_id: string;
  patch_plan: PatchPlan | null;
  validation: PatchPlanValidationResult | null;
  execution: PatchExecutionResult | null;
  computed_at: string;
  version: string;
}

export async function fetchPatchExecution(
  projectId: string,
  repairId?: string,
  repairType?: string,
  sourceType?: "intervention" | "prp2s" | "arp1" | "manual",
  versionId?: string,
  dryRun?: boolean,
): Promise<PatchExecutionResponse | null> {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) return null;

  const payload: Record<string, any> = {
    action: 'execute_patch_plan',
    projectId,
  };
  if (repairId) payload.repairId = repairId;
  if (repairType) payload.repairType = repairType;
  if (sourceType) payload.sourceType = sourceType;
  if (versionId) payload.versionId = versionId;
  if (dryRun !== undefined) payload.dryRun = dryRun;

  const resp = await fetch(FUNC_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${session.access_token}`,
    },
    body: JSON.stringify(payload),
  });

  if (!resp.ok) return null;
  const json = await resp.json();
  if (!json?.ok) return null;
  return json as PatchExecutionResponse;
}

export async function fetchPatchPlanValidation(
  projectId: string,
  repairId?: string,
  repairType?: string,
  sourceType?: "intervention" | "prp2s" | "arp1" | "manual",
  versionId?: string,
): Promise<PatchPlanValidationResponse | null> {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) return null;

  const payload: Record<string, string> = {
    action: 'validate_patch_plan',
    projectId,
  };
  if (repairId) payload.repairId = repairId;
  if (repairType) payload.repairType = repairType;
  if (sourceType) payload.sourceType = sourceType;
  if (versionId) payload.versionId = versionId;

  const resp = await fetch(FUNC_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${session.access_token}`,
    },
    body: JSON.stringify(payload),
  });

  if (!resp.ok) return null;
  const json = await resp.json();
  if (!json?.ok) return null;
  return json as PatchPlanValidationResponse;
}

async function fetchPRP1(projectId: string): Promise<PRP1Data> {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) throw new Error('Authentication required');

  const resp = await fetch(FUNC_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${session.access_token}`,
    },
    body: JSON.stringify({
      action: 'preventive_repair_prioritization',
      projectId,
    }),
  });

  if (!resp.ok) {
    const body = await resp.text().catch(() => '');
    throw new Error(`PRP1 failed: ${resp.status}${body ? ` — ${body}` : ''}`);
  }

  const json = await resp.json();
  if (!json?.ok) throw new Error(json?.error ?? 'Invalid PRP1 response');
  return json as PRP1Data;
}

async function fetchNRF1(projectId: string): Promise<NRF1Data | null> {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) throw new Error('Authentication required');

  const resp = await fetch(FUNC_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${session.access_token}`,
    },
    body: JSON.stringify({
      action: 'forecast_repair_pressure',
      projectId,
    }),
  });

  if (!resp.ok) return null;
  const json = await resp.json();
  if (!json?.ok) return null;
  return json as NRF1Data;
}

async function fetchPRP2(projectId: string): Promise<PRP2Data | null> {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) throw new Error('Authentication required');

  const resp = await fetch(FUNC_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${session.access_token}`,
    },
    body: JSON.stringify({
      action: 'select_preventive_strategy',
      projectId,
    }),
  });

  if (!resp.ok) return null;
  const json = await resp.json();
  if (!json?.ok) return null;
  return json as PRP2Data;
}

async function fetchInterventionROI(projectId: string): Promise<InterventionROIData | null> {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) throw new Error('Authentication required');

  const resp = await fetch(FUNC_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${session.access_token}`,
    },
    body: JSON.stringify({
      action: 'compute_intervention_roi',
      projectId,
    }),
  });

  if (!resp.ok) return null;
  const json = await resp.json();
  if (!json?.ok) return null;
  return json as InterventionROIData;
}

async function fetchPRP2S(projectId: string): Promise<PRP2SData | null> {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) throw new Error('Authentication required');

  const resp = await fetch(FUNC_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${session.access_token}`,
    },
    body: JSON.stringify({
      action: 'select_preventive_repair_strategy',
      projectId,
    }),
  });

  if (!resp.ok) return null;
  const json = await resp.json();
  if (!json?.ok) return null;
  return json as PRP2SData;
}

async function fetchRootCauseClusters(projectId: string): Promise<RootCauseAnalysisResult | null> {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) throw new Error('Authentication required');

  const resp = await fetch(FUNC_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${session.access_token}`,
    },
    body: JSON.stringify({
      action: 'compute_root_cause_clusters',
      projectId,
    }),
  });

  if (!resp.ok) return null;
  const json = await resp.json();
  if (!json?.ok) return null;
  return json as RootCauseAnalysisResult;
}

async function fetchInterventionCandidates(projectId: string): Promise<InterventionAnalysisResult | null> {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) throw new Error('Authentication required');

  const resp = await fetch(FUNC_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${session.access_token}`,
    },
    body: JSON.stringify({
      action: 'compute_intervention_candidates',
      projectId,
    }),
  });

  if (!resp.ok) return null;
  const json = await resp.json();
  if (!json?.ok) return null;
  return json as InterventionAnalysisResult;
}

export function usePreventiveRepairPrioritization(projectId: string | undefined) {
  const queryClient = useQueryClient();
  const prp1Key = ['prp1-prioritization', projectId];
  const nrf1Key = ['nrf1-forecast-strategy', projectId];
  const prp2Key = ['prp2-strategy', projectId];
  const roiKey = ['intervention-roi', projectId];
  const prp2sKey = ['prp2s-strategy', projectId];
  const rccKey = ['root-cause-clusters', projectId];
  const ivKey = ['intervention-candidates', projectId];

  const prp1Query = useQuery({
    queryKey: prp1Key,
    queryFn: () => fetchPRP1(projectId!),
    enabled: !!projectId,
    staleTime: 60_000,
  });

  const needsNrf1 = !!projectId && !!prp1Query.data && !prp1Query.data.nrf1_degraded;

  const nrf1Query = useQuery({
    queryKey: nrf1Key,
    queryFn: () => fetchNRF1(projectId!),
    enabled: needsNrf1,
    staleTime: 60_000,
  });

  const prp2Query = useQuery({
    queryKey: prp2Key,
    queryFn: () => fetchPRP2(projectId!),
    enabled: !!projectId,
    staleTime: 60_000,
  });

  const roiQuery = useQuery({
    queryKey: roiKey,
    queryFn: () => fetchInterventionROI(projectId!),
    enabled: !!projectId,
    staleTime: 60_000,
  });

  const prp2sQuery = useQuery({
    queryKey: prp2sKey,
    queryFn: () => fetchPRP2S(projectId!),
    enabled: !!projectId,
    staleTime: 60_000,
  });

  const rccQuery = useQuery({
    queryKey: rccKey,
    queryFn: () => fetchRootCauseClusters(projectId!),
    enabled: !!projectId,
    staleTime: 60_000,
  });

  const ivQuery = useQuery({
    queryKey: ivKey,
    queryFn: () => fetchInterventionCandidates(projectId!),
    enabled: !!projectId,
    staleTime: 60_000,
  });

  const refresh = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: prp1Key });
    queryClient.invalidateQueries({ queryKey: nrf1Key });
    queryClient.invalidateQueries({ queryKey: prp2Key });
    queryClient.invalidateQueries({ queryKey: roiKey });
    queryClient.invalidateQueries({ queryKey: prp2sKey });
    queryClient.invalidateQueries({ queryKey: rccKey });
    queryClient.invalidateQueries({ queryKey: ivKey });
  }, [queryClient]);

  return {
    prp1: prp1Query.data ?? null,
    nrf1: nrf1Query.data ?? null,
    prp2: prp2Query.data ?? null,
    roi: roiQuery.data ?? null,
    prp2s: prp2sQuery.data ?? null,
    rcc: rccQuery.data ?? null,
    iv: ivQuery.data ?? null,
    isLoading: prp1Query.isLoading,
    nrf1Loading: nrf1Query.isLoading,
    prp2Loading: prp2Query.isLoading,
    roiLoading: roiQuery.isLoading,
    prp2sLoading: prp2sQuery.isLoading,
    rccLoading: rccQuery.isLoading,
    ivLoading: ivQuery.isLoading,
    error: prp1Query.error?.message ?? null,
    refresh,
  };
}
