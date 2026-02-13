import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const FINANCE_ACCURACY_THRESHOLD = 0.65;

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    if (!supabaseUrl || !serviceKey) throw new Error("Missing env vars");

    const db = createClient(supabaseUrl, serviceKey);
    const log: string[] = [];
    const addLog = (msg: string) => { log.push(`[${new Date().toISOString()}] ${msg}`); };

    addLog("Starting nightly outcome rollup");

    // 1. Find projects with outcomes updated in last 24h
    const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const { data: recentOutcomes, error: fetchErr } = await db
      .from("project_outcomes")
      .select("project_id")
      .gte("recorded_at", cutoff);

    if (fetchErr) throw new Error(`Failed to fetch outcomes: ${fetchErr.message}`);
    addLog(`Found ${recentOutcomes?.length || 0} recently updated outcomes`);

    // 2. Recompute deltas for each (safety net — trigger should handle this, but belt & braces)
    let recomputed = 0;
    for (const row of (recentOutcomes || [])) {
      const { error: rpcErr } = await db.rpc("compute_outcome_deltas", {
        p_project_id: row.project_id,
      });
      if (rpcErr) {
        addLog(`Error recomputing ${row.project_id}: ${rpcErr.message}`);
      } else {
        recomputed++;
      }
    }
    addLog(`Recomputed ${recomputed} deltas`);

    // 3. Compute aggregate accuracy snapshot
    const { data: allDeltas } = await db
      .from("outcome_deltas")
      .select("finance_prediction_correct, greenlight_prediction_correct, predicted_to_actual_gap_score");

    const total = allDeltas?.length || 0;
    let financeCorrect = 0;
    let greenlightCorrect = 0;
    let totalGap = 0;

    for (const d of (allDeltas || [])) {
      if (d.finance_prediction_correct) financeCorrect++;
      if (d.greenlight_prediction_correct) greenlightCorrect++;
      totalGap += d.predicted_to_actual_gap_score || 0;
    }

    const financeAccuracy = total > 0 ? financeCorrect / total : null;
    const greenlightAccuracy = total > 0 ? greenlightCorrect / total : null;
    const avgGap = total > 0 ? totalGap / total : null;

    addLog(`Accuracy: finance=${financeAccuracy?.toFixed(3)}, greenlight=${greenlightAccuracy?.toFixed(3)}, avgGap=${avgGap?.toFixed(1)}, n=${total}`);

    // 4. Snapshot into model_accuracy_scores (using a synthetic engine_id for the outcome loop)
    const OUTCOME_ENGINE_ID = "00000000-0000-0000-0000-000000000001";
    if (total > 0) {
      await db.from("model_accuracy_scores").upsert({
        id: OUTCOME_ENGINE_ID,
        engine_id: OUTCOME_ENGINE_ID,
        production_type: "all",
        total_predictions: total,
        correct_predictions: financeCorrect,
        accuracy_pct: financeAccuracy !== null ? Math.round(financeAccuracy * 100) : 0,
        avg_predicted_score: avgGap,
        avg_actual_outcome: greenlightAccuracy !== null ? Math.round(greenlightAccuracy * 100) : 0,
        last_calculated_at: new Date().toISOString(),
      }, { onConflict: "id" });
      addLog("Snapshot written to model_accuracy_scores");
    }

    // 5. Calibration alert: if finance accuracy below threshold, notify admins
    if (financeAccuracy !== null && financeAccuracy < FINANCE_ACCURACY_THRESHOLD && total >= 5) {
      addLog(`⚠️ Finance accuracy ${(financeAccuracy * 100).toFixed(1)}% below ${FINANCE_ACCURACY_THRESHOLD * 100}% threshold`);

      // Find admin users (users with 'admin' role)
      const { data: adminRoles } = await db
        .from("user_roles")
        .select("user_id")
        .eq("role", "admin");

      const adminIds = (adminRoles || []).map((r: any) => r.user_id);

      // Also notify all users who have project outcomes (they're likely producers)
      if (adminIds.length === 0) {
        const { data: outcomeUsers } = await db
          .from("project_outcomes")
          .select("user_id")
          .limit(10);
        const uniqueUsers = [...new Set((outcomeUsers || []).map((u: any) => u.user_id))];
        adminIds.push(...uniqueUsers);
      }

      for (const userId of adminIds.slice(0, 5)) {
        await db.from("notifications").insert({
          user_id: userId,
          type: "calibration-alert",
          title: "Calibration Alert: Finance Accuracy Low",
          body: `Finance prediction accuracy is ${(financeAccuracy * 100).toFixed(1)}% (threshold: ${FINANCE_ACCURACY_THRESHOLD * 100}%). Consider tightening finance confidence thresholds or adjusting greenlight simulator weights. Based on ${total} outcomes.`,
          link: "/calibration-lab",
        });
      }
      addLog(`Sent calibration alerts to ${Math.min(adminIds.length, 5)} users`);
    }

    const result = {
      recomputed,
      total,
      finance_accuracy: financeAccuracy,
      greenlight_accuracy: greenlightAccuracy,
      avg_gap: avgGap,
      alert_triggered: financeAccuracy !== null && financeAccuracy < FINANCE_ACCURACY_THRESHOLD && total >= 5,
      log,
    };

    return new Response(JSON.stringify(result), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("nightly-outcome-rollup error:", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
