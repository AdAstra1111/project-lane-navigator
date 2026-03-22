/**
 * Edge Function: run-actor-validation
 * Generates a quick validation pack (11 slots × 2 variants = 22 images) for an AI Actor,
 * persists them, and updates the validation run status.
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

// ── Canonical Validation Slots ──────────────────────────────────────────────

const VALIDATION_SLOTS = [
  {
    key: "neutral_headshot",
    prompt_suffix: "Neutral expression, direct eye contact, head and shoulders, studio lighting, clean background.",
    test_purpose: "baseline facial identity",
  },
  {
    key: "true_profile",
    prompt_suffix: "True side profile view (90 degrees), showing jawline and ear, even lighting.",
    test_purpose: "profile structure agreement",
  },
  {
    key: "three_quarter_portrait",
    prompt_suffix: "Three-quarter angle portrait, natural expression, soft directional lighting.",
    test_purpose: "angle consistency",
  },
  {
    key: "standing_full_body",
    prompt_suffix: "Standing full body shot, natural posture, full figure visible head to toe, neutral background.",
    test_purpose: "body proportion and build consistency",
  },
  {
    key: "seated_medium",
    prompt_suffix: "Seated medium shot from waist up, relaxed pose, natural setting.",
    test_purpose: "pose variation robustness",
  },
  {
    key: "emotional_closeup",
    prompt_suffix: "Emotional close-up, intense or vulnerable expression, dramatic lighting, tight crop on face.",
    test_purpose: "expression robustness",
  },
  {
    key: "daylight_variant",
    prompt_suffix: "Outdoor natural daylight, warm golden hour lighting, medium shot.",
    test_purpose: "lighting robustness (bright)",
  },
  {
    key: "lowkey_variant",
    prompt_suffix: "Low-key dramatic lighting, dark moody atmosphere, strong shadows on face, chiaroscuro.",
    test_purpose: "lighting robustness (dark)",
  },
  {
    key: "wardrobe_variation",
    prompt_suffix: "Different wardrobe/costume than previous shots, styled in a contrasting outfit, medium shot.",
    test_purpose: "wardrobe robustness",
  },
  {
    key: "partner_scene",
    prompt_suffix: "Two-person scene with another character, the subject is clearly the primary focus, candid interaction.",
    test_purpose: "identity persistence in multi-person context",
  },
  {
    key: "narrative_context",
    prompt_suffix: "In a narrative scene environment (office, street, home), engaged in an action, cinematic framing.",
    test_purpose: "scene transfer stability",
  },
] as const;

// ── Image Generation ────────────────────────────────────────────────────────

async function generateImage(prompt: string, apiKey: string): Promise<string | null> {
  try {
    const resp = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "google/gemini-3.1-flash-image-preview",
        messages: [{ role: "user", content: prompt }],
        modalities: ["image", "text"],
      }),
    });

    if (!resp.ok) {
      const errText = await resp.text();
      console.error(`Image gen failed (${resp.status}):`, errText);
      if (resp.status === 429) throw new Error("RATE_LIMITED");
      if (resp.status === 402) throw new Error("CREDITS_EXHAUSTED");
      return null;
    }

    const data = await resp.json();
    return data.choices?.[0]?.message?.images?.[0]?.image_url?.url || null;
  } catch (e: any) {
    if (e.message === "RATE_LIMITED" || e.message === "CREDITS_EXHAUSTED") throw e;
    console.error("Image generation error:", e);
    return null;
  }
}

async function uploadBase64Image(supabase: any, base64Url: string, path: string): Promise<string | null> {
  try {
    const base64Data = base64Url.split(",")[1];
    if (!base64Data) return null;
    const binaryStr = atob(base64Data);
    const bytes = new Uint8Array(binaryStr.length);
    for (let i = 0; i < binaryStr.length; i++) bytes[i] = binaryStr.charCodeAt(i);
    const { error } = await supabase.storage.from("project-images").upload(path, bytes, { contentType: "image/png", upsert: true });
    if (error) { console.error("Upload error:", error); return null; }
    const { data: { publicUrl } } = supabase.storage.from("project-images").getPublicUrl(path);
    return publicUrl;
  } catch (e) {
    console.error("Upload error:", e);
    return null;
  }
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
    if (run.status !== "pending") return jsonRes({ error: `Run is already ${run.status}` }, 400);

    // 2. Fetch actor + assets for identity description
    const { data: actor } = await supabase
      .from("ai_actors")
      .select("name, description, negative_prompt")
      .eq("id", run.actor_id)
      .single();
    if (!actor) return jsonRes({ error: "Actor not found" }, 404);

    // Fetch anchor images for reference context
    const { data: versions } = await supabase
      .from("ai_actor_versions")
      .select("id")
      .eq("actor_id", run.actor_id)
      .order("version_number", { ascending: false })
      .limit(1);
    const versionId = versions?.[0]?.id;

    let referenceContext = "";
    if (versionId) {
      const { data: assets } = await supabase
        .from("ai_actor_assets")
        .select("asset_type, meta_json")
        .eq("actor_version_id", versionId);
      const assetTypes = (assets || []).map((a: any) => a.asset_type).join(", ");
      if (assetTypes) referenceContext = ` Reference assets available: ${assetTypes}.`;
    }

    // 3. Mark run as generating
    await supabase
      .from("actor_validation_runs")
      .update({ status: "generating" })
      .eq("id", runId);

    // 4. Create all validation image rows (22 total: 11 slots × 2 variants)
    const imageRows = [];
    for (const slot of VALIDATION_SLOTS) {
      for (let v = 0; v < 2; v++) {
        imageRows.push({
          validation_run_id: runId,
          slot_key: slot.key,
          variant_index: v,
          status: "pending",
          generation_config: {
            slot_key: slot.key,
            variant_index: v,
            test_purpose: slot.test_purpose,
            prompt_suffix: slot.prompt_suffix,
          },
        });
      }
    }

    const { error: insertErr } = await supabase
      .from("actor_validation_images")
      .insert(imageRows);
    if (insertErr) {
      console.error("Failed to insert image rows:", insertErr);
      await supabase.from("actor_validation_runs").update({ status: "failed", error: insertErr.message }).eq("id", runId);
      return jsonRes({ error: "Failed to create image records" }, 500);
    }

    // 5. Generate images sequentially (to avoid rate limits)
    const identityDesc = actor.description || actor.name;
    const negativePrompt = actor.negative_prompt ? ` Avoid: ${actor.negative_prompt}.` : "";

    let completedCount = 0;
    let failedCount = 0;

    for (const slot of VALIDATION_SLOTS) {
      for (let v = 0; v < 2; v++) {
        const prompt = [
          `Generate a photorealistic image of the following person: ${identityDesc}.${referenceContext}`,
          slot.prompt_suffix,
          negativePrompt,
          `Photorealistic. No text, watermarks, or logos. High resolution. Film grain texture. Natural skin.`,
          `Variant ${v + 1} — maintain the SAME person's identity but with natural photographic variation.`,
        ].join(" ");

        try {
          const base64Url = await generateImage(prompt, LOVABLE_API_KEY);
          if (!base64Url) {
            failedCount++;
            await supabase
              .from("actor_validation_images")
              .update({ status: "failed", error: "Generation returned null" })
              .eq("validation_run_id", runId)
              .eq("slot_key", slot.key)
              .eq("variant_index", v);
            continue;
          }

          // Upload
          const storagePath = `validation/${run.actor_id}/${runId}/${slot.key}_v${v}.png`;
          const publicUrl = await uploadBase64Image(supabase, base64Url, storagePath);

          if (!publicUrl) {
            failedCount++;
            await supabase
              .from("actor_validation_images")
              .update({ status: "failed", error: "Upload failed" })
              .eq("validation_run_id", runId)
              .eq("slot_key", slot.key)
              .eq("variant_index", v);
            continue;
          }

          await supabase
            .from("actor_validation_images")
            .update({ status: "complete", public_url: publicUrl, storage_path: storagePath })
            .eq("validation_run_id", runId)
            .eq("slot_key", slot.key)
            .eq("variant_index", v);

          completedCount++;
        } catch (e: any) {
          if (e.message === "CREDITS_EXHAUSTED") {
            await supabase.from("actor_validation_runs").update({ status: "failed", error: "AI credits exhausted" }).eq("id", runId);
            return jsonRes({ error: "AI credits exhausted. Please add funds in Settings → Workspace → Usage." }, 402);
          }
          if (e.message === "RATE_LIMITED") {
            // Wait and retry once
            await new Promise(r => setTimeout(r, 5000));
            failedCount++;
            await supabase
              .from("actor_validation_images")
              .update({ status: "failed", error: "Rate limited" })
              .eq("validation_run_id", runId)
              .eq("slot_key", slot.key)
              .eq("variant_index", v);
          }
        }

        // Small delay between generations
        await new Promise(r => setTimeout(r, 1500));
      }
    }

    // 6. Update pack coverage
    const totalSlots = VALIDATION_SLOTS.length;
    const slotsCovered = new Set<string>();
    const { data: completedImages } = await supabase
      .from("actor_validation_images")
      .select("slot_key")
      .eq("validation_run_id", runId)
      .eq("status", "complete");
    for (const img of completedImages || []) slotsCovered.add(img.slot_key);

    const packCoverage = {
      total_slots: totalSlots,
      covered_slots: slotsCovered.size,
      total_images: completedCount + failedCount,
      completed_images: completedCount,
      failed_images: failedCount,
      coverage_percent: Math.round((slotsCovered.size / totalSlots) * 100),
    };

    // 7. Create placeholder result
    await supabase.from("actor_validation_results").insert({
      validation_run_id: runId,
      overall_score: null,
      score_band: null,
      confidence: completedCount >= 18 ? "medium" : "low",
      axis_scores: {},
      hard_fail_codes: [],
      advisory_penalty_codes: [],
    });

    // 8. Mark run as complete
    const finalStatus = completedCount === 0 ? "failed" : "complete";
    await supabase.from("actor_validation_runs").update({
      status: finalStatus,
      pack_coverage: packCoverage,
      completed_at: new Date().toISOString(),
      error: completedCount === 0 ? "No images generated successfully" : null,
    }).eq("id", runId);

    return jsonRes({
      success: true,
      runId,
      status: finalStatus,
      completedCount,
      failedCount,
      packCoverage,
    });
  } catch (e: any) {
    console.error("Validation run error:", e);
    return jsonRes({ error: e.message || "Internal error" }, 500);
  }
});
