/**
 * Shared Trends Context — deterministic helpers for modality-aware trend retrieval.
 *
 * Used by generate-pitch and any engine that needs modality-filtered trend signals.
 * SINGLE SOURCE OF TRUTH for trends production_type filter logic.
 */

/**
 * Map production modality → production_type filter for trend queries.
 * - animation → "animation" (strict)
 * - hybrid/live_action → fallbackTypeLabel if truthy, else null (no restriction)
 */
export function modalityToTrendsProductionTypeFilter(
  modality: string | null,
  fallbackTypeLabel?: string | null,
): string | null {
  if (modality === "animation") return "animation";
  if (fallbackTypeLabel) return fallbackTypeLabel;
  return null;
}

const SIGNAL_SELECT =
  "name, category, strength, velocity, explanation, production_type, genre_tags, tone_tags, format_tags, lane_relevance, budget_tier, target_buyer, region, saturation_risk, forecast, cycle_phase";

/**
 * Fetch trend signals using the same 3-tier ladder as generate-pitch:
 * 1. Lane-scoped signals
 * 2. Production-type-scoped signals
 * 3. Global signals (any production type with filter)
 */
export async function fetchTrendSignalsLadder({
  supabase,
  typeLabel,
  lane,
  modality,
}: {
  supabase: any;
  typeLabel: string;
  lane: string;
  modality: string | null;
}): Promise<{
  laneSignals: any[];
  productionSignals: any[];
  globalSignals: any[];
  appliedProductionTypeFilter: string | null;
}> {
  const filter = modalityToTrendsProductionTypeFilter(modality, typeLabel);

  // Step 1: Lane-scoped
  let laneSignals: any[] = [];
  if (lane) {
    let q = supabase
      .from("trend_signals")
      .select(SIGNAL_SELECT)
      .eq("status", "active")
      .contains("lane_relevance", [lane])
      .order("strength", { ascending: false })
      .limit(30);
    if (filter) q = q.eq("production_type", filter);
    const { data } = await q;
    laneSignals = data || [];
  }

  // Step 2: Production-type-scoped
  let prodQ = supabase
    .from("trend_signals")
    .select(SIGNAL_SELECT)
    .eq("status", "active")
    .order("strength", { ascending: false })
    .limit(30);
  if (filter) prodQ = prodQ.eq("production_type", filter);
  const { data: prodData } = await prodQ;
  const productionSignals = prodData || [];

  // Step 3: Global (same filter still applies for modality consistency)
  let globalQ = supabase
    .from("trend_signals")
    .select(SIGNAL_SELECT)
    .eq("status", "active")
    .order("strength", { ascending: false })
    .limit(30);
  if (filter) globalQ = globalQ.eq("production_type", filter);
  const { data: globalData } = await globalQ;
  const globalSignals = globalData || [];

  return { laneSignals, productionSignals, globalSignals, appliedProductionTypeFilter: filter };
}

/**
 * Fetch active cast trends with modality-aware filtering.
 */
export async function fetchCastTrends({
  supabase,
  typeLabel,
  modality,
  region,
  limit = 15,
}: {
  supabase: any;
  typeLabel: string;
  modality: string | null;
  region?: string;
  limit?: number;
}): Promise<{
  castTrends: any[];
  appliedProductionTypeFilter: string | null;
}> {
  const filter = modalityToTrendsProductionTypeFilter(modality, typeLabel);

  let q = supabase
    .from("cast_trends")
    .select("actor_name, trend_type, market_alignment, strength, velocity, genre_relevance, budget_tier, status, production_type, region, saturation_risk, forecast")
    .eq("status", "active")
    .order("strength", { ascending: false })
    .limit(limit);

  if (filter) q = q.eq("production_type", filter);
  if (region && region.toLowerCase() !== "global") q = q.eq("region", region);

  const { data } = await q;
  return { castTrends: data || [], appliedProductionTypeFilter: filter };
}
