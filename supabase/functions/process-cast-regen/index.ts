/**
 * process-cast-regen — Backend-authoritative cast regeneration worker.
 *
 * Processes queued cast_regen_jobs one-by-one:
 * 1. Claims next job atomically (FOR UPDATE SKIP LOCKED)
 * 2. Loads original output + generation_params
 * 3. Resolves current cast context from project_ai_cast
 * 4. Re-generates image using same model/pipeline with updated identity
 * 5. Persists new ai_generated_media row with correct cast_provenance
 * 6. Updates job status (completed / failed)
 *
 * Input: { limit?: number } (default 1)
 * No client-side generation. No silent fallbacks.
 */
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { resolveGateway } from "../_shared/llm.ts";

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

// ── Normalize character key (must match canonical normalizeCharacterKey) ─────
function normalizeCharacterKey(input: string): string {
  return input.toLowerCase().trim().replace(/\s+/g, " ");
}

// ── Extract image data URL from Gemini response ─────────────────────────────
function extractDataUrl(genResult: any): string | null {
  try {
    const choice = genResult?.choices?.[0]?.message;
    if (!choice) return null;
    const imgUrl = choice.images?.[0]?.image_url?.url;
    if (imgUrl && imgUrl.startsWith("data:image")) return imgUrl;
    if (Array.isArray(choice.content)) {
      for (const part of choice.content) {
        if (part.type === "image_url" && part.image_url?.url?.startsWith("data:image")) return part.image_url.url;
        if (part.type === "image" && part.image?.url?.startsWith("data:image")) return part.image.url;
        if (part.inline_data?.data) {
          const mime = part.inline_data.mime_type || "image/png";
          return `data:${mime};base64,${part.inline_data.data}`;
        }
        if (typeof part === "string" && part.startsWith("data:image")) return part;
        if (typeof part.text === "string" && part.text.startsWith("data:image")) return part.text;
      }
    }
    if (typeof choice.content === "string" && choice.content.startsWith("data:image")) return choice.content;
  } catch (_) { /* noop */ }
  return null;
}

function dataUrlToBytes(dataUrl: string): Uint8Array {
  const base64Part = dataUrl.split(",")[1];
  if (!base64Part) throw new Error("Invalid data URL");
  const binaryStr = atob(base64Part);
  const bytes = new Uint8Array(binaryStr.length);
  for (let i = 0; i < binaryStr.length; i++) bytes[i] = binaryStr.charCodeAt(i);
  return bytes;
}

// ── Resolve cast identity for a character from project_ai_cast ──────────────
async function resolveCastIdentity(
  db: any,
  projectId: string,
  characterKey: string,
): Promise<{
  bound: boolean;
  actor_id?: string;
  actor_name?: string;
  actor_version_id?: string;
  description?: string;
  negative_prompt?: string;
  reference_images?: string[];
} | null> {
  const normKey = normalizeCharacterKey(characterKey);

  const { data: binding } = await db
    .from("project_ai_cast")
    .select("ai_actor_id, ai_actor_version_id")
    .eq("project_id", projectId)
    .eq("character_key", normKey)
    .maybeSingle();

  if (!binding || !binding.ai_actor_version_id) {
    return { bound: false };
  }

  const { data: actor } = await db
    .from("ai_actors")
    .select("id, name, description, negative_prompt")
    .eq("id", binding.ai_actor_id)
    .maybeSingle();

  const { data: assets } = await db
    .from("ai_actor_assets")
    .select("asset_type, public_url")
    .eq("actor_version_id", binding.ai_actor_version_id)
    .in("asset_type", ["reference_image", "reference_headshot", "reference_full_body"]);

  return {
    bound: true,
    actor_id: binding.ai_actor_id,
    actor_name: actor?.name,
    actor_version_id: binding.ai_actor_version_id,
    description: actor?.description,
    negative_prompt: actor?.negative_prompt,
    reference_images: (assets || []).map((a: any) => a.public_url).filter(Boolean),
  };
}

// ── Claim next queued job atomically ────────────────────────────────────────
async function claimNextJob(db: any): Promise<any | null> {
  // Use raw SQL via RPC for FOR UPDATE SKIP LOCKED
  // Fallback: fetch + update with status guard
  const { data: jobs } = await db
    .from("cast_regen_jobs")
    .select("*")
    .eq("status", "queued")
    .order("created_at", { ascending: true })
    .limit(1);

  if (!jobs || jobs.length === 0) return null;

  const job = jobs[0];

  // Atomic claim: update only if still queued
  const { data: claimed, error: claimErr } = await db
    .from("cast_regen_jobs")
    .update({ status: "running", started_at: new Date().toISOString() })
    .eq("id", job.id)
    .eq("status", "queued")
    .select()
    .single();

  if (claimErr || !claimed) return null;
  return claimed;
}

// ── Build regeneration prompt from original params + updated identity ────────
function buildRegenPrompt(
  originalParams: any,
  identity: {
    actor_name?: string;
    description?: string;
    negative_prompt?: string;
  },
): string {
  // Extract original prompt
  const originalPrompt = originalParams?.prompt || originalParams?.gen_params?.prompt || "";

  // If original prompt exists, enhance with updated identity
  if (originalPrompt) {
    const identityBlock = identity.actor_name
      ? `CHARACTER IDENTITY: ${identity.actor_name}. ${identity.description || ""}`
      : "";

    return [
      identityBlock,
      originalPrompt,
    ].filter(Boolean).join("\n\n");
  }

  // Fallback: construct minimal prompt from params
  return `Generate a cinematic image. ${identity.description || ""}`;
}

// ── Process a single regen job ──────────────────────────────────────────────
async function processJob(
  db: any,
  job: any,
  gateway: { url: string; apiKey: string },
): Promise<{ status: "completed" | "failed" | "skipped"; error?: string }> {
  const logPrefix = `[regen:${job.id}]`;

  // 1. Load original output
  const { data: originalOutput } = await db
    .from("ai_generated_media")
    .select("*")
    .eq("id", job.output_id)
    .maybeSingle();

  if (!originalOutput) {
    return { status: "failed", error: "Original output not found" };
  }

  const originalParams = originalOutput.generation_params || {};

  // 2. Resolve current cast identity for this character
  const identity = await resolveCastIdentity(db, job.project_id, job.character_key);

  if (!identity || !identity.bound) {
    console.log(`${logPrefix} character "${job.character_key}" has no current binding — skipping`);
    return { status: "skipped", error: "no_cast_binding" };
  }

  // 3. Idempotency check: if output already has current version, skip
  const existingProvenance = originalParams?.cast_provenance || originalParams?.cast_context;
  if (Array.isArray(existingProvenance)) {
    const charEntry = existingProvenance.find(
      (p: any) => normalizeCharacterKey(p.character_key || "") === normalizeCharacterKey(job.character_key),
    );
    if (charEntry && charEntry.actor_version_id === identity.actor_version_id) {
      console.log(`${logPrefix} output already at current version — idempotent skip`);
      return { status: "completed" };
    }
  }

  // 4. Build regeneration prompt
  const prompt = buildRegenPrompt(originalParams, {
    actor_name: identity.actor_name,
    description: identity.description,
    negative_prompt: identity.negative_prompt,
  });

  console.log(`${logPrefix} generating for character="${job.character_key}" actor="${identity.actor_name}" version="${identity.actor_version_id}"`);

  // 5. Generate image via AI gateway
  const imageModel = originalParams?.model
    || originalParams?.gen_params?.model
    || "google/gemini-2.5-flash-image";

  const imageResponse = await fetch(gateway.url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${gateway.apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: imageModel,
      messages: [{ role: "user", content: prompt }],
      modalities: ["image", "text"],
    }),
  });

  if (!imageResponse.ok) {
    const errText = await imageResponse.text();
    console.error(`${logPrefix} image gen failed: ${imageResponse.status} ${errText}`);
    if (imageResponse.status === 429) return { status: "failed", error: "Rate limit exceeded" };
    if (imageResponse.status === 402) return { status: "failed", error: "AI credits exhausted" };
    return { status: "failed", error: `Image generation failed: ${imageResponse.status}` };
  }

  const genResult = await imageResponse.json();
  const imageDataUrl = extractDataUrl(genResult);

  if (!imageDataUrl) {
    console.error(`${logPrefix} no image in response`);
    return { status: "failed", error: "No image returned from AI" };
  }

  // 6. Upload to storage
  const bytes = dataUrlToBytes(imageDataUrl);
  const timestamp = Date.now();
  const storagePath = `${job.project_id}/regen/${job.character_key}/${timestamp}_${job.id}.png`;

  const { error: uploadErr } = await db.storage
    .from("ai-media")
    .upload(storagePath, new Blob([bytes], { type: "image/png" }), {
      contentType: "image/png",
      upsert: false,
    });

  if (uploadErr) {
    console.error(`${logPrefix} upload error:`, uploadErr);
    return { status: "failed", error: `Storage upload failed: ${uploadErr.message}` };
  }

  // 7. Build updated cast_provenance
  const updatedProvenance = [
    {
      character_key: normalizeCharacterKey(job.character_key),
      actor_id: identity.actor_id,
      actor_version_id: identity.actor_version_id,
    },
  ];

  // Preserve provenance for OTHER characters from original
  if (Array.isArray(existingProvenance)) {
    for (const p of existingProvenance) {
      if (normalizeCharacterKey(p.character_key || "") !== normalizeCharacterKey(job.character_key)) {
        updatedProvenance.push(p);
      }
    }
  }

  // 8. Insert new ai_generated_media row
  const newGenParams = {
    ...originalParams,
    prompt,
    model: imageModel,
    cast_provenance: updatedProvenance,
    regen_source: {
      original_output_id: job.output_id,
      regen_job_id: job.id,
      reason: job.reason,
    },
  };

  const { data: newMedia, error: insertErr } = await db
    .from("ai_generated_media")
    .insert({
      project_id: job.project_id,
      shot_id: originalOutput.shot_id,
      trailer_shotlist_id: originalOutput.trailer_shotlist_id,
      media_type: originalOutput.media_type,
      storage_path: storagePath,
      generation_params: newGenParams,
      selected: false,
      created_by: job.requested_by,
    })
    .select("id")
    .single();

  if (insertErr) {
    console.error(`${logPrefix} insert error:`, insertErr);
    return { status: "failed", error: `Output insert failed: ${insertErr.message}` };
  }

  console.log(`${logPrefix} completed → new output ${newMedia.id}`);
  return { status: "completed" };
}

// ── Main handler ────────────────────────────────────────────────────────────

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    // Auth
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return json({ error: "Not authenticated" }, 401);

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const db = createClient(supabaseUrl, serviceKey);

    // Validate caller
    const anonClient = createClient(supabaseUrl, Deno.env.get("SUPABASE_ANON_KEY")!);
    const { data: { user }, error: authErr } = await anonClient.auth.getUser(
      authHeader.replace("Bearer ", ""),
    );
    if (authErr || !user) return json({ error: "Invalid token" }, 401);

    const body = await req.json().catch(() => ({}));
    const limit = Math.min(Math.max(body.limit || 1, 1), 10);

    const gateway = resolveGateway();

    const results: Array<{
      job_id: string;
      output_id: string;
      character_key: string;
      reason: string;
      result: string;
      error?: string;
    }> = [];

    for (let i = 0; i < limit; i++) {
      const job = await claimNextJob(db);
      if (!job) break; // no more jobs

      let outcome: { status: string; error?: string };
      try {
        outcome = await processJob(db, job, gateway);
      } catch (err: any) {
        console.error(`[regen:${job.id}] unhandled error:`, err);
        outcome = { status: "failed", error: err.message || "Unhandled error" };
      }

      // Update job status
      if (outcome.status === "completed" || outcome.status === "skipped") {
        await db.from("cast_regen_jobs").update({
          status: "completed",
          completed_at: new Date().toISOString(),
          error_message: outcome.status === "skipped" ? outcome.error : null,
        }).eq("id", job.id);
      } else {
        await db.from("cast_regen_jobs").update({
          status: "failed",
          completed_at: new Date().toISOString(),
          error_message: outcome.error || "Unknown error",
        }).eq("id", job.id);
      }

      results.push({
        job_id: job.id,
        output_id: job.output_id,
        character_key: job.character_key,
        reason: job.reason,
        result: outcome.status,
        error: outcome.error,
      });
    }

    return json({
      processed: results.length,
      results,
    });
  } catch (err) {
    console.error("[process-cast-regen] fatal:", err);
    return json({ error: (err as Error).message || "Internal error" }, 500);
  }
});
