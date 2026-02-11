import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

/**
 * Quarterly Source Relevance Audit
 *
 * 1. For each active data source, find its linked engines via engine_source_map
 * 2. For each engine, gather project_engine_scores and correlate with prediction_outcomes
 * 3. Sources whose engines consistently mis-predict get reliability_score reduced
 * 4. Sources with zero usage or stale data get flagged
 * 5. All changes logged to model_version_log
 */
serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    // Verify user
    const anonClient = createClient(supabaseUrl, Deno.env.get("SUPABASE_ANON_KEY")!, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: { user }, error: userErr } = await anonClient.auth.getUser();
    if (userErr || !user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // 1. Fetch all active sources, engines, mappings
    const [sourcesRes, enginesRes, mappingsRes, outcomesRes, scoresRes] = await Promise.all([
      supabase.from("data_sources").select("*").eq("status", "active"),
      supabase.from("trend_engines").select("*").eq("status", "active"),
      supabase.from("engine_source_map").select("*").eq("status", "active"),
      supabase.from("prediction_outcomes").select("*").neq("actual_financing_outcome", "pending"),
      supabase.from("project_engine_scores").select("*"),
    ]);

    const sources = sourcesRes.data || [];
    const engines = enginesRes.data || [];
    const mappings = mappingsRes.data || [];
    const outcomes = outcomesRes.data || [];
    const scores = scoresRes.data || [];

    if (sources.length === 0) {
      return new Response(
        JSON.stringify({ message: "No active data sources to audit", audited: false }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // 2. Build engine accuracy map from outcomes
    const engineAccuracy: Record<string, { hits: number; total: number }> = {};
    for (const engine of engines) {
      engineAccuracy[engine.id] = { hits: 0, total: 0 };
    }

    for (const outcome of outcomes) {
      const wasSuccess = ["fully-financed", "partially-financed"].includes(
        outcome.actual_financing_outcome
      );
      const projectScores = scores.filter((s: any) => s.project_id === outcome.project_id);

      for (const score of projectScores) {
        if (!engineAccuracy[score.engine_id]) continue;
        engineAccuracy[score.engine_id].total++;
        const predicted = score.score >= 6;
        if ((predicted && wasSuccess) || (!predicted && !wasSuccess)) {
          engineAccuracy[score.engine_id].hits++;
        }
      }
    }

    // 3. Propagate engine accuracy down to sources via mappings
    const sourceResults: Array<{
      source_id: string;
      source_name: string;
      prev_reliability: number;
      new_reliability: number;
      accuracy: number | null;
      engines_linked: number;
      engines_with_data: number;
      staleness_flag: boolean;
      status_change: string | null;
    }> = [];

    const now = Date.now();
    const NINETY_DAYS_MS = 90 * 24 * 60 * 60 * 1000;
    let sourcesUpdated = 0;

    for (const source of sources) {
      // Find all engines this source feeds
      const linkedMappings = mappings.filter((m: any) => m.source_id === source.id);
      const linkedEngineIds = linkedMappings.map((m: any) => m.engine_id);

      // Calculate weighted accuracy across linked engines
      let weightedAcc = 0;
      let totalWeight = 0;
      let enginesWithData = 0;

      for (const mapping of linkedMappings) {
        const acc = engineAccuracy[mapping.engine_id];
        if (!acc || acc.total < 2) continue;
        enginesWithData++;
        const accuracy = acc.hits / acc.total;
        weightedAcc += accuracy * mapping.source_weight;
        totalWeight += mapping.source_weight;
      }

      const avgAccuracy = totalWeight > 0 ? weightedAcc / totalWeight : null;

      // Staleness check: last_refresh > 90 days ago
      const staleness_flag = source.last_refresh
        ? now - new Date(source.last_refresh).getTime() > NINETY_DAYS_MS
        : true;

      // Compute new reliability
      let newReliability = source.reliability_score;
      let statusChange: string | null = null;

      if (avgAccuracy !== null) {
        // Blend current reliability with measured accuracy (70% measured, 30% existing)
        newReliability = avgAccuracy * 0.7 + source.reliability_score * 0.3;
        newReliability = Math.max(0.1, Math.min(1.0, newReliability));
      }

      // Apply staleness penalty
      if (staleness_flag) {
        newReliability = Math.max(0.1, newReliability * 0.85);
      }

      // Flag sources with very low accuracy
      if (avgAccuracy !== null && avgAccuracy < 0.4 && enginesWithData >= 2) {
        statusChange = "flagged-low-correlation";
      }

      // Only update if meaningful change
      const changed = Math.abs(newReliability - source.reliability_score) > 0.01 || statusChange;

      if (changed) {
        const updatePayload: any = {
          reliability_score: parseFloat(newReliability.toFixed(3)),
          data_staleness_score: staleness_flag ? Math.min(1, source.data_staleness_score + 0.1) : Math.max(0, source.data_staleness_score - 0.05),
        };

        await supabase
          .from("data_sources")
          .update(updatePayload)
          .eq("id", source.id);

        sourcesUpdated++;
      }

      sourceResults.push({
        source_id: source.id,
        source_name: source.source_name,
        prev_reliability: source.reliability_score,
        new_reliability: parseFloat(newReliability.toFixed(3)),
        accuracy: avgAccuracy !== null ? parseFloat((avgAccuracy * 100).toFixed(1)) : null,
        engines_linked: linkedMappings.length,
        engines_with_data: enginesWithData,
        staleness_flag,
        status_change: statusChange,
      });
    }

    // 4. Log to model_version_log
    const flagged = sourceResults.filter(r => r.status_change);
    const stale = sourceResults.filter(r => r.staleness_flag);

    await supabase.from("model_version_log").insert({
      version_label: `Quarterly Audit — ${new Date().toISOString().slice(0, 10)}`,
      production_type: "all",
      change_type: "quarterly_audit",
      reason: `Auto-audit: ${sourcesUpdated} sources updated, ${flagged.length} flagged low-correlation, ${stale.length} stale.`,
      triggered_by: "audit-sources",
      changes: {
        sources_audited: sources.length,
        sources_updated: sourcesUpdated,
        flagged_sources: flagged.map(f => ({ name: f.source_name, accuracy: f.accuracy })),
        stale_sources: stale.map(s => s.source_name),
        outcomes_analysed: outcomes.length,
        results: sourceResults,
      },
    });

    return new Response(
      JSON.stringify({
        success: true,
        audited: true,
        sources_audited: sources.length,
        sources_updated: sourcesUpdated,
        flagged_count: flagged.length,
        stale_count: stale.length,
        outcomes_analysed: outcomes.length,
        results: sourceResults,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (e) {
    console.error("audit-sources error:", e);
    return new Response(
      JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
