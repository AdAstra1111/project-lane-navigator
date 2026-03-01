import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import { buildBeatGuidanceBlock } from "../_shared/verticalDramaBeats.ts";
import { generateEpisodeBeatsChunked } from "../_shared/episodeBeatsChunked.ts";
import { buildLadderPromptBlock, formatToLane } from "../_shared/documentLadders.ts";
import { EPISODE_DOC_TYPES, extractEpisodeNumbersFromOutput, detectCollapsedRangeSummaries } from "../_shared/episodeScope.ts";
import { isLargeRiskDocType, isEpisodicDocType as isLargeRiskEpisodic, chunkPlanFor, strategyFor } from "../_shared/largeRiskRouter.ts";
import { runChunkedGeneration } from "../_shared/chunkRunner.ts";
import { validateEpisodicContent, hasBannedSummarizationLanguage } from "../_shared/chunkValidator.ts";
import {
  buildNuancePromptBlock, computeMetrics, melodramaScore, nuanceScore,
  runGate, buildRepairInstruction, computeFingerprint, computeSimilarityRisk,
  type NuanceParams,
} from "../_shared/nuanceEngine.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

// ─── Document Dependency Map (mirrors src/lib/document-dependencies.ts) ───

const DOC_DEPENDENCY_MAP: Record<string, string[]> = {
  pitch_document: ["qualifications.season_episode_count", "qualifications.episode_target_duration_seconds"],
  season_arc: ["qualifications.season_episode_count", "qualifications.episode_target_duration_seconds"],
  episode_grid: ["qualifications.season_episode_count", "qualifications.episode_target_duration_seconds"],
  vertical_episode_beats: ["qualifications.season_episode_count", "qualifications.episode_target_duration_seconds"],
  vertical_market_sheet: ["qualifications.season_episode_count", "qualifications.episode_target_duration_seconds"],
  series_overview: ["qualifications.season_episode_count"],
  format_rules: ["qualifications.episode_target_duration_seconds"],
  pilot_script: ["qualifications.episode_target_duration_seconds"],
  pilot_outline: ["qualifications.episode_target_duration_seconds"],
  season_scripts_bundle: ["qualifications.season_episode_count", "qualifications.episode_target_duration_seconds"],
  future_seasons_map: ["qualifications.season_episode_count"],
  character_bible: ["qualifications.season_episode_count"],
  feature_outline: ["qualifications.target_runtime_min_low", "qualifications.target_runtime_min_high"],
  screenplay_draft: ["qualifications.target_runtime_min_low", "qualifications.target_runtime_min_high"],
  long_synopsis: ["qualifications.target_runtime_min_low", "qualifications.target_runtime_min_high"],
};

// ─── Upstream dependency map: which doc_types feed into others ───

const UPSTREAM_DEPS: Record<string, string[]> = {
  logline: ["idea_brief"],
  one_pager: ["idea_brief", "logline"],
  long_synopsis: ["one_pager", "logline"],
  treatment: ["long_synopsis", "character_bible", "concept_brief", "market_sheet"],
  character_bible: ["idea_brief", "logline", "concept_brief"],
  feature_outline: ["treatment", "character_bible"],
  screenplay_draft: ["feature_outline", "character_bible", "treatment"],
  series_overview: ["idea_brief", "logline", "concept_brief", "market_sheet"],
  season_arc: ["series_overview", "character_bible", "concept_brief", "market_sheet"],
  episode_grid: ["season_arc", "character_bible", "concept_brief"],
  vertical_episode_beats: ["episode_grid", "season_arc", "character_bible", "format_rules"],
  pilot_outline: ["episode_grid", "character_bible"],
  pilot_script: ["pilot_outline", "character_bible"],
  format_rules: ["idea_brief", "concept_brief"],
  vertical_market_sheet: ["idea_brief", "concept_brief"],
  season_scripts_bundle: ["episode_grid", "vertical_episode_beats", "character_bible"],
  future_seasons_map: ["season_arc", "series_overview"],
  topline_narrative: ["idea", "idea_brief", "concept_brief", "market_sheet", "vertical_market_sheet", "blueprint"],
  budget_topline: ["treatment"],
  finance_plan: ["budget_topline"],
  packaging_targets: ["treatment", "character_bible", "concept_brief", "market_sheet"],
  production_plan: ["budget_topline"],
  delivery_requirements: [],
  story_arc_plan: ["doc_premise_brief", "research_dossier"],
  shoot_plan: ["story_arc_plan"],
};

// ── Cycle & self-dep guard (runs once at cold start) ──
try {
  for (const [dt, deps] of Object.entries(UPSTREAM_DEPS)) {
    if (deps.includes(dt)) throw new Error(`UPSTREAM_DEPS self-dep: ${dt}`);
  }
  // BFS cycle check
  for (const start of Object.keys(UPSTREAM_DEPS)) {
    const visited = new Set<string>();
    const queue = [...(UPSTREAM_DEPS[start] || [])];
    while (queue.length > 0) {
      const cur = queue.shift()!;
      if (cur === start) throw new Error(`UPSTREAM_DEPS cycle: ${start} → ... → ${start}`);
      if (visited.has(cur)) continue;
      visited.add(cur);
      for (const dep of (UPSTREAM_DEPS[cur] || [])) queue.push(dep);
    }
  }
} catch (e: any) {
  console.error(`[generate-document] FATAL dep graph error: ${e.message}`);
}

// ── Convergence guidance section extractor (pure string, no LLM) ──
const CONVERGENCE_HEADINGS = [
  "## Creative DNA Targets (From Trend Convergence)",
  "## Convergence Guidance (Audience Appetite Context)",
];
const MAX_GUIDANCE_EXTRACT_CHARS = 2000;

function extractConvergenceGuidance(upstreamBlocks: Map<string, string>): string {
  const extracts: string[] = [];
  // Deterministic order: concept_brief first, then market_sheet
  for (const dt of ["concept_brief", "market_sheet"]) {
    const text = upstreamBlocks.get(dt);
    if (!text) continue;
    for (const heading of CONVERGENCE_HEADINGS) {
      const idx = text.indexOf(heading);
      if (idx === -1) continue;
      const afterHeading = text.slice(idx);
      // Find next ## heading (or end)
      const nextH2 = afterHeading.indexOf("\n## ", heading.length);
      const section = nextH2 > 0 ? afterHeading.slice(0, nextH2).trim() : afterHeading.trim();
      if (section.length > 0) extracts.push(section);
    }
  }
  if (extracts.length === 0) return "";
  let combined = extracts.join("\n\n");
  if (combined.length > MAX_GUIDANCE_EXTRACT_CHARS) {
    combined = combined.slice(0, MAX_GUIDANCE_EXTRACT_CHARS) + "\n[truncated]";
  }
  return `=== CONVERGENCE GUIDANCE EXTRACT (FROM DOCS) ===\n${combined}\n=== END CONVERGENCE GUIDANCE EXTRACT ===`;
}

// ── Per-doc context cap ──
const MAX_PER_DOC_CHARS = 12000;

// ─── LLM Gateway ───

const GATEWAY_URL = "https://ai.gateway.lovable.dev/v1/chat/completions";

async function callLLM(apiKey: string, system: string, user: string, model = "google/gemini-2.5-flash"): Promise<string> {
  const res = await fetch(GATEWAY_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({
      model,
      messages: [{ role: "system", content: system }, { role: "user", content: user }],
      temperature: 0.5,
      max_tokens: 65000,
    }),
  });
  if (!res.ok) throw new Error(`LLM call failed: ${res.status}`);
  const data = await res.json();
  return data.choices?.[0]?.message?.content || "";
}

// ─── Handler ───

Deno.serve(async (req) => {
  const jsonRes = (payload: Record<string, any>, status = 200) => new Response(JSON.stringify(payload), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

  if (req.method === "OPTIONS") return jsonRes({ ok: true });

  try {
    const authHeader = req.headers.get("authorization") || "";
    const bearer = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : null;
    if (!bearer) return jsonRes({ error: "Unauthorized" }, 401);

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const apiKey = Deno.env.get("LOVABLE_API_KEY") || serviceKey;

    const body = await req.json();
    const forwardedUserId = body?.userId ?? body?.user_id ?? null;

    // Detect service-role caller (raw key match OR JWT with role claim)
    let isServiceRole = false;
    if (bearer === serviceKey) {
      isServiceRole = true;
    } else if (bearer.split(".").length === 3) {
      try {
        const payloadB64 = bearer.split(".")[1].replace(/-/g, "+").replace(/_/g, "/");
        const padded = payloadB64 + "=".repeat((4 - payloadB64.length % 4) % 4);
        const payload = JSON.parse(atob(padded));
        if (payload.role === "service_role") isServiceRole = true;
      } catch {
        // not a JWT, continue in user-auth path
      }
    }

    const serviceClient = createClient(supabaseUrl, serviceKey);
    const rlsClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: `Bearer ${bearer}` } },
    });

    let actorUserId: string | null = null;
    if (!isServiceRole) {
      const { data: { user }, error: userErr } = await rlsClient.auth.getUser(bearer);
      if (userErr || !user) return jsonRes({ error: "Unauthorized" }, 401);
      actorUserId = user.id;
    } else {
      actorUserId = forwardedUserId;
    }

    const db = isServiceRole ? serviceClient : rlsClient;
    const supabase = db;

    console.log("[generate-document] auth", { fn: "generate-document", isServiceRole, hasActorUserId: !!actorUserId, hasForwardedUserId: !!forwardedUserId, action: body?.action ?? null });

    // Ping support
    if ((body as any).action === "ping") return jsonRes({ ok: true, function: "generate-document" });

    const { projectId, docType, mode = "draft", generatorId = "generate-document", generatorRunId, additionalContext } = body;

    // Extract nuance parameters (with defaults)
    const nuanceParams: NuanceParams = {
      restraint: body.nuance?.restraint ?? 70,
      story_engine: body.nuance?.story_engine ?? 'pressure_cooker',
      causal_grammar: body.nuance?.causal_grammar ?? 'accumulation',
      drama_budget: body.nuance?.drama_budget ?? 2,
      anti_tropes: body.nuance?.anti_tropes ?? [],
      diversify: body.nuance?.diversify ?? true,
    };

    if (!projectId || !docType) return jsonRes({ error: "projectId and docType required" }, 400);

    // 1) Resolve qualifications
    const resolveRes = await fetch(`${supabaseUrl}/functions/v1/resolve-qualifications`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: authHeader,
      },
      body: JSON.stringify({ projectId }),
    });
    const resolveData = await resolveRes.json();
    if (!resolveRes.ok) throw new Error(resolveData.error || "resolve-qualifications failed");

    const resolvedQuals = resolveData.resolvedQualifications;
    const currentHash = resolveData.resolver_hash;

    // 2) Load project metadata
    const { data: project } = await supabase.from("projects")
      .select("title, format, pipeline_stage, guardrails_config, season_style_template_version_id, season_style_profile, user_id")
      .eq("id", projectId).single();

    if (!project) throw new Error("Project not found");

    if (isServiceRole && !actorUserId) {
      actorUserId = project.user_id || null;
    }

    // 3) Load upstream documents
    const upstreamTypes = UPSTREAM_DEPS[docType] || [];
    const inputsUsed: Record<string, any> = {};
    let upstreamContent = "";
    const upstreamBlocks = new Map<string, string>();

    if (upstreamTypes.length > 0) {
      // Get all project_documents for this project
      const { data: allDocs } = await supabase.from("project_documents")
        .select("id, doc_type, latest_version_id")
        .eq("project_id", projectId)
        .in("doc_type", upstreamTypes);

      const versionIds = (allDocs || [])
        .filter((d: any) => d.latest_version_id)
        .map((d: any) => d.latest_version_id);

      let versionMap = new Map<string, any>();
      if (versionIds.length > 0) {
        const { data: versions } = await supabase.from("project_document_versions")
          .select("id, document_id, version_number, status, plaintext")
          .in("id", versionIds);
        versionMap = new Map((versions || []).map((v: any) => [v.id, v]));
      }

      for (const doc of (allDocs || [])) {
        const version = doc.latest_version_id ? versionMap.get(doc.latest_version_id) : null;
        if (version) {
          inputsUsed[doc.doc_type] = {
            version_id: version.id,
            version_number: version.version_number,
          };
          let plaintext = version.plaintext || "(empty)";
          // Per-doc cap to keep prompt size stable
          if (plaintext.length > MAX_PER_DOC_CHARS) {
            const headChars = Math.floor(MAX_PER_DOC_CHARS * 0.6);
            const tailChars = MAX_PER_DOC_CHARS - headChars;
            plaintext = plaintext.slice(0, headChars) + "\n\n[...content trimmed for context budget...]\n\n" + plaintext.slice(-tailChars);
          }
          upstreamBlocks.set(doc.doc_type, plaintext);
          upstreamContent += `\n\n--- ${doc.doc_type.toUpperCase()} (v${version.version_number}) ---\n${plaintext}`;
        }
      }
    }

    // 3b) Extract convergence guidance as compact preface (truncation-safe)
    const guidanceExtract = extractConvergenceGuidance(upstreamBlocks);
    if (guidanceExtract) {
      upstreamContent = `\n\n${guidanceExtract}\n${upstreamContent}`;
    }

    console.log(`[generate-document] context: docType=${docType} upstreamTypes=${upstreamTypes.length} totalChars=${upstreamContent.length} guidanceExtracted=${!!guidanceExtract}`);

    // 4) Build prompt with HARD BINDING
    const durMin = resolvedQuals.episode_target_duration_min_seconds || resolvedQuals.episode_target_duration_seconds || null;
    const durMax = resolvedQuals.episode_target_duration_max_seconds || resolvedQuals.episode_target_duration_seconds || null;
    const durMid = durMin && durMax ? Math.round((durMin + durMax) / 2) : (durMin || durMax || null);
    const durRangeStr = (durMin && durMax && durMin !== durMax)
      ? `${durMin}–${durMax} seconds (midpoint ${durMid}s)`
      : `${durMid || 'N/A'} seconds`;

    // Beat guidance for vertical drama
    const isVerticalDrama = (resolvedQuals.format || project.format || '').toLowerCase().includes('vertical');
    const beatBlock = isVerticalDrama ? buildBeatGuidanceBlock(durMin, durMax) : '';

    const qualBlock = [
      "## CANONICAL QUALIFICATIONS (MUST USE — override any conflicting values)",
      resolvedQuals.is_series ? `- Canonical season length: ${resolvedQuals.season_episode_count} episodes.` : null,
      resolvedQuals.is_series ? `- Canonical episode duration range: ${durRangeStr}.` : null,
      resolvedQuals.target_runtime_min_low ? `- Target runtime: ${resolvedQuals.target_runtime_min_low}–${resolvedQuals.target_runtime_min_high} minutes.` : null,
      `- Format: ${resolvedQuals.format}`,
      `- Replace any conflicting episode count or runtime references with canonical values above.`,
      beatBlock || null,
    ].filter(Boolean).join("\n");

    // Build style profile block if season template exists
    const styleProfile = project.season_style_profile;
    const hasStyleProfile = styleProfile && Object.keys(styleProfile).length > 0 && styleProfile.tone_tags;
    const styleBlock = hasStyleProfile ? [
      `## SEASON STYLE TEMPLATE (LOCKED CONSTRAINTS — must follow)`,
      styleProfile.tone_tags?.length > 0 ? `- Tone: ${styleProfile.tone_tags.join(', ')}` : null,
      styleProfile.pacing ? `- Pacing: ${styleProfile.pacing}` : null,
      styleProfile.dialogue_ratio ? `- Dialogue ratio target: ${Math.round(styleProfile.dialogue_ratio * 100)}%` : null,
      styleProfile.has_cliffhanger_pattern ? `- Must include cliffhanger ending pattern` : null,
      styleProfile.forbidden_elements?.length > 0 ? `- Forbidden elements: ${styleProfile.forbidden_elements.join(', ')}` : null,
      `- Style template version: ${project.season_style_template_version_id || 'n/a'}`,
    ].filter(Boolean).join("\n") : "";

    const completenessBlock = `## UNIVERSAL COMPLETENESS RULES (MANDATORY — IFFY STANDARD)

YOUR #1 JOB IS COMPLETENESS. Never output partial documents.

A) HARD UNIVERSAL RULES
1) NO GAPS / NO SKIPS — If the output contains numbered items (episodes, scenes, beats, steps, acts, chapters), include EVERY number in sequence. Never jump from EP5 to EP7. Never omit sections.
2) ALWAYS FINISH THE DOCUMENT — If too large to fully expand, complete it using MINIMUM COMPLETE PLACEHOLDER format. You are NOT allowed to stop early or give only highlights/anchors.
3) STRUCTURE FIRST, THEN DETAIL — Lock the full skeleton (all headings/slots), then populate each slot. If short on space, reduce detail per slot, NOT the number of slots.
4) SELF-CHECK IS MANDATORY — Before final output, confirm every required section/slot is present. If anything is missing, add it before responding.
5) NO HALLUCINATED FORMATS — Obey the requested format exactly.

B) MINIMUM COMPLETE PLACEHOLDER — If you cannot fully expand, use the smallest valid unit per slot:
- Episodic grids: each episode MUST have: HOOK (0–10s): / CORE MOVE / OBJECTIVE: / CLIFFHANGER / TURN:
- Beat sheets: BEAT 1: / BEAT 2: / BEAT 3: / CLIFFHANGER:
- Sections (briefs, sheets, bibles): 1–3 bullets per required section, never empty headings.

C) ANTI-ANCHOR MODE — You are FORBIDDEN from outputting only "key episodes", "highlights", "anchors", or "selected examples". If you include anchors, you MUST still include every missing connective episode as placeholders.

D) OUTPUT CONTRACT — At the top of your response, print:
- Deliverable Type: [type]
- Completion Status: COMPLETE (Full Detail) OR COMPLETE (Placeholder Detail)
- Completeness Check: PASS (no missing sections/slots)`;

    // ── Topline narrative: bespoke system + validator ──────────────────────────
    const isTopline = docType === "topline_narrative";

    let system: string;
    let userPrompt: string;

    if (isTopline) {
      // Hard-fail if no source docs exist
      if (!upstreamContent.trim()) {
        return new Response(JSON.stringify({
          error: "no_source_documents",
          message: "No source documents found (Idea, Concept Brief, Market Sheet, or Blueprint). Add at least one document before generating the Topline Narrative.",
        }), { status: 422, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }

      const isSeries = resolvedQuals.is_series;

      system = [
        `You are a senior script editor generating a TOPLINE NARRATIVE document for a ${project.format || "film/TV"} project.`,
        `Project title: "${project.title}"`,
        ``,
        `## OUTPUT FORMAT (USE EXACTLY — no other headings)`,
        ``,
        `# TOPLINE NARRATIVE`,
        ``,
        `## LOGLINE`,
        `[Write 1–2 sentences only — ONE crisp logline using the project-specific details below]`,
        ``,
        `## SHORT SYNOPSIS`,
        `[150–300 words. Describe what actually happens: protagonist, goal, conflict, stakes, world. Use project specifics.]`,
        ``,
        `## LONG SYNOPSIS`,
        `[~1–2 pages (400–700 words). Cover the full story arc: setup → escalation → climax → resolution.]`,
        ``,
        `## STORY PILLARS`,
        `- Theme: [core thematic statement specific to this project]`,
        `- Protagonist: [name, role, specific want vs. need]`,
        `- Goal: [concrete objective]`,
        `- Stakes: [specific consequence of failure]`,
        `- Antagonistic force: [person, system, or internal conflict]`,
        `- Setting: [world, era, specific environment]`,
        `- Tone: [tonal descriptors, comps]`,
        `- Comps: [2–3 real comparable titles with brief rationale]`,
        isSeries ? `\n## SERIES ONLY\n- Series promise / engine: [the engine that drives episode-to-episode tension]\n- Season arc snapshot: [what changes from ep 1 to season finale]` : "",
        ``,
        `## CRITICAL RULES`,
        `1. FILL EVERY SECTION with project-specific content from the PROJECT FACTS block below.`,
        `2. NEVER output placeholder brackets like [1–2 sentences] or [Theme:] in the final text.`,
        `3. NEVER repeat the template instructions — replace them with actual content.`,
        `4. If context is insufficient for a section, synthesize from what is available. Do not leave any section empty.`,
        `5. Begin your response DIRECTLY with "# TOPLINE NARRATIVE". No preamble.`,
        qualBlock,
        styleBlock,
      ].filter(Boolean).join("\n");

      userPrompt = `PROJECT FACTS (use these as the primary source of truth):\n${upstreamContent}\n\nGenerate the full Topline Narrative for "${project.title}" now. Replace every template placeholder with real content derived from the project facts above.`;
    } else {
      const ladderBlock = buildLadderPromptBlock(formatToLane(project.format));
      const nuanceBlock = buildNuancePromptBlock(nuanceParams);

      system = [
        `You are a professional development document generator for film/TV projects.`,
        `Generate a ${docType.replace(/_/g, " ")} document for the project "${project.title}".`,
        `Production type: ${project.format || "film"}`,
        completenessBlock,
        qualBlock,
        styleBlock,
        ladderBlock,
        nuanceBlock,
        additionalContext ? `## CREATIVE DIRECTION (MUST INCORPORATE)\n${additionalContext}` : "",
        `If the upstream documents contain sections titled "Creative DNA Targets (From Trend Convergence)" or "Convergence Guidance (Audience Appetite Context)", treat them as strong recommendations for voice, tone, pacing, and world density while staying original.`,
        mode === "final" ? "This is a FINAL version — ensure completeness and polish." : "This is a DRAFT — focus on substance over polish.",
      ].filter(Boolean).join("\n\n");

      userPrompt = upstreamContent
        ? `Using the upstream documents below, generate the ${docType.replace(/_/g, " ")}.\n\n${upstreamContent}`
        : `Generate the ${docType.replace(/_/g, " ")} from scratch based on the project context.`;
    }

    // 5) Generate content
    let content: string;

    // ─────────────────────────────────────────────────────────────
    // EPISODE FORENSICS + ROUTING
    // Fires for: episode_grid, episode_beats, vertical_episode_beats
    // ─────────────────────────────────────────────────────────────
    const requestId = crypto.randomUUID();
    const isEpisodeDocType = EPISODE_DOC_TYPES.has(docType);

    // Episode count: prefer client override, then qualifiers, NO fallback
    const finalEpisodeCount: number | null =
      (body as any)?.episodeCount ?? resolvedQuals?.season_episode_count ?? null;

    if (isEpisodeDocType) {
      // A) DIAG_REQ — Request Context
      console.error(JSON.stringify({
        diag: "DIAG_REQ",
        requestId,
        timestamp: new Date().toISOString(),
        project_id: projectId,
        document_id: (body as any)?.documentId ?? (body as any)?.document_id ?? null,
        doc_type: docType,
        project_format: project?.format ?? null,
        user_id: actorUserId,
      }));

      // B) DIAG_EP_COUNT — Episode Count Resolution
      const clientEpCount = (body as any)?.episodeCount ?? null;
      const qualsEpCount = resolvedQuals?.season_episode_count ?? null;
      const episodeCountSource =
        clientEpCount != null ? "body.episodeCount"
        : qualsEpCount != null ? "resolvedQuals.season_episode_count"
        : "NONE";

      console.error(JSON.stringify({
        diag: "DIAG_EP_COUNT",
        requestId,
        candidates: { clientEpCount, qualsEpCount },
        finalEpisodeCount,
        episodeCountSource,
      }));

      if (finalEpisodeCount == null) {
        console.error(JSON.stringify({
          diag: "⚠️ DEFAULT_EPISODE_COUNT_USED",
          requestId,
          message: "All episode count sources are null — will return error",
        }));
      }

      if (finalEpisodeCount != null && finalEpisodeCount <= 8 &&
          ((clientEpCount != null && clientEpCount > 8) || (qualsEpCount != null && qualsEpCount > 8))) {
        console.error(JSON.stringify({
          diag: "⚠️ EPISODE_COUNT_COLLAPSE",
          requestId,
          message: `finalEpisodeCount=${finalEpisodeCount} but a source indicates >8`,
          candidates: { clientEpCount, qualsEpCount },
        }));
      }

      // C) DIAG_PATH — Generation Path
      console.error(JSON.stringify({
        diag: "DIAG_PATH",
        requestId,
        chunked_generator: finalEpisodeCount != null,
        single_shot_callLLM: false,
        branch_condition: "ALL episode doc types use chunked generator",
        batch_size: 6,
      }));

      // D) DIAG_UPSTREAM_DOCS — Upstream Document Forensics
      const upstreamDiag: any[] = [];
      if (upstreamTypes.length > 0) {
        const { data: diagDocs } = await supabase
          .from("project_documents")
          .select("id, doc_type, latest_version_id, project_id, created_at")
          .eq("project_id", projectId)
          .in("doc_type", upstreamTypes);

        const diagVIds = (diagDocs || [])
          .filter((d: any) => d.latest_version_id)
          .map((d: any) => d.latest_version_id);
        let diagVerMap = new Map<string, any>();
        if (diagVIds.length > 0) {
          const { data: diagVers } = await supabase
            .from("project_document_versions")
            .select("id, document_id, version_number, plaintext, created_at")
            .in("id", diagVIds);
          diagVerMap = new Map((diagVers || []).map((v: any) => [v.id, v]));
        }

        for (const doc of (diagDocs || [])) {
          const ver = doc.latest_version_id
            ? diagVerMap.get(doc.latest_version_id)
            : null;
          const snippet = ver?.plaintext
            ? ver.plaintext.substring(0, 300)
            : "(no content)";
          upstreamDiag.push({
            document_id: doc.id,
            project_id: doc.project_id,
            doc_type: doc.doc_type,
            latest_version_id: doc.latest_version_id ?? null,
            version_number: ver?.version_number ?? null,
            created_at: doc.created_at,
            content_first_300: snippet,
          });

          if (doc.project_id !== projectId) {
            console.error(JSON.stringify({
              diag: "⚠️ CROSS_PROJECT_LEAK",
              requestId,
              document_id: doc.id,
              doc_project_id: doc.project_id,
              request_project_id: projectId,
            }));
          }
        }
      }
      console.error(JSON.stringify({
        diag: "DIAG_UPSTREAM_DOCS",
        requestId,
        count: upstreamDiag.length,
        documents: upstreamDiag,
      }));

      // E) DIAG_MAYA_SCAN
      const mayaHits = {
        system_prompt: system.includes("Maya"),
        user_prompt: userPrompt.includes("Maya"),
        additionalContext: !!(additionalContext && additionalContext.includes("Maya")),
        upstreamContent: upstreamContent.includes("Maya"),
      };
      const mayaUpstreamDocs = upstreamDiag
        .filter(d => (d.content_first_300 || "").includes("Maya"))
        .map(d => ({
          document_id: d.document_id,
          doc_type: d.doc_type,
          project_id: d.project_id,
        }));
      const anyMaya = Object.values(mayaHits).some(Boolean);
      console.error(JSON.stringify({
        diag: "DIAG_MAYA_SCAN",
        requestId,
        found: anyMaya,
        locations: mayaHits,
        attributed_upstream_docs: mayaUpstreamDocs,
      }));

      if (anyMaya) {
        console.error(JSON.stringify({
          diag: "⚠️ MAYA_DETECTED",
          requestId,
          upstream_attribution: mayaUpstreamDocs,
        }));
      }
    }

    // ── Episode doc types: ALWAYS use chunked generator ──
    if (isEpisodeDocType) {
      if (finalEpisodeCount == null) {
        return new Response(JSON.stringify({
          error: "missing_episode_count",
          message: "Cannot generate episode document: season_episode_count is not set. Please set the episode count in project criteria or pass episodeCount in the request.",
        }), { status: 422, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }

      content = await generateEpisodeBeatsChunked({
        apiKey,
        episodeCount: finalEpisodeCount,
        systemPrompt: system,
        upstreamContent,
        projectTitle: project.title || "Untitled",
        requestId,
      });

      // F) DIAG_OUTPUT_VALIDATION
      const extractedEpNums = extractEpisodeNumbersFromOutput(content);
      const expectedRange = Array.from({ length: finalEpisodeCount }, (_, i) => i + 1);
      const missingEps = expectedRange.filter(n => !extractedEpNums.includes(n));
      const collapseDetected = detectCollapsedRangeSummaries(content);

      console.error(JSON.stringify({
        diag: "DIAG_OUTPUT_VALIDATION",
        requestId,
        extracted_episode_numbers: extractedEpNums,
        expected_range: `1-${finalEpisodeCount}`,
        total_extracted: extractedEpNums.length,
        total_expected: finalEpisodeCount,
        missing_episodes: missingEps,
        collapse_detected: collapseDetected,
        output_length_chars: content.length,
      }));

      if (missingEps.length > 0) {
        console.error(JSON.stringify({
          diag: "⚠️ TRUNCATION_DETECTED",
          requestId,
          missing_episodes: missingEps,
        }));
      }
      if (collapseDetected) {
        console.error(JSON.stringify({
          diag: "⚠️ COLLAPSE_SUMMARY_DETECTED",
          requestId,
          message: "Output contains collapsed range summaries — episodes may be abbreviated",
        }));
      }
    } else if (isLargeRiskDocType(docType) && !isTopline) {
      // ── Non-episodic large-risk doc: use chunked generation ──
      console.log(`[generate-document] Large-risk doc type "${docType}" — routing through chunk runner`);

      // Ensure doc record exists first
      let { data: chunkDocRecord } = await supabase.from("project_documents")
        .select("id").eq("project_id", projectId).eq("doc_type", docType).single();
      if (!chunkDocRecord) {
        const { data: newDoc, error: createErr } = await supabase.from("project_documents")
          .insert({
            project_id: projectId, doc_type: docType, user_id: actorUserId,
            file_name: `${docType}.md`, file_path: `${projectId}/${docType}.md`,
            extraction_status: "complete",
          }).select("id").single();
        if (createErr) throw new Error(`Failed to create doc record: ${createErr.message}`);
        chunkDocRecord = newDoc;
      }

      // Create version placeholder for chunks
      const { count: chunkVerCount } = await supabase.from("project_document_versions")
        .select("id", { count: "exact", head: true }).eq("document_id", chunkDocRecord!.id);
      const chunkVersionNum = (chunkVerCount || 0) + 1;
      const dependsOnFields = DOC_DEPENDENCY_MAP[docType] || [];
      const { data: chunkVersion, error: chunkVerErr } = await supabase.from("project_document_versions")
        .insert({
          document_id: chunkDocRecord!.id, version_number: chunkVersionNum,
          status: "draft", plaintext: "", created_by: actorUserId,
          depends_on: dependsOnFields, depends_on_resolver_hash: currentHash,
          inputs_used: inputsUsed,
        }).select("id").single();
      if (chunkVerErr) throw new Error(`Failed to create chunk version: ${chunkVerErr.message}`);

      const plan = chunkPlanFor(docType, {
        episodeCount: resolvedQuals?.season_episode_count,
        sceneCount: null,
      });

      const chunkResult = await runChunkedGeneration({
        supabase, apiKey, projectId,
        documentId: chunkDocRecord!.id, versionId: chunkVersion!.id,
        docType, plan, systemPrompt: system, upstreamContent,
        projectTitle: project.title || "Untitled",
        additionalContext, model: "google/gemini-2.5-flash",
        episodeCount: resolvedQuals?.season_episode_count,
        requestId,
      });

      content = chunkResult.assembledContent;

      // Update latest_version_id
      await supabase.from("project_documents")
        .update({ latest_version_id: chunkVersion!.id, updated_at: new Date().toISOString() })
        .eq("id", chunkDocRecord!.id);

      // Return early with chunk result
      return new Response(JSON.stringify({
        success: chunkResult.success,
        document_id: chunkDocRecord!.id,
        version_id: chunkVersion!.id,
        version_number: chunkVersionNum,
        mode,
        resolver_hash: currentHash,
        inputs_used: inputsUsed,
        depends_on: dependsOnFields,
        chunked: true,
        chunk_stats: {
          total: chunkResult.totalChunks,
          completed: chunkResult.completedChunks,
          failed: chunkResult.failedChunks,
          validation: chunkResult.validationResult,
        },
      }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    } else {
      content = await callLLM(apiKey, system, userPrompt);

      // Post-generation banned language check for non-large-risk docs
      if (hasBannedSummarizationLanguage(content)) {
        console.warn(`[generate-document] Banned summarization language detected in ${docType}, retrying`);
        const retrySystem = system + `\n\n⚠️ CRITICAL: Your output contained summarization language ("remaining episodes", "and so on", etc.). This is FORBIDDEN. Output COMPLETE content for every section/item. Never abbreviate or summarize.`;
        content = await callLLM(apiKey, retrySystem, userPrompt);
      }
    }

    // 6a) Topline placeholder validator (hard gate — never save template)
    if (isTopline) {
      const PLACEHOLDER_PATTERNS = [
        /\[\s*1[–-]2 sentences\s*\]/i,
        /\[\s*150[–-]300 words\s*\]/i,
        /\[\s*~?1[–-]2 pages\s*\]/i,
        /\[\s*Theme:\s*\]/i,
        /\[\s*Protagonist:\s*\]/i,
        /\[\s*Goal:\s*\]/i,
        /\[\s*Stakes:\s*\]/i,
        /\[\s*core thematic\s/i,
        /\[\s*name,\s*role\s/i,
        /\[\s*concrete objective\s*\]/i,
        /\[\s*specific consequence\s/i,
        /\[\s*Write 1[–-]2 sentences\s/i,
        /\[\s*400[–-]700 words\s*\]/i,
      ];

      const hasPlaceholders = PLACEHOLDER_PATTERNS.some(p => p.test(content));

      if (hasPlaceholders) {
        // One retry with even stronger instruction
        const retrySystem = system + `\n\n⚠️ CRITICAL FAILURE DETECTED: Your previous output contained literal bracket placeholders like [1–2 sentences] or [Theme:]. These are FORBIDDEN. Replace EVERY bracket placeholder with real, project-specific text. DO NOT output any text inside square brackets.`;
        content = await callLLM(apiKey, retrySystem, userPrompt);

        const stillHasPlaceholders = PLACEHOLDER_PATTERNS.some(p => p.test(content));
        if (stillHasPlaceholders) {
          return new Response(JSON.stringify({
            error: "template_not_filled",
            message: "Generated content still contains unfilled template placeholders. Generation blocked. Please ensure project context documents exist and retry.",
          }), { status: 422, headers: { ...corsHeaders, "Content-Type": "application/json" } });
        }
      }

      // Strip any Output Contract header if present (internal instruction, not user content)
      content = content.replace(/^Deliverable Type:.*?\n/gim, "").replace(/^Completion Status:.*?\n/gim, "").replace(/^Completeness Check:.*?\n/gim, "");

      // Ensure starts with the correct heading
      if (!content.trimStart().startsWith("# TOPLINE NARRATIVE")) {
        const match = content.match(/(#\s*TOPLINE NARRATIVE[\s\S]*)/i);
        if (match) content = match[1];
      }
    }

    // 6b) Post-generation validation (FAIL CLOSED for episode count)
    if (resolvedQuals.is_series && resolvedQuals.season_episode_count) {
      const expectedCount = resolvedQuals.season_episode_count;
      // Check for wrong episode counts in the output
      const wrongCountPattern = new RegExp(`\\b(\\d+)\\s+episode`, "gi");
      const matches = [...content.matchAll(wrongCountPattern)];
      const wrongCounts = matches.filter(m => parseInt(m[1]) !== expectedCount && parseInt(m[1]) > 1);

      if (wrongCounts.length > 0) {
        // Regenerate with stronger instruction
        const strongerSystem = system + `\n\nCRITICAL: The output MUST reference exactly ${expectedCount} episodes. Do NOT use any other episode count.`;
        content = await callLLM(apiKey, strongerSystem, userPrompt);

        // Check again
        const matches2 = [...content.matchAll(wrongCountPattern)];
        const stillWrong = matches2.filter(m => parseInt(m[1]) !== expectedCount && parseInt(m[1]) > 1);
        if (stillWrong.length > 0) {
          return new Response(JSON.stringify({
            error: "episode_count_conflict",
            message: `Generated content references ${stillWrong[0][1]} episodes instead of canonical ${expectedCount}. Generation blocked.`,
            expected: expectedCount,
            found: stillWrong.map(m => parseInt(m[1])),
          }), {
            status: 422, headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }
      }
    }

    // ── NUANCE GATE (deterministic, repair once) ──────────────────────────────
    const lane = formatToLane(project.format);
    const metrics0 = computeMetrics(content);
    const fp = computeFingerprint(content, lane, nuanceParams.story_engine, nuanceParams.causal_grammar);

    // Fetch recent fingerprints for diversity defense
    let simRisk = 0;
    if (nuanceParams.diversify) {
      const { data: recentRuns } = await supabase.from("nuance_runs")
        .select("fingerprint")
        .eq("project_id", projectId)
        .order("created_at", { ascending: false })
        .limit(10);
      const recentFps = (recentRuns || []).map((r: any) => r.fingerprint).filter(Boolean);
      simRisk = computeSimilarityRisk(fp, recentFps);
    }

    const attempt0 = runGate(metrics0, lane, nuanceParams, simRisk);
    let attempt1 = null;
    let repairInst: string | null = null;

    // If gate fails, build repair instruction and retry ONCE
    if (!attempt0.pass && !isEpisodeDocType) {
      repairInst = buildRepairInstruction(attempt0.failures, nuanceParams.anti_tropes);
      const repairSystem = system + `\n\n## NUANCE REPAIR (MANDATORY)\n${repairInst}`;
      content = await callLLM(apiKey, repairSystem, userPrompt);
      const metrics1 = computeMetrics(content);
      attempt1 = runGate(metrics1, lane, nuanceParams, simRisk);
    }

    const finalGate = attempt1 || attempt0;
    const nuanceGateResult = {
      attempt0: { pass: attempt0.pass, failures: attempt0.failures, metrics: attempt0.metrics, melodrama_score: attempt0.melodrama_score, nuance_score: attempt0.nuance_score },
      ...(attempt1 ? { attempt1: { pass: attempt1.pass, failures: attempt1.failures, metrics: attempt1.metrics, melodrama_score: attempt1.melodrama_score, nuance_score: attempt1.nuance_score } } : {}),
      final: { pass: finalGate.pass, failures: finalGate.failures, melodrama_score: finalGate.melodrama_score, nuance_score: finalGate.nuance_score },
      ...(repairInst ? { repair_instruction: repairInst } : {}),
    };

    console.error(JSON.stringify({
      diag: "NUANCE_GATE",
      requestId,
      attempt0_pass: attempt0.pass,
      attempt0_failures: attempt0.failures,
      attempt1_pass: attempt1?.pass ?? null,
      final_pass: finalGate.pass,
      melodrama_score: finalGate.melodrama_score,
      nuance_score: finalGate.nuance_score,
      similarity_risk: simRisk,
    }));

    let { data: docRecord } = await supabase.from("project_documents")
      .select("id")
      .eq("project_id", projectId)
      .eq("doc_type", docType)
      .single();

    if (!docRecord) {
      const { data: newDoc, error: createErr } = await supabase.from("project_documents")
        .insert({
          project_id: projectId,
          doc_type: docType,
          user_id: actorUserId,
          file_name: `${docType}.md`,
          file_path: `${projectId}/${docType}.md`,
          extraction_status: "complete",
        })
        .select("id")
        .single();
      if (createErr) throw new Error(`Failed to create doc record: ${createErr.message}`);
      docRecord = newDoc;
    }

    // 8) Get next version number
    const { count } = await supabase.from("project_document_versions")
      .select("id", { count: "exact", head: true })
      .eq("document_id", docRecord!.id);

    const versionNumber = (count || 0) + 1;
    const dependsOn = DOC_DEPENDENCY_MAP[docType] || [];

    // 9) Create version record
    const { data: newVersion, error: versionErr } = await supabase.from("project_document_versions")
      .insert({
        document_id: docRecord!.id,
        version_number: versionNumber,
        status: mode === "final" ? "final" : "draft",
        plaintext: content,
        created_by: actorUserId,
        depends_on: dependsOn,
        depends_on_resolver_hash: currentHash,
        inputs_used: inputsUsed,
        is_stale: false,
        stale_reason: null,
        generator_id: generatorId,
        generator_run_id: generatorRunId || null,
        source_document_ids: Object.values(inputsUsed).map((v: any) => v.version_id),
        style_template_version_id: project.season_style_template_version_id || null,
      })
      .select("id")
      .single();

    if (versionErr) throw new Error(`Failed to create version: ${versionErr.message}`);

    // 10) Update project_document pointer
    const updatePayload: Record<string, any> = {
      latest_version_id: newVersion!.id,
      updated_at: new Date().toISOString(),
    };

    // 11) If final: export to Storage
    if (mode === "final") {
      const format = (project.format || project.production_type || "film").toLowerCase().replace(/[_ ]+/g, "-");
      // Simple order lookup
      const orderStr = String(1).padStart(2, "0"); // Will be set by caller or computed
      const storagePath = `projects/${projectId}/package/${docType}/LATEST.md`;
      const encoder = new TextEncoder();
      const contentBytes = encoder.encode(content);

      await supabase.storage.from("projects").upload(storagePath, contentBytes, {
        contentType: "text/markdown",
        upsert: true,
      });

      updatePayload.latest_export_path = storagePath;

      // Mark older finals as superseded
      await supabase.from("project_document_versions")
        .update({ status: "superseded" })
        .eq("document_id", docRecord!.id)
        .neq("id", newVersion!.id)
        .eq("status", "final");
    }

    await supabase.from("project_documents")
      .update(updatePayload)
      .eq("id", docRecord!.id);

    // 12) Persist nuance run (fire-and-forget)
    try {
      await supabase.from("nuance_runs").insert({
        project_id: projectId,
        user_id: actorUserId,
        document_id: docRecord!.id,
        version_id: newVersion!.id,
        doc_type: docType,
        restraint: nuanceParams.restraint,
        story_engine: nuanceParams.story_engine,
        causal_grammar: nuanceParams.causal_grammar,
        drama_budget: nuanceParams.drama_budget,
        nuance_score: finalGate.nuance_score,
        melodrama_score: finalGate.melodrama_score,
        similarity_risk: simRisk,
        anti_tropes: nuanceParams.anti_tropes,
        constraint_pack: {},
        fingerprint: fp,
        nuance_metrics: finalGate.metrics,
        nuance_gate: nuanceGateResult,
        attempt: attempt1 ? 1 : 0,
      });
    } catch (nuanceErr: any) {
      console.error(JSON.stringify({ type: "NUANCE_RUN_PERSIST_ERROR", error: nuanceErr?.message }));
    }

    return new Response(JSON.stringify({
      success: true,
      document_id: docRecord!.id,
      version_id: newVersion!.id,
      version_number: versionNumber,
      mode,
      resolver_hash: currentHash,
      inputs_used: inputsUsed,
      depends_on: dependsOn,
      nuance: {
        nuance_score: finalGate.nuance_score,
        melodrama_score: finalGate.melodrama_score,
        similarity_risk: simRisk,
        gate_passed: finalGate.pass,
        repaired: !!attempt1,
        failures: finalGate.failures,
      },
    }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e: any) {
    console.error("[generate-document] error:", e);
    return jsonRes({
      error: e?.message || "Internal error",
      detail: e?.stack ? String(e.stack).split("\n").slice(0, 2).join(" | ") : undefined,
    }, 500);
  }
});
