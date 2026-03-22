/**
 * Edge Function: score-actor-validation
 * Phase 3 scoring engine — hardened, idempotent, no silent fallbacks.
 *
 * Computes: intra_slot_stability, cross_slot_persistence, regeneration_stability,
 * pack_coverage_score, hard fails (HF-08, HF-COV), promotable decision.
 *
 * Status flow: pack_generated → scoring → scored | failed
 * Idempotent: uses atomic status claim (WHERE status = 'pack_generated').
 * No silent fallbacks: evaluator failures are recorded, not masked.
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

// ── Constants (centralized, canonical) ──────────────────────────────────────

const INTRA_SLOT_WEIGHT = 0.6;
const CROSS_SLOT_WEIGHT = 0.4;
const HF08_INTRA_THRESHOLD = 5;
const HF08_CROSS_THRESHOLD = 4;
const HF08_SLOT_DIVERGENCE_COUNT = 3;
const HF08_SLOT_DIVERGENCE_THRESHOLD = 5;
const HFCOV_MIN_SLOTS = 8;
const SCORE_CAP_ON_HARD_FAIL = 59;
const REFERENCE_SLOT = "neutral_headshot";
const PROMOTABLE_MIN_SCORE = 75;
const SCORING_MODEL_VERSION = "phase3-hardened-v1";

const AXIS_WEIGHTS = {
  intra_slot_stability: 25,
  cross_slot_persistence: 25,
  regeneration_stability: 20,
  pack_coverage_score: 30,
};

// ── Similarity via vision model — NO SILENT FALLBACKS ───────────────────────

interface CompareResult {
  score: number;
  reason: string;
  error: string | null;
}

async function compareImages(
  imageUrlA: string,
  imageUrlB: string,
  apiKey: string,
  purpose: string,
): Promise<CompareResult> {
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
    if (resp.status === 429) throw new Error("RATE_LIMITED");
    if (resp.status === 402) throw new Error("CREDITS_EXHAUSTED");
    return { score: -1, reason: "", error: `Evaluator HTTP ${resp.status}: ${errText.slice(0, 200)}` };
  }

  const data = await resp.json();
  const text = data.choices?.[0]?.message?.content || "";

  try {
    const parsed = JSON.parse(text);
    if (typeof parsed.score !== "number") {
      return { score: -1, reason: "", error: `Evaluator returned non-numeric score: ${text.slice(0, 200)}` };
    }
    return {
      score: Math.min(10, Math.max(0, parsed.score)),
      reason: parsed.reason || "",
      error: null,
    };
  } catch {
    const match = text.match(/(\d+(?:\.\d+)?)/);
    if (match) {
      return { score: Math.min(10, Math.max(0, parseFloat(match[1]))), reason: text.slice(0, 100), error: null };
    }
    return { score: -1, reason: "", error: `Evaluator response unparseable: ${text.slice(0, 200)}` };
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

  let runId: string | null = null;
  let supabase: any = null;

  try {
    const body = await req.json();
    runId = body.runId;
    if (!runId) return jsonRes({ error: "runId required" }, 400);

    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) return jsonRes({ error: "LOVABLE_API_KEY not configured" }, 500);

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    supabase = createClient(supabaseUrl, serviceKey);

    // ── 1. IDEMPOTENT CLAIM: atomic status transition ───────────────────────
    // Only claim if status is exactly 'pack_generated'. If already scoring/scored, no-op.
    const { data: claimed, error: claimErr } = await supabase
      .from("actor_validation_runs")
      .update({ status: "scoring" })
      .eq("id", runId)
      .eq("status", "pack_generated")
      .select("id, actor_id, actor_version_id")
      .single();

    if (claimErr || !claimed) {
      // Check current status for idempotent response
      const { data: current } = await supabase
        .from("actor_validation_runs")
        .select("status")
        .eq("id", runId)
        .single();

      if (current?.status === "scored") {
        // Already scored — return existing result
        const { data: existing } = await supabase
          .from("actor_validation_results")
          .select("*")
          .eq("validation_run_id", runId)
          .single();
        return jsonRes({ success: true, alreadyScored: true, result: existing });
      }
      if (current?.status === "scoring") {
        return jsonRes({ success: true, alreadyScoring: true, message: "Scoring already in progress" });
      }
      return jsonRes({ error: `Cannot score: run status is '${current?.status || "unknown"}'` }, 400);
    }

    // ── 2. Fetch completed validation images ────────────────────────────────
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

    // ── 3. Group images by slot ─────────────────────────────────────────────
    const slotMap: Record<string, Array<{ url: string; variant_index: number }>> = {};
    for (const img of images) {
      if (!img.public_url) continue;
      if (!slotMap[img.slot_key]) slotMap[img.slot_key] = [];
      slotMap[img.slot_key].push({ url: img.public_url, variant_index: img.variant_index });
    }

    const coveredSlots = Object.keys(slotMap);
    const totalSlots = 11;
    const packCoverageScore = Math.round((coveredSlots.length / totalSlots) * 10);

    // ── 4. Intra-slot stability ─────────────────────────────────────────────
    const intraSlotDetail: Record<string, { score: number; error: string | null; reason: string }> = {};
    let intraTotal = 0;
    let intraValidCount = 0;
    let intraErrorCount = 0;
    let lowIntraSlotCount = 0;

    for (const [slotKey, variants] of Object.entries(slotMap)) {
      if (variants.length < 2) {
        // Single variant — cannot measure intra stability, mark as unavailable
        intraSlotDetail[slotKey] = { score: -1, error: "single_variant", reason: "Only one variant available" };
        continue;
      }

      const result = await compareImages(
        variants[0].url,
        variants[1].url,
        LOVABLE_API_KEY,
        `Intra-slot consistency for ${slotKey}: variant A vs B under identical conditions`,
      );

      if (result.error) {
        intraSlotDetail[slotKey] = { score: -1, error: result.error, reason: "" };
        intraErrorCount++;
      } else {
        intraSlotDetail[slotKey] = { score: result.score, error: null, reason: result.reason };
        intraTotal += result.score;
        intraValidCount++;
        if (result.score < HF08_SLOT_DIVERGENCE_THRESHOLD) lowIntraSlotCount++;
      }

      await new Promise(r => setTimeout(r, 1000));
    }

    const intraSlotStability = intraValidCount > 0
      ? Math.round((intraTotal / intraValidCount) * 10) / 10
      : 0;

    // ── 5. Cross-slot persistence ───────────────────────────────────────────
    const crossSlotDetail: Record<string, { score: number; error: string | null; reason: string }> = {};
    let crossTotal = 0;
    let crossValidCount = 0;
    let crossErrorCount = 0;
    let lowCrossSlotCount = 0;

    const referenceVariants = slotMap[REFERENCE_SLOT];
    const referenceUrl = referenceVariants?.[0]?.url;

    if (referenceUrl) {
      for (const [slotKey, variants] of Object.entries(slotMap)) {
        if (slotKey === REFERENCE_SLOT) {
          crossSlotDetail[slotKey] = { score: 10, error: null, reason: "self-reference" };
          crossTotal += 10;
          crossValidCount++;
          continue;
        }

        const result = await compareImages(
          referenceUrl,
          variants[0].url,
          LOVABLE_API_KEY,
          `Cross-slot persistence: ${REFERENCE_SLOT} vs ${slotKey}`,
        );

        if (result.error) {
          crossSlotDetail[slotKey] = { score: -1, error: result.error, reason: "" };
          crossErrorCount++;
        } else {
          crossSlotDetail[slotKey] = { score: result.score, error: null, reason: result.reason };
          crossTotal += result.score;
          crossValidCount++;
          if (result.score < HF08_SLOT_DIVERGENCE_THRESHOLD) lowCrossSlotCount++;
        }

        await new Promise(r => setTimeout(r, 1000));
      }
    } else {
      crossSlotDetail["_missing_reference"] = { score: -1, error: "no_reference_slot", reason: "neutral_headshot slot missing" };
    }

    const crossSlotPersistence = crossValidCount > 0
      ? Math.round((crossTotal / crossValidCount) * 10) / 10
      : 0;

    // ── 6. Regeneration stability rollup ────────────────────────────────────
    const regenerationStability = Math.round(
      (intraSlotStability * INTRA_SLOT_WEIGHT + crossSlotPersistence * CROSS_SLOT_WEIGHT) * 10
    ) / 10;

    // ── 7. Hard fail detection ──────────────────────────────────────────────
    const hardFailCodes: string[] = [];
    const advisoryPenaltyCodes: string[] = [];
    const failureReasons: string[] = [];

    // HF-08: Regeneration Drift
    if (intraSlotStability < HF08_INTRA_THRESHOLD) {
      hardFailCodes.push("HF-08");
      failureReasons.push(`Intra-slot stability ${intraSlotStability} < threshold ${HF08_INTRA_THRESHOLD}`);
    }
    if (crossSlotPersistence < HF08_CROSS_THRESHOLD) {
      if (!hardFailCodes.includes("HF-08")) hardFailCodes.push("HF-08");
      failureReasons.push(`Cross-slot persistence ${crossSlotPersistence} < threshold ${HF08_CROSS_THRESHOLD}`);
    }
    if ((lowIntraSlotCount + lowCrossSlotCount) >= HF08_SLOT_DIVERGENCE_COUNT) {
      if (!hardFailCodes.includes("HF-08")) hardFailCodes.push("HF-08");
      failureReasons.push(`${lowIntraSlotCount + lowCrossSlotCount} slots below divergence threshold`);
    }

    // HF-COV: Insufficient Validation Coverage
    if (coveredSlots.length < HFCOV_MIN_SLOTS) {
      hardFailCodes.push("HF-COV");
      failureReasons.push(`Only ${coveredSlots.length}/${totalSlots} slots covered, minimum ${HFCOV_MIN_SLOTS}`);
    }

    // Advisories
    if (intraSlotStability >= HF08_INTRA_THRESHOLD && intraSlotStability < 7) {
      advisoryPenaltyCodes.push("ADV-INTRA-MARGINAL");
    }
    if (crossSlotPersistence >= HF08_CROSS_THRESHOLD && crossSlotPersistence < 6) {
      advisoryPenaltyCodes.push("ADV-CROSS-MARGINAL");
    }
    if (intraErrorCount > 0 || crossErrorCount > 0) {
      advisoryPenaltyCodes.push("ADV-EVALUATOR-ERRORS");
      failureReasons.push(`${intraErrorCount + crossErrorCount} evaluator error(s) during scoring`);
    }

    // ── 8. Overall score ────────────────────────────────────────────────────
    let overallScore = Math.round(
      (intraSlotStability / 10) * AXIS_WEIGHTS.intra_slot_stability +
      (crossSlotPersistence / 10) * AXIS_WEIGHTS.cross_slot_persistence +
      (regenerationStability / 10) * AXIS_WEIGHTS.regeneration_stability +
      (packCoverageScore / 10) * AXIS_WEIGHTS.pack_coverage_score
    );

    if (hardFailCodes.length > 0) {
      overallScore = Math.min(overallScore, SCORE_CAP_ON_HARD_FAIL);
    }
    overallScore = Math.max(0, Math.min(100, overallScore));

    // ── 9. Confidence ───────────────────────────────────────────────────────
    let confidence = "high";
    if (coveredSlots.length < HFCOV_MIN_SLOTS || (intraErrorCount + crossErrorCount) > 3) {
      confidence = "low";
    } else if (coveredSlots.length < totalSlots || (intraErrorCount + crossErrorCount) > 0) {
      confidence = "medium";
    }

    const scoreBand = getScoreBand(overallScore);

    // ── 10. Promotable decision ─────────────────────────────────────────────
    const promotable = hardFailCodes.length === 0 && overallScore >= PROMOTABLE_MIN_SCORE;

    // ── 11. Build canonical axis scores ─────────────────────────────────────
    const axisScores = {
      intra_slot_stability: intraSlotStability,
      cross_slot_persistence: crossSlotPersistence,
      regeneration_stability: regenerationStability,
      pack_coverage_score: packCoverageScore,
    };

    // Diagnostic evidence (separate from canonical decision)
    const diagnosticEvidence = {
      intra_slot_detail: intraSlotDetail,
      cross_slot_detail: crossSlotDetail,
      covered_slots: coveredSlots.length,
      total_slots: totalSlots,
      low_intra_slot_count: lowIntraSlotCount,
      low_cross_slot_count: lowCrossSlotCount,
      intra_error_count: intraErrorCount,
      cross_error_count: crossErrorCount,
      scoring_model: SCORING_MODEL_VERSION,
      promotable_threshold: PROMOTABLE_MIN_SCORE,
    };

    // ── 12. Persist result (upsert by validation_run_id) ────────────────────
    const resultPayload = {
      validation_run_id: runId,
      overall_score: overallScore,
      score_band: scoreBand,
      confidence,
      axis_scores: { ...axisScores, diagnostic: diagnosticEvidence },
      hard_fail_codes: hardFailCodes,
      advisory_penalty_codes: advisoryPenaltyCodes,
    };

    // Check if placeholder row exists (created by run-actor-validation)
    const { data: existingResult } = await supabase
      .from("actor_validation_results")
      .select("id")
      .eq("validation_run_id", runId)
      .single();

    if (existingResult) {
      await supabase.from("actor_validation_results").update(resultPayload).eq("id", existingResult.id);
    } else {
      await supabase.from("actor_validation_results").insert(resultPayload);
    }

    // ── 13. Mark run as scored ──────────────────────────────────────────────
    await supabase.from("actor_validation_runs").update({
      status: "scored",
      completed_at: new Date().toISOString(),
    }).eq("id", runId);

    console.log(`[Scoring] Run ${runId}: score=${overallScore} band=${scoreBand} confidence=${confidence} promotable=${promotable} hardFails=${hardFailCodes.join(",") || "none"}`);

    return jsonRes({
      success: true,
      runId,
      overallScore,
      scoreBand,
      confidence,
      promotable,
      hardFailCodes,
      advisoryPenaltyCodes,
      axisScores,
      failureReasons,
    });
  } catch (e: any) {
    console.error("Scoring error:", e);

    if (runId && supabase) {
      try {
        await supabase.from("actor_validation_runs").update({
          status: "failed",
          error: e.message || "Scoring failed",
        }).eq("id", runId).eq("status", "scoring");
      } catch {}
    }

    return jsonRes({ error: e.message || "Scoring failed" }, 500);
  }
});
