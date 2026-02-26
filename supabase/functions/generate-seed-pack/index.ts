import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const GATEWAY_URL = "https://ai.gateway.lovable.dev/v1/chat/completions";

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
      return new Response(JSON.stringify({ error: "AI API key not configured" }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Auth: get user from JWT
    const anonClient = createClient(supabaseUrl, Deno.env.get("SUPABASE_ANON_KEY")!, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: { user }, error: authErr } = await anonClient.auth.getUser();
    if (authErr || !user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const adminClient = createClient(supabaseUrl, serviceKey);

    const body: SeedPackPayload = await req.json();
    const { projectId, pitch, lane, targetPlatform } = body;

    if (!projectId || !pitch || !lane) {
      return new Response(JSON.stringify({ error: "projectId, pitch, and lane are required" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // 1) Load project metadata
    const { data: project, error: projErr } = await adminClient
      .from("projects")
      .select("id, title, format, genres, assigned_lane, budget_range, tone, target_audience")
      .eq("id", projectId)
      .single();

    if (projErr || !project) {
      return new Response(JSON.stringify({ error: "Project not found" }), {
        status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // 2) Create deterministic snapshot ID
    const seedSnapshotId = await hashSnapshot(projectId, pitch, lane, targetPlatform ?? null);
    const generatedAt = new Date().toISOString();

    // 3) Build system prompt
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

    // 4) LLM call — single pass, low temperature, no repair
    const llmResponse = await fetch(GATEWAY_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "google/gemini-2.5-flash",
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt },
        ],
        temperature: 0.2,
        max_tokens: 8000,
      }),
    });

    if (llmResponse.status === 429) {
      return new Response(JSON.stringify({ error: "Rate limited — please try again later" }), {
        status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    if (llmResponse.status === 402) {
      return new Response(JSON.stringify({ error: "Payment required — please add credits" }), {
        status: 402, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    if (!llmResponse.ok) {
      const errText = await llmResponse.text();
      console.error("LLM error:", llmResponse.status, errText);
      return new Response(JSON.stringify({ error: "AI generation failed" }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const llmData = await llmResponse.json();
    const rawContent = llmData.choices?.[0]?.message?.content || "";

    // 5) Parse JSON — fail hard on invalid
    let cleaned = rawContent.replace(/```(?:json)?\s*\n?/gi, "").replace(/\n?```\s*$/g, "").trim();
    const firstBrace = cleaned.indexOf("{");
    if (firstBrace > 0) cleaned = cleaned.slice(firstBrace);
    const lastBrace = cleaned.lastIndexOf("}");
    if (lastBrace >= 0) cleaned = cleaned.slice(0, lastBrace + 1);

    let seedPack: SeedPackResult;
    try {
      seedPack = JSON.parse(cleaned);
    } catch (parseErr) {
      console.error("Seed pack JSON parse failed:", parseErr, "Raw:", rawContent.slice(0, 500));
      return new Response(JSON.stringify({ error: "AI returned invalid JSON — please retry" }), {
        status: 422, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Validate required keys
    for (const cfg of SEED_DOC_CONFIGS) {
      if (typeof (seedPack as any)[cfg.key] !== "string") {
        return new Response(JSON.stringify({ error: `Missing or invalid key: ${cfg.key}` }), {
          status: 422, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
    }

    // Ensure provenance is set correctly
    seedPack.provenance = {
      lane,
      targetPlatform: targetPlatform ?? null,
      seed_snapshot_id: seedSnapshotId,
      generated_at: generatedAt,
    };

    // 6) Create/update documents
    const createdDocs: { title: string; doc_type: string; document_id: string; version_number: number }[] = [];

    for (const cfg of SEED_DOC_CONFIGS) {
      const content = (seedPack as any)[cfg.key] as string;

      // Check if seed doc already exists
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

        // Get max version number
        const { data: maxVer } = await adminClient
          .from("project_document_versions")
          .select("version_number")
          .eq("document_id", documentId)
          .order("version_number", { ascending: false })
          .limit(1);

        const nextVersion = (maxVer?.[0]?.version_number || 0) + 1;

        // Clear is_current on all existing versions
        await adminClient
          .from("project_document_versions")
          .update({ is_current: false })
          .eq("document_id", documentId)
          .eq("is_current", true);

        // Insert new version
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
        // New seed doc
        const { data: newDoc, error: docErr } = await adminClient
          .from("project_documents")
          .insert({
            project_id: projectId,
            user_id: user.id,
            title: cfg.title,
            doc_type: cfg.doc_type,
            ingestion_source: "seed",
            is_primary: false,
            file_name: `${cfg.doc_type}_seed.txt`,
            file_path: `seed/${projectId}/${cfg.doc_type}`,
          })
          .select("id")
          .single();

        if (docErr || !newDoc) {
          console.error(`Doc insert failed for ${cfg.title}:`, docErr);
          continue;
        }

        documentId = newDoc.id;

        // Insert v1
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

    return new Response(JSON.stringify({
      success: true,
      seed_snapshot_id: seedSnapshotId,
      documents: createdDocs,
    }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error("generate-seed-pack error:", message);
    return new Response(JSON.stringify({ error: message }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
