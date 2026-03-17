import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { callLLM, extractJSON, MODELS } from "../_shared/llm.ts";
import { upsertDoc, SEED_CORE_TYPES } from "../_shared/doc-os.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "authorization, apikey, x-client-info, content-type, prefer, accept, origin, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
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
  const isEpisodic = ["tv-series", "limited-series", "digital-series", "vertical-drama", "anim-series", "reality", "series"].includes(lane) ||
    ["tv-series", "limited-series", "digital-series", "vertical-drama", "anim-series", "reality", "series"].includes(format);
  const isVerticalDrama = lane === "vertical-drama" || format === "vertical-drama";

  let laneStructuralBlock = "";
  if (isVerticalDrama) {
    laneStructuralBlock = `
VERTICAL DRAMA STRUCTURAL REQUIREMENTS (MANDATORY):
- sustainability_validation.narrative_fuel MUST describe a REPEATABLE EXTERNAL PRESSURE ENGINE, not just romance/vibe/internal conflict.
- The engine must support 30+ episodes of short-form mobile-first content with high-frequency escalation.
- engine_inevitability_test.natural_pressure_source MUST be an external force (antagonist, ticking clock, systemic threat) — purely internal/contemplative pressure is STRUCTURALLY INVALID.
- If you cannot identify a clear external escalation source, flag it explicitly in failure_modes.`;
  } else if (isEpisodic) {
    laneStructuralBlock = `
EPISODIC FORMAT REQUIREMENTS:
- sustainability_validation.narrative_fuel MUST describe a renewable conflict engine that sustains a full season.
- A single event or static situation is insufficient for episodic formats.`;
  }

  return `You are a professional film/TV development architect. Generate a Pitch Architecture analysis and seed pack.

OUTPUT RULES:
- Return ONLY valid JSON. No markdown. No commentary. No backticks.
- The JSON must match the exact schema below.

NARRATIVE UNIT STRUCTURAL REQUIREMENTS (NUE-INFORMED — MANDATORY):
Every generated seed pack MUST explicitly account for ALL of the following narrative architecture elements.
These are NOT optional — a seed that omits any of these is structurally insufficient.

1. PROTAGONIST OBJECTIVE: concept_distillation.core_concept and sustainability_validation.character_engine must clearly identify the protagonist and their concrete, actionable objective.
2. ANTAGONIST FORCE: engine_inevitability_test must identify a specific opposition source — person, system, or structural threat. "Internal conflict alone" is insufficient for commercial formats.
3. STORY ENGINE: sustainability_validation.narrative_fuel must describe the repeatable mechanism that generates conflict. For episodic formats, this must sustain multiple episodes.
4. RELATIONSHIP TENSION AXIS: sustainability_validation.character_engine must identify the primary dramatic relationship between at least two named character archetypes with opposing needs/values.
5. MARKET HOOK: differentiation_analysis.unique_angle must be a concrete commercial differentiator, not just genre labels. One sentence that would make a buyer lean forward.
6. LANE FIT: The entire analysis must be tailored to the declared lane (${lane}) and format (${format}). A feature premise forced into series is a structural failure.
${laneStructuralBlock}

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
    "core_concept": "string — must include protagonist identity and objective",
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
    "unique_angle": "string — the concrete market hook that distinguishes this from competitors",
    "comparable_gap": "string",
    "market_white_space": "string"
  },
  "sustainability_validation": {
    "narrative_fuel": "string — the repeatable conflict engine (MUST be specific and renewable)",
    "character_engine": "string — protagonist vs. key relationship axis with opposing values",
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
    "natural_pressure_source": "string — MUST be an external force for commercial formats"
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
    return new Response(null, { status: 200, headers: corsHeaders });
  }

  let body: any = {};
  try {
    body = await req.json();
  } catch {
    body = {};
  }

  try {
    const authHeader = req.headers.get("authorization") || req.headers.get("Authorization") || "";
    const bearer = authHeader.replace(/^Bearer\s+/i, "").trim();
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    let apiKey: string;
    try {
      const gw = resolveGateway();
      apiKey = gw.apiKey;
    } catch {
      return jsonRes({ error: "AI API key not configured" }, 500);
    }

    const forwardedUserId = body?.userId ?? body?.user_id ?? null;
    let actorUserId: string | null = null;
    let isServiceRole = false;

    if (serviceKey && bearer === serviceKey) {
      isServiceRole = true;
    } else if (bearer.split(".").length === 3) {
      try {
        let seg = bearer.split(".")[1].replace(/-/g, "+").replace(/_/g, "/");
        seg += "=".repeat((4 - (seg.length % 4)) % 4);
        const payload = JSON.parse(atob(seg));
        if (payload.role === "service_role") isServiceRole = true;
      } catch {
        // ignore decode errors
      }
    }

    const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const serviceClient = createClient(supabaseUrl, serviceKey);
    const rlsClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader || `Bearer ${bearer}` } },
    });
    const db = isServiceRole ? serviceClient : rlsClient;

    if (isServiceRole) {
      actorUserId = forwardedUserId;
    } else {
      const { data: { user: authUser }, error: authErr } = await rlsClient.auth.getUser(bearer);
      if (authErr || !authUser) {
        return jsonRes({ error: "Unauthorized" }, 401);
      }
      actorUserId = authUser.id;
    }

    // Ping support
    if ((body as any).action === "ping") return jsonRes({ ok: true, function: "generate-seed-pack" });

    const { projectId, pitch, lane, targetPlatform, riskOverride, commitOnly, necOverride } = body as SeedPackPayload;

    if (!projectId || !pitch || !lane) {
      return jsonRes({ success: false, insertedCount: 0, updatedCount: 0, error: "projectId, pitch, and lane are required" }, 400);
    }

    // Access check via db (RLS-scoped for users, admin for service_role)
    const { data: project, error: projErr } = await db
      .from("projects")
      .select("id, title, format, genres, assigned_lane, budget_range, tone, target_audience, resolved_qualifications_hash")
      .eq("id", projectId)
      .single();

    if (projErr || !project) {
      return jsonRes({ error: "Project not found or access denied" }, 404);
    }

    // Fallback: service_role without forwarded userId => project owner
    if (isServiceRole && !actorUserId) {
      const { data: ownerProject } = await serviceClient
        .from("projects")
        .select("user_id")
        .eq("id", projectId)
        .single();
      actorUserId = ownerProject?.user_id ?? null;
    }

    console.log("[generate-seed-pack] auth", {
      isServiceRole,
      hasForwardedUserId: !!forwardedUserId,
      hasActorUserId: !!actorUserId,
      projectId,
    });

    if (!actorUserId) {
      return jsonRes({ error: "MISSING_USER_ID", detail: "No forwarded userId and project has no user_id" }, 400);
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

        const { data: newVer, error: vErr } = await adminClient
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
            depends_on_resolver_hash: project.resolved_qualifications_hash || null,
            generator_id: "seed-pack",
            inputs_used: { seed_source: "generate-seed-pack", nec_override: true, project_id: projectId },
          })
          .select("id")
          .single();

        if (vErr) {
          console.error("NEC commit version insert failed:", vErr);
          return jsonRes({ error: "Failed to commit NEC version" }, 500);
        }
        // PATCH A2: Set latest_version_id for NEC commitOnly (existing doc)
        if (newVer?.id) {
          await adminClient.from("project_documents").update({ latest_version_id: newVer.id }).eq("id", documentId);
          console.log(`[generate-seed-pack] latest_version_id set for NEC doc ${documentId} → ${newVer.id}`);
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

        const { data: newVer2, error: vErr } = await adminClient
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
            depends_on_resolver_hash: project.resolved_qualifications_hash || null,
            generator_id: "seed-pack",
            inputs_used: { seed_source: "generate-seed-pack", nec_override: true, project_id: projectId },
          })
          .select("id")
          .single();

        if (vErr) {
          console.error("NEC commit version insert failed:", vErr);
          return jsonRes({ error: "Failed to commit NEC version" }, 500);
        }
        // PATCH A2: Set latest_version_id for NEC commitOnly (new doc)
        if (newVer2?.id) {
          await adminClient.from("project_documents").update({ latest_version_id: newVer2.id }).eq("id", documentId);
          console.log(`[generate-seed-pack] latest_version_id set for new NEC doc ${documentId} → ${newVer2.id}`);
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

    // ── PROPULSION VALIDATOR (deterministic, fail-closed) ──
    const seedIsEpisodic = ["tv-series", "limited-series", "digital-series", "vertical-drama", "anim-series", "reality", "series"].includes(lane);
    const seedIsVD = lane === "vertical-drama";

    function classifySeedPropulsion(p: any): { sources: string[]; primary: string | null; durable: boolean; failures: string[] } {
      const sv = p.sustainability_validation || {};
      const da = p.differentiation_analysis || {};
      const eit = p.engine_inevitability_test || {};
      const cd = p.concept_distillation || {};
      const sources: string[] = [];
      const failures: string[] = [];

      const fuel = String(sv.narrative_fuel || "").trim();
      const charEng = String(sv.character_engine || "").trim();
      const pressure = String(eit.natural_pressure_source || "").trim();
      const concept = String(cd.core_concept || "").trim();

      // 1. Protagonist objective
      if (concept.length >= 15 && !/vague|unclear/i.test(concept)) sources.push("protagonist_objective");
      // 2. External pressure engine
      if (pressure.length >= 15 && !/internal conflict alone|purely internal|self-doubt only/i.test(pressure)) sources.push("external_pressure_engine");
      // 3. Relationship escalation
      if (charEng.length >= 15 && /escala|forbidden|betray|rival|scandal|contract|trap|obligation|tension|conflict|pressure/i.test(charEng)) sources.push("relationship_escalation_engine");
      // 4. Investigation
      if (/investig|mystery|uncover|secret|conspiracy|detective|solve|revelation/i.test(fuel)) sources.push("investigation_engine");
      // 5. Survival
      if (/surviv|threat|siege|escape|hunted|pursuit|trapped|life.or.death/i.test(fuel)) sources.push("survival_threat_engine");
      // 6. Competition/system
      if (/compet|career|system|institution|corporate|political|ambition|power.struggle|status/i.test(fuel) ||
          /compet|career|system|institution|corporate|political/i.test(pressure)) sources.push("competition_system_engine");

      // Field presence
      if (!da.unique_angle || String(da.unique_angle).trim().length < 10) failures.push("missing_market_hook");
      if (fuel.length < 15) failures.push("missing_story_engine");

      let durable = sources.length > 0;
      if (seedIsVD) {
        const hasRepeatable = sources.some(s => s !== "protagonist_objective");
        if (!hasRepeatable) { durable = false; failures.push("vd_no_durable_serial_propulsion"); }
        if (!sv.longevity_assessment || String(sv.longevity_assessment).trim().length < 10) failures.push("missing_serial_scalability");
      } else if (seedIsEpisodic) {
        if (sources.length <= 1 && !sources.some(s => s !== "protagonist_objective")) { durable = false; failures.push("episodic_weak_propulsion"); }
      }

      return { sources, primary: sources[0] || null, durable, failures };
    }

    let seedPropulsion = classifySeedPropulsion(parsed);
    console.log(`[generate-seed-pack][IEL] propulsion_validator { project_id: "${projectId}", lane: "${lane}", sources: ${JSON.stringify(seedPropulsion.sources)}, durable: ${seedPropulsion.durable}, failures: ${JSON.stringify(seedPropulsion.failures)} }`);

    // ── SINGLE REPAIR RETRY if propulsion fails ──
    if (!seedPropulsion.durable || seedPropulsion.failures.length > 0) {
      console.warn(`[generate-seed-pack][IEL] propulsion_repair_triggered { project_id: "${projectId}", failures: ${JSON.stringify(seedPropulsion.failures)} }`);
      try {
        const repairPrompt = `STRUCTURAL REPAIR. Previous output had failures: ${seedPropulsion.failures.join(", ")}.
Fix by strengthening propulsion sources. Allowed propulsion types: protagonist_objective, external_pressure_engine, relationship_escalation_engine, investigation_engine, survival_threat_engine, competition_system_engine.
A reactive protagonist is ALLOWED if supported by durable external propulsion.
${seedIsVD ? "VERTICAL DRAMA: needs repeatable 30+ episode external escalation, not just romance/vibe." : ""}
Preserve the concept. Return the same JSON schema with structural elements strengthened.`;

        const repairResult = await callLLM({
          apiKey,
          model: MODELS.FAST,
          system: systemPrompt + "\n\n" + repairPrompt,
          user: `Repair this seed pack:\n\n${JSON.stringify(parsed, null, 2)}`,
          temperature: 0.2,
          maxTokens: 8000,
          retries: 0,
        });

        const repairCleaned = extractJSON(repairResult.content);
        const repaired = JSON.parse(repairCleaned);
        const repairPropulsion = classifySeedPropulsion(repaired);
        console.log(`[generate-seed-pack][IEL] propulsion_repair_result { project_id: "${projectId}", sources: ${JSON.stringify(repairPropulsion.sources)}, durable: ${repairPropulsion.durable} }`);

        if (repairPropulsion.durable && repairPropulsion.failures.length === 0) {
          // Merge repaired analysis keys back while preserving structure
          for (const key of ["concept_distillation", "emotional_thesis", "differentiation_analysis",
            "sustainability_validation", "polarity_lock", "engine_inevitability_test", "failure_modes",
            "risk_posture", "narrative_energy_contract", "final_seed_docs", "compression"]) {
            if (repaired[key]) parsed[key] = repaired[key];
          }
          parsed._structural_repaired = true;
          seedPropulsion = repairPropulsion;
        }
      } catch (repairErr) {
        console.error(`[generate-seed-pack] Repair retry failed:`, repairErr);
      }
    }

    parsed._propulsion_sources = seedPropulsion.sources;
    parsed._propulsion_primary = seedPropulsion.primary;
    parsed._structural_pass = seedPropulsion.durable && seedPropulsion.failures.length === 0;
    parsed._structural_failures = seedPropulsion.failures;

    if (!parsed._structural_pass) {
      console.error(`[generate-seed-pack][IEL] propulsion_gate_blocked { project_id: "${projectId}", failures: ${JSON.stringify(seedPropulsion.failures)} }`);
      return jsonRes({
        success: false, insertedCount: 0, updatedCount: 0,
        error: "Seed lacks durable propulsion after repair attempt",
        structural_failures: seedPropulsion.failures,
        propulsion_sources: seedPropulsion.sources,
      }, 422);
    }

    console.log(`[generate-seed-pack][IEL] propulsion_gate_passed { project_id: "${projectId}", sources: ${JSON.stringify(seedPropulsion.sources)}, repaired: ${parsed._structural_repaired || false} }`);

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
          dependsOnResolverHash: project.resolved_qualifications_hash || undefined,
          generatorId: "seed-pack",
          inputsUsed: { seed_source: "generate-seed-pack", project_id: projectId, doc_type: cfg.doc_type, ...(parsed.provenance || {}) },
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
