/**
 * Edge Function: run-actor-validation
 * Generates a quick validation pack (11 slots × 2 variants = 22 images) for an AI Actor,
 * using actor anchor images as identity references for generation consistency.
 * Enforces PG-00/PG-01 gates before proceeding.
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
  { key: "neutral_headshot", prompt_suffix: "Neutral expression, direct eye contact, head and shoulders, studio lighting, clean background.", test_purpose: "baseline facial identity" },
  { key: "true_profile", prompt_suffix: "True side profile view (90 degrees), showing jawline and ear, even lighting.", test_purpose: "profile structure agreement" },
  { key: "three_quarter_portrait", prompt_suffix: "Three-quarter angle portrait, natural expression, soft directional lighting.", test_purpose: "angle consistency" },
  { key: "standing_full_body", prompt_suffix: "Standing full body shot, natural posture, full figure visible head to toe, neutral background.", test_purpose: "body proportion and build consistency" },
  { key: "seated_medium", prompt_suffix: "Seated medium shot from waist up, relaxed pose, natural setting.", test_purpose: "pose variation robustness" },
  { key: "emotional_closeup", prompt_suffix: "Emotional close-up, intense or vulnerable expression, dramatic lighting, tight crop on face.", test_purpose: "expression robustness" },
  { key: "daylight_variant", prompt_suffix: "Outdoor natural daylight, warm golden hour lighting, medium shot.", test_purpose: "lighting robustness (bright)" },
  { key: "lowkey_variant", prompt_suffix: "Low-key dramatic lighting, dark moody atmosphere, strong shadows on face, chiaroscuro.", test_purpose: "lighting robustness (dark)" },
  { key: "wardrobe_variation", prompt_suffix: "Different wardrobe/costume than previous shots, styled in a contrasting outfit, medium shot.", test_purpose: "wardrobe robustness" },
  { key: "partner_scene", prompt_suffix: "Two-person scene with another character, the subject is clearly the primary focus, candid interaction.", test_purpose: "identity persistence in multi-person context" },
  { key: "narrative_context", prompt_suffix: "In a narrative scene environment (office, street, home), engaged in an action, cinematic framing.", test_purpose: "scene transfer stability" },
] as const;

// ── Anchor Resolution ───────────────────────────────────────────────────────

interface AnchorSet {
  headshot: string | null;
  profile: string | null;
  fullBody: string | null;
  anchorCount: number;
  versionId: string | null;
}

async function resolveActorAnchors(supabase: any, actorId: string): Promise<AnchorSet> {
  const { data: versions } = await supabase
    .from("ai_actor_versions")
    .select("id")
    .eq("actor_id", actorId)
    .order("version_number", { ascending: false })
    .limit(1);

  const versionId = versions?.[0]?.id || null;
  if (!versionId) return { headshot: null, profile: null, fullBody: null, anchorCount: 0, versionId: null };

  const { data: assets } = await supabase
    .from("ai_actor_assets")
    .select("asset_type, public_url, storage_path, meta_json")
    .eq("actor_version_id", versionId);

  let headshot: string | null = null;
  let profile: string | null = null;
  let fullBody: string | null = null;

  for (const asset of (assets || [])) {
    const assetType = (asset.asset_type || "").toLowerCase();
    const metaShotType = (asset.meta_json?.shot_type || "").toLowerCase();
    const url = asset.public_url || asset.storage_path;
    if (!url) continue;

    if (!headshot && (assetType === "reference_headshot" || metaShotType === "identity_headshot" || metaShotType === "headshot")) {
      headshot = url;
    }
    if (!profile && (metaShotType === "profile" || metaShotType === "identity_profile")) {
      profile = url;
    }
    if (!fullBody && (assetType === "reference_full_body" || metaShotType === "identity_full_body" || metaShotType === "full_body")) {
      fullBody = url;
    }
  }

  const anchorCount = [headshot, profile, fullBody].filter(Boolean).length;
  return { headshot, profile, fullBody, anchorCount, versionId };
}

// ── PG Gate Check ───────────────────────────────────────────────────────────

function checkPGGates(anchors: AnchorSet, actor: any): { blocked: boolean; reason: string | null } {
  // PG-00: Coverage
  if (anchors.anchorCount < 1) {
    return { blocked: true, reason: "PG-00: No anchor images found. Upload headshot, profile, and full-body references first." };
  }

  // Check persisted gate status on actor record
  const coverageStatus = actor.anchor_coverage_status || "insufficient";
  const coherenceStatus = actor.anchor_coherence_status || "unknown";

  if (coverageStatus === "insufficient") {
    return { blocked: true, reason: "PG-00: Insufficient anchor coverage. Requires at minimum headshot and full-body references." };
  }
  if (coherenceStatus === "incoherent") {
    return { blocked: true, reason: "PG-01: Anchor set is incoherent — identity references contradict each other." };
  }

  return { blocked: false, reason: null };
}

// ── Image Generation (with identity reference) ──────────────────────────────

async function generateImage(prompt: string, apiKey: string, referenceUrls: string[]): Promise<string | null> {
  try {
    // Build multimodal message content with anchor images as references
    const content: any[] = [];

    // Add reference images first for identity grounding
    for (const url of referenceUrls) {
      content.push({
        type: "image_url",
        image_url: { url },
      });
    }

    // Add the text prompt
    content.push({ type: "text", text: prompt });

    const resp = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "google/gemini-3.1-flash-image-preview",
        messages: [{ role: "user", content }],
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

    // 2. Fetch actor
    const { data: actor } = await supabase
      .from("ai_actors")
      .select("name, description, negative_prompt, anchor_coverage_status, anchor_coherence_status")
      .eq("id", run.actor_id)
      .single();
    if (!actor) return jsonRes({ error: "Actor not found" }, 404);

    // 3. Resolve anchor images
    const anchors = await resolveActorAnchors(supabase, run.actor_id);

    // 4. Enforce PG gates
    const gate = checkPGGates(anchors, actor);
    if (gate.blocked) {
      await supabase.from("actor_validation_runs").update({
        status: "failed",
        error: gate.reason,
      }).eq("id", runId);
      return jsonRes({ error: gate.reason }, 400);
    }

    // 5. Build identity reference URL set (only non-null anchors)
    const identityReferenceUrls = [anchors.headshot, anchors.profile, anchors.fullBody].filter(Boolean) as string[];

    console.log(`[Validation] Actor ${run.actor_id}: ${identityReferenceUrls.length} anchor images as identity references`);

    // 6. Mark run as generating
    await supabase
      .from("actor_validation_runs")
      .update({ status: "generating" })
      .eq("id", runId);

    // 7. Create all validation image rows with full provenance
    const identityDesc = actor.description || actor.name;
    const negativePrompt = actor.negative_prompt ? ` Avoid: ${actor.negative_prompt}.` : "";

    const imageRows = [];
    for (const slot of VALIDATION_SLOTS) {
      for (let v = 0; v < 2; v++) {
        const prompt = [
          `Generate a photorealistic image of this exact person. Maintain strict facial identity, body proportions, and physical characteristics matching the reference images provided.`,
          `Identity: ${identityDesc}.`,
          slot.prompt_suffix,
          negativePrompt,
          `Photorealistic. No text, watermarks, or logos. High resolution. Film grain texture. Natural skin.`,
          `Variant ${v + 1} — maintain the SAME person's identity with natural photographic variation only.`,
        ].join(" ");

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
            prompt_full: prompt,
            identity_anchors_used: identityReferenceUrls,
            identity_anchor_count: identityReferenceUrls.length,
            identity_mode: "anchor_locked",
            actor_id: run.actor_id,
            actor_version_id: anchors.versionId,
            actor_name: actor.name,
            anchor_coverage_status: actor.anchor_coverage_status || "unknown",
            anchor_coherence_status: actor.anchor_coherence_status || "unknown",
            model: "google/gemini-3.1-flash-image-preview",
            generated_at: new Date().toISOString(),
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

    // 8. Generate images sequentially with identity references
    let completedCount = 0;
    let failedCount = 0;

    for (const slot of VALIDATION_SLOTS) {
      for (let v = 0; v < 2; v++) {
        const prompt = [
          `Generate a photorealistic image of this exact person. Maintain strict facial identity, body proportions, and physical characteristics matching the reference images provided.`,
          `Identity: ${identityDesc}.`,
          slot.prompt_suffix,
          negativePrompt,
          `Photorealistic. No text, watermarks, or logos. High resolution. Film grain texture. Natural skin.`,
          `Variant ${v + 1} — maintain the SAME person's identity with natural photographic variation only.`,
        ].join(" ");

        try {
          const base64Url = await generateImage(prompt, LOVABLE_API_KEY, identityReferenceUrls);
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
            return jsonRes({ error: "AI credits exhausted." }, 402);
          }
          if (e.message === "RATE_LIMITED") {
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

        await new Promise(r => setTimeout(r, 1500));
      }
    }

    // 9. Update pack coverage
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
      identity_anchors_used: identityReferenceUrls.length,
      identity_mode: "anchor_locked",
    };

    // 10. Create placeholder result (scoring not yet implemented)
    await supabase.from("actor_validation_results").insert({
      validation_run_id: runId,
      overall_score: null,
      score_band: null,
      confidence: completedCount >= 18 ? "medium" : "low",
      axis_scores: {},
      hard_fail_codes: [],
      advisory_penalty_codes: [],
    });

    // 11. Mark run as complete — status reflects pack generated, NOT fully scored
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
