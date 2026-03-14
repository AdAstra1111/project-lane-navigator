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
  documents_attempted?: number;
  documents_executed?: number;
  document_sequences_failed?: number;
  documents_skipped_due_to_upstream_failure?: number;
  blocked_document_ids?: string[];
  blocked_doc_types?: string[];
  document_execution_order?: string[];
  document_execution_metadata?: Array<{
    document_id: string;
    doc_type: string;
    order_index: number;
    ordering_basis: "dependency_registry" | "lane_ladder" | "lexical_fallback";
  }>;
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
  revalidation_execution?: RevalidationExecution | null;
  execution_observability?: ExecutionObservability | null;
}

export interface ExecutionObservabilityDocTimeline {
  document_id: string;
  doc_type: string;
  order_index: number;
  ordering_basis: "dependency_registry" | "lane_ladder" | "lexical_fallback";
  status: "executed" | "failed" | "blocked" | "dry_run";
  blocked_by_doc_type: string | null;
  blocked_reason: string | null;
  section_targets_total: number;
  section_targets_executed: number;
  section_targets_failed: number;
  section_targets_skipped: number;
  version_id_before: string | null;
  version_id_after: string | null;
  governance_status: "performed" | "skipped" | "deferred" | "failed" | null;
  revalidation_status: "performed" | "partial" | "skipped" | "deferred" | "failed" | null;
  execution_message: string;
}

export interface ExecutionObservabilityEvent {
  seq: number;
  event_type: string;
  document_id: string | null;
  doc_type: string | null;
  phase: "validation" | "execution" | "governance" | "revalidation";
  status: "started" | "completed" | "failed" | "blocked" | "skipped";
  message: string;
}

export interface ExecutionObservability {
  started_at: string;
  finished_at: string;
  total_duration_ms: number;
  phase_durations_ms: {
    validation: number | null;
    section_execution: number | null;
    governance: number | null;
    revalidation: number | null;
  };
  document_timeline: ExecutionObservabilityDocTimeline[];
  event_trace: ExecutionObservabilityEvent[];
}

export interface RevalidationExecutionTarget {
  document_id: string;
  doc_type: string;
  version_id: string | null;
  revalidation_type: "full_reanalysis" | "spine_check_only" | "canon_alignment_only" | "section_recheck";
  status: "executed" | "skipped" | "failed" | "deferred";
  message: string;
}

export interface RevalidationExecution {
  attempted: number;
  succeeded: number;
  failed: number;
  target_results: RevalidationExecutionTarget[];
  notes: {
    patched_document_revalidated: boolean;
    downstream_revalidation_performed: boolean;
    unavailable_paths_deferred: boolean;
    dry_run_no_revalidation_writes: boolean;
  };
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

// ── Execution Replay Types ──

export interface ExecutionReplaySnapshot {
  execution_replay_version: string;
  /** "full" is the only supported mode in v1. Added by buildPatchExecutionReplaySnapshot. */
  snapshot_mode?: "full";
  plan_id: string;
  project_id: string;
  computed_at: string;
  patch_plan: PatchPlan;
  validation: PatchPlanValidationResult;
  execution: PatchExecutionResult;
}

// ── Causal Graph Types ──

export interface CausalNode {
  node_id: string;
  node_type: "document" | "validation" | "execution_step" | "governance" | "revalidation" | "patch_target";
  ref_id: string | null;
  label: string;
}

export interface CausalEdge {
  from_node: string;
  to_node: string;
  edge_type: "depends_on" | "blocks" | "generated" | "invalidated" | "triggered" | "revalidated" | "failed_because";
  reason_code: string;
  reason_message: string;
}

export interface ExecutionReplayResponse {
  ok: boolean;
  action: string;
  project_id: string;
  replay_found: boolean;
  replay_source: string;
  execution_replay: ExecutionReplaySnapshot | null;
  replay_notes: {
    exact_match: boolean;
    fallback_used: boolean;
    fallback_reason: string | null;
  };
  computed_at: string;
  version: string;
}

// ── Execution History Index Types ──

/**
 * Deterministic outcome mapping for history items.
 * Priority: dry_run > blocked > partial > executed > failed
 * - dry_run:  exec.dry_run === true
 * - blocked:  exec.execution_allowed === false && !dry_run
 * - partial:  exec.executed === true && direct_targets_failed > 0 && !dry_run
 * - executed: exec.executed === true && direct_targets_failed === 0 && !dry_run
 * - failed:   everything else (attempted but no success)
 */
export type PatchExecutionOutcome = "executed" | "blocked" | "failed" | "partial" | "dry_run";

export function deriveExecutionOutcome(item: Pick<PatchExecutionHistoryItem, 'dry_run' | 'execution_allowed' | 'executed' | 'direct_targets_failed'>): PatchExecutionOutcome {
  if (item.dry_run) return "dry_run";
  if (!item.execution_allowed) return "blocked";
  if (item.executed && item.direct_targets_failed > 0) return "partial";
  if (item.executed && item.direct_targets_failed === 0) return "executed";
  return "failed";
}

export interface PatchExecutionHistoryFilters {
  date_from?: string;
  date_to?: string;
  repair_type?: string;
  source_type?: string;
  outcome?: PatchExecutionOutcome;
}

export interface PatchExecutionHistoryAppliedFilters {
  date_from: string | null;
  date_to: string | null;
  repair_type: string | null;
  source_type: string | null;
  outcome: string | null;
}

export interface PatchExecutionHistoryItem {
  transition_id: string;
  plan_id: string;
  created_at: string;
  event_type: string;
  status: string | null;
  trigger: string | null;
  replay_version: string;
  dry_run: boolean;
  executed: boolean;
  execution_allowed: boolean;
  direct_targets_attempted: number;
  direct_targets_executed: number;
  direct_targets_failed: number;
  documents_attempted: number | null;
  documents_executed: number | null;
  blocked_doc_types: string[];
  total_duration_ms: number | null;
  source_type: string | null;
  repair_id: string | null;
  repair_type: string | null;
  outcome?: PatchExecutionOutcome;
}

export interface PatchExecutionHistoryCursor {
  created_at: string;
  id: string;
}

export interface PatchExecutionHistoryPagination {
  limit: number;
  returned_count: number;
  next_cursor: PatchExecutionHistoryCursor | null;
  has_more: boolean;
}

export interface PatchExecutionHistoryResponse {
  ok: boolean;
  action: string;
  project_id: string;
  applied_filters?: PatchExecutionHistoryAppliedFilters;
  history_items: PatchExecutionHistoryItem[];
  pagination?: PatchExecutionHistoryPagination;
  history_notes: {
    exact_source: string;
    filtered_count: number;
    omitted_non_replay_rows: number;
    prefilter_row_count?: number;
    postfilter_row_count?: number;
    cursor_mode?: string;
  };
  computed_at: string;
  version: string;
}

export async function fetchPatchExecutionHistory(
  projectId: string,
  limit?: number,
  filters?: PatchExecutionHistoryFilters,
  cursor?: PatchExecutionHistoryCursor,
): Promise<PatchExecutionHistoryResponse | null> {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) return null;

  const payload: Record<string, any> = {
    action: 'list_patch_execution_history',
    projectId,
  };
  if (limit) payload.limit = limit;
  if (filters && Object.values(filters).some(v => v != null && v !== '')) {
    payload.filters = filters;
  }
  if (cursor) payload.cursor = cursor;

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
  return json as PatchExecutionHistoryResponse;
}

// ── Execution Diff Comparison Types ──

export interface MetricDiffEntry {
  left: number | null;
  right: number | null;
  delta: number | null;
}

export interface DocumentTimelineDiffEntry {
  document_id: string;
  doc_type: string;
  left_status: string | null;
  right_status: string | null;
  left_version_id_after: string | null;
  right_version_id_after: string | null;
  left_governance_status: string | null;
  right_governance_status: string | null;
  left_revalidation_status: string | null;
  right_revalidation_status: string | null;
}

export interface PatchExecutionComparisonResponse {
  ok: boolean;
  action: string;
  project_id: string;
  comparison_found: boolean;
  left_plan_id: string;
  right_plan_id: string;
  comparison: {
    left_snapshot: { plan_id: string; computed_at: string; repair_type: string | null; source_type: string | null };
    right_snapshot: { plan_id: string; computed_at: string; repair_type: string | null; source_type: string | null };
    summary: {
      same_repair_type: boolean;
      same_source_type: boolean;
      outcome_changed: boolean;
      duration_changed: boolean;
      documents_changed: boolean;
      target_counts_changed: boolean;
    };
    metrics_diff: {
      direct_targets_attempted: MetricDiffEntry;
      direct_targets_executed: MetricDiffEntry;
      direct_targets_failed: MetricDiffEntry;
      documents_attempted: MetricDiffEntry;
      documents_executed: MetricDiffEntry;
      document_sequences_failed: MetricDiffEntry;
      documents_skipped_due_to_upstream_failure: MetricDiffEntry;
      total_duration_ms: MetricDiffEntry;
    };
    outcome_diff: { left_outcome: string; right_outcome: string };
    blocked_doc_types_diff: { only_left: string[]; only_right: string[]; both: string[] };
    document_order_diff: { left: string[]; right: string[]; changed: boolean };
    document_timeline_diff: { only_left: string[]; only_right: string[]; changed_documents: DocumentTimelineDiffEntry[] };
    phase_duration_diff: {
      validation: MetricDiffEntry;
      section_execution: MetricDiffEntry;
      governance: MetricDiffEntry;
      revalidation: MetricDiffEntry;
    };
    event_trace_summary: { left_event_count: number; right_event_count: number; delta: number };
  } | null;
  comparison_notes: {
    exact_snapshot_match: boolean;
    fallback_used: boolean;
    missing_side: "left" | "right" | "both" | null;
    left_invalid_reason?: string | null;
    right_invalid_reason?: string | null;
    first_causal_divergence?: { edge: string; reason: string } | null;
    root_blocker?: { from_node: string; to_node: string; reason: string } | null;
    new_blockers?: string[];
    resolved_blockers?: string[];
  };
  computed_at: string;
  version: string;
}

export async function fetchPatchExecutionComparison(
  projectId: string,
  leftPlanId: string,
  rightPlanId: string,
): Promise<PatchExecutionComparisonResponse | null> {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) return null;

  const resp = await fetch(FUNC_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${session.access_token}`,
    },
    body: JSON.stringify({
      action: 'compare_patch_execution_replays',
      projectId,
      leftPlanId,
      rightPlanId,
    }),
  });

  if (!resp.ok) return null;
  const json = await resp.json();
  if (!json?.ok) return null;
  return json as PatchExecutionComparisonResponse;
}

// ── Execution Analytics Types ──

export interface AnalyticsOutcomes {
  executed: number;
  partial: number;
  blocked: number;
  failed: number;
  dry_run: number;
}

export interface AnalyticsSuccessRates {
  executed_rate: number;
  partial_or_better_rate: number;
  blocked_rate: number;
  failed_rate: number;
}

export interface AnalyticsRepairTypeEntry {
  repair_type: string;
  count: number;
  executed: number;
  partial: number;
  blocked: number;
  failed: number;
  dry_run: number;
}

export interface AnalyticsSourceTypeEntry {
  source_type: string;
  count: number;
  executed: number;
  partial: number;
  blocked: number;
  failed: number;
  dry_run: number;
}

export interface AnalyticsDocTypeEntry {
  doc_type: string;
  total_seen: number;
  executed: number;
  blocked: number;
  failed: number;
  skipped_upstream: number;
  governance_performed: number;
  revalidation_performed: number;
}

export interface AnalyticsBlockerEntry {
  blocker_code: string;
  count: number;
}

export interface AnalyticsTiming {
  avg_total_duration_ms: number | null;
  min_total_duration_ms: number | null;
  max_total_duration_ms: number | null;
  avg_validation_ms: number | null;
  avg_section_execution_ms: number | null;
  avg_governance_ms: number | null;
  avg_revalidation_ms: number | null;
  // Sample count used to compute avg_section_execution_ms.
  // Used by recommendation engine to gate timing recs on >= 3 samples.
  section_execution_sample_count: number;
}

export interface AnalyticsGovernance {
  snapshots_with_governance: number;
  snapshots_without_governance: number;
  invalidation_performed_count: number;
  revalidation_handoff_performed_count: number;
}

export interface AnalyticsRevalidation {
  snapshots_with_revalidation_execution: number;
  full_success_count: number;
  partial_count: number;
  failed_count: number;
  deferred_count: number;
}

export interface AnalyticsCausalPatterns {
  root_blockers: Array<{ blocker: string; count: number }>;
  block_edges: Array<{ from_node: string; to_node: string; count: number }>;
}

export interface PatchExecutionAnalytics {
  summary: { total_snapshots: number; valid_snapshots: number; invalid_snapshots: number; scanned_rows: number };
  outcomes: AnalyticsOutcomes;
  success_rates: AnalyticsSuccessRates;
  repair_type_breakdown: AnalyticsRepairTypeEntry[];
  source_type_breakdown: AnalyticsSourceTypeEntry[];
  document_type_breakdown: AnalyticsDocTypeEntry[];
  blocker_breakdown: AnalyticsBlockerEntry[];
  timing: AnalyticsTiming;
  governance: AnalyticsGovernance;
  revalidation: AnalyticsRevalidation;
  causal_patterns: AnalyticsCausalPatterns;
}

export interface PatchExecutionAnalyticsResponse {
  ok: boolean;
  action: string;
  project_id: string;
  analytics: PatchExecutionAnalytics;
  window: { limit: number; date_from: string | null; date_to: string | null };
  computed_at: string;
  version: string;
}

// ── Execution Recommendations Types ──

export interface ExecutionRecommendation {
  recommendation_id: string;
  category: string;
  severity: "high" | "medium" | "low";
  title: string;
  rationale: string;
  evidence: Record<string, unknown>;
  suggested_action: string;
  confidence: "high" | "medium" | "low";
  // Explainability fields — execution-recommendations-v1.1
  rule_id: string;
  threshold_version: string;
  trigger_metrics: Record<string, number | string | null>;
  evidence_summary: string[];
}

export interface ExecutionRecommendationSummary {
  total_snapshots: number;
  generated_recommendations: number;
  high_severity_count: number;
  medium_severity_count: number;
  low_severity_count: number;
}

export interface ExecutionRecommendations {
  summary: ExecutionRecommendationSummary;
  top_priorities: ExecutionRecommendation[];
  blocker_mitigations: ExecutionRecommendation[];
  repair_type_watchlist: ExecutionRecommendation[];
  source_type_watchlist: ExecutionRecommendation[];
  document_type_watchlist: ExecutionRecommendation[];
  governance_gaps: ExecutionRecommendation[];
  revalidation_gaps: ExecutionRecommendation[];
  suggested_next_actions: ExecutionRecommendation[];
}

// ── Recommendations Calibration Types ──

export interface RecommendationCalibrationSampleSupport {
  metric_name: string;
  sample_count: number | null;
  minimum_required: number | null;
  sufficient: boolean | null;
}

export interface RecommendationCalibrationRule {
  rule_id: string;
  category: string;
  threshold_fields: Record<string, number | string>;
  minimum_sample_support: RecommendationCalibrationSampleSupport[];
  denominator_notes: string[];
  calibration_notes: string[];
}

export interface RecommendationCalibration {
  threshold_version: string;
  rules: RecommendationCalibrationRule[];
}

export interface PatchExecutionRecommendationsResponse {
  ok: boolean;
  action: string;
  project_id: string;
  recommendations: ExecutionRecommendations;
  recommendations_calibration: RecommendationCalibration;
  window: { limit: number; date_from: string | null; date_to: string | null };
  computed_at: string;
  version: string;
}

export async function fetchPatchExecutionRecommendations(
  projectId: string,
  window?: { limit?: number; date_from?: string; date_to?: string },
): Promise<PatchExecutionRecommendationsResponse | null> {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) return null;
  const payload: Record<string, any> = { action: 'get_patch_execution_recommendations', projectId };
  if (window) payload.window = window;
  const resp = await fetch(FUNC_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}` },
    body: JSON.stringify(payload),
  });
  if (!resp.ok) return null;
  const json = await resp.json();
  if (!json?.ok) return null;
  return json as PatchExecutionRecommendationsResponse;
}

// ── Recommendation Dedup / Suppression v1 ──────────────────────────────────
// Pure deterministic post-processing layer. No backend changes. No threshold
// changes. Raw recommendations preserved unchanged for auditability.
// ────────────────────────────────────────────────────────────────────────────

const BUCKET_PRIORITY_ORDER = [
  "top_priorities",
  "blocker_mitigations",
  "repair_type_watchlist",
  "source_type_watchlist",
  "document_type_watchlist",
  "governance_gaps",
  "revalidation_gaps",
  "suggested_next_actions",
] as const;

export type RecommendationBucketKey = typeof BUCKET_PRIORITY_ORDER[number];

const ISSUE_FAMILY_MAP: Record<string, string> = {
  overall_health: "execution_health",
  blocker_pattern: "blocker_pressure",
  blocker_mitigation: "blocker_pressure",
  causal_root_blocker: "causal_blocking",
  repair_type_instability: "repair_type_instability",
  source_type_instability: "source_type_instability",
  document_type_instability: "document_type_instability",
  governance_coverage: "governance_gap",
  governance_gap: "governance_gap",
  revalidation_coverage: "revalidation_gap",
  revalidation_gap: "revalidation_gap",
  timing_efficiency: "timing_efficiency",
  execution_timing: "timing_efficiency",
};

export function classifyRecommendationIssueFamily(rec: ExecutionRecommendation): string {
  return ISSUE_FAMILY_MAP[rec.category] ?? rec.category;
}

const SEV_ORDER: Record<string, number> = { high: 3, medium: 2, low: 1 };
const CONF_ORDER: Record<string, number> = { high: 3, medium: 2, low: 1 };

// Note: computeRecommendationPriority removed in v1.1 — was exported but unused.
// Bucket sort uses severity > confidence > lexical recommendation_id directly
// inside dedupeAndSuppressRecommendations (see sort at bucket build step).

export interface SuppressionEntry {
  recommendation_id: string;
  suppressed_by_recommendation_id: string | null;
  reason: string;
}

export interface SuppressionReport {
  raw_total: number;
  display_total: number;
  suppressed_total: number;
  suppression_reasons: Array<{ reason: string; count: number }>;
  suppressed_items: SuppressionEntry[];
}

export interface DisplayRecommendation extends ExecutionRecommendation {
  source_bucket: RecommendationBucketKey;
  suppressed: boolean;
  suppression_reason: string | null;
  suppressed_by: string | null;
}

export interface DisplayRecommendationsResult {
  display_buckets: Record<RecommendationBucketKey, DisplayRecommendation[]>;
  suppression_report: SuppressionReport;
  all_display: DisplayRecommendation[];
}

function recFingerprint(rec: ExecutionRecommendation): string {
  return `${rec.rule_id}|${rec.title}|${rec.suggested_action}|${rec.severity}`;
}

export function dedupeAndSuppressRecommendations(
  recs: ExecutionRecommendations,
): DisplayRecommendationsResult {
  // Flatten all recs with source bucket
  const all: DisplayRecommendation[] = [];
  for (const bk of BUCKET_PRIORITY_ORDER) {
    const bucket = recs[bk] as ExecutionRecommendation[];
    if (!bucket) continue;
    for (const rec of bucket) {
      all.push({
        ...rec,
        source_bucket: bk,
        suppressed: false,
        suppression_reason: null,
        suppressed_by: null,
      });
    }
  }

  const suppressions: SuppressionEntry[] = [];

  const suppress = (dr: DisplayRecommendation, reason: string, byId: string | null) => {
    dr.suppressed = true;
    dr.suppression_reason = reason;
    dr.suppressed_by = byId;
    suppressions.push({
      recommendation_id: dr.recommendation_id,
      suppressed_by_recommendation_id: byId,
      reason,
    });
  };

  // RULE 1: Exact duplicate suppression
  const seenFingerprints = new Map<string, DisplayRecommendation>();
  for (const dr of all) {
    if (dr.suppressed) continue;
    const fp = recFingerprint(dr);
    const existing = seenFingerprints.get(fp);
    if (existing) {
      suppress(dr, "exact_duplicate", existing.recommendation_id);
    } else {
      seenFingerprints.set(fp, dr);
    }
  }

  // RULE 2: Same-rule bucket duplication — keep in top_priorities, suppress in lower
  const topIds = new Set(
    all.filter(d => !d.suppressed && d.source_bucket === "top_priorities")
      .map(d => `${d.rule_id}|${d.title}`),
  );
  const topIdMap = new Map(
    all.filter(d => !d.suppressed && d.source_bucket === "top_priorities")
      .map(d => [`${d.rule_id}|${d.title}`, d.recommendation_id]),
  );
  for (const dr of all) {
    if (dr.suppressed || dr.source_bucket === "top_priorities") continue;
    const key = `${dr.rule_id}|${dr.title}`;
    if (topIds.has(key)) {
      suppress(dr, "promoted_to_top_priorities", topIdMap.get(key) ?? null);
    }
  }

  // RULE 3: Same-entity watchlist collapse
  // Group by (source_bucket, rule_id, entity_key) where entity_key is derived from evidence
  const entityGroups = new Map<string, DisplayRecommendation[]>();
  for (const dr of all) {
    if (dr.suppressed) continue;
    const entityKey = extractEntityKey(dr);
    if (!entityKey) continue;
    const gk = `${dr.source_bucket}|${dr.rule_id}|${entityKey}`;
    const group = entityGroups.get(gk) ?? [];
    group.push(dr);
    entityGroups.set(gk, group);
  }
  for (const group of entityGroups.values()) {
    if (group.length <= 1) continue;
    // Sort: highest severity, then highest confidence, then lexical id
    group.sort((a, b) => {
      const sd = (SEV_ORDER[b.severity] ?? 0) - (SEV_ORDER[a.severity] ?? 0);
      if (sd !== 0) return sd;
      const cd = (CONF_ORDER[b.confidence] ?? 0) - (CONF_ORDER[a.confidence] ?? 0);
      if (cd !== 0) return cd;
      return a.recommendation_id.localeCompare(b.recommendation_id);
    });
    const retained = group[0];
    for (let i = 1; i < group.length; i++) {
      suppress(group[i], "same_entity_higher_priority_variant_retained", retained.recommendation_id);
    }
  }

  // RULE 4: Lower-signal redundancy suppression
  const active = all.filter(d => !d.suppressed);
  const highMedActive = active.filter(d => d.severity === "high" || d.severity === "medium");
  const lowActive = active.filter(d => d.severity === "low");
  for (const low of lowActive) {
    const lowFamily = classifyRecommendationIssueFamily(low);
    const coveringRec = highMedActive.find(h => classifyRecommendationIssueFamily(h) === lowFamily);
    if (coveringRec) {
      suppress(low, "covered_by_higher_signal_recommendation", coveringRec.recommendation_id);
    }
  }

  // Build display buckets (non-suppressed only for display, but keep all for audit)
  const displayBuckets: Record<RecommendationBucketKey, DisplayRecommendation[]> = {
    top_priorities: [],
    blocker_mitigations: [],
    repair_type_watchlist: [],
    source_type_watchlist: [],
    document_type_watchlist: [],
    governance_gaps: [],
    revalidation_gaps: [],
    suggested_next_actions: [],
  };

  // Sort display items by priority within each bucket
  for (const dr of all) {
    displayBuckets[dr.source_bucket].push(dr);
  }
  for (const bk of BUCKET_PRIORITY_ORDER) {
    displayBuckets[bk].sort((a, b) => {
      // Non-suppressed first
      if (a.suppressed !== b.suppressed) return a.suppressed ? 1 : -1;
      const sd = (SEV_ORDER[b.severity] ?? 0) - (SEV_ORDER[a.severity] ?? 0);
      if (sd !== 0) return sd;
      const cd = (CONF_ORDER[b.confidence] ?? 0) - (CONF_ORDER[a.confidence] ?? 0);
      if (cd !== 0) return cd;
      return a.recommendation_id.localeCompare(b.recommendation_id);
    });
  }

  return {
    display_buckets: displayBuckets,
    suppression_report: buildSuppressionReport(all.length, suppressions),
    all_display: all,
  };
}

function extractEntityKey(dr: DisplayRecommendation): string | null {
  // Extract entity from evidence or title for watchlist-style recs
  const ev = dr.evidence as Record<string, unknown>;
  if (ev?.repair_type) return `repair:${ev.repair_type}`;
  if (ev?.source_type) return `source:${ev.source_type}`;
  if (ev?.doc_type) return `doc:${ev.doc_type}`;
  if (ev?.blocker_code) return `blocker:${ev.blocker_code}`;
  return null;
}

export function buildSuppressionReport(rawTotal: number, suppressions: SuppressionEntry[]): SuppressionReport {
  const reasonCounts = new Map<string, number>();
  for (const s of suppressions) {
    reasonCounts.set(s.reason, (reasonCounts.get(s.reason) ?? 0) + 1);
  }
  const reasons = Array.from(reasonCounts.entries())
    .map(([reason, count]) => ({ reason, count }))
    .sort((a, b) => b.count - a.count || a.reason.localeCompare(b.reason));

  return {
    raw_total: rawTotal,
    display_total: rawTotal - suppressions.length,
    suppressed_total: suppressions.length,
    suppression_reasons: reasons,
    suppressed_items: suppressions,
  };
}

// ── Execution Trend Types ──

export type TrendDirection = "improving" | "worsening" | "flat" | "insufficient_data";

export interface TrendRatePoint {
  prior: number | null;
  recent: number | null;
  delta: number | null;
  direction: TrendDirection;
}

export interface TrendCountPoint {
  prior: number;
  recent: number;
  delta: number;
  direction: TrendDirection;
}

export interface TrendNullableCountPoint {
  prior: number | null;
  recent: number | null;
  delta: number | null;
  direction: TrendDirection;
}

export interface TrendSampleCountPoint {
  prior: number;
  recent: number;
  delta: number;
}

export interface TrendWindowSummary {
  recent_count: number;
  prior_count: number;
  sufficient_for_comparison: boolean;
}

export interface TrendOverallOutcomes {
  executed_rate_pct: TrendRatePoint;
  blocked_rate_pct: TrendRatePoint;
  failed_rate_pct: TrendRatePoint;
  partial_or_better_rate_pct: TrendRatePoint;
}

export interface TrendRecommendationSignals {
  overall_health_signal: TrendCountPoint;
  blocker_signal_count: TrendCountPoint;
  governance_gap_signal: TrendCountPoint;
  revalidation_gap_signal: TrendNullableCountPoint;
  timing_signal: TrendNullableCountPoint;
  causal_root_blocker_signal: TrendCountPoint;
}

export interface TrendBlockerCodeEntry {
  blocker_code: string;
  prior_count: number;
  recent_count: number;
  delta: number;
  direction: TrendDirection;
}

export interface TrendRepairTypeEntry {
  repair_type: string;
  prior_bad_rate_pct: number | null;
  recent_bad_rate_pct: number | null;
  delta: number | null;
  direction: TrendDirection;
  sample_prior: number;
  sample_recent: number;
}

export interface TrendSourceTypeEntry {
  source_type: string;
  prior_bad_rate_pct: number | null;
  recent_bad_rate_pct: number | null;
  delta: number | null;
  direction: TrendDirection;
  sample_prior: number;
  sample_recent: number;
}

export interface TrendDocTypeEntry {
  doc_type: string;
  prior_instability_rate_pct: number | null;
  recent_instability_rate_pct: number | null;
  delta: number | null;
  direction: TrendDirection;
  sample_prior: number;
  sample_recent: number;
}

export interface TrendTimingMetrics {
  avg_total_duration_ms: TrendNullableCountPoint;
  avg_section_execution_ms: TrendNullableCountPoint;
  section_execution_sample_count: TrendSampleCountPoint;
}

export interface TrendGovernanceMetrics {
  governance_coverage_rate_pct: TrendRatePoint;
  invalidation_performed_rate_pct: TrendRatePoint;
}

export interface TrendRevalidationMetrics {
  revalidation_execution_rate_pct: TrendRatePoint;
  revalidation_success_rate_pct: TrendNullableCountPoint;
  revalidation_failure_or_deferral_rate_pct: TrendNullableCountPoint;
}

export interface TrendTopSignalEntry {
  signal_key: string;
  rationale: string;
  delta: number;
  confidence: "high" | "medium" | "low";
}

export interface ExecutionRecommendationTrends {
  window_summary: TrendWindowSummary;
  overall_outcomes: TrendOverallOutcomes;
  recommendation_signal_trends: TrendRecommendationSignals;
  blocker_code_trends: TrendBlockerCodeEntry[];
  repair_type_trends: TrendRepairTypeEntry[];
  source_type_trends: TrendSourceTypeEntry[];
  document_type_trends: TrendDocTypeEntry[];
  timing_trends: TrendTimingMetrics;
  governance_trends: TrendGovernanceMetrics;
  revalidation_trends: TrendRevalidationMetrics;
  top_worsening_signals: TrendTopSignalEntry[];
  top_improving_signals: TrendTopSignalEntry[];
}

export interface PatchExecutionTrendsResponse {
  ok: boolean;
  action: string;
  project_id: string;
  insufficient_data: boolean;
  insufficient_reason: string | null;
  trends: ExecutionRecommendationTrends;
  window: { recent_limit: number; prior_limit: number; total_valid_scanned: number };
  computed_at: string;
  version: string;
}

export async function fetchPatchExecutionRecommendationTrends(
  projectId: string,
  opts?: { recent_limit?: number; prior_limit?: number },
): Promise<PatchExecutionTrendsResponse | null> {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) return null;
  const payload: Record<string, any> = {
    action: 'get_patch_execution_recommendation_trends',
    projectId,
    ...(opts?.recent_limit != null ? { recent_limit: opts.recent_limit } : {}),
    ...(opts?.prior_limit  != null ? { prior_limit:  opts.prior_limit  } : {}),
  };
  const resp = await fetch(FUNC_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}` },
    body: JSON.stringify(payload),
  });
  if (!resp.ok) return null;
  const json = await resp.json();
  if (!json?.ok) return null;
  return json as PatchExecutionTrendsResponse;
}

export async function fetchPatchExecutionAnalytics(
  projectId: string,
  window?: { limit?: number; date_from?: string; date_to?: string },
): Promise<PatchExecutionAnalyticsResponse | null> {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) return null;

  const payload: Record<string, any> = {
    action: 'get_patch_execution_analytics',
    projectId,
  };
  if (window) payload.window = window;

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
  return json as PatchExecutionAnalyticsResponse;
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

export async function fetchPatchExecutionReplay(
  projectId: string,
  planId: string,
): Promise<ExecutionReplayResponse | null> {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) return null;

  const resp = await fetch(FUNC_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${session.access_token}`,
    },
    body: JSON.stringify({
      action: 'get_patch_execution_replay',
      projectId,
      planId,
    }),
  });

  if (!resp.ok) return null;
  const json = await resp.json();
  if (!json?.ok) return null;
  return json as ExecutionReplayResponse;
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
