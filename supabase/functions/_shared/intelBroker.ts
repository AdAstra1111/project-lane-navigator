/**
 * Intel Broker — Centralized intel context builder.
 *
 * NO surface may directly query trend_signals.
 * All intel access goes through this broker.
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { resolveIntelPolicy, type PolicyContext, type ResolvedIntelPolicy } from "./intelPolicy.ts";

export interface IntelContextBlock {
  advisory_only: true;
  policy: ResolvedIntelPolicy;
  top_signals: Array<{
    id: string;
    name: string;
    strength: number;
    velocity: string;
    category: string;
    saturation_risk: string;
  }>;
  open_alerts: Array<{
    id: string;
    event_type: string;
    severity: string;
    payload: any;
  }>;
  metadata: {
    generated_at: string;
    policy_sources: string[];
  };
}

export interface BrokerContext extends PolicyContext {
  limit_signals?: number;
  limit_alerts?: number;
}

/**
 * Build a structured intel context block for any surface.
 * Returns null if intel is disabled by policy.
 */
export async function buildIntelContextBlock(
  supabaseUrl: string,
  serviceRoleKey: string,
  context: BrokerContext,
): Promise<IntelContextBlock | null> {
  const resolved = await resolveIntelPolicy(supabaseUrl, serviceRoleKey, context);

  if (!resolved.enabled) return null;

  const sb = createClient(supabaseUrl, serviceRoleKey);
  const policy = resolved.policy;
  const limitSignals = context.limit_signals ?? 10;
  const limitAlerts = context.limit_alerts ?? 5;

  // Fetch top active signals above strength threshold
  let signals: IntelContextBlock["top_signals"] = [];
  if (policy.modules.trend_signals) {
    const { data } = await sb
      .from("trend_signals")
      .select("id, name, strength, velocity, category, saturation_risk")
      .eq("status", "active")
      .gte("strength", policy.thresholds.min_signal_strength)
      .order("strength", { ascending: false })
      .limit(limitSignals);
    signals = (data || []).map(s => ({
      id: s.id,
      name: s.name,
      strength: s.strength,
      velocity: s.velocity,
      category: s.category,
      saturation_risk: s.saturation_risk,
    }));
  }

  // Fetch open alerts
  let alerts: IntelContextBlock["open_alerts"] = [];
  if (policy.warnings.enabled) {
    const q = sb
      .from("intel_events")
      .select("id, event_type, severity, payload")
      .eq("status", "open")
      .order("created_at", { ascending: false })
      .limit(limitAlerts);

    if (context.project_id) {
      q.eq("project_id", context.project_id);
    }

    const { data } = await q;
    alerts = (data || []).map(e => ({
      id: e.id,
      event_type: e.event_type,
      severity: e.severity,
      payload: e.payload,
    }));
  }

  return {
    advisory_only: true,
    policy: resolved,
    top_signals: signals,
    open_alerts: alerts,
    metadata: {
      generated_at: new Date().toISOString(),
      policy_sources: resolved.sources,
    },
  };
}
