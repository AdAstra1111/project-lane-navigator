import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { callLLM, extractJSON, MODELS } from "../_shared/llm.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

interface SeedPackPayload {
  projectId: string;
  pitch: string;
  lane: string;
  targetPlatform?: string | null;
}

interface SeedPackResult {
  project_overview: string;
  creative_brief: string;
  market_positioning: string;
  canon_constraints: string;
  provenance: {
    lane: string;
    targetPlatform: string | null;
    seed_snapshot_id: string;
    generated_at: string;
  };
}

const SEED_DOC_CONFIGS = [
  { key: "project_overview", title: "Project Overview (Seed)", doc_type: "project_overview" },
  { key: "creative_brief", title: "Creative Brief (Seed)", doc_type: "creative_brief" },
  { key: "market_positioning", title: "Market Positioning (Seed)", doc_type: "market_positioning" },
  { key: "canon_constraints", title: "Canon & Constraints (Seed)", doc_type: "canon" },
] as const;

async function hashSnapshot(projectId: string, pitch: string, lane: string, targetPlatform: string | null): Promise<string> {
  const dateKey = new Date().toISOString().slice(0, 10).replace(/-/g, "");
  const input = `${projectId}|${pitch}|${lane}|${targetPlatform || ""}|${dateKey}`;
  const encoded = new TextEncoder().encode(input);
  const hashBuffer = await crypto.subtle.digest("SHA-256", encoded);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map(b => b.toString(16).padStart(2, "0")).join("").slice(0, 32);
}

function jsonRes(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get("Authorization") || "";
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const apiKey = Deno.env.get("LOVABLE_API_KEY");

    if (!apiKey) {
      return jsonRes({ error: "AI API key not configured" }, 500);
    }

    // Auth: get user via anon client (RLS-scoped)
    const anonClient = createClient(supabaseUrl, Deno.env.get("SUPABASE_ANON_KEY")!, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: { user }, error: authErr } = await anonClient.auth.getUser();
    if (authErr || !user) {
      return jsonRes({ error: "Unauthorized" }, 401);
    }

    const body: SeedPackPayload = await req.json();
    const { projectId, pitch, lane, targetPlatform } = body;

    if (!projectId || !pitch || !lane) {
      return jsonRes({ error: "projectId, pitch, and lane are required" }, 400);
    }

    // ── Access check: use anonClient (RLS-scoped) to verify project access ──
    const { data: project, error: projErr } = await anonClient
      .from("projects")
      .select("id, title, format, genres, assigned_lane, budget_range, tone, target_audience")
      .eq("id", projectId)
      .single();

    if (projErr || !project) {
      return jsonRes({ error: "Project not found or access denied" }, 404);
    }

    // Admin client for writes only — access already verified above
    const adminClient = createClient(supabaseUrl, serviceKey);

    // Create deterministic snapshot ID
    const seedSnapshotId = await hashSnapshot(projectId, pitch, lane, targetPlatform ?? null);
    const generatedAt = new Date().toISOString();

    // Build prompts
    const systemPrompt = `You are a professional film/TV development consultant. Generate a structured seed pack for a project.

OUTPUT RULES:
- Return ONLY valid JSON. No markdown. No commentary. No backticks.
- The JSON must have exactly these keys: project_overview, creative_brief, market_positioning, canon_constraints, provenance
- Each of the four content keys must be a string containing structured professional text (use newlines for sections).
- provenance must match: { "lane": "${lane}", "targetPlatform": ${targetPlatform ? `"${targetPlatform}"` : "null"}, "seed_snapshot_id": "${seedSnapshotId}", "generated_at": "${generatedAt}" }

CONTENT GUIDELINES:
- project_overview: Title, logline, format, genre, tone, target audience, comparable titles, development stage summary.
- creative_brief: Creative vision, thematic core, visual tone, narrative approach, audience engagement strategy.
- market_positioning: Market landscape, competitive positioning, target buyers/platforms, international potential, timing considerations.
- canon_constraints: World rules, character constraints, narrative boundaries, tone guardrails, format-specific requirements.

Tailor content to the lane (${lane}) and format (${project.format || "unknown"}).`;

    const userPrompt = `PROJECT: ${project.title}
FORMAT: ${project.format || "unknown"}
GENRES: ${(project.genres || []).join(", ") || "unspecified"}
LANE: ${lane}
BUDGET: ${project.budget_range || "unspecified"}
TONE: ${project.tone || "unspecified"}
TARGET AUDIENCE: ${project.target_audience || "unspecified"}
TARGET PLATFORM: ${targetPlatform || "unspecified"}

PITCH:
${pitch}

Generate the seed pack now. Return ONLY valid JSON.`;

    // ── LLM call via shared callLLM helper — single pass, low temperature ──
    let llmResult;
    try {
      llmResult = await callLLM({
        apiKey,
        model: MODELS.FAST,
        system: systemPrompt,
        user: userPrompt,
        temperature: 0.2,
        maxTokens: 8000,
        retries: 1, // single pass — no retry cascade
      });
    } catch (llmErr: unknown) {
      const msg = llmErr instanceof Error ? llmErr.message : "AI call failed";
      if (msg === "RATE_LIMIT") return jsonRes({ error: "Rate limited — please try again later" }, 429);
      if (msg === "PAYMENT_REQUIRED") return jsonRes({ error: "Payment required — please add credits" }, 402);
      console.error("generate-seed-pack LLM error:", msg);
      return jsonRes({ error: "AI generation failed" }, 500);
    }

    // Parse JSON — fail hard on invalid (no repair pass)
    let seedPack: SeedPackResult;
    try {
      const cleaned = extractJSON(llmResult.content);
      seedPack = JSON.parse(cleaned);
    } catch (parseErr) {
      console.error("Seed pack JSON parse failed. Raw excerpt:", llmResult.content.slice(0, 500));
      return jsonRes({ error: "AI returned invalid JSON — please retry" }, 422);
    }

    // Validate required keys
    for (const cfg of SEED_DOC_CONFIGS) {
      if (typeof (seedPack as any)[cfg.key] !== "string") {
        return jsonRes({ error: `Missing or invalid key: ${cfg.key}` }, 422);
      }
    }

    // Stamp provenance deterministically
    seedPack.provenance = {
      lane,
      targetPlatform: targetPlatform ?? null,
      seed_snapshot_id: seedSnapshotId,
      generated_at: generatedAt,
    };

    // ── Create/update documents ──
    const createdDocs: { title: string; doc_type: string; document_id: string; version_number: number }[] = [];

    for (const cfg of SEED_DOC_CONFIGS) {
      const content = (seedPack as any)[cfg.key] as string;

      // Check if seed doc already exists for this project
      const { data: existing } = await adminClient
        .from("project_documents")
        .select("id")
        .eq("project_id", projectId)
        .eq("ingestion_source", "seed")
        .eq("title", cfg.title)
        .limit(1);

      let documentId: string;

      if (existing && existing.length > 0) {
        // Existing seed doc — create new version
        documentId = existing[0].id;

        const { data: maxVer } = await adminClient
          .from("project_document_versions")
          .select("version_number")
          .eq("document_id", documentId)
          .order("version_number", { ascending: false })
          .limit(1);

        const nextVersion = (maxVer?.[0]?.version_number || 0) + 1;

        // Clear is_current on existing versions
        await adminClient
          .from("project_document_versions")
          .update({ is_current: false })
          .eq("document_id", documentId)
          .eq("is_current", true);

        const { error: vErr } = await adminClient
          .from("project_document_versions")
          .insert({
            document_id: documentId,
            version_number: nextVersion,
            plaintext: content,
            is_current: true,
            status: "active",
            label: `seed_v${nextVersion}`,
            created_by: user.id,
            approval_status: "draft",
            meta_json: seedPack.provenance,
          });

        if (vErr) {
          console.error(`Version insert failed for ${cfg.title}:`, vErr);
          continue;
        }

        createdDocs.push({ title: cfg.title, doc_type: cfg.doc_type, document_id: documentId, version_number: nextVersion });
      } else {
        // New seed doc — no storage upload, no fake file_path
        const { data: newDoc, error: docErr } = await adminClient
          .from("project_documents")
          .insert({
            project_id: projectId,
            user_id: user.id,
            title: cfg.title,
            doc_type: cfg.doc_type,
            ingestion_source: "seed",
            is_primary: false,
            file_name: `seed:${cfg.doc_type}`,
            file_path: "",
            extraction_status: "complete",
          })
          .select("id")
          .single();

        if (docErr || !newDoc) {
          console.error(`Doc insert failed for ${cfg.title}:`, docErr);
          continue;
        }

        documentId = newDoc.id;

        const { error: vErr } = await adminClient
          .from("project_document_versions")
          .insert({
            document_id: documentId,
            version_number: 1,
            plaintext: content,
            is_current: true,
            status: "active",
            label: "seed_v1",
            created_by: user.id,
            approval_status: "draft",
            meta_json: seedPack.provenance,
          });

        if (vErr) {
          console.error(`Version insert failed for ${cfg.title}:`, vErr);
          continue;
        }

        createdDocs.push({ title: cfg.title, doc_type: cfg.doc_type, document_id: documentId, version_number: 1 });
      }
    }

    return jsonRes({
      success: true,
      seed_snapshot_id: seedSnapshotId,
      documents: createdDocs,
    });

  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error("generate-seed-pack error:", message);
    return jsonRes({ error: message }, 500);
  }
});
