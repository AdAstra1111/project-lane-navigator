/**
 * storyboard-engine — Edge function for Storyboard Pipeline v1.
 * Reads canonical visual_units, creates panel plans via LLM, generates image frames via Gemini.
 */
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { callLLM, MODELS, parseJsonSafe } from "../_shared/llm.ts";

const GATEWAY_URL = "https://ai.gateway.lovable.dev/v1/chat/completions";
const IMAGE_MODEL = "google/gemini-2.5-flash-image";

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

// ─── list_canonical_units ───
async function handleListCanonicalUnits(db: any, body: any) {
  const { projectId, unitKeys } = body;
  let query = db.from("visual_units").select("unit_key, canonical_payload, source_versions, locked, stale").eq("project_id", projectId);
  if (unitKeys && Array.isArray(unitKeys) && unitKeys.length > 0) {
    query = query.in("unit_key", unitKeys);
  }
  const { data, error } = await query.order("unit_key");
  if (error) return json({ error: error.message }, 500);
  // Attach scores from canonical_payload
  const units = (data || []).map((u: any) => ({
    ...u,
    scores: {
      trailer_value: u.canonical_payload?.trailer_value,
      storyboard_value: u.canonical_payload?.storyboard_value,
      pitch_value: u.canonical_payload?.pitch_value,
      complexity: u.canonical_payload?.complexity,
    },
  }));
  return json({ units });
}

// ─── create_run_and_panels ───
async function handleCreateRunAndPanels(db: any, body: any, userId: string, apiKey: string) {
  const { projectId, unitKeys: requestedKeys, stylePreset = "cinematic_realism", aspectRatio = "16:9" } = body;

  // Fetch canonical units
  let query = db.from("visual_units").select("*").eq("project_id", projectId);
  const { data: allUnits } = await query;
  if (!allUnits || allUnits.length === 0) return json({ error: "No canonical visual units found" }, 400);

  // Select units
  let selectedUnits: any[];
  if (requestedKeys && Array.isArray(requestedKeys) && requestedKeys.length > 0) {
    selectedUnits = allUnits.filter((u: any) => requestedKeys.includes(u.unit_key));
  } else {
    // Top 12 by storyboard_value
    selectedUnits = allUnits
      .sort((a: any, b: any) =>
        (b.canonical_payload?.storyboard_value || b.canonical_payload?.trailer_value || 0) -
        (a.canonical_payload?.storyboard_value || a.canonical_payload?.trailer_value || 0)
      )
      .slice(0, 12);
  }

  if (selectedUnits.length === 0) return json({ error: "No matching units" }, 400);

  const chosenKeys = selectedUnits.map((u: any) => u.unit_key);

  // Insert run
  const { data: run, error: runErr } = await db.from("storyboard_runs").insert({
    project_id: projectId,
    unit_keys: chosenKeys,
    style_preset: stylePreset,
    aspect_ratio: aspectRatio,
    status: "pending",
    created_by: userId,
  }).select().single();
  if (runErr) return json({ error: "Failed to create run: " + runErr.message }, 500);

  try {
    // Build LLM context
    const unitDescriptions = selectedUnits.map((u: any) => {
      const p = u.canonical_payload || {};
      return `unit_key: ${u.unit_key}\nlogline: ${p.logline || ""}\nvisual_intention: ${p.visual_intention || ""}\nlocation: ${p.location || ""}\ntime: ${p.time || ""}\ntone: ${(p.tone || []).join(", ")}\ncharacters: ${(p.characters_present || []).join(", ")}\nsuggested_shots: ${JSON.stringify(p.suggested_shots || [])}`;
    }).join("\n\n");

    const systemPrompt = `You are a storyboard director. Given visual unit descriptions, produce a detailed panel plan for each unit.

Return STRICT JSON only (no prose, no markdown) in this exact schema:
{
  "panels_by_unit": [
    {
      "unit_key": "string",
      "panels": [
        {
          "panel_index": 1,
          "shot_type": "WS|MS|CU|ECU|OTS|Aerial|Insert",
          "camera": "static|handheld|dolly|crane|steadicam|drone",
          "lens": "18mm|24mm|35mm|50mm|85mm",
          "composition": "what's in frame + framing notes",
          "action": "what happens",
          "mood": "tone words",
          "lighting": "lighting plan",
          "prompt": "image generation prompt (safe, no copyrighted characters, describe scene cinematically)",
          "negative_prompt": "things to avoid in image",
          "continuity_notes": "brief continuity"
        }
      ]
    }
  ]
}

Rules:
- 3-5 panels per unit (vary shot types for visual interest)
- Style preset: ${stylePreset}
- Aspect ratio: ${aspectRatio}
- Prompts must be safe for AI image generation (no real people names, no copyrighted characters)
- Include lighting, mood, and composition details in the prompt field
- Return ONLY valid JSON`;

    const result = await callLLM({
      apiKey,
      model: MODELS.BALANCED,
      system: systemPrompt,
      user: unitDescriptions.slice(0, 14000),
      temperature: 0.4,
      maxTokens: 10000,
    });

    const parsed = await parseJsonSafe(result.content, apiKey);
    const panelsByUnit: any[] = parsed.panels_by_unit || parsed;

    // Insert panels
    const panelRows: any[] = [];
    for (const unitPanels of panelsByUnit) {
      const uk = unitPanels.unit_key;
      if (!uk) continue;
      const panels = (unitPanels.panels || []).slice(0, 6); // clamp
      for (const panel of panels) {
        panelRows.push({
          project_id: projectId,
          run_id: run.id,
          unit_key: uk,
          panel_index: panel.panel_index || panelRows.filter((r: any) => r.unit_key === uk).length + 1,
          status: "proposed",
          panel_payload: panel,
          created_by: userId,
        });
      }
    }

    if (panelRows.length === 0) {
      await db.from("storyboard_runs").update({ status: "failed", error: "No panels generated" }).eq("id", run.id);
      return json({ error: "LLM produced no panels" }, 500);
    }

    const { error: insertErr } = await db.from("storyboard_panels").insert(panelRows);
    if (insertErr) {
      await db.from("storyboard_runs").update({ status: "failed", error: insertErr.message }).eq("id", run.id);
      return json({ error: "Failed to insert panels: " + insertErr.message }, 500);
    }

    await db.from("storyboard_runs").update({ status: "complete" }).eq("id", run.id);
    return json({ ok: true, runId: run.id, panelsCount: panelRows.length });
  } catch (err: any) {
    await db.from("storyboard_runs").update({ status: "failed", error: err.message }).eq("id", run.id);
    if (err.message === "RATE_LIMIT") return json({ error: "Rate limit exceeded. Try again shortly." }, 429);
    if (err.message === "PAYMENT_REQUIRED") return json({ error: "AI credits exhausted." }, 402);
    return json({ error: err.message }, 500);
  }
}

// ─── list_runs ───
async function handleListRuns(db: any, body: any) {
  const { projectId, limit = 20 } = body;
  const { data } = await db.from("storyboard_runs").select("*").eq("project_id", projectId)
    .order("created_at", { ascending: false }).limit(limit);
  return json({ runs: data || [] });
}

// ─── list_panels ───
async function handleListPanels(db: any, body: any) {
  const { projectId, runId } = body;
  if (!runId) return json({ error: "runId required" }, 400);
  const { data } = await db.from("storyboard_panels").select("*")
    .eq("project_id", projectId).eq("run_id", runId)
    .order("unit_key").order("panel_index");
  return json({ panels: data || [] });
}

// ─── get_panel ───
async function handleGetPanel(db: any, body: any) {
  const { projectId, panelId } = body;
  if (!panelId) return json({ error: "panelId required" }, 400);
  const { data: panel } = await db.from("storyboard_panels").select("*")
    .eq("id", panelId).eq("project_id", projectId).single();
  if (!panel) return json({ error: "Panel not found" }, 404);
  const { data: frames } = await db.from("storyboard_pipeline_frames").select("*")
    .eq("panel_id", panelId).eq("project_id", projectId)
    .order("created_at", { ascending: false });
  return json({ panel, frames: frames || [] });
}

// ─── generate_frame ───
async function handleGenerateFrame(db: any, body: any, userId: string, apiKey: string) {
  const { projectId, panelId, seed, override_prompt, override_negative } = body;
  if (!panelId) return json({ error: "panelId required" }, 400);

  // Fetch panel + run
  const { data: panel } = await db.from("storyboard_panels").select("*, storyboard_runs(style_preset, aspect_ratio)")
    .eq("id", panelId).eq("project_id", projectId).single();
  if (!panel) return json({ error: "Panel not found" }, 404);

  const payload = panel.panel_payload || {};
  const run = panel.storyboard_runs || {};
  const stylePreset = run.style_preset || "cinematic_realism";
  const aspectRatio = run.aspect_ratio || "16:9";

  const basePrompt = override_prompt || payload.prompt || "A cinematic scene";
  const negativePrompt = override_negative || payload.negative_prompt || "";

  const styleGuide: Record<string, string> = {
    cinematic_realism: "cinematic storyboard frame, film still, high detail, realistic lighting, professional cinematography",
    anime: "anime style storyboard, detailed animation key frame, vivid colors",
    noir: "film noir style, high contrast black and white, dramatic shadows, moody atmosphere",
    watercolor: "watercolor storyboard sketch, artistic, soft edges, painterly style",
  };

  const finalPrompt = `${basePrompt}. ${styleGuide[stylePreset] || styleGuide.cinematic_realism}. Aspect ratio ${aspectRatio}.${negativePrompt ? ` Avoid: ${negativePrompt}` : ""}`;

  try {
    // Call Gemini image generation
    const response = await fetch(GATEWAY_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: IMAGE_MODEL,
        messages: [{ role: "user", content: finalPrompt }],
        modalities: ["image", "text"],
      }),
    });

    if (!response.ok) {
      const errText = await response.text();
      console.error("Image gen error:", response.status, errText);
      if (response.status === 429) return json({ error: "Rate limit exceeded" }, 429);
      if (response.status === 402) return json({ error: "AI credits exhausted" }, 402);
      await db.from("storyboard_panels").update({ status: "failed" }).eq("id", panelId);
      return json({ error: "Image generation failed" }, 500);
    }

    const genResult = await response.json();
    const imageData = genResult.choices?.[0]?.message?.images?.[0]?.image_url?.url;
    if (!imageData || !imageData.startsWith("data:image")) {
      await db.from("storyboard_panels").update({ status: "failed" }).eq("id", panelId);
      return json({ error: "No image returned from AI" }, 500);
    }

    // Decode base64
    const base64Part = imageData.split(",")[1];
    const binaryStr = atob(base64Part);
    const bytes = new Uint8Array(binaryStr.length);
    for (let i = 0; i < binaryStr.length; i++) bytes[i] = binaryStr.charCodeAt(i);

    // Upload to storage
    const storagePath = `${projectId}/storyboard-frames/${panelId}_${Date.now()}.png`;
    const { error: uploadErr } = await db.storage.from("storyboards").upload(storagePath, bytes, {
      contentType: "image/png",
      upsert: false,
    });
    if (uploadErr) {
      console.error("Storage upload error:", uploadErr);
      await db.from("storyboard_panels").update({ status: "failed" }).eq("id", panelId);
      return json({ error: "Failed to upload image: " + uploadErr.message }, 500);
    }

    // Get public URL (storyboards bucket is public)
    const { data: urlData } = db.storage.from("storyboards").getPublicUrl(storagePath);
    const publicUrl = urlData?.publicUrl || "";

    // Insert frame record
    const { data: frame, error: frameErr } = await db.from("storyboard_pipeline_frames").insert({
      project_id: projectId,
      panel_id: panelId,
      status: "generated",
      storage_path: storagePath,
      public_url: publicUrl,
      seed: seed || null,
      model: IMAGE_MODEL,
      gen_params: { prompt: finalPrompt, negative_prompt: negativePrompt, style_preset: stylePreset, aspect_ratio: aspectRatio, seed },
      created_by: userId,
    }).select().single();

    if (frameErr) {
      console.error("Frame insert error:", frameErr);
      return json({ error: "Failed to record frame: " + frameErr.message }, 500);
    }

    // Update panel status
    await db.from("storyboard_panels").update({ status: "generated" }).eq("id", panelId);

    return json({ ok: true, frame });
  } catch (err: any) {
    console.error("generate_frame error:", err);
    await db.from("storyboard_panels").update({ status: "failed" }).eq("id", panelId);
    if (err.message === "RATE_LIMIT") return json({ error: "Rate limit exceeded" }, 429);
    if (err.message === "PAYMENT_REQUIRED") return json({ error: "AI credits exhausted" }, 402);
    return json({ error: err.message }, 500);
  }
}

// ─── Main handler ───
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const authHeader = req.headers.get("Authorization") || "";
    if (!authHeader.startsWith("Bearer ")) return json({ error: "Unauthorized" }, 401);
    const token = authHeader.replace("Bearer ", "");
    let userId: string;
    try { userId = parseUserId(token); } catch { return json({ error: "Invalid token" }, 401); }

    const body = await req.json();
    const action = body.action;
    const projectId = body.projectId || body.project_id;
    if (!projectId) return json({ error: "projectId required" }, 400);

    const db = adminClient();

    // Verify access
    const { data: access } = await db.rpc("has_project_access", { _user_id: userId, _project_id: projectId });
    if (!access) return json({ error: "Forbidden" }, 403);

    const apiKey = Deno.env.get("LOVABLE_API_KEY") || "";

    switch (action) {
      case "list_canonical_units": return await handleListCanonicalUnits(db, body);
      case "create_run_and_panels": return await handleCreateRunAndPanels(db, body, userId, apiKey);
      case "list_runs": return await handleListRuns(db, body);
      case "list_panels": return await handleListPanels(db, body);
      case "get_panel": return await handleGetPanel(db, body);
      case "generate_frame": return await handleGenerateFrame(db, body, userId, apiKey);
      case "regenerate_frame": return await handleGenerateFrame(db, body, userId, apiKey);
      default: return json({ error: `Unknown action: ${action}` }, 400);
    }
  } catch (err: any) {
    console.error("storyboard-engine error:", err);
    return json({ error: err.message || "Internal error" }, 500);
  }
});
