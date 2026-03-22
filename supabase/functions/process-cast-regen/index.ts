/**
 * process-cast-regen — Backend-authoritative cast regeneration worker.
 *
 * Processes queued cast_regen_jobs:
 * 1. Claims next job atomically via RPC (FOR UPDATE SKIP LOCKED)
 * 2. Loads original output + generation_params
 * 3. Resolves current cast context via canonical server-safe cast resolver
 * 4. Delegates image generation to shared canonical image gen module
 * 5. Persists new ai_generated_media row with correct cast_provenance
 * 6. Updates job status (completed / failed)
 *
 * Input: { limit?: number } (default 1)
 * No client-side generation. No silent fallbacks. No duplicate logic.
 */
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { resolveGateway } from "../_shared/llm.ts";
import {
  resolveServerCastContext,
  normalizeCharacterKey,
  type ServerCastResult,
} from "../_shared/castResolver.ts";
import {
  generateImageViaGateway,
  uploadToStorage,
} from "../_shared/imageGen.ts";

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

// ── Build regeneration prompt from original params + updated identity ────────

function buildRegenPrompt(
  originalParams: any,
  identity: ServerCastResult,
): string {
  const originalPrompt =
    originalParams?.prompt || originalParams?.gen_params?.prompt || "";

  if (originalPrompt) {
    const identityBlock = identity.actor_name
      ? `CHARACTER IDENTITY: ${identity.actor_name}. ${identity.description || ""}`
      : "";
    return [identityBlock, originalPrompt].filter(Boolean).join("\n\n");
  }

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

  // 2. Resolve current cast identity via canonical server-safe resolver
  const castContext = await resolveServerCastContext(
    db,
    job.project_id,
    job.character_key,
  );

  if (!castContext.bound) {
    console.log(
      `${logPrefix} character "${job.character_key}" has no current binding — skipping`,
    );
    return { status: "skipped", error: "no_cast_binding" };
  }

  const identity = castContext as ServerCastResult;

  // 3. Idempotency check: if output already has current version, skip
  const existingProvenance =
    originalParams?.cast_provenance || originalParams?.cast_context;
  if (Array.isArray(existingProvenance)) {
    const normKey = normalizeCharacterKey(job.character_key);
    const charEntry = existingProvenance.find(
      (p: any) =>
        normalizeCharacterKey(p.character_key || "") === normKey,
    );
    if (charEntry && charEntry.actor_version_id === identity.actor_version_id) {
      console.log(
        `${logPrefix} output already at current version — idempotent skip`,
      );
      return { status: "completed" };
    }
  }

  // 4. Build regeneration prompt
  const prompt = buildRegenPrompt(originalParams, identity);

  const imageModel =
    originalParams?.model ||
    originalParams?.gen_params?.model ||
    "google/gemini-2.5-flash-image";

  console.log(
    `${logPrefix} generating for character="${job.character_key}" actor="${identity.actor_name}" version="${identity.actor_version_id}"`,
  );

  // 5. Generate image via shared canonical image gen module
  const imageResult = await generateImageViaGateway({
    gatewayUrl: gateway.url,
    apiKey: gateway.apiKey,
    model: imageModel,
    prompt,
    referenceImageUrls:
      identity.reference_images.length > 0
        ? identity.reference_images
        : undefined,
  });

  // 6. Upload via shared storage helper
  const timestamp = Date.now();
  const storagePath = `${job.project_id}/regen/${normalizeCharacterKey(job.character_key)}/${timestamp}_${job.id}.png`;

  await uploadToStorage(db, "ai-media", storagePath, imageResult.rawBytes);

  // 7. Build updated cast_provenance
  const normKey = normalizeCharacterKey(job.character_key);
  const updatedProvenance = [
    {
      character_key: normKey,
      actor_id: identity.actor_id,
      actor_version_id: identity.actor_version_id,
    },
  ];

  // Preserve provenance for OTHER characters from original
  if (Array.isArray(existingProvenance)) {
    for (const p of existingProvenance) {
      if (normalizeCharacterKey(p.character_key || "") !== normKey) {
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
    return {
      status: "failed",
      error: `Output insert failed: ${insertErr.message}`,
    };
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
    const anonClient = createClient(
      supabaseUrl,
      Deno.env.get("SUPABASE_ANON_KEY")!,
    );
    const {
      data: { user },
      error: authErr,
    } = await anonClient.auth.getUser(authHeader.replace("Bearer ", ""));
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
      // Atomic claim via RPC (FOR UPDATE SKIP LOCKED)
      const { data: claimedRows, error: claimErr } = await db.rpc(
        "claim_next_cast_regen_job",
      );

      if (claimErr) {
        console.error("[process-cast-regen] claim RPC error:", claimErr);
        break;
      }

      const job = Array.isArray(claimedRows)
        ? claimedRows[0]
        : claimedRows;

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
        await db
          .from("cast_regen_jobs")
          .update({
            status: "completed",
            completed_at: new Date().toISOString(),
            error_message:
              outcome.status === "skipped" ? outcome.error : null,
          })
          .eq("id", job.id);
      } else {
        await db
          .from("cast_regen_jobs")
          .update({
            status: "failed",
            completed_at: new Date().toISOString(),
            error_message: outcome.error || "Unknown error",
          })
          .eq("id", job.id);
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
