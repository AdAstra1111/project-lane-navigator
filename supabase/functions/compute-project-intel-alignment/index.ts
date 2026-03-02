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
  if (req.method === "GET") return jsonRes({ ok: true, build: "compute-project-intel-alignment-v3" });

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const sb = createClient(supabaseUrl, serviceKey);

  try {
    const body = await req.json();
    const { project_id } = body;
    if (!project_id) return jsonRes({ error: "project_id required" }, 400);

    // Verify user access
    const authHeader = req.headers.get("Authorization");
    const sbUser = createClient(supabaseUrl, Deno.env.get("SUPABASE_ANON_KEY")!, {
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
        engine_name: "project-alignment-v3",
        trigger: body.trigger || "manual",
        scope: "project",
        requested_filters: { project_id },
        ok: false,
      })
      .select("id")
      .single();

    if (runErr || !run) return jsonRes({ error: "Failed to create run", detail: runErr?.message }, 500);
    const runId = run.id;

    // Load project embedding (prefer logline, then summary)
    const { data: projVec } = await sb
      .from("project_vectors")
      .select("embedding")
      .eq("project_id", project_id)
      .eq("vector_type", "logline")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    let projectEmbedding = projVec?.embedding;
    if (!projectEmbedding) {
      const { data: summaryVec } = await sb
        .from("project_vectors")
        .select("embedding")
        .eq("project_id", project_id)
        .eq("vector_type", "summary")
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      projectEmbedding = summaryVec?.embedding;
    }

    const usedPgvector = !!projectEmbedding;
    let usedDbSimilarity = false;
    let topMatches: any[] = [];

    if (usedPgvector) {
      // ===== FIX #1: Use DB-side pgvector similarity via match_trend_signals RPC =====
      const { data: rpcMatches, error: rpcErr } = await sb.rpc("match_trend_signals", {
        _project_embedding: projectEmbedding,
        _min_strength: 1,
        _limit: 30,
      });

      if (rpcErr) {
        console.error("match_trend_signals RPC error, falling back to tag scoring:", rpcErr.message);
        // Fall through to tag-intersection fallback below
      } else if (rpcMatches && rpcMatches.length > 0) {
        usedDbSimilarity = true;
        topMatches = rpcMatches.map((m: any) => {
          const base = m.similarity * 100;
          const strengthWeight = (m.strength || 5) / 10;
          const velocityWeight = m.velocity === "Rising" ? 1.1 : m.velocity === "Declining" ? 0.85 : 1.0;
          const satPenalty = m.saturation_risk === "High" ? 0.85 : m.saturation_risk === "Medium" ? 0.93 : 1.0;
          const finalScore = base * strengthWeight * velocityWeight * satPenalty;

          return {
            signal_id: m.signal_id,
            name: m.name,
            similarity: Math.round(m.similarity * 1000) / 1000,
            strength: m.strength,
            velocity: m.velocity,
            saturation_risk: m.saturation_risk,
            dimension: m.dimension,
            modality: m.modality,
            cycle_phase: m.cycle_phase,
            final_score: Math.round(finalScore * 100) / 100,
          };
        });
        topMatches.sort((a: any, b: any) => b.final_score - a.final_score);
      }
    }

    // Tag-intersection fallback (no embedding OR RPC failed)
    if (topMatches.length === 0) {
      const { data: project } = await sb
        .from("projects")
        .select("genre, format, assigned_lane")
        .eq("id", project_id)
        .maybeSingle();

      const { data: signals } = await sb
        .from("trend_signals")
        .select("id, name, strength, velocity, saturation_risk, category, dimension, modality, genre_tags, tone_tags, format_tags, cycle_phase")
        .eq("status", "active");

      if (signals && signals.length > 0 && project) {
        const projGenres = (project.genre || "").toLowerCase().split(/[,/]/).map((g: string) => g.trim()).filter(Boolean);
        const projFormat = (project.format || "").toLowerCase();

        const scored = signals.map(sig => {
          const sigGenres = (sig.genre_tags || []).map((t: string) => t.toLowerCase());
          const sigFormats = (sig.format_tags || []).map((t: string) => t.toLowerCase());

          const genreOverlap = projGenres.filter((g: string) => sigGenres.includes(g)).length;
          const formatMatch = sigFormats.includes(projFormat) ? 1 : 0;
          const intersectionScore = (genreOverlap + formatMatch) / Math.max(1, projGenres.length + 1);

          const base = intersectionScore * 100;
          const strengthWeight = (sig.strength || 5) / 10;
          const velocityWeight = sig.velocity === "Rising" ? 1.1 : sig.velocity === "Declining" ? 0.85 : 1.0;
          const satPenalty = sig.saturation_risk === "High" ? 0.85 : sig.saturation_risk === "Medium" ? 0.93 : 1.0;
          const finalScore = base * strengthWeight * velocityWeight * satPenalty;

          return {
            signal_id: sig.id,
            name: sig.name,
            similarity: Math.round(intersectionScore * 1000) / 1000,
            strength: sig.strength,
            velocity: sig.velocity,
            saturation_risk: sig.saturation_risk,
            dimension: sig.dimension,
            modality: sig.modality,
            cycle_phase: sig.cycle_phase,
            final_score: Math.round(finalScore * 100) / 100,
          };
        });

        scored.sort((a, b) => b.final_score - a.final_score);
        topMatches = scored.slice(0, 30);
      }
    }

    // Compute aggregate scores from top 10
    const top10 = topMatches.slice(0, 10);
    const alignment_score = top10.length > 0
      ? Math.min(100, Math.round(top10.reduce((s, t) => s + t.final_score, 0) / top10.length))
      : 0;

    const opportunity_score = top10.length > 0
      ? Math.round((top10.filter(t => t.velocity === "Rising" && ["Early", "Building"].includes(t.cycle_phase)).length / top10.length) * 100)
      : 0;

    const risk_score = top10.length > 0
      ? Math.round((top10.filter(t => t.saturation_risk === "High" || ["Peaking", "Declining"].includes(t.cycle_phase)).length / top10.length) * 100)
      : 0;

    const contrarian_matches = topMatches.filter(t => t.similarity > 0.5 && t.strength <= 5 && t.velocity === "Rising");
    const contrarian_score = Math.min(100, contrarian_matches.length * 15);

    const top_signal_ids = top10.map(t => t.signal_id);

    // Lane/buyer/format fit
    const { data: lanes } = await sb.from("lane_profiles").select("lane_key, heat_preference");
    const lane_fit_scores: Record<string, number> = {};
    if (lanes) {
      for (const l of lanes) {
        lane_fit_scores[l.lane_key] = Math.round(alignment_score * (l.heat_preference || 0.5));
      }
    }

    const { data: buyers } = await sb.from("buyer_profiles").select("buyer_key, risk_profile");
    const buyer_fit_scores: Record<string, number> = {};
    if (buyers) {
      for (const b of buyers) {
        buyer_fit_scores[b.buyer_key] = Math.round(alignment_score * (1 - (b.risk_profile || 0.5)));
      }
    }

    const { data: formats } = await sb.from("format_archetypes").select("format_key");
    const format_fit_scores: Record<string, number> = {};
    if (formats) {
      for (const f of formats) {
        format_fit_scores[f.format_key] = alignment_score;
      }
    }

    const breakdown = topMatches.slice(0, 15);

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

    // Persist
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
      breakdown,
    });

    // Mark run ok
    await sb.from("intel_runs").update({
      ok: true,
      stats: {
        signals_analyzed: topMatches.length > 0 ? topMatches.length : 0,
        used_pgvector: usedPgvector,
        used_db_similarity: usedDbSimilarity,
        alignment_score,
        opportunity_score,
        risk_score,
        contrarian_score,
        top_similarity: topMatches[0]?.similarity || 0,
      },
    }).eq("id", runId);

    return jsonRes({
      ok: true,
      advisory_only: true,
      run_id: runId,
      used_pgvector: usedPgvector,
      used_db_similarity: usedDbSimilarity,
      ...result,
      breakdown,
    });
  } catch (err) {
    console.error("compute-project-intel-alignment error:", err);
    return jsonRes({ error: err instanceof Error ? err.message : "Unknown error" }, 500);
  }
});
