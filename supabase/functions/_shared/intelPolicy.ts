/**
 * Intel Policy Resolution Engine
 *
 * Resolves the effective intel policy by merging policies in priority order:
 * global → surface → project → lane → production_type → modality.
 *
 * If any higher-scope policy has enabled=false, the resolved policy is disabled.
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

export interface IntelPolicy {
  advisory_only: boolean;
  modules: {
    trend_signals: boolean;
    cast_trends: boolean;
    convergence: boolean;
    embeddings: boolean;
  };
  thresholds: {
    min_signal_strength: number;
    min_convergence_score: number;
    min_persistence_runs: number;
  };
  warnings: {
    enabled: boolean;
    severity_min: string;
    suppress_days: number;
  };
  cadence: {
    recency_filter: string;
  };
}

export interface ResolvedIntelPolicy {
  enabled: boolean;
  policy: IntelPolicy;
  sources: string[]; // scope_type:scope_key that contributed
}

const DEFAULT_POLICY: IntelPolicy = {
  advisory_only: true,
  modules: { trend_signals: true, cast_trends: true, convergence: true, embeddings: true },
  thresholds: { min_signal_strength: 7, min_convergence_score: 0.78, min_persistence_runs: 2 },
  warnings: { enabled: true, severity_min: "medium", suppress_days: 14 },
  cadence: { recency_filter: "week" },
};

export interface PolicyContext {
  surface?: string;
  project_id?: string;
  lane?: string;
  production_type?: string;
  modality?: string;
}

/**
 * Resolve the effective intel policy for a given context.
 * Loads policies ordered by priority, merges them, respects enabled flags.
 */
export async function resolveIntelPolicy(
  supabaseUrl: string,
  serviceRoleKey: string,
  context: PolicyContext,
): Promise<ResolvedIntelPolicy> {
  const sb = createClient(supabaseUrl, serviceRoleKey);

  // Build scope filters — ordered by precedence
  const scopeFilters: Array<{ scope_type: string; scope_key: string }> = [
    { scope_type: "global", scope_key: "default" },
  ];
  if (context.surface) scopeFilters.push({ scope_type: "surface", scope_key: context.surface });
  if (context.project_id) scopeFilters.push({ scope_type: "project", scope_key: context.project_id });
  if (context.lane) scopeFilters.push({ scope_type: "lane", scope_key: context.lane });
  if (context.production_type) scopeFilters.push({ scope_type: "production_type", scope_key: context.production_type });
  if (context.modality) scopeFilters.push({ scope_type: "modality", scope_key: context.modality });

  // Load all matching policies ordered by priority ASC (lower = applied first)
  const { data: rows, error } = await sb
    .from("intel_policies")
    .select("scope_type, scope_key, enabled, policy, priority")
    .order("priority", { ascending: true });

  if (error || !rows) {
    console.error("Failed to load intel policies:", error);
    return { enabled: true, policy: { ...DEFAULT_POLICY }, sources: ["fallback"] };
  }

  // Filter to relevant scopes
  const scopeSet = new Set(scopeFilters.map(s => `${s.scope_type}:${s.scope_key}`));
  const relevant = rows.filter(r => scopeSet.has(`${r.scope_type}:${r.scope_key}`));

  if (relevant.length === 0) {
    return { enabled: true, policy: { ...DEFAULT_POLICY }, sources: ["default_fallback"] };
  }

  // Merge policies (later in priority list overrides earlier)
  let merged: any = {};
  let enabled = true;
  const sources: string[] = [];

  for (const row of relevant) {
    sources.push(`${row.scope_type}:${row.scope_key}`);
    if (!row.enabled) {
      enabled = false; // any disabled scope kills the chain
    }
    merged = deepMerge(merged, row.policy as any);
  }

  // Ensure all required fields exist
  const finalPolicy: IntelPolicy = {
    advisory_only: merged.advisory_only ?? DEFAULT_POLICY.advisory_only,
    modules: { ...DEFAULT_POLICY.modules, ...(merged.modules || {}) },
    thresholds: { ...DEFAULT_POLICY.thresholds, ...(merged.thresholds || {}) },
    warnings: { ...DEFAULT_POLICY.warnings, ...(merged.warnings || {}) },
    cadence: { ...DEFAULT_POLICY.cadence, ...(merged.cadence || {}) },
  };

  return { enabled, policy: finalPolicy, sources };
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
