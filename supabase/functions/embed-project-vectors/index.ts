/**
 * embed-project-vectors — Generate multi-surface embedding vectors for a project.
 * Stores in project_vectors table. Idempotent via source_hash dedup.
 */
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { createEmbedding, DIMENSION, EMBEDDING_MODEL } from "../_shared/embeddingProvider.ts";
import {
  ALL_PROJECT_VECTOR_TYPES,
  PROJECT_VECTOR_DOC_MAP,
  buildProjectEmbeddingText,
  sha256Hash,
} from "../_shared/embeddingText.ts";

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

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  // Ping
  if (req.method === "GET") {
    return json({ ok: true, build: "embed-project-vectors-v1" });
  }

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) throw new Error("Missing auth header");

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const lovableKey = Deno.env.get("OPENROUTER_API_KEY");
    if (!lovableKey) throw new Error("OPENROUTER_API_KEY not configured");

    // Verify user
    const userClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: { user }, error: authErr } = await userClient.auth.getUser();
    if (authErr || !user) throw new Error("Unauthorized");

    const body = await req.json();
    const projectId = body.project_id;
    if (!projectId) throw new Error("project_id required");

    // Verify access
    const sb = createClient(supabaseUrl, serviceKey);
    const { data: hasAccess } = await sb.rpc("has_project_access", {
      _user_id: user.id,
      _project_id: projectId,
    });
    if (!hasAccess) return json({ error: "Forbidden" }, 403);

    const requestedTypes = body.vector_types && Array.isArray(body.vector_types)
      ? body.vector_types.filter((t: string) => ALL_PROJECT_VECTOR_TYPES.includes(t))
      : ALL_PROJECT_VECTOR_TYPES;

    // Get project metadata
    const { data: project } = await sb
      .from("projects")
      .select("title, genre, format")
      .eq("id", projectId)
      .single();
    if (!project) throw new Error("Project not found");

    // Collect all needed doc_types
    const allDocTypes = new Set<string>();
    for (const vt of requestedTypes) {
      for (const dt of PROJECT_VECTOR_DOC_MAP[vt] || []) {
        allDocTypes.add(dt);
      }
    }

    // Fetch latest doc version plaintext for each doc_type
    const docTexts: Record<string, string> = {};
    for (const dt of allDocTypes) {
      const { data: doc } = await sb
        .from("project_documents")
        .select("latest_version_id")
        .eq("project_id", projectId)
        .eq("doc_type", dt)
        .limit(1)
        .maybeSingle();

      if (doc?.latest_version_id) {
        const { data: ver } = await sb
          .from("project_document_versions")
          .select("plaintext")
          .eq("id", doc.latest_version_id)
          .maybeSingle();
        if (ver?.plaintext) {
          docTexts[dt] = ver.plaintext;
        }
      }
    }

    // Get existing vectors for dedup
    const { data: existingVectors } = await sb
      .from("project_vectors")
      .select("vector_type, source_hash, created_at")
      .eq("project_id", projectId)
      .order("created_at", { ascending: false });

    const latestHashByType: Record<string, string> = {};
    for (const v of existingVectors || []) {
      if (!latestHashByType[v.vector_type] && v.source_hash) {
        latestHashByType[v.vector_type] = v.source_hash;
      }
    }

    // Process each vector type
    const details: any[] = [];
    let createdCount = 0;
    let skippedCount = 0;

    for (const vectorType of requestedTypes) {
      const embeddingText = buildProjectEmbeddingText(
        vectorType,
        project.title,
        project.genre,
        project.format,
        docTexts,
      );

      if (!embeddingText) {
        details.push({ vector_type: vectorType, status: "skipped", reason: "no_source_text" });
        skippedCount++;
        continue;
      }

      const hash = await sha256Hash(embeddingText);

      // Dedup check
      if (latestHashByType[vectorType] === hash) {
        details.push({ vector_type: vectorType, status: "skipped", reason: "same_hash" });
        skippedCount++;
        continue;
      }

      try {
        const embedding = await createEmbedding(embeddingText, lovableKey);

        const { data: newId, error: insertErr } = await sb.rpc("insert_project_vector", {
          _project_id: projectId,
          _vector_type: vectorType,
          _embedding: embedding,
          _embedding_model: EMBEDDING_MODEL,
          _source_hash: hash,
          _source_len: embeddingText.length,
          _source_meta: {
            source_preview: embeddingText.slice(0, 200),
            generated_at: new Date().toISOString(),
            provider: "lovable_ai_gateway",
            trigger: body.trigger || "manual",
          },
        });

        if (insertErr) {
          details.push({ vector_type: vectorType, status: "error", error: insertErr.message });
        } else if (newId === null) {
          details.push({ vector_type: vectorType, status: "skipped", reason: "same_hash_in_db" });
          skippedCount++;
        } else {
          details.push({ vector_type: vectorType, status: "created", hash, len: embeddingText.length });
          createdCount++;
        }
      } catch (e: any) {
        details.push({ vector_type: vectorType, status: "error", error: e.message });
      }

      // Small delay between embeddings to avoid rate limits
      await new Promise(r => setTimeout(r, 300));
    }

    return json({
      ok: true,
      project_id: projectId,
      created_count: createdCount,
      skipped_count: skippedCount,
      details,
    });
  } catch (e: any) {
    console.error("[embed-project-vectors] error:", e);
    const status = e.message?.includes("RATE_LIMIT") ? 429 : e.message?.includes("PAYMENT") ? 402 : 400;
    return json({ error: e.message || "Unknown error" }, status);
  }
});
