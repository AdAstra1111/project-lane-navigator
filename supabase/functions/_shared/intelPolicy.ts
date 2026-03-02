/**
 * Intel Policy Resolution Engine V2
 *
 * Resolves the effective intel policy by merging policies in DETERMINISTIC precedence:
 * global → surface → project → lane → production_type → modality
 *
 * Within each scope_type, pick the single row with highest priority (then latest updated_at).
 * Across scope_types, merge in strict precedence order (later overrides earlier).
 * If any matched scope has enabled=false, the resolved policy is disabled.
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

export interface IntelPolicy {
  advisory_only: boolean;
  modules: {
    trend_signals: boolean;
    cast_trends: boolean;
    convergence: boolean;
    alignment: boolean;
    alerts: boolean;
    embeddings?: boolean;
  };
  thresholds: {
    min_signal_strength: number;
    min_convergence_score: number;
    min_convergence_persistence_weeks: number;
    min_persistence_runs?: number;
  };
  warnings: {
    enabled: boolean;
    severity_min: string;
    suppress_days: number;
  };
  cadence: {
    convergence_run: string;
    alignment_run: string;
    recency_filter?: string;
  };
}

export interface PolicySource {
  scope_type: string;
  scope_key: string;
  row_id: string;
  priority: number;
}

export interface ResolvedIntelPolicy {
  enabled: boolean;
  policy: IntelPolicy;
  sources: string[];
  source_details: PolicySource[];
}

const DEFAULT_POLICY: IntelPolicy = {
  advisory_only: true,
  modules: { trend_signals: true, cast_trends: true, convergence: true, alignment: true, alerts: true },
  thresholds: { min_signal_strength: 7, min_convergence_score: 0.72, min_convergence_persistence_weeks: 2 },
  warnings: { enabled: true, severity_min: "medium", suppress_days: 7 },
  cadence: { convergence_run: "weekly", alignment_run: "manual" },
};

export interface PolicyContext {
  surface?: string;
  project_id?: string;
  lane?: string;
  production_type?: string;
  modality?: string;
}

// Strict precedence order — index = merge rank (later overrides earlier)
const SCOPE_PRECEDENCE: string[] = [
  "global",
  "surface",
  "project",
  "lane",
  "production_type",
  "modality",
];

/**
 * Resolve the effective intel policy for a given context.
 * Deterministic: strict scope_type precedence, single winner per scope_type.
 */
export async function resolveIntelPolicy(
  supabaseUrl: string,
  serviceRoleKey: string,
  context: PolicyContext,
): Promise<ResolvedIntelPolicy> {
  const sb = createClient(supabaseUrl, serviceRoleKey);

  // Map scope_type -> expected scope_key from context
  const scopeKeyMap: Record<string, string | undefined> = {
    global: "default",
    surface: context.surface,
    project: context.project_id,
    lane: context.lane,
    production_type: context.production_type,
    modality: context.modality,
  };

  // Load all policies
  const { data: rows, error } = await sb
    .from("intel_policies")
    .select("id, scope_type, scope_key, enabled, policy, priority, updated_at")
    .order("priority", { ascending: false });

  if (error || !rows) {
    console.error("Failed to load intel policies:", error);
    return { enabled: true, policy: { ...DEFAULT_POLICY }, sources: ["fallback"], source_details: [] };
  }

  // For each scope_type in precedence order, find the best matching row
  let merged: any = {};
  let enabled = true;
  const sources: string[] = [];
  const sourceDetails: PolicySource[] = [];

  for (const scopeType of SCOPE_PRECEDENCE) {
    const expectedKey = scopeKeyMap[scopeType];
    if (!expectedKey) continue;

    // Find matching rows for this scope_type + scope_key
    const candidates = rows.filter(
      r => r.scope_type === scopeType && r.scope_key === expectedKey
    );

    if (candidates.length === 0) continue;

    // Pick winner: highest priority, then latest updated_at
    candidates.sort((a, b) => {
      if (b.priority !== a.priority) return b.priority - a.priority;
      return (b.updated_at || "").localeCompare(a.updated_at || "");
    });

    const winner = candidates[0];
    sources.push(`${winner.scope_type}:${winner.scope_key}`);
    sourceDetails.push({
      scope_type: winner.scope_type,
      scope_key: winner.scope_key,
      row_id: winner.id,
      priority: winner.priority,
    });

    if (!winner.enabled) {
      enabled = false; // Kill switch — still record source for explainability
    }

    merged = deepMerge(merged, winner.policy as any);
  }

  if (sources.length === 0) {
    return { enabled: true, policy: { ...DEFAULT_POLICY }, sources: ["default_fallback"], source_details: [] };
  }

  // Ensure all required fields exist
  const finalPolicy: IntelPolicy = {
    advisory_only: merged.advisory_only ?? DEFAULT_POLICY.advisory_only,
    modules: { ...DEFAULT_POLICY.modules, ...(merged.modules || {}) },
    thresholds: { ...DEFAULT_POLICY.thresholds, ...(merged.thresholds || {}) },
    warnings: { ...DEFAULT_POLICY.warnings, ...(merged.warnings || {}) },
    cadence: { ...DEFAULT_POLICY.cadence, ...(merged.cadence || {}) },
  };

  return { enabled, policy: finalPolicy, sources, source_details: sourceDetails };
}

/**
 * Explain which policy rows contributed and their precedence.
 */
export async function explainResolvedPolicy(
  supabaseUrl: string,
  serviceRoleKey: string,
  context: PolicyContext,
): Promise<ResolvedIntelPolicy> {
  return resolveIntelPolicy(supabaseUrl, serviceRoleKey, context);
}

function deepMerge(target: any, source: any): any {
  const result = { ...target };
  for (const key of Object.keys(source)) {
    if (
      source[key] && typeof source[key] === "object" && !Array.isArray(source[key]) &&
      result[key] && typeof result[key] === "object"
    ) {
      result[key] = deepMerge(result[key], source[key]);
    } else {
      result[key] = source[key];
    }
  }
  return result;
}
