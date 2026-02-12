import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

/**
 * Recalibrate engine weights based on prediction accuracy.
 *
 * Logic:
 * 1. Fetch all resolved prediction_outcomes
 * 2. For each outcome, find the engine scores at prediction time
 * 3. Engines that correlated well with successful outcomes get weight boost
 * 4. Engines that correlated poorly get weight reduction
 * 5. Normalize weights back to 1.0 per production type
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

    // Fetch resolved outcomes
    const { data: outcomes } = await supabase
      .from("prediction_outcomes")
      .select("*, projects!prediction_outcomes_project_id_fkey(format)")
      .neq("actual_financing_outcome", "pending");

    if (!outcomes?.length || outcomes.length < 3) {
      return new Response(
        JSON.stringify({ message: "Need at least 3 resolved outcomes for recalibration", recalibrated: false }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Fetch all engine scores for those projects
    const projectIds = [...new Set(outcomes.map((o: any) => o.project_id))];
    const { data: allScores } = await supabase
      .from("project_engine_scores")
      .select("*")
      .in("project_id", projectIds);

    // Fetch engines
    const { data: engines } = await supabase
      .from("trend_engines")
      .select("*")
      .eq("status", "active");

    if (!engines?.length || !allScores?.length) {
      return new Response(
        JSON.stringify({ message: "Insufficient data for recalibration", recalibrated: false }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Calculate per-engine accuracy correlation
    // For each engine: how well does a high score correlate with successful outcomes?
    const engineCorrelation: Record<string, { hits: number; misses: number; total: number }> = {};
    for (const engine of engines) {
      engineCorrelation[engine.id] = { hits: 0, misses: 0, total: 0 };
    }

    for (const outcome of outcomes) {
      const wasSuccess = ["fully-financed", "partially-financed"].includes(outcome.actual_financing_outcome);
      const projectScores = (allScores as any[]).filter((s: any) => s.project_id === outcome.project_id);

      for (const score of projectScores) {
        if (!engineCorrelation[score.engine_id]) continue;
        engineCorrelation[score.engine_id].total++;

        const enginePredictedPositive = score.score >= 6;
        if ((enginePredictedPositive && wasSuccess) || (!enginePredictedPositive && !wasSuccess)) {
          engineCorrelation[score.engine_id].hits++;
        } else {
          engineCorrelation[score.engine_id].misses++;
        }
      }
    }

    // Compute adjustment factors: engines with better accuracy get boosted
    const adjustments: Record<string, number> = {};
    for (const engine of engines) {
      const corr = engineCorrelation[engine.id];
      if (corr.total < 2) {
        adjustments[engine.id] = 1.0; // Not enough data, no change
        continue;
      }
      const accuracy = corr.hits / corr.total;
      // Map accuracy to adjustment: 0.8x for poor, 1.2x for excellent
      adjustments[engine.id] = 0.8 + (accuracy * 0.4);
    }

    // Apply adjustments per production type
    const { data: existingWeights } = await supabase
      .from("production_engine_weights")
      .select("*");

    if (!existingWeights?.length) {
      return new Response(
        JSON.stringify({ message: "No weights to recalibrate", recalibrated: false }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Group by production type
    const byType: Record<string, any[]> = {};
    for (const w of existingWeights) {
      if (!byType[w.production_type]) byType[w.production_type] = [];
      byType[w.production_type].push(w);
    }

    let updated = 0;
    for (const [prodType, typeWeights] of Object.entries(byType)) {
      // Apply adjustments
      const adjusted = typeWeights.map((w: any) => ({
        ...w,
        new_weight: w.weight_value * (adjustments[w.engine_id] || 1.0),
      }));

      // Normalize to 1.0
      const total = adjusted.reduce((s: number, w: any) => s + w.new_weight, 0);
      if (total <= 0) continue;

      for (const w of adjusted) {
        const normalized = w.new_weight / total;
        // Only update if the change is meaningful (> 0.5% shift)
        if (Math.abs(normalized - w.weight_value) > 0.005) {
          const { error } = await supabase
            .from("production_engine_weights")
            .update({ weight_value: parseFloat(normalized.toFixed(4)) })
            .eq("id", w.id);
          if (!error) updated++;
        }
      }
    }

    // Populate model_accuracy_scores table
    for (const engine of engines) {
      const corr = engineCorrelation[engine.id];
      if (corr.total < 1) continue;

      // Determine production types this engine participates in
      const engineProdTypes = new Set<string>();
      for (const outcome of outcomes) {
        const proj = outcome.projects;
        const fmt = proj?.format || 'film';
        const projScores = (allScores as any[]).filter(
          (s: any) => s.project_id === outcome.project_id && s.engine_id === engine.id
        );
        if (projScores.length > 0) engineProdTypes.add(fmt);
      }

      for (const pt of engineProdTypes) {
        // Calculate per-type accuracy
        let ptHits = 0, ptTotal = 0, ptPredSum = 0, ptActualSum = 0;
        for (const outcome of outcomes) {
          const proj = outcome.projects;
          const fmt = proj?.format || 'film';
          if (fmt !== pt) continue;
          const projScore = (allScores as any[]).find(
            (s: any) => s.project_id === outcome.project_id && s.engine_id === engine.id
          );
          if (!projScore) continue;
          ptTotal++;
          ptPredSum += projScore.score;
          const wasSuccess = ["fully-financed", "partially-financed"].includes(outcome.actual_financing_outcome);
          ptActualSum += wasSuccess ? 10 : 0;
          const predicted = projScore.score >= 6;
          if ((predicted && wasSuccess) || (!predicted && !wasSuccess)) ptHits++;
        }

        if (ptTotal > 0) {
          const accPct = parseFloat(((ptHits / ptTotal) * 100).toFixed(2));
          await supabase
            .from("model_accuracy_scores")
            .upsert({
              production_type: pt,
              engine_id: engine.id,
              total_predictions: ptTotal,
              correct_predictions: ptHits,
              accuracy_pct: accPct,
              avg_predicted_score: parseFloat((ptPredSum / ptTotal).toFixed(2)),
              avg_actual_outcome: parseFloat((ptActualSum / ptTotal).toFixed(2)),
              last_calculated_at: new Date().toISOString(),
            }, { onConflict: "production_type,engine_id" });
        }
      }
    }

    return new Response(
      JSON.stringify({
        success: true,
        recalibrated: true,
        weights_updated: updated,
        outcomes_analysed: outcomes.length,
        engine_correlations: Object.fromEntries(
          engines.map((e: any) => [e.engine_name, {
            accuracy: engineCorrelation[e.id].total > 0
              ? Math.round((engineCorrelation[e.id].hits / engineCorrelation[e.id].total) * 100)
              : null,
            adjustment: adjustments[e.id] ? parseFloat(adjustments[e.id].toFixed(2)) : 1.0,
          }])
        ),
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (e) {
    console.error("recalibrate-weights error:", e);
    return new Response(
      JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
