import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { callLLM, extractJSON, MODELS } from "../_shared/llm.ts";
import { upsertDoc, SEED_CORE_TYPES } from "../_shared/doc-os.ts";

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
  riskOverride?: "robust" | "edge" | "provocative" | null;
  commitOnly?: boolean;
  necOverride?: string | null;
}

const SEED_DOC_CONFIGS = [
  { key: "project_overview", title: "Project Overview (Seed)", doc_type: "project_overview" },
  { key: "creative_brief", title: "Creative Brief (Seed)", doc_type: "creative_brief" },
  { key: "market_positioning", title: "Market Positioning (Seed)", doc_type: "market_positioning" },
  { key: "canon_constraints", title: "Canon & Constraints (Seed)", doc_type: "canon" },
  { key: "narrative_energy_contract", title: "Narrative Energy Contract (Seed)", doc_type: "nec" },
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

function buildSystemPrompt(lane: string, format: string, seedSnapshotId: string, generatedAt: string, targetPlatform: string | null, riskOverride: string | null): string {
  return `You are a professional film/TV development architect. Generate a Pitch Architecture analysis and seed pack.

OUTPUT RULES:
- Return ONLY valid JSON. No markdown. No commentary. No backticks.
- The JSON must match the exact schema below.

RESTRAINT BIAS RULES (MANDATORY):
- Default escalation bias is RESTRAINED.
- If no riskOverride is provided, derive risk_posture conservatively. Default to "robust" when ambiguous.
- If derived_mode is anything beyond "robust", you MUST justify why restraint weakens the concept.
- Catastrophic escalation must NEVER be the default.
- Psychological and relational tension is preferred over spectacle unless the genre strictly demands otherwise.
- Polarity-driven escalation only. Never spectacle-driven.

STAKES GOVERNOR (DEFAULT):
- Default stakes tier MUST be grounded and human-scale (Tier 1–3).
- Do NOT escalate to Tier 4–5 (mass casualty, apocalypse, global collapse, terrorist-scale events, world-ending threats) unless the user's pitch explicitly contains those elements.
- If higher-tier stakes are used, you MUST cite the exact pitch element that requires it.

PRESTIGE PRESSURE PREFERENCE:
- Prefer pressure sources that create prestige/elevated tension without spectacle: moral compromise, status threat, intimacy rupture, betrayal, shame, obsession, institutional pressure, psychological dread, social consequence.
- Catastrophe is NOT a substitute for tension.

HORROR / ELEVATED GENRE CLARIFIER:
- If genre signals horror/elevated genre, prefer dread, constraint, and inevitability over escalation magnitude.
- The fear should come from proximity and meaning, not bigger explosions.

ESCALATION EARNED RULE:
- Escalation must be EARNED through polarity movement and character consequence.
- No sudden "evil mastermind / end-of-the-world" pivots unless pitch demands it.

NEC CONSISTENCY CHECK (INTERNAL):
- The Narrative Energy Contract must reflect these rules: Preferred Operating Tier should be 2–3 by default. Absolute Maximum Tier should be 3 by default.
- If the pitch explicitly demands Tier 4–5, NEC must explicitly justify why Tier 3 cannot satisfy the premise.

${riskOverride ? `RISK OVERRIDE: "${riskOverride}" — apply this posture but still justify.` : "AUTO-DERIVE risk posture conservatively."}

REQUIRED JSON SCHEMA:
{
  "concept_distillation": {
    "core_concept": "string",
    "central_question": "string",
    "thematic_spine": "string",
    "audience_promise": "string"
  },
  "emotional_thesis": {
    "primary_emotion": "string",
    "emotional_journey": "string",
    "cathartic_mechanism": "string"
  },
  "differentiation_analysis": {
    "unique_angle": "string",
    "comparable_gap": "string",
    "market_white_space": "string"
  },
  "sustainability_validation": {
    "narrative_fuel": "string",
    "character_engine": "string",
    "world_capacity": "string",
    "longevity_assessment": "string"
  },
  "polarity_lock": {
    "core_polarity": "string",
    "how_conflict_moves_along_axis": "string",
    "escalation_expression_along_polarity": "string"
  },
  "engine_inevitability_test": {
    "what_happens_if_no_one_acts": "string",
    "why_world_cannot_remain_stable": "string",
    "natural_pressure_source": "string"
  },
  "failure_modes": [
    { "risk": "string", "safeguard": "string" }
  ],
  "risk_posture": {
    "derived_mode": "robust|edge|provocative",
    "justification": "string",
    "override_applied": boolean
  },
  "narrative_energy_contract": "STRING — concise structured text containing: Baseline Mode, Conflict Hierarchy (Tier 1-5), Preferred Operating Tier, Absolute Maximum Tier, Tension Source Matrix, Escalation Geometry, Tonal Envelope, Sustainability Check, Creative Elasticity. Must respect risk posture and restraint bias.",
  "final_seed_docs": {
    "project_overview": "STRING — Title, logline, format, genre, tone, target audience, comparable titles, development stage summary.",
    "creative_brief": "STRING — Creative vision, thematic core, visual tone, narrative approach, audience engagement strategy.",
    "market_positioning": "STRING — Market landscape, competitive positioning, target buyers/platforms, international potential, timing considerations.",
    "canon_constraints": "STRING — World rules, character constraints, narrative boundaries, tone guardrails, format-specific requirements."
  },
  "compression": {
    "words_25": "STRING — max 25 words summarizing the project",
    "words_75": "STRING — max 75 words summarizing the project"
  },
  "provenance": {
    "lane": "${lane}",
    "targetPlatform": ${targetPlatform ? `"${targetPlatform}"` : "null"},
    "seed_snapshot_id": "${seedSnapshotId}",
    "generated_at": "${generatedAt}"
  }
}

failure_modes must contain 3-5 entries.
Tailor content to the lane (${lane}) and format (${format}).`;
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

    // ── Auth gate: support both user JWTs and service_role tokens ──
    const token = authHeader.replace(/^Bearer\s+/i, "");
    let actorUserId: string | null = null;
    let isServiceRole = false;

    // Detect service_role: raw key match OR JWT with role=service_role
    if (serviceKey && token === serviceKey) {
      isServiceRole = true;
    } else if (token.split(".").length === 3) {
      try {
        let seg = token.split(".")[1].replace(/-/g, "+").replace(/_/g, "/");
        seg += "=".repeat((4 - (seg.length % 4)) % 4);
        const payload = JSON.parse(atob(seg));
        if (payload.role === "service_role") isServiceRole = true;
      } catch { /* not a JWT or decode failed */ }
    }

    // Build clients up-front
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const serviceClient = createClient(supabaseUrl, serviceKey);
    const rlsClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const db = isServiceRole ? serviceClient : rlsClient;

    if (isServiceRole) {
      // Extract userId from body for audit fields; allow null
      const preBody = await req.clone().json();
      actorUserId = preBody?.userId || preBody?.user_id || null;
    } else {
      const { data: { user: authUser }, error: authErr } = await rlsClient.auth.getUser();
      if (authErr || !authUser) {
        return jsonRes({ error: "Unauthorized" }, 401);
      }
      actorUserId = authUser.id;
    }

    console.log("[generate-seed-pack] auth", { isServiceRole, hasUserToken: !!token });

    const body: SeedPackPayload = await req.json();
    const { projectId, pitch, lane, targetPlatform, riskOverride, commitOnly, necOverride } = body;

    console.log("[generate-seed-pack] start", { projectId, lane, commitOnly: !!commitOnly });

    if (!projectId || !pitch || !lane) {
      return jsonRes({ success: false, insertedCount: 0, updatedCount: 0, error: "projectId, pitch, and lane are required" }, 400);
    }

    // Access check via db (RLS-scoped for users, admin for service_role)
    const { data: project, error: projErr } = await db
      .from("projects")
      .select("id, title, format, genres, assigned_lane, budget_range, tone, target_audience")
      .eq("id", projectId)
      .single();

    if (projErr || !project) {
      return jsonRes({ error: "Project not found or access denied" }, 404);
    }

    const adminClient = createClient(supabaseUrl, serviceKey);

    const seedSnapshotId = await hashSnapshot(projectId, pitch, lane, targetPlatform ?? null);
    const generatedAt = new Date().toISOString();

    // ── commitOnly path: only upsert NEC doc, no LLM call ──
    if (commitOnly) {
      if (!necOverride || !necOverride.trim()) {
        return jsonRes({ error: "necOverride is required for commitOnly" }, 400);
      }
      const necCfg = SEED_DOC_CONFIGS.find(c => c.key === "narrative_energy_contract")!;
      const provenance = { lane, targetPlatform: targetPlatform ?? null, seed_snapshot_id: seedSnapshotId, generated_at: generatedAt };

      const { data: existing } = await adminClient
        .from("project_documents")
        .select("id")
        .eq("project_id", projectId)
        .eq("doc_type", necCfg.doc_type)
        .limit(1);

      let documentId: string;
      let versionNumber: number;

      if (existing && existing.length > 0) {
        documentId = existing[0].id;
        const { data: maxVer } = await adminClient
          .from("project_document_versions")
          .select("version_number")
          .eq("document_id", documentId)
          .order("version_number", { ascending: false })
          .limit(1);
        const nextVersion = (maxVer?.[0]?.version_number || 0) + 1;

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
            plaintext: necOverride,
            is_current: true,
            status: "draft",
            label: `nec_edited_v${nextVersion}`,
            created_by: actorUserId,
            approval_status: "draft",
            meta_json: provenance,
          });

        if (vErr) {
          console.error("NEC commit version insert failed:", vErr);
          return jsonRes({ error: "Failed to commit NEC version" }, 500);
        }
        versionNumber = nextVersion;
      } else {
        const { data: newDoc, error: docErr } = await adminClient
          .from("project_documents")
          .insert({
            project_id: projectId,
            user_id: actorUserId,
            title: necCfg.title,
            doc_type: necCfg.doc_type,
            ingestion_source: "seed",
            is_primary: false,
            file_name: `seed:${necCfg.doc_type}`,
            file_path: "",
            extraction_status: "complete",
          })
          .select("id")
          .single();

        if (docErr || !newDoc) {
          console.error("NEC commit doc insert failed:", docErr);
          return jsonRes({ error: "Failed to create NEC document" }, 500);
        }
        documentId = newDoc.id;

        const { error: vErr } = await adminClient
          .from("project_document_versions")
          .insert({
            document_id: documentId,
            version_number: 1,
            plaintext: necOverride,
            is_current: true,
            status: "draft",
            label: "nec_edited_v1",
            created_by: actorUserId,
            approval_status: "draft",
            meta_json: provenance,
          });

        if (vErr) {
          console.error("NEC commit version insert failed:", vErr);
          return jsonRes({ error: "Failed to commit NEC version" }, 500);
        }
        versionNumber = 1;
      }

      return jsonRes({
        success: true,
        seed_snapshot_id: seedSnapshotId,
        documents: [{ title: necCfg.title, doc_type: necCfg.doc_type, document_id: documentId, version_number: versionNumber }],
        nec: { document_id: documentId, plaintext: necOverride },
      });
    }

    // ── Full generation path ──
    const systemPrompt = buildSystemPrompt(
      lane,
      project.format || "unknown",
      seedSnapshotId,
      generatedAt,
      targetPlatform ?? null,
      riskOverride ?? null,
    );

    const userPrompt = `PROJECT: ${project.title}
FORMAT: ${project.format || "unknown"}
GENRES: ${(project.genres || []).join(", ") || "unspecified"}
LANE: ${lane}
BUDGET: ${project.budget_range || "unspecified"}
TONE: ${project.tone || "unspecified"}
TARGET AUDIENCE: ${project.target_audience || "unspecified"}
TARGET PLATFORM: ${targetPlatform || "unspecified"}
RISK OVERRIDE: ${riskOverride || "auto"}

PITCH:
${pitch}

Generate the full Pitch Architecture analysis and seed pack now. Return ONLY valid JSON.`;

    let llmResult;
    try {
      llmResult = await callLLM({
        apiKey,
        model: MODELS.FAST,
        system: systemPrompt,
        user: userPrompt,
        temperature: 0.2,
        maxTokens: 8000,
        retries: 1,
      });
    } catch (llmErr: unknown) {
      const msg = llmErr instanceof Error ? llmErr.message : "AI call failed";
      if (msg === "RATE_LIMIT") return jsonRes({ error: "Rate limited — please try again later" }, 429);
      if (msg === "PAYMENT_REQUIRED") return jsonRes({ error: "Payment required — please add credits" }, 402);
      console.error("generate-seed-pack LLM error:", msg);
      return jsonRes({ error: "AI generation failed" }, 500);
    }

    // Hard parse — no repair
    let parsed: any;
    try {
      const cleaned = extractJSON(llmResult.content);
      parsed = JSON.parse(cleaned);
    } catch (parseErr) {
      console.error("Seed pack JSON parse failed. Raw excerpt:", llmResult.content.slice(0, 500));
      return jsonRes({ error: "AI returned invalid JSON — please retry" }, 422);
    }

    // Validate required keys
    const requiredAnalysis = ["concept_distillation", "emotional_thesis", "differentiation_analysis",
      "sustainability_validation", "polarity_lock", "engine_inevitability_test", "failure_modes", "risk_posture"];
    for (const key of requiredAnalysis) {
      if (!parsed[key]) {
        return jsonRes({ error: `Missing analysis key: ${key}` }, 422);
      }
    }

    // Validate failure_modes length (3-5)
    if (!Array.isArray(parsed.failure_modes) || parsed.failure_modes.length < 3 || parsed.failure_modes.length > 5) {
      return jsonRes({ error: "failure_modes must contain 3-5 entries" }, 422);
    }

    // Validate risk_posture.derived_mode
    const validModes = ["robust", "edge", "provocative"];
    if (!parsed.risk_posture?.derived_mode || !validModes.includes(parsed.risk_posture.derived_mode)) {
      return jsonRes({ error: "risk_posture.derived_mode must be robust, edge, or provocative" }, 422);
    }

    if (!parsed.final_seed_docs || typeof parsed.final_seed_docs !== "object") {
      return jsonRes({ error: "Missing final_seed_docs" }, 422);
    }
    for (const k of ["project_overview", "creative_brief", "market_positioning", "canon_constraints"]) {
      if (typeof parsed.final_seed_docs[k] !== "string") {
        return jsonRes({ error: `Missing or invalid seed doc: ${k}` }, 422);
      }
    }
    if (typeof parsed.narrative_energy_contract !== "string") {
      return jsonRes({ error: "Missing narrative_energy_contract" }, 422);
    }

    // Stamp provenance
    parsed.provenance = {
      lane,
      targetPlatform: targetPlatform ?? null,
      seed_snapshot_id: seedSnapshotId,
      generated_at: generatedAt,
    };

    // Build content map for document creation
    const contentMap: Record<string, string> = {
      project_overview: parsed.final_seed_docs.project_overview,
      creative_brief: parsed.final_seed_docs.creative_brief,
      market_positioning: parsed.final_seed_docs.market_positioning,
      canon_constraints: parsed.final_seed_docs.canon_constraints,
      narrative_energy_contract: parsed.narrative_energy_contract,
    };

    // Pre-fetch existing doc ids for insert/update counting
    const { data: preExistingDocs } = await adminClient
      .from("project_documents")
      .select("doc_type")
      .eq("project_id", projectId)
      .in("doc_type", SEED_DOC_CONFIGS.map(c => c.doc_type));
    const preExistingSet = new Set((preExistingDocs || []).map((d: any) => d.doc_type));

    // Create/update documents using canonical doc-os helpers
    const createdDocs: { title: string; doc_type: string; document_id: string; version_number: number }[] = [];
    let necDocumentId: string | null = null;
    let insertedCount = 0;
    let updatedCount = 0;

    for (const cfg of SEED_DOC_CONFIGS) {
      const content = contentMap[cfg.key];
      if (!content) continue;

      try {
        const result = await upsertDoc(adminClient, {
          projectId,
          userId: actorUserId,
          docType: cfg.doc_type,
          plaintext: content,
          label: `seed_v1`,
          approvalStatus: "draft",
          metaJson: parsed.provenance,
          source: "seed",
          title: cfg.title,
        });

        if (result.isNewDoc) {
          insertedCount++;
        } else {
          updatedCount++;
        }
        createdDocs.push({ title: cfg.title, doc_type: cfg.doc_type, document_id: result.documentId, version_number: result.versionNumber });

        if (cfg.key === "narrative_energy_contract") {
          necDocumentId = result.documentId;
        }
      } catch (err: any) {
        console.error(`[generate-seed-pack] upsertDoc failed for ${cfg.title}:`, err.message);
        continue;
      }
    }

    // Never return success if any seed doc failed to persist
    if (createdDocs.length < SEED_DOC_CONFIGS.length) {
      const missing = SEED_DOC_CONFIGS
        .filter(c => !createdDocs.some(d => d.doc_type === c.doc_type))
        .map(c => c.title);
      console.error("[generate-seed-pack] incomplete — failed docs:", missing, { insertedCount, updatedCount });
      return jsonRes({ success: false, insertedCount, updatedCount, error: `Failed to persist seed documents: ${missing.join(", ")}` }, 500);
    }

    console.log("[generate-seed-pack] complete", { insertedCount, updatedCount });

    return jsonRes({
      success: true,
      insertedCount,
      updatedCount,
      seed_snapshot_id: seedSnapshotId,
      documents: createdDocs,
      nec: {
        document_id: necDocumentId,
        plaintext: parsed.narrative_energy_contract,
      },
      strategic_analysis: {
        concept_distillation: parsed.concept_distillation,
        emotional_thesis: parsed.emotional_thesis,
        differentiation_analysis: parsed.differentiation_analysis,
        sustainability_validation: parsed.sustainability_validation,
        polarity_lock: parsed.polarity_lock,
        engine_inevitability_test: parsed.engine_inevitability_test,
        failure_modes: parsed.failure_modes,
        risk_posture: parsed.risk_posture,
        compression: parsed.compression || {},
      },
    });

  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error("[generate-seed-pack] error:", message);
    return jsonRes({ success: false, insertedCount: 0, updatedCount: 0, error: message }, 500);
  }
});
