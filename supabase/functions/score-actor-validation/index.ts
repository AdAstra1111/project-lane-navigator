/**
 * Edge Function: score-actor-validation
 * Phase 3 scoring engine for validation packs.
 * 
 * Computes:
 * - intra_slot_stability (variant-to-variant within each slot)
 * - cross_slot_persistence (each slot vs neutral_headshot)
 * - regeneration_stability (weighted rollup)
 * - pack_coverage_score
 * - hard fails: HF-08 (regeneration drift), HF-COV (insufficient coverage)
 * 
 * Status flow: pack_generated → scoring → scored | failed
 */
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

function jsonRes(data: any, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

// ── Constants ───────────────────────────────────────────────────────────────

const INTRA_SLOT_WEIGHT = 0.6;
const CROSS_SLOT_WEIGHT = 0.4;
const HF08_INTRA_THRESHOLD = 5;
const HF08_CROSS_THRESHOLD = 4;
const HF08_SLOT_DIVERGENCE_COUNT = 3;
const HF08_SLOT_DIVERGENCE_THRESHOLD = 5;
const HFCOV_MIN_SLOTS = 8;
const SCORE_CAP_ON_HARD_FAIL = 59;
const REFERENCE_SLOT = "neutral_headshot";

const AXIS_WEIGHTS = {
  intra_slot_stability: 25,
  cross_slot_persistence: 25,
  regeneration_stability: 20,
  pack_coverage_score: 30,
};

// ── Similarity via vision model ─────────────────────────────────────────────

async function compareImages(
  imageUrlA: string,
  imageUrlB: string,
  apiKey: string,
  purpose: string,
): Promise<number> {
  try {
    const prompt = `You are an identity consistency evaluator. Compare these two images of the same person and rate identity consistency on a scale of 0-10.

Focus on: facial structure, nose shape, eye spacing, jawline, cheekbones, overall facial proportions, hair color/style, skin tone, body build.

Context: ${purpose}

Return ONLY a JSON object: {"score": <number 0-10>, "reason": "<brief reason>"}
Score guide: 10=identical person, 7-9=same person with natural variation, 4-6=ambiguous/uncertain, 0-3=different person.`;

    const content = [
      { type: "image_url", image_url: { url: imageUrlA } },
      { type: "image_url", image_url: { url: imageUrlB } },
      { type: "text", text: prompt },
    ];

    const resp = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "google/gemini-2.5-flash-lite",
        messages: [{ role: "user", content }],
        response_format: { type: "json_object" },
      }),
    });

    if (!resp.ok) {
      const errText = await resp.text();
      console.error(`Similarity eval failed (${resp.status}):`, errText);
      if (resp.status === 429) throw new Error("RATE_LIMITED");
      if (resp.status === 402) throw new Error("CREDITS_EXHAUSTED");
      return 5; // neutral fallback
    }

    const data = await resp.json();
    const text = data.choices?.[0]?.message?.content || "";
    try {
      const parsed = JSON.parse(text);
      return Math.min(10, Math.max(0, parsed.score ?? 5));
    } catch {
      // Try to extract number from text
      const match = text.match(/(\d+(?:\.\d+)?)/);
      return match ? Math.min(10, Math.max(0, parseFloat(match[1]))) : 5;
    }
  } catch (e: any) {
    if (e.message === "RATE_LIMITED" || e.message === "CREDITS_EXHAUSTED") throw e;
    console.error("compareImages error:", e);
    return 5;
  }
}

// ── Score band ──────────────────────────────────────────────────────────────

function getScoreBand(score: number): string {
  if (score >= 90) return "elite";
  if (score >= 75) return "stable";
  if (score >= 60) return "promising";
  return "weak";
}

// ── Main Handler ────────────────────────────────────────────────────────────

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const { runId } = await req.json();
    if (!runId) return jsonRes({ error: "runId required" }, 400);

    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) return jsonRes({ error: "LOVABLE_API_KEY not configured" }, 500);

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, serviceKey);

    // 1. Fetch run
    const { data: run, error: runErr } = await supabase
      .from("actor_validation_runs")
      .select("*")
      .eq("id", runId)
      .single();

    if (runErr || !run) return jsonRes({ error: "Validation run not found" }, 404);
    if (run.status !== "pack_generated") {
      return jsonRes({ error: `Run status is '${run.status}', expected 'pack_generated'` }, 400);
    }

    // 2. Transition to scoring
    await supabase
      .from("actor_validation_runs")
      .update({ status: "scoring" })
      .eq("id", runId);

    // 3. Fetch all completed validation images
    const { data: images } = await supabase
      .from("actor_validation_images")
      .select("*")
      .eq("validation_run_id", runId)
      .eq("status", "complete")
      .order("slot_key")
      .order("variant_index");

    if (!images || images.length === 0) {
      await supabase.from("actor_validation_runs").update({
        status: "failed",
        error: "No completed validation images to score",
      }).eq("id", runId);
      return jsonRes({ error: "No images to score" }, 400);
    }

    // 4. Group images by slot
    const slotMap: Record<string, Array<{ url: string; variant_index: number }>> = {};
    for (const img of images) {
      if (!img.public_url) continue;
      if (!slotMap[img.slot_key]) slotMap[img.slot_key] = [];
      slotMap[img.slot_key].push({ url: img.public_url, variant_index: img.variant_index });
    }

    const coveredSlots = Object.keys(slotMap);
    const totalSlots = 11;

    // 5. Pack coverage score
    const packCoverageScore = Math.round((coveredSlots.length / totalSlots) * 10);

    // 6. Intra-slot stability: compare variant A vs B within each slot
    const intraSlotScores: Record<string, number> = {};
    let intraTotal = 0;
    let intraCount = 0;
    let lowIntraSlotCount = 0;

    for (const [slotKey, variants] of Object.entries(slotMap)) {
      if (variants.length < 2) {
        // Only one variant — assume neutral stability
        intraSlotScores[slotKey] = 7;
        intraTotal += 7;
        intraCount++;
        continue;
      }

      const score = await compareImages(
        variants[0].url,
        variants[1].url,
        LOVABLE_API_KEY,
        `Intra-slot consistency check for ${slotKey}: comparing variant A vs B under identical conditions`,
      );

      intraSlotScores[slotKey] = score;
      intraTotal += score;
      intraCount++;

      if (score < HF08_SLOT_DIVERGENCE_THRESHOLD) {
        lowIntraSlotCount++;
      }

      // Rate limit protection
      await new Promise(r => setTimeout(r, 1000));
    }

    const intraSlotStability = intraCount > 0 ? Math.round((intraTotal / intraCount) * 10) / 10 : 0;

    // 7. Cross-slot persistence: compare each slot's best image against neutral_headshot
    const crossSlotScores: Record<string, number> = {};
    let crossTotal = 0;
    let crossCount = 0;
    let lowCrossSlotCount = 0;

    const referenceVariants = slotMap[REFERENCE_SLOT];
    const referenceUrl = referenceVariants?.[0]?.url;

    if (referenceUrl) {
      for (const [slotKey, variants] of Object.entries(slotMap)) {
        if (slotKey === REFERENCE_SLOT) {
          crossSlotScores[slotKey] = 10; // self-comparison
          crossTotal += 10;
          crossCount++;
          continue;
        }

        const bestVariant = variants[0];
        const score = await compareImages(
          referenceUrl,
          bestVariant.url,
          LOVABLE_API_KEY,
          `Cross-slot identity persistence: comparing ${REFERENCE_SLOT} reference against ${slotKey}`,
        );

        crossSlotScores[slotKey] = score;
        crossTotal += score;
        crossCount++;

        if (score < HF08_SLOT_DIVERGENCE_THRESHOLD) {
          lowCrossSlotCount++;
        }

        await new Promise(r => setTimeout(r, 1000));
      }
    }

    const crossSlotPersistence = crossCount > 0 ? Math.round((crossTotal / crossCount) * 10) / 10 : 0;

    // 8. Regeneration stability rollup
    const regenerationStability = Math.round(
      (intraSlotStability * INTRA_SLOT_WEIGHT + crossSlotPersistence * CROSS_SLOT_WEIGHT) * 10
    ) / 10;

    // 9. Hard fail detection
    const hardFailCodes: string[] = [];
    const advisoryPenaltyCodes: string[] = [];

    // HF-08: Regeneration Drift
    if (
      intraSlotStability < HF08_INTRA_THRESHOLD ||
      crossSlotPersistence < HF08_CROSS_THRESHOLD ||
      (lowIntraSlotCount + lowCrossSlotCount) >= HF08_SLOT_DIVERGENCE_COUNT
    ) {
      hardFailCodes.push("HF-08");
    }

    // HF-COV: Insufficient Validation Coverage
    if (coveredSlots.length < HFCOV_MIN_SLOTS) {
      hardFailCodes.push("HF-COV");
    }

    // Advisory: marginal intra stability
    if (intraSlotStability >= HF08_INTRA_THRESHOLD && intraSlotStability < 7) {
      advisoryPenaltyCodes.push("ADV-INTRA-MARGINAL");
    }
    // Advisory: marginal cross persistence
    if (crossSlotPersistence >= HF08_CROSS_THRESHOLD && crossSlotPersistence < 6) {
      advisoryPenaltyCodes.push("ADV-CROSS-MARGINAL");
    }

    // 10. Compute overall score (weighted)
    const axisScoresNormalized = {
      intra_slot_stability: intraSlotStability,
      cross_slot_persistence: crossSlotPersistence,
      regeneration_stability: regenerationStability,
      pack_coverage_score: packCoverageScore,
    };

    let overallScore = Math.round(
      (intraSlotStability / 10) * AXIS_WEIGHTS.intra_slot_stability +
      (crossSlotPersistence / 10) * AXIS_WEIGHTS.cross_slot_persistence +
      (regenerationStability / 10) * AXIS_WEIGHTS.regeneration_stability +
      (packCoverageScore / 10) * AXIS_WEIGHTS.pack_coverage_score
    );

    // Apply hard fail cap
    if (hardFailCodes.length > 0) {
      overallScore = Math.min(overallScore, SCORE_CAP_ON_HARD_FAIL);
    }

    overallScore = Math.max(0, Math.min(100, overallScore));

    // 11. Confidence
    let confidence = "high";
    if (coveredSlots.length < HFCOV_MIN_SLOTS) {
      confidence = "low";
    } else if (coveredSlots.length < totalSlots || intraCount < 8) {
      confidence = "medium";
    }

    // 12. Score band
    const scoreBand = getScoreBand(overallScore);

    // 13. Build detailed axis scores for persistence
    const axisScoresDetailed = {
      ...axisScoresNormalized,
      intra_slot_detail: intraSlotScores,
      cross_slot_detail: crossSlotScores,
      covered_slots: coveredSlots.length,
      total_slots: totalSlots,
      low_intra_slot_count: lowIntraSlotCount,
      low_cross_slot_count: lowCrossSlotCount,
    };

    // 14. Persist result — update existing placeholder row
    const { data: existingResult } = await supabase
      .from("actor_validation_results")
      .select("id")
      .eq("validation_run_id", runId)
      .single();

    if (existingResult) {
      await supabase.from("actor_validation_results").update({
        overall_score: overallScore,
        score_band: scoreBand,
        confidence,
        axis_scores: axisScoresDetailed,
        hard_fail_codes: hardFailCodes,
        advisory_penalty_codes: advisoryPenaltyCodes,
      }).eq("id", existingResult.id);
    } else {
      await supabase.from("actor_validation_results").insert({
        validation_run_id: runId,
        overall_score: overallScore,
        score_band: scoreBand,
        confidence,
        axis_scores: axisScoresDetailed,
        hard_fail_codes: hardFailCodes,
        advisory_penalty_codes: advisoryPenaltyCodes,
      });
    }

    // 15. Mark run as scored
    await supabase.from("actor_validation_runs").update({
      status: "scored",
      completed_at: new Date().toISOString(),
    }).eq("id", runId);

    console.log(`[Scoring] Run ${runId}: score=${overallScore} band=${scoreBand} confidence=${confidence} hardFails=${hardFailCodes.join(",") || "none"}`);

    return jsonRes({
      success: true,
      runId,
      overallScore,
      scoreBand,
      confidence,
      hardFailCodes,
      advisoryPenaltyCodes,
      axisScores: axisScoresNormalized,
    });
  } catch (e: any) {
    console.error("Scoring error:", e);

    // Try to mark run as failed
    try {
      const { runId } = await new Response(req.clone().body).json().catch(() => ({}));
      if (runId) {
        const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
        const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
        const sb = createClient(supabaseUrl, serviceKey);
        await sb.from("actor_validation_runs").update({
          status: "failed",
          error: e.message || "Scoring failed",
        }).eq("id", runId);
      }
    } catch {}

    return jsonRes({ error: e.message || "Scoring failed" }, 500);
  }
});
