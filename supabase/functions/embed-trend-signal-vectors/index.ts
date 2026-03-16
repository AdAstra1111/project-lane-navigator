/**
 * embed-trend-signal-vectors — Generate embeddings for active trend_signals.
 * Updates embedding in-place. Idempotent via embedding_text_hash dedup.
 */
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { createEmbedding, DIMENSION, EMBEDDING_MODEL } from "../_shared/embeddingProvider.ts";
import { buildTrendSignalEmbeddingText, sha256Hash } from "../_shared/embeddingText.ts";

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
    return json({ ok: true, build: "embed-trend-signal-vectors-v1" });
  }

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) throw new Error("Missing auth header");

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const lovableKey = Deno.env.get("OPENROUTER_API_KEY");
    if (!lovableKey) throw new Error("OPENROUTER_API_KEY not configured");

    // Verify user is authenticated
    const userClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: { user }, error: authErr } = await userClient.auth.getUser();
    if (authErr || !user) throw new Error("Unauthorized");

    const body = await req.json();
    const limit = Math.min(body.limit || 10, 25);
    const onlyMissing = body.only_missing !== false; // default true
    const minStrength = body.min_strength || 1;
    const testSignalId = body.test_signal_id || null; // single-signal smoke test

    const sb = createClient(supabaseUrl, serviceKey);

    // Fetch signals to process
    let query = sb
      .from("trend_signals")
      .select("id, name, explanation, description, dimension, modality, category, cycle_phase, production_type, genre_tags, tone_tags, format_tags, style_tags, narrative_tags, signal_tags, tags, embedding_text_hash, embedding");

    if (testSignalId) {
      // Single-signal test mode — bypass status/strength filters
      query = query.eq("id", testSignalId).limit(1);
    } else {
      query = query
        .eq("status", "active")
        .gte("strength", minStrength)
        .order("last_updated_at", { ascending: false })
        .limit(limit);

      if (onlyMissing) {
        query = query.is("embedding", null);
      }
    }

    const { data: signals, error: fetchErr } = await query;
    if (fetchErr) throw new Error(`Fetch signals failed: ${fetchErr.message}`);
    if (!signals || signals.length === 0) {
      return json({ ok: true, processed: 0, skipped: 0, message: "No signals to process" });
    }

    let processed = 0;
    let skipped = 0;
    const details: any[] = [];

    for (const signal of signals) {
      const embeddingText = buildTrendSignalEmbeddingText(signal);
      const hash = await sha256Hash(embeddingText);

      // Dedup: if hash matches and embedding exists, skip
      if (signal.embedding_text_hash === hash && signal.embedding) {
        skipped++;
        continue;
      }

      try {
        const embedding = await createEmbedding(embeddingText, lovableKey);

        const { data: updated, error: updateErr } = await sb.rpc("upsert_trend_signal_embedding", {
          _signal_id: signal.id,
          _embedding: embedding,
          _embedding_model: EMBEDDING_MODEL,
          _embedding_text_hash: hash,
          _embedding_text_len: embeddingText.length,
        });

        if (updateErr) {
          details.push({ id: signal.id, name: signal.name, status: "error", error: updateErr.message });
        } else {
          details.push({ id: signal.id, name: signal.name, status: "embedded", hash_prefix: hash.slice(0, 8) });
          processed++;
        }
      } catch (e: any) {
        details.push({ id: signal.id, name: signal.name, status: "error", error: e.message });
        if (e.message === "RATE_LIMIT" || e.message === "PAYMENT_REQUIRED") {
          // Stop processing on hard limits
          details.push({ status: "halted", reason: e.message });
          break;
        }
      }

      // Rate-limit padding
      await new Promise(r => setTimeout(r, 400));
    }

    return json({
      ok: true,
      processed,
      skipped,
      total_fetched: signals.length,
      details: details.slice(0, 20), // cap detail output
    });
  } catch (e: any) {
    console.error("[embed-trend-signal-vectors] error:", e);
    const status = e.message?.includes("RATE_LIMIT") ? 429 : e.message?.includes("PAYMENT") ? 402 : 400;
    return json({ error: e.message || "Unknown error" }, status);
  }
});
