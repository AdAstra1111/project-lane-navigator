/**
 * ai-production-layer — Edge function for AI Production features.
 *
 * Actions:
 *   label_ai_readiness    — Score a shot for AI feasibility
 *   generate_shot_media   — Generate storyboard frames or animated panels
 *   extract_trailer_moments — Extract trailer beats from a script
 *   build_trailer_shotlist — Build an AI-optimised trailer shotlist
 *   assemble_taster_trailer — Assemble a taster trailer package
 */
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { callLLMWithJsonRetry, MODELS } from "../_shared/llm.ts";
import { isObject, hasArray } from "../_shared/validators.ts";

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

// ─── Rubric weights ───
const WEIGHTS = {
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
    const val = rubric[key] ?? 0;
    rawScore += val * weight;
    maxPossible += 5 * Math.abs(weight);
  }
  // Normalize to 0-100
  const riskScore = Math.max(0, Math.min(100, ((rawScore + maxPossible) / (2 * maxPossible)) * 100));
  const confidence = Math.max(0, Math.min(100, Math.round(100 - riskScore)));

  let tier: string;
  if (riskScore <= 20 && confidence >= 80) tier = "A";
  else if (riskScore <= 40 && confidence >= 60) tier = "B";
  else if (riskScore <= 65 && confidence >= 35) tier = "C";
  else tier = "D";

  let maxQuality: string;
  if (tier === "A") maxQuality = "Broadcast";
  else if (tier === "B") maxQuality = "Pitch";
  else if (tier === "C") maxQuality = "Previz";
  else maxQuality = "Previz";

  let modelRoute: string;
  if (tier === "A" || tier === "B") modelRoute = "text-to-video";
  else if (tier === "C") modelRoute = "hybrid";
  else modelRoute = "3D-assisted";

  let costBand: string;
  if (tier === "A") costBand = "low";
  else if (tier === "B") costBand = "medium";
  else costBand = "high";

  return { tier, confidence, maxQuality, modelRoute, costBand, riskScore };
}

// ─── Handlers ───

async function handleLabelAiReadiness(db: any, body: any, userId: string, apiKey: string) {
  const { projectId, shotId } = body;
  if (!projectId || !shotId) return json({ error: "projectId and shotId required" }, 400);

  // Fetch shot data
  const { data: shot, error: shotErr } = await db
    .from("scene_shots")
    .select("*")
    .eq("id", shotId)
    .eq("project_id", projectId)
    .single();
  if (shotErr || !shot) return json({ error: "Shot not found" }, 404);

  // Build description for LLM
  const shotDesc = [
    `Shot type: ${shot.shot_type || "unknown"}`,
    `Framing: ${shot.framing || "unknown"}`,
    `Camera: ${shot.camera_movement || "static"}, support: ${shot.camera_support || "tripod"}`,
    `Angle: ${shot.angle || "eye level"}`,
    `Blocking: ${shot.blocking_notes || "none"}`,
    `Emotional intent: ${shot.emotional_intent || "neutral"}`,
    `Characters: ${(shot.characters_in_frame || []).join(", ") || "none"}`,
    `Props: ${(shot.props_required || []).join(", ") || "none"}`,
    `VFX/SFX: ${JSON.stringify(shot.sfx_vfx_flags || {})}`,
    `Duration: ${shot.est_duration_seconds || "unknown"}s`,
    `Location: ${shot.location_hint || "unknown"}`,
    `Lighting: ${shot.lighting_style || "unknown"}`,
    `Composition: ${shot.composition_notes || "none"}`,
  ].join("\n");

  const systemPrompt = `You are an AI production feasibility analyst for film/TV. Score this shot on 8 rubric dimensions (0-5 each).

RUBRIC:
- performance_complexity: How complex is the acting performance needed? (0=simple/no actors, 5=intense emotional closeup)
- identity_continuity_required: Does this need a recognizable, consistent character face/body? (0=no/silhouette, 5=close-up known face)
- action_complexity: How complex is the physical action? (0=static, 5=stunt/fight/chase)
- environment_controllability: How easy to generate the setting? (0=hard/unique, 5=generic/simple)
- camera_complexity: How complex is the camera work? (0=locked/static, 5=oner/steadicam/whip)
- dialogue_lipsync_requirement: Does this need lip sync? (0=no dialogue/VO, 5=close-up dialogue)
- ip_likeness_risk: Risk of needing real people/brands? (0=none, 5=celebrity/brand required)
- asset_availability: Are reference assets available? (0=none, 5=full pack available)

Also provide:
- blocking_constraints: string[] of human-readable constraints preventing AI generation
- required_assets: string[] of missing assets needed
- legal_risk_flags: string[] of legal concerns (likeness, brand, etc)

Return JSON:
{
  "rubric": { "performance_complexity": N, ... all 8 },
  "blocking_constraints": [...],
  "required_assets": [...],
  "legal_risk_flags": [...]
}`;

  const parsed = await callLLMWithJsonRetry({
    apiKey,
    model: MODELS.FAST,
    system: systemPrompt,
    user: shotDesc,
    temperature: 0.1,
    maxTokens: 2000,
  }, {
    handler: "label_ai_readiness",
    validate: (d): d is any => isObject(d) && isObject(d.rubric),
  });
  const rubric = parsed.rubric || {};
  const { tier, confidence, maxQuality, modelRoute, costBand, riskScore } = computeTier(rubric);

  const blockingConstraints = parsed.blocking_constraints || [];
  const requiredAssets = parsed.required_assets || [];
  const legalRiskFlags = parsed.legal_risk_flags || [];

  const analysisJson = {
    rubric,
    riskScore,
    blockingConstraints,
    requiredAssets,
    legalRiskFlags,
  };

  // Update shot
  await db
    .from("scene_shots")
    .update({
      ai_candidate: tier !== "D",
      ai_readiness_tier: tier,
      ai_max_quality: maxQuality,
      ai_confidence: confidence,
      ai_blocking_constraints: blockingConstraints,
      ai_required_assets: requiredAssets,
      ai_model_route: modelRoute,
      ai_legal_risk_flags: legalRiskFlags,
      ai_estimated_cost_band: costBand,
      ai_analysis_json: analysisJson,
      ai_last_labeled_at: new Date().toISOString(),
      ai_last_labeled_by: userId,
    })
    .eq("id", shotId);

  return json({
    shotId,
    tier,
    max_quality_now: maxQuality,
    confidence,
    blocking_constraints: blockingConstraints,
    required_assets: requiredAssets,
    model_route: modelRoute,
    legal_risk_flags: legalRiskFlags,
    estimated_cost_band: costBand,
    analysis_json: analysisJson,
  });
}

async function handleGenerateShotMedia(db: any, body: any, userId: string, apiKey: string) {
  const { projectId, shotId, generationType, options = {} } = body;
  if (!projectId || !shotId) return json({ error: "projectId and shotId required" }, 400);
  if (!["storyboard_frame", "animated_panel"].includes(generationType)) {
    return json({ error: "generationType must be storyboard_frame or animated_panel" }, 400);
  }

  // Fetch shot + tier
  const { data: shot } = await db
    .from("scene_shots")
    .select("*")
    .eq("id", shotId)
    .eq("project_id", projectId)
    .single();
  if (!shot) return json({ error: "Shot not found" }, 404);

  const tier = shot.ai_readiness_tier || "D";

  // Tier gates
  if (tier === "D") {
    return json({ error: "Tier D: not viable for AI generation. Generate mood references only.", tier_blocked: true }, 400);
  }
  if (tier === "C" && generationType === "animated_panel") {
    return json({ error: "Tier C: animation not supported. Use storyboard_frame for previz only.", tier_blocked: true }, 400);
  }

  const aspectRatio = options.aspectRatio || "16:9";
  const style = options.style || "cinematic film still";
  const variations = Math.min(options.variations || 1, 4);

  // Build image generation prompt
  const prompt = [
    `SUBJECT: ${(shot.characters_in_frame || []).join(", ") || "scene"}, ${shot.blocking_notes || ""}`,
    `SETTING: ${shot.location_hint || "unspecified"}, ${shot.time_of_day_hint || "day"}`,
    `CAMERA: ${shot.shot_type || "MS"} ${shot.framing || ""}, ${shot.camera_movement || "static"}`,
    `LIGHTING: ${shot.lighting_style || "natural"}, ${shot.emotional_intent || "neutral"} mood`,
    `STYLE: ${style}, ${aspectRatio} aspect ratio, cinematic composition`,
    `NEGATIVES: no logos, no text, no watermarks, no UI elements`,
  ].join("\n");

  const createdMedia: any[] = [];

  for (let i = 0; i < variations; i++) {
    try {
      // Generate image via Lovable AI image model
      const imageResponse = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: "google/gemini-2.5-flash-image",
          messages: [{ role: "user", content: prompt }],
          modalities: ["image", "text"],
        }),
      });

      if (!imageResponse.ok) {
        console.error("Image gen failed:", imageResponse.status);
        continue;
      }

      const imageData = await imageResponse.json();
      const imageUrl = imageData.choices?.[0]?.message?.images?.[0]?.image_url?.url;
      if (!imageUrl) continue;

      // Decode base64
      const base64Data = imageUrl.replace(/^data:image\/\w+;base64,/, "");
      const binaryData = Uint8Array.from(atob(base64Data), (c) => c.charCodeAt(0));

      // Upload to storage
      const timestamp = Date.now();
      const storagePath = `${projectId}/shots/${shotId}/frames/${timestamp}_${i}.png`;
      const supabaseAdmin = createClient(
        Deno.env.get("SUPABASE_URL")!,
        Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
      );
      const { error: uploadErr } = await supabaseAdmin.storage
        .from("ai-media")
        .upload(storagePath, binaryData, { contentType: "image/png", upsert: true });

      if (uploadErr) {
        console.error("Upload error:", uploadErr);
        continue;
      }

      // Get public URL
      const { data: urlData } = supabaseAdmin.storage.from("ai-media").getPublicUrl(storagePath);

      // Insert metadata
      const { data: mediaRow } = await db
        .from("ai_generated_media")
        .insert({
          project_id: projectId,
          shot_id: shotId,
          media_type: generationType,
          storage_path: storagePath,
          generation_params: { prompt, options, model: "gemini-2.5-flash-image", variation: i },
          selected: false,
          created_by: userId,
        })
        .select()
        .single();

      if (mediaRow) {
        createdMedia.push({ ...mediaRow, public_url: urlData?.publicUrl });
      }
    } catch (err) {
      console.error("Generation error:", err);
    }
  }

  return json({ media: createdMedia, count: createdMedia.length });
}

async function handleExtractTrailerMoments(db: any, body: any, userId: string, apiKey: string) {
  const { projectId, documentId, versionId } = body;
  if (!projectId || !documentId || !versionId) {
    return json({ error: "projectId, documentId, versionId required" }, 400);
  }

  // Fetch script text
  const { data: version } = await db
    .from("project_document_versions")
    .select("content")
    .eq("id", versionId)
    .single();

  if (!version?.content) return json({ error: "Version content not found" }, 404);

  const systemPrompt = `You are a trailer editor for film/TV. Analyze this script and extract 10-25 trailer moments — beats that would make compelling trailer material.

For each moment, provide:
- moment_summary: One-sentence description of the visual/emotional beat
- scene_number: Integer scene number if identifiable, null otherwise
- hook_strength: 0-10 (how attention-grabbing)
- spectacle_score: 0-10 (visual wow factor)
- emotional_score: 0-10 (emotional impact)
- ai_friendly: boolean (can this be effectively generated by AI? Prefer landscapes, silhouettes, symbols, montage over close-up dialogue)
- suggested_visual_approach: Rewrite as an AI-friendly cinematic shot description (silhouettes, VO montage, inserts, landscapes, symbol shots)

Return JSON: { "moments": [...] }`;

  const parsed = await callLLMWithJsonRetry({
    apiKey,
    model: MODELS.BALANCED,
    system: systemPrompt,
    user: version.content.slice(0, 30000),
    temperature: 0.4,
    maxTokens: 8000,
  }, {
    handler: "extract_trailer_moments",
    validate: (d): d is any => isObject(d) && hasArray(d, "moments"),
  });
  const moments = parsed.moments || [];

  // Delete prior moments for same project+version (idempotent)
  await db
    .from("trailer_moments")
    .delete()
    .eq("project_id", projectId)
    .eq("source_version_id", versionId);

  // Insert new moments
  const rows = moments.map((m: any) => ({
    project_id: projectId,
    source_document_id: documentId,
    source_version_id: versionId,
    scene_number: m.scene_number ?? null,
    moment_summary: m.moment_summary || "Untitled moment",
    hook_strength: Math.max(0, Math.min(10, m.hook_strength ?? 5)),
    spectacle_score: Math.max(0, Math.min(10, m.spectacle_score ?? 5)),
    emotional_score: Math.max(0, Math.min(10, m.emotional_score ?? 5)),
    ai_friendly: !!m.ai_friendly,
    suggested_visual_approach: m.suggested_visual_approach || null,
  }));

  if (rows.length > 0) {
    await db.from("trailer_moments").insert(rows);
  }

  return json({ inserted: rows.length, moments: rows });
}

async function handleBuildTrailerShotlist(db: any, body: any, userId: string, apiKey: string) {
  const { projectId, count = 12 } = body;
  if (!projectId) return json({ error: "projectId required" }, 400);

  // Fetch moments
  const { data: moments } = await db
    .from("trailer_moments")
    .select("*")
    .eq("project_id", projectId)
    .order("created_at", { ascending: false })
    .limit(100);

  if (!moments || moments.length === 0) {
    return json({ error: "No trailer moments found. Extract moments first." }, 400);
  }

  // Score and sort
  const scored = moments.map((m: any) => ({
    ...m,
    _score: m.hook_strength * 0.5 + m.spectacle_score * 0.3 + m.emotional_score * 0.2,
  }));
  scored.sort((a: any, b: any) => {
    // Prefer ai_friendly, then by score
    if (a.ai_friendly !== b.ai_friendly) return a.ai_friendly ? -1 : 1;
    return b._score - a._score;
  });

  const selected = scored.slice(0, count);

  // Build shotlist items from moments
  const items = selected.map((m: any, idx: number) => ({
    index: idx + 1,
    moment_id: m.id,
    shot_title: `Trailer Beat ${idx + 1}`,
    shot_description: m.suggested_visual_approach || m.moment_summary,
    intended_duration: m.spectacle_score >= 7 ? 3 : m.hook_strength >= 7 ? 2 : 1.5,
    ai_suggested_tier: m.ai_friendly ? "A" : "C",
    text_card_suggestion: idx === 0 ? "TITLE CARD" : null,
    hook_strength: m.hook_strength,
    spectacle_score: m.spectacle_score,
    emotional_score: m.emotional_score,
  }));

  // Store in DB
  const { data: shotlist, error: insertErr } = await db
    .from("trailer_shotlists")
    .insert({
      project_id: projectId,
      items,
      source_moment_ids: selected.map((m: any) => m.id),
      status: "draft",
      created_by: userId,
    })
    .select()
    .single();

  if (insertErr) return json({ error: "Failed to create shotlist: " + insertErr.message }, 500);

  return json({ trailer_shotlist_id: shotlist.id, items });
}

async function handleAssembleTasterTrailer(db: any, body: any, userId: string, apiKey: string) {
  const { projectId, trailerShotlistId, selectedShotIds } = body;
  if (!projectId || !trailerShotlistId) {
    return json({ error: "projectId and trailerShotlistId required" }, 400);
  }

  // Fetch shotlist
  const { data: shotlist } = await db
    .from("trailer_shotlists")
    .select("*")
    .eq("id", trailerShotlistId)
    .eq("project_id", projectId)
    .single();

  if (!shotlist) return json({ error: "Trailer shotlist not found" }, 404);

  const items = shotlist.items || [];

  // For each item, check if frames exist or need generation
  const timeline: any[] = [];
  const missingFrames: string[] = [];

  for (const item of items) {
    // Check for existing generated media
    const { data: media } = await db
      .from("ai_generated_media")
      .select("*")
      .eq("project_id", projectId)
      .eq("media_type", "storyboard_frame")
      .order("created_at", { ascending: false })
      .limit(1);

    const frame = media?.[0];
    timeline.push({
      index: item.index,
      shot_title: item.shot_title,
      shot_description: item.shot_description,
      intended_duration: item.intended_duration,
      has_frame: !!frame,
      frame_path: frame?.storage_path || null,
      text_card: item.text_card_suggestion,
    });

    if (!frame) missingFrames.push(item.shot_title);
  }

  // Create a timeline JSON artifact
  const timelineData = {
    project_id: projectId,
    shotlist_id: trailerShotlistId,
    total_duration: timeline.reduce((sum: number, t: any) => sum + (t.intended_duration || 1.5), 0),
    frame_count: timeline.filter((t: any) => t.has_frame).length,
    missing_frames: missingFrames,
    timeline,
    created_at: new Date().toISOString(),
  };

  // Store timeline as media artifact
  const supabaseAdmin = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
  );

  const timelinePath = `${projectId}/trailers/${trailerShotlistId}/timeline.json`;
  await supabaseAdmin.storage
    .from("ai-media")
    .upload(timelinePath, JSON.stringify(timelineData, null, 2), {
      contentType: "application/json",
      upsert: true,
    });

  const { data: urlData } = supabaseAdmin.storage.from("ai-media").getPublicUrl(timelinePath);

  // Insert media record
  await db.from("ai_generated_media").insert({
    project_id: projectId,
    media_type: "trailer_cut",
    storage_path: timelinePath,
    generation_params: { type: "timeline_json", shotlist_id: trailerShotlistId },
    selected: false,
    created_by: userId,
  });

  return json({
    timeline: timelineData,
    timeline_url: urlData?.publicUrl,
    missing_frames: missingFrames,
    message: missingFrames.length > 0
      ? `Timeline created with ${missingFrames.length} missing frames. Generate frames first for a complete package.`
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
    try {
      userId = parseUserId(token);
    } catch {
      return json({ error: "Unauthorized" }, 401);
    }

    const body = await req.json();
    const { action } = body;

    const db = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    const apiKey = Deno.env.get("LOVABLE_API_KEY");
    if (!apiKey) return json({ error: "AI key not configured" }, 500);

    // Verify project access
    if (body.projectId) {
      const { data: project } = await db
        .from("projects")
        .select("id")
        .eq("id", body.projectId)
        .single();
      if (!project) return json({ error: "Project not found" }, 404);
    }

    switch (action) {
      case "label_ai_readiness":
        return await handleLabelAiReadiness(db, body, userId, apiKey);
      case "generate_shot_media":
        return await handleGenerateShotMedia(db, body, userId, apiKey);
      case "extract_trailer_moments":
        return await handleExtractTrailerMoments(db, body, userId, apiKey);
      case "build_trailer_shotlist":
        return await handleBuildTrailerShotlist(db, body, userId, apiKey);
      case "assemble_taster_trailer":
        return await handleAssembleTasterTrailer(db, body, userId, apiKey);
      default:
        return json({ error: `Unknown action: ${action}` }, 400);
    }
  } catch (err) {
    console.error("ai-production-layer error:", err);
    const msg = err instanceof Error ? err.message : "Unknown error";
    if (msg === "RATE_LIMIT") return json({ error: "Rate limit exceeded. Try again shortly." }, 429);
    if (msg === "PAYMENT_REQUIRED") return json({ error: "AI credits exhausted. Add funds." }, 402);
    return json({ error: msg }, 500);
  }
});
