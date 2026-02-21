/**
 * analyze-episode-engagement — Computes beat density, tension curve, retention
 * score, and engagement recommendations for a vertical drama episode.
 *
 * Actions:
 *   - "analyze": Full analysis from beats or script text
 *
 * Uses rule-based scoring + LLM-assisted recommendation generation.
 */

import "https://deno.land/std@0.168.0/dotenv/load.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import { callLLM, MODELS, parseJsonSafe } from "../_shared/llm.ts";
import { computeBeatTargets, verticalBeatMinimumServer, buildBeatGuidanceBlock } from "../_shared/verticalDramaBeats.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const body = await req.json();
    const {
      projectId,
      episodeNumber,
      docVersionId,
      mode = "beats", // "beats" | "script"
      content, // optional: raw text to analyze (skips DB fetch)
      episodeLengthMin = 120,
      episodeLengthMax = 180,
    } = body;

    const apiKey = Deno.env.get("LOVABLE_API_KEY");
    if (!apiKey) throw new Error("Missing LOVABLE_API_KEY");

    const supaUrl = Deno.env.get("SUPABASE_URL")!;
    const supaKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const sb = createClient(supaUrl, supaKey);

    // Resolve content to analyze
    let textToAnalyze = content || "";

    if (!textToAnalyze && docVersionId) {
      const { data: ver } = await sb
        .from("project_document_versions")
        .select("content")
        .eq("id", docVersionId)
        .single();
      textToAnalyze = ver?.content || "";
    }

    if (!textToAnalyze && projectId && episodeNumber) {
      // Try series_episodes script
      const { data: ep } = await sb
        .from("series_episodes")
        .select("script_id")
        .eq("project_id", projectId)
        .eq("episode_number", episodeNumber)
        .maybeSingle();

      if (ep?.script_id) {
        const { data: script } = await sb
          .from("scripts")
          .select("content")
          .eq("id", ep.script_id)
          .maybeSingle();
        textToAnalyze = script?.content || "";
      }
    }

    if (!textToAnalyze) {
      return new Response(
        JSON.stringify({ error: "No content to analyze" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // Compute targets
    const targets = computeBeatTargets({
      minSeconds: episodeLengthMin,
      maxSeconds: episodeLengthMax,
    });
    const midSeconds = targets.midSeconds;

    // ── LLM Analysis ──
    const system = `You are a vertical drama engagement analyst. Analyze the provided ${mode === "beats" ? "episode beats" : "episode script"} and return a JSON object.

EPISODE CONSTRAINTS:
- Duration range: ${episodeLengthMin}–${episodeLengthMax}s (midpoint ${midSeconds}s)
- Target beat count: ${targets.beatCountRange}
- Beat spacing target: ${targets.beatSpacingLabel}
- Hook must land within 3–10 seconds
- Micro-cliffhanger required at end

${buildBeatGuidanceBlock(episodeLengthMin, episodeLengthMax)}

Return ONLY this JSON structure:
{
  "beat_density": {
    "detected_beats": <number of distinct story beats>,
    "turns_per_min": <beats / (estimated_runtime / 60)>,
    "estimated_runtime_seconds": <estimated total runtime>,
    "longest_gap_seconds": <longest stretch without a turn>,
    "distribution": "even" | "front_loaded" | "back_loaded" | "uneven",
    "flags": ["sparse_middle", "no_hook", "no_cliffhanger", "overstuffed", ...]
  },
  "tension_curve": {
    "points": [{"t": <seconds>, "value": <0-100>}, ...],
    "peaks": [<seconds>],
    "troughs": [<seconds>],
    "end_hook_strength": <0-100>,
    "hook_time_seconds": <seconds until first hook lands>,
    "shape": "rising" | "sawtooth" | "flat" | "front_heavy" | "crescendo"
  },
  "retention_score": {
    "total": <0-100>,
    "components": {
      "hook_strength": <0-100>,
      "pattern_interrupt_frequency": <0-100>,
      "stakes_clarity": <0-100>,
      "payoff_cadence": <0-100>,
      "cliffhanger_strength": <0-100>,
      "confusion_risk": <0-100>
    },
    "key_risks": ["<risk description>", ...]
  },
  "engagement_score": {
    "total": <0-100>,
    "components": {
      "comment_bait": <0-100>,
      "shareability": <0-100>,
      "rewatch_magnet": <0-100>,
      "character_attachment": <0-100>
    }
  },
  "recommendations": [
    {
      "title": "<short title>",
      "why": "<1-2 sentence explanation>",
      "severity": "low" | "med" | "high",
      "target_section": "<which part of the episode>",
      "suggested_fix": "<specific actionable fix>"
    }
  ]
}

Generate 8-15 tension curve points evenly distributed across the estimated runtime.
Provide 2-5 recommendations ordered by severity (high first).`;

    const result = await callLLM({
      apiKey,
      model: MODELS.FAST,
      system,
      user: `Analyze this ${mode}:\n\n${textToAnalyze.slice(0, 15000)}`,
      temperature: 0.2,
      maxTokens: 4000,
    });

    const metrics = await parseJsonSafe(result.content, apiKey);

    // ── Rule-based validation overlay ──
    // Enforce hard rules on top of LLM scores
    const bd = metrics.beat_density;
    const tc = metrics.tension_curve;
    const rs = metrics.retention_score;

    // Flag: hook too late
    if (tc?.hook_time_seconds > 10 && !bd?.flags?.includes("no_hook")) {
      bd.flags = bd.flags || [];
      bd.flags.push("late_hook");
    }

    // Flag: below minimum beat count
    const minBeats = verticalBeatMinimumServer(midSeconds);
    if (bd?.detected_beats < minBeats && !bd?.flags?.includes("sparse_middle")) {
      bd.flags = bd.flags || [];
      bd.flags.push("below_minimum_beats");
    }

    // Flag: end hook too weak
    if (tc?.end_hook_strength < 50) {
      bd.flags = bd.flags || [];
      if (!bd.flags.includes("no_cliffhanger")) bd.flags.push("weak_cliffhanger");
    }

    // Clamp confusion risk penalty into retention
    if (rs?.components?.confusion_risk > 70) {
      rs.total = Math.max(0, rs.total - Math.round((rs.components.confusion_risk - 70) * 0.5));
    }

    return new Response(
      JSON.stringify({
        success: true,
        episodeNumber,
        mode,
        episodeLengthRange: `${episodeLengthMin}–${episodeLengthMax}s`,
        targets: {
          beatCountRange: targets.beatCountRange,
          beatSpacing: targets.beatSpacingLabel,
          hookWindow: targets.hookWindowSeconds,
        },
        metrics,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (err: any) {
    console.error("analyze-episode-engagement error:", err);
    return new Response(
      JSON.stringify({ error: err.message || "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
