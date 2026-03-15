import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import { isCPMEnabled, CPM_GENERATION_PROMPT_BLOCK, logCPM } from "../_shared/characterPressureMatrix.ts";
import { buildBeatGuidanceBlock } from "../_shared/verticalDramaBeats.ts";
import { resolveNarrativeContext, buildNarrativeContextBlock } from "../_shared/narrativeContextResolver.ts";
import { generateEpisodeBeatsChunked } from "../_shared/episodeBeatsChunked.ts";
import { buildLadderPromptBlock, formatToLane } from "../_shared/documentLadders.ts";
import { EPISODE_DOC_TYPES, extractEpisodeNumbersFromOutput, detectCollapsedRangeSummaries } from "../_shared/episodeScope.ts";
import { isLargeRiskDocType, isEpisodicDocType as isLargeRiskEpisodic, chunkPlanFor, strategyFor } from "../_shared/largeRiskRouter.ts";
import { runChunkedGeneration, resumeChunkedGeneration } from "../_shared/chunkRunner.ts";
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
  season_script: ["vertical_episode_beats", "character_bible", "season_arc", "episode_grid", "concept_brief", "format_rules"],
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
let DEP_GRAPH_VALID = true;
try {
  for (const [dt, deps] of Object.entries(UPSTREAM_DEPS)) {
    if (deps.includes(dt)) throw new Error(`UPSTREAM_DEPS self-dep: ${dt}`);
  }
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
  DEP_GRAPH_VALID = false;
  console.error(`[generate-document] FATAL dep graph error: ${e.message}`);
}

// ── Convergence guidance section extractor (pure string, no LLM) ──
const CONVERGENCE_HEADINGS = [
  "## Creative DNA Targets (From Trend Convergence)",
  "## Convergence Guidance (Audience Appetite Context)",
];
const MAX_GUIDANCE_EXTRACT_CHARS = 2000;
const MAX_SECTION_CHARS = 1200;

function extractConvergenceGuidance(upstreamBlocks: Map<string, string>): string {
  const extracts: string[] = [];
  const seen = new Set<string>();
  // Deterministic order: concept_brief first, then market_sheet
  for (const dt of ["concept_brief", "market_sheet"]) {
    const text = upstreamBlocks.get(dt);
    if (!text) continue;
    for (const heading of CONVERGENCE_HEADINGS) {
      const dedupKey = `${dt}::${heading}`;
      if (seen.has(dedupKey)) continue;
      const idx = text.indexOf(heading);
      if (idx === -1) continue;
      seen.add(dedupKey);
      // Find end of heading line, then search for next ## from there
      const headingEnd = text.indexOf("\n", idx + heading.length);
      if (headingEnd === -1) {
        const section = text.slice(idx).trim();
        if (section.length > 0) extracts.push(section.slice(0, MAX_SECTION_CHARS));
        continue;
      }
      const afterHeadingLine = text.slice(headingEnd + 1);
      const nextH2 = afterHeadingLine.search(/^\s*## /m);
      const bodyText = nextH2 >= 0 ? afterHeadingLine.slice(0, nextH2).trim() : afterHeadingLine.trim();
      const fullSection = (text.slice(idx, headingEnd + 1) + "\n" + bodyText).trim();
      if (fullSection.length > 0) extracts.push(fullSection.slice(0, MAX_SECTION_CHARS));
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

    // Dep graph validity gate
    if (!DEP_GRAPH_VALID) return jsonRes({ error: "DEP_GRAPH_INVALID", message: "UPSTREAM_DEPS contains a cycle or self-dependency. Cannot proceed." }, 500);

    const { projectId, docType, mode = "draft", generatorId = "generate-document", generatorRunId, additionalContext, sourceDocType, sourceVersionId } = body;

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
      .select("title, format, pipeline_stage, guardrails_config, season_style_template_version_id, season_style_profile, user_id, assigned_lane")
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
      // Get upstream project_documents for this project
      const { data: allDocs } = await supabase.from("project_documents")
        .select("id, doc_type, latest_version_id")
        .eq("project_id", projectId)
        .in("doc_type", upstreamTypes);

      const upstreamDocIds = (allDocs || []).map((d: any) => d.id);
      const versionsByDoc = new Map<string, any[]>();

      if (upstreamDocIds.length > 0) {
        const { data: versions } = await supabase.from("project_document_versions")
          .select("id, document_id, version_number, approval_status, is_current, plaintext, created_at")
          .in("document_id", upstreamDocIds)
          .order("version_number", { ascending: false });

        for (const v of (versions || [])) {
          const arr = versionsByDoc.get(v.document_id) || [];
          arr.push(v);
          versionsByDoc.set(v.document_id, arr);
        }
      }

      for (const doc of (allDocs || [])) {
        const candidates = versionsByDoc.get(doc.id) || [];
        const explicitSourceVersion =
          sourceVersionId && sourceDocType === doc.doc_type
            ? candidates.find((v: any) => v.id === sourceVersionId)
            : null;
        const version =
          explicitSourceVersion ||
          candidates.find((v: any) => v.approval_status === "approved" && v.is_current === true) ||
          candidates.find((v: any) => v.approval_status === "approved") ||
          (doc.latest_version_id ? candidates.find((v: any) => v.id === doc.latest_version_id) : null) ||
          candidates[0] ||
          null;

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

    // ── Narrative Context Resolver: NEC + canon + signals + decisions + voice ──
    const genLane = project.assigned_lane || "independent-film";
    const genFormat = (resolvedQuals.format || project.format || "film").toLowerCase().replace(/_/g, "-");
    const narrativeCtx = await resolveNarrativeContext(supabase, projectId, {
      lane: genLane,
      format: genFormat,
      includeSignals: true,
    });
    const narrativeBlock = buildNarrativeContextBlock(narrativeCtx);
    console.log(`[generate-document] narrative-context: hash=${narrativeCtx.metadata.resolverHash} signals=${narrativeCtx.metadata.counts.signals} decisions=${narrativeCtx.metadata.counts.decisions} canonChars=${narrativeCtx.metadata.counts.canonChars}`);

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
        narrativeBlock,
      ].filter(Boolean).join("\n");

      userPrompt = `PROJECT FACTS (use these as the primary source of truth):\n${upstreamContent}\n\nGenerate the full Topline Narrative for "${project.title}" now. Replace every template placeholder with real content derived from the project facts above.`;
    } else {
      const ladderBlock = buildLadderPromptBlock(formatToLane(project.format));
      const nuanceBlock = buildNuancePromptBlock(nuanceParams);

      // ── CPM_V1: inject Character Pressure Matrix block for episode_grid ──
      const cpmEnabled = isCPMEnabled();
      const cpmBlock = (cpmEnabled && docType === "episode_grid")
        ? CPM_GENERATION_PROMPT_BLOCK
        : "";
      if (cpmEnabled && docType === "episode_grid") {
        logCPM("cpm_v1_applied", { doc_type: "episode_grid", source: "generate-document" });
      }

      // ── CHARACTER_BIBLE_DEPTH_V1: inject depth checklist for character_bible ──
      let charBibleDepthBlock = "";
      try {
        const { isCharBibleDepthEnabled, CHARACTER_BIBLE_DEPTH_PROMPT_BLOCK } = await import("../_shared/ciBlockerGate.ts");
        if (isCharBibleDepthEnabled() && docType === "character_bible") {
          charBibleDepthBlock = CHARACTER_BIBLE_DEPTH_PROMPT_BLOCK;
          console.log(`[generate-document][IEL] char_bible_depth_v1_applied { doc_type: "character_bible" }`);
        }
      } catch { /* flag off or import fails — no-op */ }

      // ── VD_FORMAT_RULES_SEED: deterministic constraints for Vertical Drama format_rules ──
      let vdFormatRulesBlock = "";
      if (docType === "format_rules" && isVerticalDrama) {
        // Load pitch criteria from canon_json and project metadata
        let canonData: any = null;
        try {
          const { data: canonRow } = await supabase.from("project_canon")
            .select("canon_json").eq("project_id", projectId).maybeSingle();
          canonData = canonRow?.canon_json;
        } catch { /* no canon — proceed with defaults */ }

        const epCount = resolvedQuals.season_episode_count || canonData?.episode_count || 30;
        const epDurMin = durMin || 120;
        const epDurMax = durMax || 180;
        const epDurMidVal = Math.round((epDurMin + epDurMax) / 2);
        const budgetBand = canonData?.budget_band || canonData?.budgetBand || "micro-to-low";
        const culturalAnchor = canonData?.cultural_tag || canonData?.culturalTag || "";
        const toneAnchor = canonData?.tone_anchor || canonData?.toneAnchor || "";

        // Compute beat targets from shared module
        const vdBeatTargets = (await import("../_shared/verticalDramaBeats.ts")).computeBeatTargets({
          minSeconds: epDurMin,
          maxSeconds: epDurMax,
        });

        // Pacing heuristic from cultural anchor
        let pacingGuidance = "Standard scroll-stopping cadence with constant forward momentum.";
        const culturalLower = culturalAnchor.toLowerCase();
        if (culturalLower.includes("k-drama") || culturalLower.includes("korean")) {
          pacingGuidance = "K-drama rhythmic pacing: emotional swell → beat → reaction → cliffhanger. Lingering close-ups on emotional pivots. Restrained dialogue density.";
        } else if (culturalLower.includes("telenovela") || culturalLower.includes("latin")) {
          pacingGuidance = "Telenovela-driven pacing: rapid emotional reversals, confrontational dialogue peaks, dramatic reveals every 30–45 seconds.";
        } else if (culturalLower.includes("bollywood") || culturalLower.includes("indian")) {
          pacingGuidance = "Bollywood-influenced pacing: melodrama peaks balanced with intimate moments, musical/emotional punctuation points, family-centric tension arcs.";
        } else if (culturalLower.includes("anime") || culturalLower.includes("manga")) {
          pacingGuidance = "Anime-influenced pacing: hard cuts between action and stillness, internal monologue beats, visual metaphor moments, escalating power dynamics.";
        }

        // Budget discipline from budgetBand
        let budgetDiscipline = "Standard production constraints.";
        const budgetLower = budgetBand.toLowerCase();
        if (budgetLower.includes("micro") || budgetLower.includes("ultra-low")) {
          budgetDiscipline = "ULTRA-TIGHT BUDGET: Maximum 2 standing locations per episode. No crowd scenes. No VFX. No stunts. Cast limit: 3–5 principals per episode. Natural lighting preferred. Single-camera coverage.";
        } else if (budgetLower.includes("low")) {
          budgetDiscipline = "LOW BUDGET: Maximum 3 locations per episode. Minimal extras. No complex VFX. Cast limit: 5–7 principals per episode. Simple practical effects only.";
        } else if (budgetLower.includes("mid") || budgetLower.includes("medium")) {
          budgetDiscipline = "MID BUDGET: Maximum 4–5 locations per episode. Modest extras allowed. Simple VFX permitted. Cast limit: 8–10 principals per episode.";
        }

        vdFormatRulesBlock = `## VERTICAL DRAMA FORMAT RULES — DETERMINISTIC SEED (MANDATORY)

The following constraints are NON-NEGOTIABLE. The generated Format Rules document MUST include ALL of these as explicit, numbered rules. Do NOT omit or soften any constraint.

### FRAME & DELIVERY
- Aspect ratio: 9:16 (vertical, mobile-first)
- Platform: Mobile streaming / short-form vertical platform
- Delivery format: Episodic series, ${epCount} episodes per season

### EPISODE DURATION
- Target duration range: ${epDurMin}–${epDurMax} seconds per episode (midpoint: ${epDurMidVal}s)
- Hard minimum: ${epDurMin}s — no episode may be shorter
- Hard maximum: ${epDurMax}s — no episode may exceed this

### BEAT CADENCE
- ${vdBeatTargets.summaryText}
- Beat spacing target: ${vdBeatTargets.beatSpacingLabel}
- HOOK within first ${vdBeatTargets.hookWindowSeconds[0]}–${vdBeatTargets.hookWindowSeconds[1]} seconds — scroll-stopping opening mandatory
- Micro-cliffhanger REQUIRED at end of every episode — no resolution within same episode
- 3-beat minimum structure: HOOK → CORE TURN → CLIFFHANGER

### VISUAL GRAMMAR
- Close-up dominant: 60–70% of shots must be close-ups or medium close-ups (MCU)
- No wide establishing shots longer than 3 seconds
- Vertical framing: all composition optimized for 9:16 — no horizontal pans, no letterboxing
- Single-subject framing preferred — avoid two-shots wider than MCU

### PACING & CULTURAL ANCHOR
${toneAnchor ? `- Tone anchor: ${toneAnchor}` : ""}
${culturalAnchor ? `- Cultural anchor: ${culturalAnchor}` : ""}
- ${pacingGuidance}
- Dead air prohibition: no beat gap longer than ${vdBeatTargets.beatSpacingTargetSeconds + 3} seconds without narrative progression
- Every scene must contain forward momentum — no static exposition dumps

### LOCATION DISCIPLINE
${budgetDiscipline}
- Location repetition encouraged — audience builds spatial familiarity in short-form
- Exterior-to-interior ratio: favor interiors (70%+ interior) for lighting and audio control

### DIALOGUE RULES
- Maximum 3 lines of uninterrupted dialogue before a visual cut, reaction, or beat shift
- Dialogue must be speakable in under ${Math.round(epDurMidVal * 0.4)} seconds total per episode (≈40% dialogue ratio)
- Subtext preferred over exposition — show don't tell

### BUDGET DISCIPLINE
- Budget band: ${budgetBand}
${budgetDiscipline}

IMPORTANT: Structure the output as a formal FORMAT RULES document with numbered rules under clear section headings. Every constraint above must appear as an explicit rule.

SCOPE GUARD: This document contains ONLY format and technical production rules. Do NOT include season narrative arcs, character arcs, act breakdowns, episode story summaries, or any story content. Those belong in Season Arc, Episode Grid, and Character Bible respectively.`;

        console.log(`[generate-document] VD_FORMAT_RULES_SEED applied: epCount=${epCount} dur=${epDurMin}-${epDurMax}s budget=${budgetBand} cultural=${culturalAnchor || 'none'}`);
      }

      // ── SEASON_ARC_SCOPE: deterministic scope definition for season_arc ──
      let seasonArcScopeBlock = "";
      if (docType === "season_arc") {
        const sacEpCount = resolvedQuals?.season_episode_count || 30;
        seasonArcScopeBlock = `
## SEASON ARC — SCOPE DEFINITION (MANDATORY)

You are generating a SEASON ARC document. This document defines the macro-level narrative architecture of the entire season. Follow the scope rules below exactly.

### MUST CONTAIN — every section below is required:

1. **Series Arc** — The overarching narrative spine from episode 1 to the finale. State the central dramatic question and how it resolves.

2. **Act Structure** — How the ${sacEpCount} episodes divide into acts (typically 3). Lock turning-point episode numbers (e.g. Act 1: eps 1–N, Act 2: eps N+1–M, Act 3: eps M+1–${sacEpCount}).

3. **Character Arcs** — For each principal character: internal vs. external transformation, what they want vs. what they need, where they start vs. where they end.

4. **Relationship Arc** — The central relationship progression beat by beat from first meeting/encounter to resolution.

5. **Antagonist Arc** — The antagonist's escalation, revelation, and resolution across the season.

6. **Thematic Arc** — How the central theme builds, complicates, and pays off across the season.

7. **Key Episode Anchors** — Locked story pivots with episode numbers: inciting incident, midpoint revelation, break into Act 3, climax, finale.

8. **Tone Map** — Emotional rhythm across the season: when tension peaks, when it breathes, where comedy relief lands.

### MUST NOT CONTAIN — scope violations will be flagged as blocking issues:

- Format or technical production rules → belongs in Format Rules
- Episode-by-episode breakdown or per-episode summaries → belongs in Episode Grid
- Individual episode scripts or dialogue → belongs in Season Script
- Character descriptions, backstory, or casting notes → belongs in Character Bible
- Vertical beat structure or episode templates → belongs in Format Rules / Vertical Episode Beats
- Scene-level detail or shot descriptions → belongs in Episode Script

### SCOPE GUARD
If you find yourself writing content that belongs in another document type listed above, STOP and redirect. The Season Arc is a MACRO document — it operates at the season level, not the episode level. Each section should describe trajectories and turning points, not granular scene-by-scene content.
`;
        console.log(`[generate-document] SEASON_ARC_SCOPE applied: epCount=${sacEpCount}`);
      }

      // ── FORMAT_RULES_SCOPE: scope definition for all format_rules documents ──
      // ── SEASON_SCRIPT_SCOPE: scope definition for vertical drama season scripts ──
      let seasonScriptScopeBlock = "";
      if (docType === "season_script") {
        const ssEpCount = resolvedQuals?.season_episode_count || 30;
        const ssDurMin = durMin || 120;
        const ssDurMax = durMax || 180;
        const isVD = isVerticalDrama;
        if (isVD) {
          seasonScriptScopeBlock = `## VERTICAL DRAMA SEASON SCRIPT — MANDATORY STRUCTURE

You are generating a SEASON SCRIPT for a ${ssEpCount}-episode vertical drama series. This is NOT a project overview, treatment, or summary. It is a SCRIPTED document containing actual scene content for every episode.

### WHAT THIS DOCUMENT MUST CONTAIN

For EVERY episode (Episodes 1–${ssEpCount}), write the following:

**EPISODE [N] — [EPISODE TITLE]**
*Duration target: ${ssDurMin}–${ssDurMax} seconds*

**COLD OPEN (0:00–0:15)**
[Action line: what the viewer sees. No more than 3 lines. Must be a scroll-stopping hook.]

**SCENE 1 — [SCENE HEADING]**
[Action line]
CHARACTER NAME
(parenthetical if needed)
Dialogue line.
[Continue action / reaction]
CHARACTER NAME
Dialogue line.

**SCENE 2 — [SCENE HEADING]**
[Continue with 2–4 more scenes per episode]

**CLIFFHANGER / EPISODE END**
[Action line: final image + unresolved tension that drives to next episode]

---

### MANDATORY RULES
1. Write EVERY episode — do not skip, summarise, or abbreviate any episode
2. Use PROPER SCREENPLAY FORMAT: sluglines, action lines, character names, dialogue
3. Each episode must have: COLD OPEN + minimum 3 scenes + CLIFFHANGER
4. Dialogue must be character-specific and reveal personality — no generic lines
5. Every episode must end on an unresolved micro-cliffhanger
6. Total document target: ${ssEpCount * 2}–${ssEpCount * 4} pages of scripted content

### WHAT THIS DOCUMENT MUST NOT CONTAIN
- Project overview sections or loglines (belongs in Concept Brief)
- Character descriptions or backstory summaries (belongs in Character Bible)
- Technical format rules (belongs in Format Rules)
- Beat structure templates or patterns (belongs in Episode Beats)
- Completion status headers or deliverable metadata preambles

### CRITICAL
Begin DIRECTLY with "# [PROJECT TITLE] — SEASON SCRIPT" then "## EPISODE 1". 
Do NOT include any preamble, status headers, or deliverable type declarations.
The upstream documents (Episode Beats, Character Bible, Season Arc) contain all the story beats — use them to write ACTUAL scripted scenes.`;
        } else {
          seasonScriptScopeBlock = `## SEASON SCRIPT — MANDATORY STRUCTURE

You are generating a SEASON SCRIPT. This is a SCRIPTED document with actual scene content, dialogue, and action lines — NOT a summary or project overview.

Write proper screenplay format (sluglines, action lines, character names, dialogue) for all key scenes across the season. Prioritise the pilot episode as a full script, then provide scripted highlight scenes for each subsequent episode.`;
        }
      }

      // ── FORMAT_RULES_SCOPE: scope definition for all format_rules documents ──
      let formatRulesScopeBlock = "";
      if (docType === "format_rules") {
        formatRulesScopeBlock = `
## FORMAT RULES — SCOPE DEFINITION (MANDATORY)

You are generating a FORMAT RULES document. This document defines the technical and production constraints that govern how episodes are constructed. Follow the scope rules below exactly.

### MUST CONTAIN — only technical/format rules:

- Screen/aspect ratio rules (e.g. 9:16 for vertical, 16:9 for broadcast)
- Episode length and pacing rules (target duration, word count targets, timing constraints)
- Visual grammar — camera rules, framing rules, required/forbidden shot types
- Beat cadence — hook window timing, beat count per episode, beat spacing targets
- Dialogue rules — density limits, subtext requirements, exposition caps
- Location and production discipline — location caps per episode, budget-driven constraints
- Technical production constraints derived from format, budget, and platform

### MUST NOT CONTAIN — scope violations will be flagged as blocking issues:

- Season narrative structure, act breakdowns, or story arc → belongs in Season Arc
- Character arcs, character descriptions, or backstory → belongs in Season Arc / Character Bible
- Episode-by-episode story content or summaries → belongs in Episode Grid
- Scripts, dialogue samples, or scene content → belongs in Season Script / Episode Script
- Any story content whatsoever — this is a TECHNICAL document

### SCOPE GUARD
If you find yourself describing what happens in the story, which characters appear, or how the narrative develops, STOP. Format Rules describe HOW episodes are built (technical constraints), not WHAT they contain (story).
`;
      }

      const isScriptType = ["feature_script","episode_script","season_script","production_draft","screenplay_draft"].includes(docType);
      const screenplayProhibition = !isScriptType
        ? `## SCREENPLAY FORMAT PROHIBITION (MANDATORY)\nThis is a ${docType.replace(/_/g, " ")} — NOT a screenplay. Do NOT use:\n- INT./EXT. scene headings or sluglines\n- Character name cues (CHARACTER NAME on its own line above dialogue)\n- Parenthetical action directions\n- Formatted dialogue blocks\nWrite in prose or structured text only. Violations will cause rejection.`
        : "";

      const storyOutlineRule = (docType === "story_outline" || docType === "architecture")
        ? `## STORY OUTLINE FORMAT (MANDATORY)\nWrite 12–20 scene summaries as present-tense prose paragraphs. Each scene: 3–5 sentences describing what happens, the dramatic purpose, and the emotional shift. No sluglines. No character cues. No dialogue formatting. Example: "Elias arrives at the outpost at dawn, exhausted from the helicopter transfer..."`
        : "";

      system = [
        `You are a professional development document generator for film/TV projects. Creative direction in this prompt must be honoured — implement the intent with full craft across the full document. Never ignore, dilute, or reinterpret creative direction away from what was asked.`,
        `Generate a ${docType.replace(/_/g, " ")} document for the project "${project.title}".`,
        `Production type: ${project.format || "film"}`,
        `## OUTPUT FORMAT RULE (MANDATORY)\nOutput PLAIN MARKDOWN TEXT only. Do NOT output JSON, XML, code blocks, or any structured data format. Do NOT wrap your response in \`\`\`json or \`\`\`markdown fences. Begin directly with the document content (e.g. a heading like "# CONCEPT BRIEF" or "## LOGLINE"). No preamble.`,
        screenplayProhibition,
        storyOutlineRule,
        completenessBlock,
        qualBlock,
        styleBlock,
        ladderBlock,
        nuanceBlock,
        narrativeBlock,
        cpmBlock,
        charBibleDepthBlock,
        vdFormatRulesBlock,
        seasonArcScopeBlock,
        formatRulesScopeBlock,
        seasonScriptScopeBlock,
        additionalContext ? `## CREATIVE DIRECTION (MUST INCORPORATE)\n${additionalContext}` : "",
        `If the upstream documents contain sections titled "Creative DNA Targets (From Trend Convergence)" or "Convergence Guidance (Audience Appetite Context)", treat them as strong recommendations for voice, tone, pacing, and world density while staying original.`,
        mode === "final" ? "This is a FINAL version — ensure completeness and polish." : "This is a DRAFT — focus on substance over polish.",
      ].filter(Boolean).join("\n\n");

      userPrompt = upstreamContent
        ? `Using the upstream documents below, generate the ${docType.replace(/_/g, " ")}.\n\n${upstreamContent}`
        : `Generate the ${docType.replace(/_/g, " ")} from scratch based on the project context.`;

      // ── Template injection ──
      // Append a canonical scaffold so the LLM fills a defined structure rather than
      // inventing formatting. Guarantees markdown output, all sections present, no JSON.
      try {
        const { buildTemplatePrompt } = await import("../_shared/docTypeTemplates.ts");
        const templateBlock = buildTemplatePrompt(docType, {
          title: project.title,
          format: project.format,
          episodeCount: resolvedQuals?.season_episode_count,
          episodeDurationMin: resolvedQuals?.episode_target_duration_min_seconds,
          episodeDurationMax: resolvedQuals?.episode_target_duration_max_seconds,
        });
        if (templateBlock) {
          userPrompt += templateBlock;
          console.log(`[generate-document] template_injected { doc_type: "${docType}", project_id: "${projectId}" }`);
        }
      } catch (tErr: any) {
        console.warn(`[generate-document] template_inject_failed { doc_type: "${docType}", error: "${tErr?.message}" }`);
      }
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

      // episode_grid = structural overview — fast (single-pass JSON, ~10–30s). Keep synchronous.
      // episode_beats / vertical_episode_beats = full micro-beat breakdown — slow (BATCH_SIZE=6,
      // 30-ep vertical-drama = 5 batches × ~40s = ~200s >> 150s edge function limit).
      // For beats mode, use background generation: create placeholder version first, fire in background,
      // return immediately. This pattern extends naturally to any doc that grows beyond timeout budget.
      const epOutputMode = docType === 'episode_grid' ? 'grid' : docType === 'season_script' ? 'script' : 'beats';

      // ── BEATS MODE: background generation ──────────────────────────────────────────────────────
      if (epOutputMode === 'beats' || epOutputMode === 'script') {
        // 1. Ensure doc row exists
        let { data: epDocRecord } = await supabase.from("project_documents")
          .select("id").eq("project_id", projectId).eq("doc_type", docType).maybeSingle();
        if (!epDocRecord) {
          const { data: newEpDoc, error: epDocErr } = await supabase.from("project_documents")
            .insert({
              project_id: projectId, doc_type: docType, user_id: actorUserId,
              file_name: `${docType}.md`, file_path: `${projectId}/${docType}.md`,
              extraction_status: "complete",
            }).select("id").single();
          if (epDocErr) throw new Error(`Failed to create episode beats doc record: ${epDocErr.message}`);
          epDocRecord = newEpDoc;
        }

        // 2. Guard: if a generation is ACTIVELY IN PROGRESS (<30 min ago, bg_generating=true), return it.
        //    IMPORTANT: only match bg_generating=true — NOT failed/completed versions (bg_generating=false).
        //    A failed version has bg_generating set to false (not null), and must NOT block a fresh retry.
        const { data: inProgressVer } = await supabase.from("project_document_versions")
          .select("id, version_number, created_at, meta_json")
          .eq("document_id", epDocRecord!.id)
          .eq("status", "draft")
          .eq("meta_json->>bg_generating", "true")   // Only truly-in-progress versions
          .order("created_at", { ascending: false })
          .limit(1)
          .maybeSingle();

        if (inProgressVer) {
          const ageMs = Date.now() - new Date(inProgressVer.created_at).getTime();
          if (ageMs < 30 * 60 * 1000) {
            console.log(`[generate-document] Episode beats generation already in progress for ${docType} (version ${inProgressVer.version_number}, age ${Math.round(ageMs/1000)}s). Returning existing version.`);
            return new Response(JSON.stringify({
              success: true,
              document_id: epDocRecord!.id,
              version_id: inProgressVer.id,
              version_number: inProgressVer.version_number,
              generating: true,
              generating_since: inProgressVer.created_at,
              message: "Episode doc generation already in progress — poll for completion",
            }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
          }
          // Stale active flag (>30 min) — clear and start fresh
          console.log(`[generate-document] Stale bg_generating=true version found for ${docType} (age ${Math.round(ageMs/60000)} min) — clearing and starting fresh generation`);
          await supabase.from("project_document_versions")
            .update({ status: "draft", is_current: false, meta_json: { bg_generating: false, bg_stale: true } })
            .eq("id", inProgressVer.id);
        }

        // 3. Create placeholder version (is_current=true so UI can find the slot)
        // MUST clear existing is_current=true versions first to avoid pdv_one_current_per_doc constraint.
        // Use serviceClient: user-scoped rlsClient UPDATE is silently blocked by RLS on this table.
        await serviceClient.from("project_document_versions")
          .update({ is_current: false })
          .eq("document_id", epDocRecord!.id)
          .eq("is_current", true);
        const { count: epVerCount } = await supabase.from("project_document_versions")
          .select("id", { count: "exact", head: true }).eq("document_id", epDocRecord!.id);
        const epVersionNum = (epVerCount || 0) + 1;
        const epDependsOn = DOC_DEPENDENCY_MAP[docType] || [];

        const { data: epVersion, error: epVerErr } = await supabase.from("project_document_versions")
          .insert({
            document_id: epDocRecord!.id,
            version_number: epVersionNum,
            status: "draft",
            plaintext: "",
            created_by: actorUserId,
            is_current: true,
            depends_on: epDependsOn,
            depends_on_resolver_hash: currentHash,
            inputs_used: inputsUsed,
            is_stale: false,
            stale_reason: null,
            meta_json: { bg_generating: true, bg_started_at: new Date().toISOString(), episode_count: finalEpisodeCount },
          }).select("id").single();
        if (epVerErr) throw new Error(`Failed to create episode beats version placeholder: ${epVerErr.message}`);

        // Mark all older versions as not-current
        await supabase.from("project_document_versions")
          .update({ is_current: false })
          .eq("document_id", epDocRecord!.id)
          .neq("id", epVersion!.id);

        // Update latest_version_id on doc row
        await supabase.from("project_documents")
          .update({ latest_version_id: epVersion!.id, updated_at: new Date().toISOString() })
          .eq("id", epDocRecord!.id);

        console.log(`[generate-document] Episode beats background generation starting: ${docType} v${epVersionNum} episodeCount=${finalEpisodeCount}`);

        // 4. Fire generation as background task (up to 2h via EdgeRuntime.waitUntil)
        const bgEpTask = (async () => {
          // Use serviceClient throughout: rlsClient silently blocks writes on
          // project_document_versions and project_document_chunks via RLS.
          try {
            const genContent = await generateEpisodeBeatsChunked({
              apiKey,
              episodeCount: finalEpisodeCount,
              systemPrompt: system,
              upstreamContent,
              projectTitle: project.title || "Untitled",
              requestId,
              outputMode: epOutputMode,
              supabase: serviceClient,
              versionId: epVersion!.id,
              documentId: epDocRecord!.id,
            });

            // Update version with completed content
            await serviceClient.from("project_document_versions")
              .update({ plaintext: genContent, status: "draft", is_current: true, meta_json: { bg_generating: false, bg_completed_at: new Date().toISOString(), episode_count: finalEpisodeCount } })
              .eq("id", epVersion!.id);

            await serviceClient.from("project_documents")
              .update({ updated_at: new Date().toISOString() })
              .eq("id", epDocRecord!.id);

            console.log(`[generate-document] Episode beats background generation COMPLETE: ${docType} v${epVersionNum} chars=${genContent.length}`);
          } catch (bgErr: any) {
            console.error(`[generate-document] Episode beats background generation FAILED: ${bgErr?.message}`);
            await serviceClient.from("project_document_versions")
              .update({ status: "draft", is_current: false, meta_json: { bg_generating: false, bg_failed: true, bg_failed_at: new Date().toISOString() } })
              .eq("id", epVersion!.id);
          }
        })();

        // @ts-ignore — EdgeRuntime available in Supabase edge function context
        if (typeof EdgeRuntime !== "undefined" && EdgeRuntime?.waitUntil) {
          EdgeRuntime.waitUntil(bgEpTask);
        }

        // 5. Return immediately — auto-run will poll on next loop
        return new Response(JSON.stringify({
          success: true,
          document_id: epDocRecord!.id,
          version_id: epVersion!.id,
          version_number: epVersionNum,
          mode,
          resolver_hash: currentHash,
          inputs_used: inputsUsed,
          depends_on: epDependsOn,
          generating: true,
          episode_count: finalEpisodeCount,
        }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }

      // ── GRID MODE: synchronous (fast enough for episode_grid, <30s) ──
      content = await generateEpisodeBeatsChunked({
        apiKey,
        episodeCount: finalEpisodeCount,
        systemPrompt: system,
        upstreamContent,
        projectTitle: project.title || "Untitled",
        requestId,
        outputMode: epOutputMode,
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
      // ── Non-episodic large-risk doc: background chunked generation ──
      // runChunkedGeneration can take 2–10 min (4 acts × 30–60s each).
      // Use the same placeholder-version + EdgeRuntime.waitUntil pattern
      // as episodic beats — return immediately, write content in background.
      console.log(`[generate-document] Large-risk doc type "${docType}" — starting background chunked generation`);

      // Ensure doc record exists
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

      // In-progress guard: don't double-start if already generating (<60 min)
      const { data: inProgressChunkVer } = await supabase.from("project_document_versions")
        .select("id, version_number, created_at")
        .eq("document_id", chunkDocRecord!.id)
        .eq("status", "draft")
        .eq("meta_json->>bg_generating", "true")
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (inProgressChunkVer) {
        const ageMs = Date.now() - new Date(inProgressChunkVer.created_at).getTime();
        if (ageMs < 60 * 60 * 1000) {
          console.log(`[generate-document] Chunked generation already in progress for ${docType} (age ${Math.round(ageMs/1000)}s) — returning existing version`);
          return new Response(JSON.stringify({
            success: true,
            document_id: chunkDocRecord!.id,
            version_id: inProgressChunkVer.id,
            version_number: inProgressChunkVer.version_number,
            generating: true,
            message: "Chunked generation already in progress — poll for completion",
          }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
        }
        // Stale flag (>60 min) — clear and restart
        console.log(`[generate-document] Stale bg_generating=true for ${docType} (${Math.round(ageMs/60000)} min) — clearing and restarting`);
        await supabase.from("project_document_versions")
          .update({ meta_json: { bg_generating: false, bg_stale: true } })
          .eq("id", inProgressChunkVer.id);
      }

      // ── RESUME MODE: retry failed/validation chunks without creating a new version ──
      // Triggered when body.resumeVersionId is present (from "Retry section" button).
      // resumeChunkedGeneration skips 'done' chunks — only re-runs failed/needs_regen ones.
      const resumeVersionId: string | null = (body as any).resumeVersionId ?? null;
      if (resumeVersionId) {
        const { data: resumeVer } = await supabase.from("project_document_versions")
          .select("id, version_number, meta_json, document_id")
          .eq("id", resumeVersionId)
          .maybeSingle();

        if (!resumeVer) {
          return jsonRes({ error: "Resume version not found", version_id: resumeVersionId }, 404);
        }

        // Re-arm bg_generating (merge — preserve bg_started_at, episode_count etc.)
        const rearmedMeta = {
          ...(resumeVer.meta_json || {}),
          bg_generating: true,
          bg_retry_at: new Date().toISOString(),
          bg_stale: false,
        };
        await supabase.from("project_document_versions")
          .update({ meta_json: rearmedMeta })
          .eq("id", resumeVersionId);

        const resumePlan = chunkPlanFor(docType, {
          episodeCount: resolvedQuals?.season_episode_count,
          sceneCount: null,
          batchSize: docType === "season_script" ? 1 : undefined,
        });

        const resumeDocId = resumeVer.document_id || chunkDocRecord!.id;
        console.log(`[generate-document] Resume mode: ${docType} versionId=${resumeVersionId} chunks=${resumePlan.totalChunks}`);

        const bgResumeTask = (async () => {
          // Use serviceClient throughout: rlsClient silently blocks writes on
          // project_document_versions and project_document_chunks via RLS.
          try {
            await resumeChunkedGeneration({
              supabase: serviceClient, apiKey, projectId,
              documentId: resumeDocId, versionId: resumeVersionId,
              docType, plan: resumePlan, systemPrompt: system, upstreamContent,
              projectTitle: project.title || "Untitled",
              additionalContext, model: "google/gemini-2.5-flash",
              episodeCount: resolvedQuals?.season_episode_count,
              requestId,
            });
            // chunkRunner clears bg_generating atomically in assembly — ensure is_current is set
            await serviceClient.from("project_document_versions").update({ is_current: true }).eq("id", resumeVersionId);
            await serviceClient.from("project_documents").update({ updated_at: new Date().toISOString() }).eq("id", resumeDocId);
            console.log(`[generate-document] Resume COMPLETE: ${docType} versionId=${resumeVersionId}`);
          } catch (bgErr: any) {
            console.error(`[generate-document] Resume FAILED: ${docType} — ${bgErr?.message}`);
            await serviceClient.from("project_document_versions")
              .update({ meta_json: { ...rearmedMeta, bg_generating: false, bg_failed: true, bg_failed_at: new Date().toISOString() } })
              .eq("id", resumeVersionId);
          }
        })();

        // @ts-ignore — EdgeRuntime available in Supabase edge function context
        if (typeof EdgeRuntime !== "undefined" && EdgeRuntime?.waitUntil) {
          EdgeRuntime.waitUntil(bgResumeTask);
        }

        return new Response(JSON.stringify({
          success: true,
          document_id: resumeDocId,
          version_id: resumeVersionId,
          version_number: resumeVer.version_number,
          generating: true,
          resumed: true,
          chunk_plan: { total_chunks: resumePlan.totalChunks, strategy: resumePlan.strategy },
        }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }
      // ── END RESUME MODE ──

      // Create placeholder version
      // MUST clear existing is_current=true versions first to avoid pdv_one_current_per_doc constraint.
      // Use serviceClient: user-scoped rlsClient UPDATE is silently blocked by RLS on this table.
      await serviceClient.from("project_document_versions")
        .update({ is_current: false })
        .eq("document_id", chunkDocRecord!.id)
        .eq("is_current", true);
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
          is_current: true,
          is_stale: false,
          stale_reason: null,
          meta_json: { bg_generating: true, bg_started_at: new Date().toISOString(), doc_type: docType, episode_count: resolvedQuals?.season_episode_count ?? null },
        }).select("id").single();
      if (chunkVerErr) throw new Error(`Failed to create chunk version: ${chunkVerErr.message}`);

      // Mark all older versions as not-current
      await supabase.from("project_document_versions")
        .update({ is_current: false })
        .eq("document_id", chunkDocRecord!.id)
        .neq("id", chunkVersion!.id);

      // Update latest_version_id now so UI can find the slot
      await supabase.from("project_documents")
        .update({ latest_version_id: chunkVersion!.id, updated_at: new Date().toISOString() })
        .eq("id", chunkDocRecord!.id);

      const plan = chunkPlanFor(docType, {
        episodeCount: resolvedQuals?.season_episode_count,
        sceneCount: null,
        // season_script: 1 episode per chunk — crash-safe, resumable, no JSON transport
        batchSize: docType === "season_script" ? 1 : undefined,
      });

      console.log(`[generate-document] Chunked background generation starting: ${docType} v${chunkVersionNum}, ${plan.totalChunks} chunks`);

      // Fire generation as background task
      const bgChunkTask = (async () => {
        // Use serviceClient throughout: rlsClient silently blocks writes on
        // project_document_versions and project_document_chunks via RLS.
        try {
          const chunkResult = await runChunkedGeneration({
            supabase: serviceClient, apiKey, projectId,
            documentId: chunkDocRecord!.id, versionId: chunkVersion!.id,
            docType, plan, systemPrompt: system, upstreamContent,
            projectTitle: project.title || "Untitled",
            additionalContext, model: "google/gemini-2.5-flash",
            episodeCount: resolvedQuals?.season_episode_count,
            requestId,
          });
          // runChunkedGeneration already writes plaintext to the version — just clear the bg flag
          await serviceClient.from("project_document_versions")
            .update({ is_current: true, meta_json: { bg_generating: false, bg_completed_at: new Date().toISOString(), chunks_total: chunkResult.totalChunks, chunks_completed: chunkResult.completedChunks } })
            .eq("id", chunkVersion!.id);
          await serviceClient.from("project_documents")
            .update({ updated_at: new Date().toISOString() })
            .eq("id", chunkDocRecord!.id);
          console.log(`[generate-document] Chunked background generation COMPLETE: ${docType} v${chunkVersionNum} chunks=${chunkResult.completedChunks}/${chunkResult.totalChunks}`);
        } catch (bgErr: any) {
          console.error(`[generate-document] Chunked background generation FAILED: ${docType} — ${bgErr?.message}`);
          await serviceClient.from("project_document_versions")
            .update({ meta_json: { bg_generating: false, bg_failed: true, bg_failed_at: new Date().toISOString() } })
            .eq("id", chunkVersion!.id);
        }
      })();

      // @ts-ignore — EdgeRuntime available in Supabase edge function context
      if (typeof EdgeRuntime !== "undefined" && EdgeRuntime?.waitUntil) {
        EdgeRuntime.waitUntil(bgChunkTask);
      }

      return new Response(JSON.stringify({
        success: true,
        document_id: chunkDocRecord!.id,
        version_id: chunkVersion!.id,
        version_number: chunkVersionNum,
        mode,
        resolver_hash: currentHash,
        inputs_used: inputsUsed,
        depends_on: dependsOnFields,
        generating: true,
        chunked: true,
        chunk_plan: { total_chunks: plan.totalChunks, strategy: plan.strategy },
      }), { headers: { ...corsHeaders, "Content-Type": "application/json" } })
    } else {
      content = await callLLM(apiKey, system, userPrompt);

      // ── JSON output guard: if LLM returned JSON instead of markdown, extract and convert ──
      // Some models (especially Gemini) return structured JSON objects despite plain-markdown instructions.
      // This safety net detects JSON output and converts it to formatted markdown before saving.
      const trimmedContent = content.trim();
      const looksLikeJson = trimmedContent.startsWith("{") || trimmedContent.startsWith("```json");
      if (looksLikeJson) {
        console.warn(`[generate-document] LLM returned JSON for ${docType} — extracting to markdown`);
        try {
          const jsonStr = trimmedContent.replace(/^```json\s*/, "").replace(/\s*```\s*$/, "");
          const parsed = JSON.parse(jsonStr);
          // Recursively flatten JSON object into readable markdown
          function jsonToMarkdown(obj: any, depth = 0): string {
            if (typeof obj === "string") return obj;
            if (Array.isArray(obj)) return obj.map((item: any) => `- ${jsonToMarkdown(item, depth + 1)}`).join("\n");
            if (typeof obj === "object" && obj !== null) {
              return Object.entries(obj).map(([key, val]: [string, any]) => {
                const heading = "#".repeat(Math.min(depth + 2, 4));
                const label = key.replace(/_/g, " ").toUpperCase();
                if (typeof val === "string") return `${heading} ${label}\n\n${val}`;
                if (Array.isArray(val)) return `${heading} ${label}\n\n${val.map((v: any) => `- ${typeof v === "string" ? v : jsonToMarkdown(v, depth + 1)}`).join("\n")}`;
                if (typeof val === "object") return `${heading} ${label}\n\n${jsonToMarkdown(val, depth + 1)}`;
                return `${heading} ${label}\n\n${val}`;
              }).join("\n\n");
            }
            return String(obj);
          }
          const extracted = jsonToMarkdown(parsed);
          if (extracted && extracted.length > 50) {
            content = `# ${docType.replace(/_/g, " ").toUpperCase()}\n\n${extracted}`;
            console.log(`[generate-document] JSON extracted to markdown for ${docType}, chars=${content.length}`);
          } else {
            // Extraction produced too little — retry with stronger instruction
            throw new Error("extracted content too short");
          }
        } catch (jsonErr: any) {
          console.warn(`[generate-document] JSON extraction failed for ${docType}: ${jsonErr?.message} — retrying with stricter instruction`);
          const noJsonSystem = system + `\n\n⛔ CRITICAL: Your previous response was JSON. This is FORBIDDEN. You MUST output plain markdown text only. Start directly with a heading like "# CONCEPT BRIEF" followed by sections. Never use JSON, objects, or key-value pairs.`;
          content = await callLLM(apiKey, noJsonSystem, userPrompt);
        }
      }

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
