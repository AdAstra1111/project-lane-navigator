import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

function jsonRes(body: any, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  // Ping
  if (req.method === "GET") {
    return jsonRes({ ok: true, build: "compute-project-intel-alignment-v1" });
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const sb = createClient(supabaseUrl, serviceKey);

  try {
    const body = await req.json();
    const { project_id } = body;

    if (!project_id) return jsonRes({ error: "project_id required" }, 400);

    // Verify user access
    const authHeader = req.headers.get("Authorization");
    const sbUser = createClient(supabaseUrl, Deno.env.get("SUPABASE_PUBLISHABLE_KEY") || Deno.env.get("SUPABASE_ANON_KEY")!, {
      global: { headers: { Authorization: authHeader || "" } },
    });
    const { data: { user } } = await sbUser.auth.getUser();
    if (!user) return jsonRes({ error: "Unauthorized" }, 401);

    const { data: hasAccess } = await sb.rpc("has_project_access", { _user_id: user.id, _project_id: project_id });
    if (!hasAccess) return jsonRes({ error: "No project access" }, 403);

    // Create intel_run
    const { data: run, error: runErr } = await sb
      .from("intel_runs")
      .insert({
        engine_name: "project-alignment",
        trigger: body.trigger || "manual",
        scope: "project",
        requested_filters: { project_id },
        ok: false,
      })
      .select("id")
      .single();

    if (runErr || !run) return jsonRes({ error: "Failed to create run", detail: runErr?.message }, 500);

    const runId = run.id;

    // Load project embedding
    const { data: projVec } = await sb
      .from("project_vectors")
      .select("embedding")
      .eq("project_id", project_id)
      .eq("vector_type", "logline")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    // Load active trend signals with embeddings
    const { data: signals } = await sb
      .from("trend_signals")
      .select("id, name, strength, velocity, saturation_risk, category, embedding, genre_tags, tone_tags")
      .eq("status", "active")
      .not("embedding", "is", null);

    // If no project embedding, compute basic strength-based alignment
    let alignment_score = 0;
    let opportunity_score = 0;
    let risk_score = 0;
    let contrarian_score = 0;
    const top_signal_ids: string[] = [];

    if (signals && signals.length > 0) {
      // Sort by strength descending
      const sorted = [...signals].sort((a, b) => (b.strength || 0) - (a.strength || 0));
      const topN = sorted.slice(0, 10);

      // Compute scores based on signal properties
      const avgStrength = topN.reduce((s, t) => s + (t.strength || 0), 0) / topN.length;
      alignment_score = Math.min(100, Math.round(avgStrength * 10));

      // Opportunity: high strength + accelerating velocity
      const accelCount = topN.filter(s => s.velocity === "accelerating").length;
      opportunity_score = Math.round((accelCount / topN.length) * 100);

      // Risk: saturation
      const satCount = topN.filter(s => s.saturation_risk === "high" || s.saturation_risk === "saturated").length;
      risk_score = Math.round((satCount / topN.length) * 100);

      // Contrarian: low-strength emerging signals
      const emerging = sorted.filter(s => (s.strength || 0) <= 5 && s.velocity === "accelerating");
      contrarian_score = Math.min(100, emerging.length * 15);

      topN.forEach(s => top_signal_ids.push(s.id));
    }

    // Lane fit scores
    const { data: lanes } = await sb.from("lane_profiles").select("lane_key, description, risk_tolerance, heat_preference");
    const lane_fit_scores: Record<string, number> = {};
    if (lanes) {
      for (const l of lanes) {
        // Simple heuristic: higher alignment = better fit for heat-seeking lanes
        lane_fit_scores[l.lane_key] = Math.round(alignment_score * (l.heat_preference || 0.5));
      }
    }

    // Buyer fit scores
    const { data: buyers } = await sb.from("buyer_profiles").select("buyer_key, risk_profile");
    const buyer_fit_scores: Record<string, number> = {};
    if (buyers) {
      for (const b of buyers) {
        buyer_fit_scores[b.buyer_key] = Math.round(alignment_score * (1 - (b.risk_profile || 0.5)));
      }
    }

    // Format fit scores
    const { data: formats } = await sb.from("format_archetypes").select("format_key");
    const format_fit_scores: Record<string, number> = {};
    if (formats) {
      for (const f of formats) {
        format_fit_scores[f.format_key] = alignment_score; // baseline
      }
    }

    const result = {
      alignment_score,
      opportunity_score,
      risk_score,
      contrarian_score,
      top_signal_ids,
      lane_fit_scores,
      buyer_fit_scores,
      format_fit_scores,
      convergence_matches: {},
    };

    // Persist alignment
    await sb.from("project_intel_alignment").insert({
      project_id,
      run_id: runId,
      alignment_score,
      opportunity_score,
      risk_score,
      contrarian_score,
      top_signal_ids,
      lane_fit_scores,
      buyer_fit_scores,
      format_fit_scores,
      convergence_matches: {},
      breakdown: result,
    });

    // Mark run ok
    await sb.from("intel_runs").update({
      ok: true,
      stats: {
        signals_analyzed: signals?.length || 0,
        alignment_score,
        opportunity_score,
        risk_score,
        contrarian_score,
      },
    }).eq("id", runId);

    return jsonRes({
      ok: true,
      advisory_only: true,
      run_id: runId,
      ...result,
    });
  } catch (err) {
    console.error("compute-project-intel-alignment error:", err);
    return jsonRes({ error: err instanceof Error ? err.message : "Unknown error" }, 500);
  }
});
