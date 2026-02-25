import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { MODELS } from "../_shared/llm.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const EMBEDDING_MODEL = "text-embedding-3-small";
const BATCH_SIZE = 20; // chunks per embedding request
const DIMENSION = 1536;

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) throw new Error("Missing auth header");

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const lovableKey = Deno.env.get("LOVABLE_API_KEY");
    if (!lovableKey) throw new Error("LOVABLE_API_KEY not configured");

    // Verify user
    const userClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: { user }, error: authErr } = await userClient.auth.getUser();
    if (authErr || !user) throw new Error("Unauthorized");

    const adminClient = createClient(supabaseUrl, supabaseKey);
    const { action, ...params } = await req.json();

    if (action === "embed_script") {
      return await handleEmbedScript(adminClient, user.id, params, lovableKey, corsHeaders);
    } else if (action === "embed_pending") {
      return await handleEmbedPending(adminClient, user.id, lovableKey, corsHeaders);
    } else if (action === "semantic_search") {
      return await handleSemanticSearch(adminClient, user.id, params, lovableKey, corsHeaders);
    } else {
      throw new Error(`Unknown action: ${action}`);
    }
  } catch (e) {
    console.error("embed-corpus error:", e);
    const status = e instanceof Error && e.message.includes("Rate limit") ? 429 : 400;
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }), {
      status,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});

// ── Embed all chunks for a single script ─────────────────────────────

async function handleEmbedScript(
  db: ReturnType<typeof createClient>,
  userId: string,
  params: { script_id: string },
  apiKey: string,
  cors: Record<string, string>,
) {
  const { script_id } = params;
  if (!script_id) throw new Error("script_id required");

  // Verify ownership
  const { data: script, error: scriptErr } = await db
    .from("corpus_scripts")
    .select("id, user_id")
    .eq("id", script_id)
    .eq("user_id", userId)
    .single();
  if (scriptErr || !script) throw new Error("Script not found or not owned by user");

  // Get pending chunks
  const { data: chunks, error: chunkErr } = await db
    .from("corpus_chunks")
    .select("id, chunk_text")
    .eq("script_id", script_id)
    .eq("user_id", userId)
    .in("embedding_status", ["pending", "error"])
    .order("chunk_index", { ascending: true });

  if (chunkErr) throw new Error(`Failed to fetch chunks: ${chunkErr.message}`);
  if (!chunks || chunks.length === 0) {
    return new Response(JSON.stringify({ embedded: 0, message: "No pending chunks" }), {
      headers: { ...cors, "Content-Type": "application/json" },
    });
  }

  // Mark as processing
  const chunkIds = chunks.map(c => c.id);
  await db.from("corpus_chunks").update({ embedding_status: "processing" }).in("id", chunkIds);

  let embedded = 0;
  let errors = 0;

  // Process in batches
  for (let i = 0; i < chunks.length; i += BATCH_SIZE) {
    const batch = chunks.slice(i, i + BATCH_SIZE);
    try {
      const embeddings = await generateEmbeddings(
        batch.map(c => c.chunk_text),
        apiKey,
      );

      // Update each chunk with its embedding
      for (let j = 0; j < batch.length; j++) {
        const embedding = embeddings[j];
        if (embedding && embedding.length === DIMENSION) {
          const { error: updateErr } = await db
            .from("corpus_chunks")
            .update({
              embedding: JSON.stringify(embedding),
              embedding_status: "ready",
              embedding_model: EMBEDDING_MODEL,
              embedding_updated_at: new Date().toISOString(),
            })
            .eq("id", batch[j].id);
          if (updateErr) {
            console.error(`Update error for chunk ${batch[j].id}:`, updateErr);
            errors++;
          } else {
            embedded++;
          }
        } else {
          await db.from("corpus_chunks").update({ embedding_status: "error" }).eq("id", batch[j].id);
          errors++;
        }
      }

      // Small delay between batches to avoid rate limits
      if (i + BATCH_SIZE < chunks.length) {
        await new Promise(r => setTimeout(r, 500));
      }
    } catch (batchErr) {
      console.error(`Batch error at offset ${i}:`, batchErr);
      // Mark remaining batch as error
      for (const c of batch) {
        await db.from("corpus_chunks").update({ embedding_status: "error" }).eq("id", c.id);
      }
      errors += batch.length;

      if (batchErr instanceof Error && (batchErr.message.includes("429") || batchErr.message.includes("Rate limit"))) {
        // Stop processing on rate limit
        break;
      }
    }
  }

  return new Response(JSON.stringify({ embedded, errors, total: chunks.length }), {
    headers: { ...cors, "Content-Type": "application/json" },
  });
}

// ── Embed all pending chunks across all scripts ──────────────────────

async function handleEmbedPending(
  db: ReturnType<typeof createClient>,
  userId: string,
  apiKey: string,
  cors: Record<string, string>,
) {
  // Get all scripts with pending chunks
  const { data: scripts, error: scriptErr } = await db
    .from("corpus_scripts")
    .select("id")
    .eq("user_id", userId)
    .eq("ingestion_status", "complete");

  if (scriptErr || !scripts) throw new Error("Failed to fetch scripts");

  let totalEmbedded = 0;
  let totalErrors = 0;
  let scriptsProcessed = 0;

  for (const script of scripts) {
    const { data: pendingCount } = await db
      .from("corpus_chunks")
      .select("id", { count: "exact", head: true })
      .eq("script_id", script.id)
      .eq("user_id", userId)
      .in("embedding_status", ["pending", "error"]);

    if (!pendingCount || (pendingCount as any).length === 0) continue;

    // Delegate to per-script handler (reuse logic)
    const { data: chunks } = await db
      .from("corpus_chunks")
      .select("id, chunk_text")
      .eq("script_id", script.id)
      .eq("user_id", userId)
      .in("embedding_status", ["pending", "error"])
      .order("chunk_index", { ascending: true })
      .limit(200); // Cap per script

    if (!chunks || chunks.length === 0) continue;

    await db.from("corpus_chunks").update({ embedding_status: "processing" }).in("id", chunks.map(c => c.id));

    for (let i = 0; i < chunks.length; i += BATCH_SIZE) {
      const batch = chunks.slice(i, i + BATCH_SIZE);
      try {
        const embeddings = await generateEmbeddings(batch.map(c => c.chunk_text), apiKey);
        for (let j = 0; j < batch.length; j++) {
          const embedding = embeddings[j];
          if (embedding && embedding.length === DIMENSION) {
            await db.from("corpus_chunks").update({
              embedding: JSON.stringify(embedding),
              embedding_status: "ready",
              embedding_model: EMBEDDING_MODEL,
              embedding_updated_at: new Date().toISOString(),
            }).eq("id", batch[j].id);
            totalEmbedded++;
          } else {
            await db.from("corpus_chunks").update({ embedding_status: "error" }).eq("id", batch[j].id);
            totalErrors++;
          }
        }
        if (i + BATCH_SIZE < chunks.length) await new Promise(r => setTimeout(r, 500));
      } catch (batchErr) {
        console.error(`Batch error:`, batchErr);
        for (const c of batch) {
          await db.from("corpus_chunks").update({ embedding_status: "error" }).eq("id", c.id);
        }
        totalErrors += batch.length;
        if (batchErr instanceof Error && batchErr.message.includes("429")) break;
      }
    }
    scriptsProcessed++;
  }

  return new Response(JSON.stringify({ embedded: totalEmbedded, errors: totalErrors, scripts_processed: scriptsProcessed }), {
    headers: { ...cors, "Content-Type": "application/json" },
  });
}

// ── Semantic search ──────────────────────────────────────────────────

async function handleSemanticSearch(
  db: ReturnType<typeof createClient>,
  userId: string,
  params: { query: string; limit?: number; script_id?: string },
  apiKey: string,
  cors: Record<string, string>,
) {
  const { query, limit = 12, script_id } = params;
  if (!query) throw new Error("query required");

  // Generate query embedding
  const embeddings = await generateEmbeddings([query], apiKey);
  const queryEmbedding = embeddings[0];
  if (!queryEmbedding || queryEmbedding.length !== DIMENSION) {
    throw new Error("Failed to generate query embedding");
  }

  // Call the semantic search function
  const { data, error } = await db.rpc("search_corpus_semantic", {
    query_embedding: JSON.stringify(queryEmbedding),
    match_count: limit,
    filter_script_id: script_id || null,
  });

  if (error) throw new Error(`Semantic search failed: ${error.message}`);

  // Enrich with script metadata
  const scriptIds = [...new Set((data || []).map((r: any) => r.script_id))];
  let scripts: any[] = [];
  if (scriptIds.length > 0) {
    const { data: scriptData } = await db
      .from("corpus_scripts")
      .select("id, title, approved_sources(title)")
      .in("id", scriptIds);
    scripts = scriptData || [];
  }

  return new Response(JSON.stringify({ chunks: data || [], scripts }), {
    headers: { ...cors, "Content-Type": "application/json" },
  });
}

// ── Generate embeddings via Lovable AI gateway ───────────────────────

async function generateEmbeddings(texts: string[], apiKey: string): Promise<number[][]> {
  // Use Gemini to generate embeddings via the completions API with a structured output approach
  // Since the gateway is OpenAI-compatible, we use the embeddings endpoint pattern
  // But the Lovable AI gateway only supports chat completions, so we use a tool-calling approach

  const resp = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: MODELS.FAST_LITE,
      messages: [
        {
          role: "system",
          content: `You are an embedding generator. For each input text, produce a ${DIMENSION}-dimensional numerical embedding vector. The vectors should capture semantic meaning for similarity search over screenplay content. Return the embeddings via the tool call.`,
        },
        {
          role: "user",
          content: `Generate ${DIMENSION}-dimensional embedding vectors for the following ${texts.length} text(s). Each vector must have exactly ${DIMENSION} floating point numbers between -1 and 1.\n\n${texts.map((t, i) => `[${i}]: ${t.slice(0, 500)}`).join("\n\n")}`,
        },
      ],
      tools: [
        {
          type: "function",
          function: {
            name: "store_embeddings",
            description: `Store ${texts.length} embedding vectors`,
            parameters: {
              type: "object",
              properties: {
                embeddings: {
                  type: "array",
                  description: `Array of ${texts.length} embedding vectors, each with ${DIMENSION} numbers`,
                  items: {
                    type: "array",
                    items: { type: "number" },
                  },
                },
              },
              required: ["embeddings"],
            },
          },
        },
      ],
      tool_choice: { type: "function", function: { name: "store_embeddings" } },
    }),
  });

  if (!resp.ok) {
    const errText = await resp.text();
    if (resp.status === 429) throw new Error("Rate limit exceeded (429)");
    if (resp.status === 402) throw new Error("Payment required (402) — add credits to workspace");
    throw new Error(`Embedding generation failed (${resp.status}): ${errText}`);
  }

  const data = await resp.json();
  const toolCall = data.choices?.[0]?.message?.tool_calls?.[0];
  if (!toolCall) throw new Error("No embedding tool call in response");

  const parsed = JSON.parse(toolCall.function.arguments);
  return parsed.embeddings || [];
}
