/**
 * trailer-clip-generator — Multi-provider clip generation for trailer beats.
 * Providers: stub, elevenlabs_sfx, elevenlabs_music, gateway_i2v (image-to-video via AI gateway)
 */
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { encode as base64Encode } from "https://deno.land/std@0.168.0/encoding/base64.ts";

const STORAGE_BUCKET = "storyboards";
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

async function verifyAccess(db: any, userId: string, projectId: string): Promise<boolean> {
  const { data } = await db.rpc("has_project_access", { _user_id: userId, _project_id: projectId });
  return !!data;
}

// ─── Provider: ElevenLabs SFX ───
async function generateElevenLabsSfx(prompt: string, durationS: number): Promise<ArrayBuffer> {
  const apiKey = Deno.env.get("ELEVENLABS_API_KEY");
  if (!apiKey) throw new Error("ELEVENLABS_API_KEY not configured");

  const resp = await fetch("https://api.elevenlabs.io/v1/sound-generation", {
    method: "POST",
    headers: { "xi-api-key": apiKey, "Content-Type": "application/json" },
    body: JSON.stringify({
      text: prompt,
      duration_seconds: Math.min(durationS, 22),
      prompt_influence: 0.3,
    }),
  });
  if (!resp.ok) throw new Error(`ElevenLabs SFX failed: ${resp.status}`);
  return resp.arrayBuffer();
}

// ─── Provider: ElevenLabs Music ───
async function generateElevenLabsMusic(prompt: string, durationS: number): Promise<ArrayBuffer> {
  const apiKey = Deno.env.get("ELEVENLABS_API_KEY");
  if (!apiKey) throw new Error("ELEVENLABS_API_KEY not configured");

  const resp = await fetch("https://api.elevenlabs.io/v1/music", {
    method: "POST",
    headers: { "xi-api-key": apiKey, "Content-Type": "application/json" },
    body: JSON.stringify({
      prompt,
      duration_seconds: Math.min(durationS, 120),
    }),
  });
  if (!resp.ok) throw new Error(`ElevenLabs Music failed: ${resp.status}`);
  return resp.arrayBuffer();
}

// ─── Provider: AI Gateway Image-to-Video (generates a still frame as placeholder for v1) ───
async function generateGatewayFrame(prompt: string, apiKey: string): Promise<{ bytes: Uint8Array; mimeType: string }> {
  const resp = await fetch(GATEWAY_URL, {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: IMAGE_MODEL,
      messages: [{ role: "user", content: prompt }],
      modalities: ["image", "text"],
    }),
  });
  if (!resp.ok) {
    if (resp.status === 429) throw new Error("RATE_LIMIT");
    if (resp.status === 402) throw new Error("PAYMENT_REQUIRED");
    throw new Error(`AI gateway error: ${resp.status}`);
  }
  const result = await resp.json();
  const choice = result?.choices?.[0]?.message;
  let dataUrl: string | null = null;

  // Extract image data URL from various response shapes
  if (Array.isArray(choice?.content)) {
    for (const part of choice.content) {
      if (part.type === "image_url" && part.image_url?.url?.startsWith("data:image")) { dataUrl = part.image_url.url; break; }
      if (part.inline_data?.data) { dataUrl = `data:${part.inline_data.mime_type || "image/png"};base64,${part.inline_data.data}`; break; }
    }
  }
  if (!dataUrl && typeof choice?.content === "string" && choice.content.startsWith("data:image")) {
    dataUrl = choice.content;
  }
  if (!dataUrl) throw new Error("No image returned from AI gateway");

  const base64Part = dataUrl.split(",")[1];
  const binaryStr = atob(base64Part);
  const bytes = new Uint8Array(binaryStr.length);
  for (let i = 0; i < binaryStr.length; i++) bytes[i] = binaryStr.charCodeAt(i);
  return { bytes, mimeType: "image/png" };
}

// ─── Provider: Stub (placeholder) ───
function generateStub(): { bytes: Uint8Array; mimeType: string } {
  // Return a tiny 1x1 PNG as placeholder
  const png = new Uint8Array([
    0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d,
    0x49, 0x48, 0x44, 0x52, 0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01,
    0x08, 0x02, 0x00, 0x00, 0x00, 0x90, 0x77, 0x53, 0xde, 0x00, 0x00, 0x00,
    0x0c, 0x49, 0x44, 0x41, 0x54, 0x08, 0xd7, 0x63, 0xf8, 0xcf, 0xc0, 0x00,
    0x00, 0x00, 0x02, 0x00, 0x01, 0xe2, 0x21, 0xbc, 0x33, 0x00, 0x00, 0x00,
    0x00, 0x49, 0x45, 0x4e, 0x44, 0xae, 0x42, 0x60, 0x82,
  ]);
  return { bytes: png, mimeType: "image/png" };
}

// ─── Generate clips for beats ───
async function handleGenerateClips(db: any, body: any, userId: string, apiKey: string) {
  const { projectId, blueprintId, beatIndices, provider = "stub", candidateCount = 1 } = body;
  if (!blueprintId) return json({ error: "blueprintId required" }, 400);

  const { data: bp } = await db.from("trailer_blueprints").select("*")
    .eq("id", blueprintId).eq("project_id", projectId).single();
  if (!bp) return json({ error: "Blueprint not found" }, 404);

  const edl = bp.edl || [];
  const indices = beatIndices || edl.map((_: any, i: number) => i);

  const results: any[] = [];

  for (const idx of indices) {
    const beat = edl[idx];
    if (!beat) continue;

    for (let c = 0; c < candidateCount; c++) {
      const clipSpec = beat.clip_spec || {};
      const durationS = beat.duration_s || 3;
      let effectiveProvider = provider;

      // Auto-select provider based on media type
      if (beat.role === "title_card") effectiveProvider = "stub";

      const clipRow: any = {
        project_id: projectId,
        blueprint_id: blueprintId,
        beat_index: idx,
        provider: effectiveProvider,
        status: "generating",
        media_type: effectiveProvider.startsWith("elevenlabs_") ? (effectiveProvider === "elevenlabs_music" ? "music" : "sfx") : "video",
        duration_ms: Math.round(durationS * 1000),
        gen_params: { beat_role: beat.role, clip_spec: clipSpec, candidate: c },
        created_by: userId,
      };

      const { data: clip, error: clipErr } = await db.from("trailer_clips").insert(clipRow).select().single();
      if (clipErr) { results.push({ error: clipErr.message, beat_index: idx }); continue; }

      try {
        let storagePath: string;
        let publicUrl: string;

        if (effectiveProvider === "elevenlabs_sfx") {
          const audio = await generateElevenLabsSfx(clipSpec.audio_cue || clipSpec.action_description || "dramatic sound", durationS);
          storagePath = `${projectId}/trailer-clips/${blueprintId}/${clip.id}.mp3`;
          const blob = new Blob([audio], { type: "audio/mpeg" });
          await db.storage.from(STORAGE_BUCKET).upload(storagePath, blob, { contentType: "audio/mpeg", upsert: true });
          clipRow.media_type = "sfx";
        } else if (effectiveProvider === "elevenlabs_music") {
          const audio = await generateElevenLabsMusic(clipSpec.audio_cue || "cinematic trailer music", durationS);
          storagePath = `${projectId}/trailer-clips/${blueprintId}/${clip.id}.mp3`;
          const blob = new Blob([audio], { type: "audio/mpeg" });
          await db.storage.from(STORAGE_BUCKET).upload(storagePath, blob, { contentType: "audio/mpeg", upsert: true });
          clipRow.media_type = "music";
        } else if (effectiveProvider === "gateway_i2v") {
          const { bytes, mimeType } = await generateGatewayFrame(
            clipSpec.visual_prompt || clipSpec.action_description || "cinematic scene",
            apiKey
          );
          storagePath = `${projectId}/trailer-clips/${blueprintId}/${clip.id}.png`;
          const blob = new Blob([bytes], { type: mimeType });
          await db.storage.from(STORAGE_BUCKET).upload(storagePath, blob, { contentType: mimeType, upsert: true });
        } else {
          // Stub provider
          const { bytes, mimeType } = generateStub();
          storagePath = `${projectId}/trailer-clips/${blueprintId}/${clip.id}.png`;
          const blob = new Blob([bytes], { type: mimeType });
          await db.storage.from(STORAGE_BUCKET).upload(storagePath, blob, { contentType: mimeType, upsert: true });
        }

        // Get public URL
        const { data: pubData } = db.storage.from(STORAGE_BUCKET).getPublicUrl(storagePath!);
        publicUrl = pubData?.publicUrl || "";

        await db.from("trailer_clips").update({
          status: "complete",
          storage_path: storagePath,
          public_url: publicUrl,
        }).eq("id", clip.id);

        results.push({ clipId: clip.id, beat_index: idx, status: "complete", publicUrl });
      } catch (err: any) {
        await db.from("trailer_clips").update({ status: "failed", error: err.message }).eq("id", clip.id);
        results.push({ clipId: clip.id, beat_index: idx, status: "failed", error: err.message });
      }
    }
  }

  return json({ ok: true, results });
}

async function handleListClips(db: any, body: any) {
  const { projectId, blueprintId } = body;
  if (!blueprintId) return json({ error: "blueprintId required" }, 400);
  const { data } = await db.from("trailer_clips").select("*")
    .eq("project_id", projectId).eq("blueprint_id", blueprintId)
    .order("beat_index").order("created_at", { ascending: false });
  return json({ clips: data || [] });
}

async function handleRateClip(db: any, body: any) {
  const { projectId, clipId, rating } = body;
  if (!clipId) return json({ error: "clipId required" }, 400);
  const { error } = await db.from("trailer_clips").update({ rating })
    .eq("id", clipId).eq("project_id", projectId);
  if (error) return json({ error: error.message }, 500);
  return json({ ok: true });
}

async function handleSelectClip(db: any, body: any) {
  const { projectId, clipId, blueprintId, beatIndex } = body;
  if (!clipId) return json({ error: "clipId required" }, 400);
  // Deselect all other clips for same beat
  await db.from("trailer_clips")
    .update({ used_in_cut: false })
    .eq("blueprint_id", blueprintId).eq("beat_index", beatIndex).eq("project_id", projectId);
  // Select this one
  await db.from("trailer_clips").update({ used_in_cut: true, status: "selected" })
    .eq("id", clipId).eq("project_id", projectId);
  return json({ ok: true });
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
    const hasAccess = await verifyAccess(db, userId, projectId);
    if (!hasAccess) return json({ error: "Forbidden" }, 403);

    const apiKey = Deno.env.get("LOVABLE_API_KEY") || "";

    switch (action) {
      case "generate_clips": return await handleGenerateClips(db, body, userId, apiKey);
      case "list_clips": return await handleListClips(db, body);
      case "rate_clip": return await handleRateClip(db, body);
      case "select_clip": return await handleSelectClip(db, body);
      default: return json({ error: `Unknown action: ${action}` }, 400);
    }
  } catch (err: any) {
    console.error("trailer-clip-generator error:", err);
    return json({ error: err.message || "Internal error" }, 500);
  }
});
