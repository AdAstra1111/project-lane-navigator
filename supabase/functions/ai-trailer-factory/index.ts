/**
 * ai-trailer-factory — Edge function for AI Trailer Factory MVP.
 *
 * Actions:
 *   label_ai_readiness         — Score a shot for AI feasibility
 *   generate_storyboard_frames — Generate storyboard frame variations
 *   select_media               — Select/deselect generated media
 *   animate_shot_clip          — Generate motion still from keyframe (A/B only)
 *   extract_trailer_moments    — Extract trailer beats from pack context
 *   build_trailer_shotlist     — Build an AI-optimised trailer shotlist
 *   generate_trailer_assets    — Batch-generate frames + motion stills for a trailer shotlist
 *   assemble_taster_trailer    — Assemble a taster trailer package
 *   upsert_trailer_pack        — Create or update a trailer definition pack
 *   get_trailer_packs          — List packs for a project
 *   get_trailer_pack           — Get a single pack with items
 */
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { callLLM, MODELS, callLLMWithJsonRetry } from "../_shared/llm.ts";
import { compileTrailerContext } from "../_shared/trailerContext.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function parseUserId(token: string): string {
  const payload = JSON.parse(atob(token.split(".")[1]));
  if (!payload.sub || (payload.exp && payload.exp < Date.now() / 1000)) throw new Error("expired");
  return payload.sub;
}

function adminClient() {
  return createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
}

// ─── Rubric weights ───
const WEIGHTS: Record<string, number> = {
  performance_complexity: 1.5,
  identity_continuity_required: 1.3,
  action_complexity: 1.2,
  camera_complexity: 1.0,
  dialogue_lipsync_requirement: 1.5,
  ip_likeness_risk: 1.4,
  environment_controllability: -0.8,
  asset_availability: -1.0,
};

function computeTier(rubric: Record<string, number>) {
  let rawScore = 0;
  let maxPossible = 0;
  for (const [key, weight] of Object.entries(WEIGHTS)) {
    rawScore += (rubric[key] ?? 0) * weight;
    maxPossible += 5 * Math.abs(weight);
  }
  const riskScore = Math.max(0, Math.min(100, ((rawScore + maxPossible) / (2 * maxPossible)) * 100));
  const confidence = Math.max(0, Math.min(100, Math.round(100 - riskScore)));

  const tier = riskScore <= 20 && confidence >= 80 ? "A"
    : riskScore <= 40 && confidence >= 60 ? "B"
    : riskScore <= 65 && confidence >= 35 ? "C" : "D";

  const maxQuality = tier === "A" ? "Broadcast" : tier === "B" ? "Pitch" : "Previz";
  const modelRoute = tier === "A" || tier === "B" ? "image-to-video" : tier === "C" ? "hybrid" : "3D-assisted";
  const costBand = tier === "A" ? "low" : tier === "B" ? "medium" : "high";

  return { tier, confidence, maxQuality, modelRoute, costBand, riskScore };
}

// ─── Build prompt from shot data ───
function buildImagePrompt(shot: any, style?: string): string {
  return [
    `SUBJECT: ${(shot.characters_in_frame || []).join(", ") || "scene"}, ${shot.blocking_notes || ""}`,
    `SETTING: ${shot.location_hint || "unspecified"}, ${shot.time_of_day_hint || "day"}`,
    `CAMERA: ${shot.shot_type || "MS"} ${shot.framing || ""}, ${shot.camera_movement || "static"}`,
    `LIGHTING: ${shot.lighting_style || "natural"}, ${shot.emotional_intent || "neutral"} mood`,
    `STYLE: ${style || "cinematic film still"}, cinematic composition`,
    `NEGATIVES: no text, no watermarks, no logos, no brand marks, no UI elements`,
  ].join("\n");
}

// ─── Upload helper ───
async function uploadImageFromUrl(imageUrl: string, storagePath: string): Promise<string | null> {
  try {
    if (imageUrl.startsWith("data:")) {
      const base64Data = imageUrl.replace(/^data:image\/\w+;base64,/, "");
      const binaryData = Uint8Array.from(atob(base64Data), (c) => c.charCodeAt(0));
      const admin = adminClient();
      const { error } = await admin.storage
        .from("ai-media")
        .upload(storagePath, binaryData, { contentType: "image/png", upsert: true });
      if (error) { console.error("Upload error:", error); return null; }
      const { data } = admin.storage.from("ai-media").getPublicUrl(storagePath);
      return data?.publicUrl || null;
    }

    const resp = await fetch(imageUrl);
    if (!resp.ok) { console.error("Failed to fetch image URL:", resp.status); return null; }
    const arrayBuffer = await resp.arrayBuffer();
    const bytes = new Uint8Array(arrayBuffer);
    const contentType = resp.headers.get("content-type") || "image/png";
    const admin = adminClient();
    const { error } = await admin.storage
      .from("ai-media")
      .upload(storagePath, bytes, { contentType, upsert: true });
    if (error) { console.error("Upload error:", error); return null; }
    const { data } = admin.storage.from("ai-media").getPublicUrl(storagePath);
    return data?.publicUrl || null;
  } catch (err) {
    console.error("uploadImageFromUrl error:", err);
    return null;
  }
}

// ─── Generate image via Gemini ───
async function generateImage(apiKey: string, prompt: string): Promise<string | null> {
  const resp = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: "google/gemini-2.5-flash-image",
      messages: [{ role: "user", content: prompt }],
      modalities: ["image", "text"],
    }),
  });
  if (!resp.ok) { console.error("Image gen failed:", resp.status); return null; }
  const data = await resp.json();
  return data.choices?.[0]?.message?.images?.[0]?.image_url?.url || null;
}

// ═══════════════════════════════════════════
// TRAILER DEFINITION PACK HELPERS
// compileTrailerContext is now imported from _shared/trailerContext.ts
// ═══════════════════════════════════════════

// ═══════════════════════════════════════════
// PACK CRUD HANDLERS
// ═══════════════════════════════════════════

async function handleUpsertPack(db: any, body: any, userId: string) {
  const { projectId, packId, title, items } = body;
  if (!projectId || !items || !Array.isArray(items)) return json({ error: "projectId and items required" }, 400);

  let pack: any;

  if (packId) {
    // Update existing
    const updates: any = { updated_by: userId };
    if (title) updates.title = title;
    const { data, error } = await db.from("trailer_definition_packs")
      .update(updates).eq("id", packId).eq("project_id", projectId).select().single();
    if (error) return json({ error: "Pack update failed: " + error.message }, 500);
    pack = data;

    // Delete removed items
    const docIds = items.map((i: any) => i.documentId);
    await db.from("trailer_definition_pack_items")
      .delete().eq("pack_id", packId).not("document_id", "in", `(${docIds.join(",")})`);
  } else {
    // Create new
    const { data, error } = await db.from("trailer_definition_packs")
      .insert({ project_id: projectId, title: title || "Trailer Definition Pack", created_by: userId })
      .select().single();
    if (error) return json({ error: "Pack creation failed: " + error.message }, 500);
    pack = data;
  }

  // Upsert items
  for (const item of items) {
    await db.from("trailer_definition_pack_items").upsert({
      pack_id: pack.id,
      project_id: projectId,
      document_id: item.documentId,
      version_id: item.versionId || null,
      role: item.role || "supporting",
      sort_order: item.sortOrder ?? 0,
      include: item.include !== false,
    }, { onConflict: "pack_id,document_id" });
  }

  // Return pack with items
  const { data: packItems } = await db.from("trailer_definition_pack_items")
    .select("*").eq("pack_id", pack.id).order("sort_order", { ascending: true });

  return json({ pack, items: packItems || [] });
}

async function handleGetPacks(db: any, body: any) {
  const { projectId } = body;
  if (!projectId) return json({ error: "projectId required" }, 400);

  const { data: packs } = await db.from("trailer_definition_packs")
    .select("*, trailer_definition_pack_items(*)")
    .eq("project_id", projectId)
    .order("created_at", { ascending: false });

  return json({ packs: packs || [] });
}

async function handleGetPack(db: any, body: any) {
  const { projectId, packId } = body;
  if (!projectId || !packId) return json({ error: "projectId and packId required" }, 400);

  const { data: pack } = await db.from("trailer_definition_packs")
    .select("*").eq("id", packId).eq("project_id", projectId).single();
  if (!pack) return json({ error: "Pack not found" }, 404);

  const { data: items } = await db.from("trailer_definition_pack_items")
    .select("*").eq("pack_id", packId).order("sort_order", { ascending: true });

  return json({ pack, items: items || [] });
}

// ═══════════════════════════════════════════
// ACTION HANDLERS
// ═══════════════════════════════════════════

async function handleLabelReadiness(db: any, body: any, userId: string, apiKey: string) {
  const { projectId, shotId } = body;
  if (!projectId || !shotId) return json({ error: "projectId and shotId required" }, 400);

  const { data: shot } = await db.from("scene_shots").select("*")
    .eq("id", shotId).eq("project_id", projectId).single();
  if (!shot) return json({ error: "Shot not found" }, 404);

  const shotDesc = [
    `Shot type: ${shot.shot_type || "unknown"}`, `Framing: ${shot.framing || "unknown"}`,
    `Camera: ${shot.camera_movement || "static"}, support: ${shot.camera_support || "tripod"}`,
    `Angle: ${shot.angle || "eye level"}`, `Blocking: ${shot.blocking_notes || "none"}`,
    `Emotional intent: ${shot.emotional_intent || "neutral"}`,
    `Characters: ${(shot.characters_in_frame || []).join(", ") || "none"}`,
    `Props: ${(shot.props_required || []).join(", ") || "none"}`,
    `VFX/SFX: ${JSON.stringify(shot.sfx_vfx_flags || {})}`,
    `Duration: ${shot.est_duration_seconds || "unknown"}s`,
    `Location: ${shot.location_hint || "unknown"}`, `Lighting: ${shot.lighting_style || "unknown"}`,
  ].join("\n");

  const systemPrompt = `You are an AI production feasibility analyst. Score this shot on 8 rubric dimensions (0-5 each).
RUBRIC: performance_complexity, identity_continuity_required, action_complexity, environment_controllability, camera_complexity, dialogue_lipsync_requirement, ip_likeness_risk, asset_availability.
Also provide blocking_constraints (string[]), required_assets (string[]), legal_risk_flags (string[]).
Return JSON: { "rubric": {...all 8}, "blocking_constraints": [...], "required_assets": [...], "legal_risk_flags": [...] }`;

  const parsed = await callLLMWithJsonRetry(
    { apiKey, model: MODELS.FAST, system: systemPrompt, user: shotDesc, temperature: 0.1, maxTokens: 2000 },
    { handler: "label_ai_readiness", validate: (d): d is any => d && typeof d.rubric === "object" },
  );
  const rubric = parsed.rubric || {};
  const { tier, confidence, maxQuality, modelRoute, costBand, riskScore } = computeTier(rubric);

  await db.from("scene_shots").update({
    ai_candidate: tier !== "D", ai_readiness_tier: tier, ai_max_quality: maxQuality,
    ai_confidence: confidence, ai_blocking_constraints: parsed.blocking_constraints || [],
    ai_required_assets: parsed.required_assets || [], ai_model_route: modelRoute,
    ai_legal_risk_flags: parsed.legal_risk_flags || [], ai_estimated_cost_band: costBand,
    ai_analysis_json: { rubric, riskScore, ...parsed },
    ai_last_labeled_at: new Date().toISOString(), ai_last_labeled_by: userId,
  }).eq("id", shotId);

  return json({ shotId, tier, max_quality_now: maxQuality, confidence, model_route: modelRoute,
    blocking_constraints: parsed.blocking_constraints || [], required_assets: parsed.required_assets || [],
    legal_risk_flags: parsed.legal_risk_flags || [], estimated_cost_band: costBand });
}

async function handleGenerateFrames(db: any, body: any, userId: string, apiKey: string) {
  const { projectId, shotId, options = {} } = body;
  if (!projectId || !shotId) return json({ error: "projectId and shotId required" }, 400);

  const { data: shot } = await db.from("scene_shots").select("*")
    .eq("id", shotId).eq("project_id", projectId).single();
  if (!shot) return json({ error: "Shot not found" }, 404);

  if (!shot.ai_readiness_tier) {
    const labelResp = await handleLabelReadiness(db, body, userId, apiKey);
    const labelData = await labelResp.json();
    if (labelData.tier === "D") return json({ error: "Tier D: generate mood references only.", tier_blocked: true }, 400);
  } else if (shot.ai_readiness_tier === "D") {
    return json({ error: "Tier D: generate mood references only.", tier_blocked: true }, 400);
  }

  const style = options.style || "cinematic film still";
  const variations = Math.min(options.variations || 4, 4);
  const prompt = buildImagePrompt(shot, style);
  const createdMedia: any[] = [];

  for (let i = 0; i < variations; i++) {
    try {
      const imageUrl = await generateImage(apiKey, prompt);
      if (!imageUrl) continue;

      const storagePath = `${projectId}/shots/${shotId}/frames/${Date.now()}_${i}.png`;
      const publicUrl = await uploadImageFromUrl(imageUrl, storagePath);
      if (!publicUrl) continue;

      const { data: row } = await db.from("ai_generated_media").insert({
        project_id: projectId, shot_id: shotId, media_type: "storyboard_frame",
        storage_path: storagePath, selected: false, created_by: userId,
        generation_params: { prompt, options, model: "gemini-2.5-flash-image", variation: i },
      }).select().single();

      if (row) createdMedia.push({ ...row, public_url: publicUrl });
    } catch (err) { console.error("Frame gen error:", err); }
  }

  return json({ media: createdMedia, count: createdMedia.length });
}

async function handleSelectMedia(db: any, body: any, _userId: string) {
  const { projectId, mediaId } = body;
  if (!projectId || !mediaId) return json({ error: "projectId and mediaId required" }, 400);

  const { data: media } = await db.from("ai_generated_media").select("*")
    .eq("id", mediaId).eq("project_id", projectId).single();
  if (!media) return json({ error: "Media not found" }, 404);

  if (media.media_type === "storyboard_frame" && media.shot_id) {
    await db.from("ai_generated_media").update({ selected: false })
      .eq("project_id", projectId).eq("shot_id", media.shot_id)
      .eq("media_type", "storyboard_frame");
  }

  const { data: updated } = await db.from("ai_generated_media")
    .update({ selected: true }).eq("id", mediaId).select().single();

  return json(updated);
}

async function handleAnimateClip(db: any, body: any, userId: string, apiKey: string) {
  const { projectId, shotId, options = {} } = body;
  if (!projectId || !shotId) return json({ error: "projectId and shotId required" }, 400);

  const { data: shot } = await db.from("scene_shots").select("ai_readiness_tier")
    .eq("id", shotId).eq("project_id", projectId).single();
  if (!shot) return json({ error: "Shot not found" }, 404);

  const tier = shot.ai_readiness_tier;
  if (!tier || tier === "C" || tier === "D") {
    return json({ error: `Tier ${tier || "unscored"}: motion stills require Tier A or B.`, tier_blocked: true }, 400);
  }

  let { data: frames } = await db.from("ai_generated_media").select("*")
    .eq("project_id", projectId).eq("shot_id", shotId)
    .eq("media_type", "storyboard_frame").eq("selected", true).limit(1);

  if (!frames || frames.length === 0) {
    const frameResp = await handleGenerateFrames(db, { projectId, shotId, options: { variations: 1 } }, userId, apiKey);
    const frameData = await frameResp.json();
    if (frameData.media?.[0]) {
      await db.from("ai_generated_media").update({ selected: true }).eq("id", frameData.media[0].id);
      frames = [frameData.media[0]];
    } else {
      return json({ error: "Could not generate keyframe for motion still" }, 500);
    }
  }

  const keyframeUrl = frames[0].public_url || (() => {
    const admin = adminClient();
    return admin.storage.from("ai-media").getPublicUrl(frames[0].storage_path).data?.publicUrl;
  })();

  if (!keyframeUrl) return json({ error: "No keyframe URL available" }, 500);

  const motion = options.motion || "push_in";
  const animPrompt = `Take this cinematic keyframe and create a version with a subtle ${motion} camera movement implied. Gentle, cinematic motion. Show slight perspective shift. No lip-sync. NEGATIVES: no text, no watermarks, no logos.`;

  const resp = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: "google/gemini-2.5-flash-image",
      messages: [{
        role: "user",
        content: [
          { type: "text", text: animPrompt },
          { type: "image_url", image_url: { url: keyframeUrl } },
        ],
      }],
      modalities: ["image", "text"],
    }),
  });

  if (!resp.ok) return json({ error: "Motion still generation failed" }, 500);
  const animData = await resp.json();
  const animImageUrl = animData.choices?.[0]?.message?.images?.[0]?.image_url?.url;
  if (!animImageUrl) return json({ error: "No motion still output" }, 500);

  const storagePath = `${projectId}/shots/${shotId}/motion/${Date.now()}_0.png`;
  const publicUrl = await uploadImageFromUrl(animImageUrl, storagePath);
  if (!publicUrl) return json({ error: "Upload failed" }, 500);

  const { data: row } = await db.from("ai_generated_media").insert({
    project_id: projectId, shot_id: shotId, media_type: "motion_still",
    storage_path: storagePath, selected: true, created_by: userId,
    generation_params: { motion, keyframe_id: frames[0].id, model: "gemini-2.5-flash-image" },
  }).select().single();

  return json({ media: row, public_url: publicUrl });
}

async function handleExtractMoments(db: any, body: any, _userId: string, apiKey: string) {
  const { projectId, packId, documentId, versionId } = body;
  if (!projectId) return json({ error: "projectId required" }, 400);

  let contextText = "";
  let sourceDocId = documentId || null;
  let sourceVersionId = versionId || null;

  if (packId) {
    // Use pack context
    const ctx = await compileTrailerContext(db, projectId, packId);
    const docList = ctx.items.map(i => `• ${i.title} (${i.doc_type}, ${i.role})`).join("\n");
    contextText = `TRAILER DEFINITION PACK: "${ctx.pack.title}"\nSelected documents:\n${docList}\n\n=== PRIMARY MATERIALS ===\n${ctx.primariesText}\n\n=== SUPPORTING MATERIALS ===\n${ctx.supportingText}`;
  } else if (documentId && versionId) {
    // Legacy single-doc path
    const { data: version } = await db.from("project_document_versions")
      .select("content, plaintext").eq("id", versionId).single();
    contextText = (version?.plaintext || version?.content || "").toString();
    if (!contextText) return json({ error: "Version content not found" }, 404);
  } else {
    return json({ error: "packId or (documentId + versionId) required" }, 400);
  }

  const systemPrompt = `You are a trailer editor. Analyze the provided project materials and extract 10-25 trailer-worthy moments.
These materials may include scripts, treatments, beat sheets, concept briefs, blueprints, character bibles, or market sheets.
If no full screenplay exists, extract moments from available materials — label confidence proportionally lower for non-script sources.
For each moment return: moment_summary, scene_number (int or null), hook_strength (0-10), spectacle_score (0-10), emotional_score (0-10), ai_friendly (bool), suggested_visual_approach (rewrite to AI-friendly: silhouettes, VO montage, inserts, landscapes, symbols, text cards), source_refs (which doc titles/sections it came from), spoiler_level (0-3).
Return JSON: { "moments": [...] }`;

  const parsed = await callLLMWithJsonRetry(
    { apiKey, model: MODELS.FAST, system: systemPrompt, user: contextText.slice(0, 16000), temperature: 0.4, maxTokens: 4000 },
    { handler: "extract_trailer_moments", validate: (d): d is any => d && Array.isArray(d.moments) },
  );
  const moments = parsed.moments || [];

  // Clear old moments for this project (if pack-based, clear all; if doc-based, clear per version)
  if (packId) {
    await db.from("trailer_moments").delete().eq("project_id", projectId);
  } else if (sourceVersionId) {
    await db.from("trailer_moments").delete().eq("project_id", projectId).eq("source_version_id", sourceVersionId);
  }

  const rows = moments.map((m: any) => ({
    project_id: projectId,
    source_document_id: sourceDocId,
    source_version_id: sourceVersionId,
    scene_number: m.scene_number ?? null,
    moment_summary: m.moment_summary || "Untitled",
    hook_strength: Math.max(0, Math.min(10, m.hook_strength ?? 5)),
    spectacle_score: Math.max(0, Math.min(10, m.spectacle_score ?? 5)),
    emotional_score: Math.max(0, Math.min(10, m.emotional_score ?? 5)),
    ai_friendly: !!m.ai_friendly,
    suggested_visual_approach: m.suggested_visual_approach || null,
  }));

  if (rows.length > 0) await db.from("trailer_moments").insert(rows);
  return json({ inserted: rows.length, moments: rows });
}

async function handleBuildShotlist(db: any, body: any, userId: string, _apiKey: string) {
  const { projectId, count = 16, momentIds } = body;
  if (!projectId) return json({ error: "projectId required" }, 400);

  const { data: moments } = await db.from("trailer_moments").select("*")
    .eq("project_id", projectId).order("created_at", { ascending: false }).limit(100);
  if (!moments || moments.length === 0) return json({ error: "No trailer moments found. Extract moments first." }, 400);

  let filteredMoments = moments;
  if (momentIds && Array.isArray(momentIds) && momentIds.length > 0) {
    const idSet = new Set(momentIds);
    filteredMoments = moments.filter((m: any) => idSet.has(m.id));
    if (filteredMoments.length === 0) return json({ error: "None of the selected moments were found." }, 400);
  }

  const scored = filteredMoments.map((m: any) => ({
    ...m, _score: m.hook_strength * 0.5 + m.spectacle_score * 0.3 + m.emotional_score * 0.2,
  }));
  scored.sort((a: any, b: any) => {
    if (a.ai_friendly !== b.ai_friendly) return a.ai_friendly ? -1 : 1;
    return b._score - a._score;
  });

  const selected = scored.slice(0, count);
  const items = selected.map((m: any, idx: number) => ({
    index: idx + 1, moment_id: m.id,
    shot_title: `Trailer Beat ${idx + 1}`,
    shot_description: m.suggested_visual_approach || m.moment_summary,
    intended_duration: m.spectacle_score >= 7 ? 3 : m.hook_strength >= 7 ? 2.5 : 2,
    ai_suggested_tier: m.ai_friendly ? "A" : "C",
    text_card_suggestion: idx === 0 ? "TITLE CARD" : null,
    hook_strength: m.hook_strength, spectacle_score: m.spectacle_score, emotional_score: m.emotional_score,
    included: true,
  }));

  const { data: shotlist, error } = await db.from("trailer_shotlists").insert({
    project_id: projectId, items, source_moment_ids: selected.map((m: any) => m.id),
    status: "draft", created_by: userId,
  }).select().single();

  if (error) return json({ error: "Failed to create shotlist: " + error.message }, 500);
  return json({ trailer_shotlist_id: shotlist.id, items });
}

async function handleGenerateTrailerAssets(db: any, body: any, userId: string, apiKey: string) {
  // Single-beat generation: processes ONE beat per call to stay within CPU limits
  const { projectId, trailerShotlistId, beatIndex, skipMotionStill } = body;
  if (!projectId || !trailerShotlistId) return json({ error: "projectId and trailerShotlistId required" }, 400);

  // If no beatIndex, return the list of beats to process (planning mode)
  if (beatIndex === undefined || beatIndex === null) {
    const { data: shotlist } = await db.from("trailer_shotlists").select("*")
      .eq("id", trailerShotlistId).eq("project_id", projectId).single();
    if (!shotlist) return json({ error: "Shotlist not found" }, 404);

    const allItems = shotlist.items || [];
    const selectedIndices: number[] | null = shotlist.selected_indices;
    const filteredByIndices = selectedIndices && selectedIndices.length > 0
      ? allItems.filter((item: any) => selectedIndices.includes(item.index))
      : allItems;
    const items = filteredByIndices.filter((item: any) => item.included !== false);
    return json({ mode: "plan", beats: items.map((i: any) => ({ index: i.index, shot_title: i.shot_title })), total: items.length });
  }

  // Process single beat
  const { data: shotlist } = await db.from("trailer_shotlists").select("*")
    .eq("id", trailerShotlistId).eq("project_id", projectId).single();
  if (!shotlist) return json({ error: "Shotlist not found" }, 404);

  const item = (shotlist.items || []).find((i: any) => i.index === beatIndex);
  if (!item) return json({ error: `Beat ${beatIndex} not found` }, 404);

  const prompt = buildImagePrompt({
    characters_in_frame: [],
    blocking_notes: item.shot_description,
    location_hint: "", time_of_day_hint: "day",
    shot_type: "WS", framing: "wide", camera_movement: "static",
    lighting_style: "cinematic", emotional_intent: "dramatic",
  }, "cinematic trailer frame");

  const imageUrl = await generateImage(apiKey, prompt);
  if (!imageUrl) return json({ index: beatIndex, status: "frame_failed", framesGenerated: 0, motionStillsGenerated: 0 });

  const storagePath = `${projectId}/trailers/${trailerShotlistId}/frames/${Date.now()}_${beatIndex}.png`;
  const publicUrl = await uploadImageFromUrl(imageUrl, storagePath);
  if (!publicUrl) return json({ index: beatIndex, status: "upload_failed", framesGenerated: 0, motionStillsGenerated: 0 });

  const { data: mediaRow } = await db.from("ai_generated_media").insert({
    project_id: projectId, media_type: "storyboard_frame",
    storage_path: storagePath, selected: true, created_by: userId,
    trailer_shotlist_id: trailerShotlistId,
    generation_params: { prompt, beat_index: beatIndex, model: "gemini-2.5-flash-image" },
  }).select().single();

  let motionStillsGenerated = 0;

  if (!skipMotionStill && item.ai_suggested_tier !== "C" && item.hook_strength >= 6) {
    try {
      const animResp = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
        method: "POST",
        headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          model: "google/gemini-2.5-flash-image",
          messages: [{
            role: "user",
            content: [
              { type: "text", text: "Create a subtle push-in camera movement version of this cinematic frame. Gentle, slow perspective shift. No text, no watermarks." },
              { type: "image_url", image_url: { url: publicUrl } },
            ],
          }],
          modalities: ["image", "text"],
        }),
      });

      if (animResp.ok) {
        const animData = await animResp.json();
        const animUrl = animData.choices?.[0]?.message?.images?.[0]?.image_url?.url;
        if (animUrl) {
          const clipPath = `${projectId}/trailers/${trailerShotlistId}/motion/${Date.now()}_${beatIndex}.png`;
          const clipPublicUrl = await uploadImageFromUrl(animUrl, clipPath);
          if (clipPublicUrl) {
            await db.from("ai_generated_media").insert({
              project_id: projectId, media_type: "motion_still",
              storage_path: clipPath, selected: true, created_by: userId,
              trailer_shotlist_id: trailerShotlistId,
              generation_params: { keyframe_id: mediaRow?.id, beat_index: beatIndex },
            });
            motionStillsGenerated = 1;
          }
        }
      }
    } catch (animErr) { console.error("Motion still error for beat", beatIndex, animErr); }
  }

  return json({ index: beatIndex, status: "ok", frame_url: publicUrl, framesGenerated: 1, motionStillsGenerated });
}

async function handleAssembleTrailer(db: any, body: any, userId: string, _apiKey: string) {
  const { projectId, trailerShotlistId } = body;
  if (!projectId || !trailerShotlistId) return json({ error: "projectId and trailerShotlistId required" }, 400);

  const { data: shotlist } = await db.from("trailer_shotlists").select("*")
    .eq("id", trailerShotlistId).eq("project_id", projectId).single();
  if (!shotlist) return json({ error: "Shotlist not found" }, 404);

  const allItems = shotlist.items || [];
  const selectedIndices: number[] | null = shotlist.selected_indices;
  const filteredByIndices = selectedIndices && selectedIndices.length > 0
    ? allItems.filter((item: any) => selectedIndices.includes(item.index))
    : allItems;
  const items = filteredByIndices.filter((item: any) => item.included !== false);

  const { data: shotlistMedia } = await db.from("ai_generated_media").select("*")
    .eq("project_id", projectId)
    .eq("trailer_shotlist_id", trailerShotlistId)
    .order("created_at", { ascending: false });

  const mediaList = shotlistMedia || [];

  const timeline: any[] = [];
  const missingFrames: string[] = [];

  for (const item of items) {
    const beatMedia = mediaList.filter((m: any) => m.generation_params?.beat_index === item.index);
    const frame = beatMedia.find((m: any) => m.media_type === "storyboard_frame");
    const motionStill = beatMedia.find((m: any) => m.media_type === "motion_still");

    const admin = adminClient();
    const frameUrl = frame ? admin.storage.from("ai-media").getPublicUrl(frame.storage_path).data?.publicUrl : null;
    const motionStillUrl = motionStill ? admin.storage.from("ai-media").getPublicUrl(motionStill.storage_path).data?.publicUrl : null;

    timeline.push({
      index: item.index, shot_title: item.shot_title, shot_description: item.shot_description,
      intended_duration: item.intended_duration,
      has_frame: !!frame, frame_url: frameUrl,
      has_motion_still: !!motionStill, motion_still_url: motionStillUrl,
      text_card: item.text_card_suggestion,
    });

    if (!frame) missingFrames.push(item.shot_title);
  }

  const timelineData = {
    project_id: projectId, shotlist_id: trailerShotlistId,
    total_duration: timeline.reduce((sum: number, t: any) => sum + (t.intended_duration || 2), 0),
    frame_count: timeline.filter((t: any) => t.has_frame).length,
    motion_still_count: timeline.filter((t: any) => t.has_motion_still).length,
    missing_frames: missingFrames, timeline,
    created_at: new Date().toISOString(),
  };

  const admin = adminClient();
  const timelinePath = `${projectId}/trailers/${trailerShotlistId}/timeline.json`;
  await admin.storage.from("ai-media").upload(timelinePath, JSON.stringify(timelineData, null, 2), {
    contentType: "application/json", upsert: true,
  });
  const { data: urlData } = admin.storage.from("ai-media").getPublicUrl(timelinePath);

  await db.from("ai_generated_media").insert({
    project_id: projectId, media_type: "trailer_cut",
    storage_path: timelinePath, selected: false, created_by: userId,
    trailer_shotlist_id: trailerShotlistId,
    generation_params: { type: "timeline_json", shotlist_id: trailerShotlistId },
  });

  return json({
    timeline: timelineData, timeline_url: urlData?.publicUrl,
    missing_frames: missingFrames,
    message: missingFrames.length > 0
      ? `Timeline created with ${missingFrames.length} missing frames. Generate assets first.`
      : "Trailer timeline assembled successfully.",
  });
}

// ─── Main handler ───

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const authHeader = req.headers.get("Authorization") || "";
    const token = authHeader.replace("Bearer ", "");
    let userId: string;
    try { userId = parseUserId(token); } catch { return json({ error: "Unauthorized" }, 401); }

    const body = await req.json();
    const { action } = body;

    const db = adminClient();
    const apiKey = Deno.env.get("LOVABLE_API_KEY");
    if (!apiKey) return json({ error: "AI key not configured" }, 500);

    if (body.projectId) {
      const { data: project } = await db.from("projects").select("id").eq("id", body.projectId).single();
      if (!project) return json({ error: "Project not found" }, 404);
    }

    switch (action) {
      case "label_ai_readiness": return await handleLabelReadiness(db, body, userId, apiKey);
      case "generate_storyboard_frames": return await handleGenerateFrames(db, body, userId, apiKey);
      case "select_media": return await handleSelectMedia(db, body, userId);
      case "animate_shot_clip": return await handleAnimateClip(db, body, userId, apiKey);
      case "extract_trailer_moments": return await handleExtractMoments(db, body, userId, apiKey);
      case "build_trailer_shotlist": return await handleBuildShotlist(db, body, userId, apiKey);
      case "generate_trailer_assets": return await handleGenerateTrailerAssets(db, body, userId, apiKey);
      case "assemble_taster_trailer": return await handleAssembleTrailer(db, body, userId, apiKey);
      case "upsert_trailer_pack": return await handleUpsertPack(db, body, userId);
      case "get_trailer_packs": return await handleGetPacks(db, body);
      case "get_trailer_pack": return await handleGetPack(db, body);
      default: return json({ error: `Unknown action: ${action}` }, 400);
    }
  } catch (err) {
    console.error("ai-trailer-factory error:", err);
    const msg = err instanceof Error ? err.message : "Unknown error";
    if (msg === "RATE_LIMIT") return json({ error: "Rate limit exceeded. Try again shortly." }, 429);
    if (msg === "PAYMENT_REQUIRED") return json({ error: "AI credits exhausted. Add funds." }, 402);
    return json({ error: msg }, 500);
  }
});
