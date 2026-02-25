import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import { buildBeatGuidanceBlock } from "../_shared/verticalDramaBeats.ts";
import { generateEpisodeBeatsChunked } from "../_shared/episodeBeatsChunked.ts";

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
  treatment: ["long_synopsis", "character_bible"],
  character_bible: ["idea_brief", "logline"],
  feature_outline: ["treatment", "character_bible"],
  screenplay_draft: ["feature_outline", "character_bible", "treatment"],
  series_overview: ["idea_brief", "logline"],
  season_arc: ["series_overview", "character_bible"],
  episode_grid: ["season_arc", "character_bible"],
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
  packaging_targets: ["treatment", "character_bible"],
  production_plan: ["budget_topline"],
  delivery_requirements: [],
  story_arc_plan: ["doc_premise_brief", "research_dossier"],
  shoot_plan: ["story_arc_plan"],
};

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
      max_tokens: 12000,
    }),
  });
  if (!res.ok) throw new Error(`LLM call failed: ${res.status}`);
  const data = await res.json();
  return data.choices?.[0]?.message?.content || "";
}

// ─── Handler ───

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const apiKey = Deno.env.get("LOVABLE_API_KEY") || serviceKey;
    const supabase = createClient(supabaseUrl, serviceKey);

    const token = authHeader.replace("Bearer ", "");
    const { data: { user } } = await supabase.auth.getUser(token);
    if (!user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const body = await req.json();
    const { projectId, docType, mode = "draft", generatorId = "generate-document", generatorRunId, additionalContext } = body;

    if (!projectId || !docType) {
      return new Response(JSON.stringify({ error: "projectId and docType required" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

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
      .select("title, format, pipeline_stage, guardrails_config, season_style_template_version_id, season_style_profile")
      .eq("id", projectId).single();

    if (!project) throw new Error("Project not found");

    // 3) Load upstream documents
    const upstreamTypes = UPSTREAM_DEPS[docType] || [];
    const inputsUsed: Record<string, any> = {};
    let upstreamContent = "";

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
          upstreamContent += `\n\n--- ${doc.doc_type.toUpperCase()} (v${version.version_number}) ---\n${version.plaintext || "(empty)"}`;
        }
      }
    }

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
      system = [
        `You are a professional development document generator for film/TV projects.`,
        `Generate a ${docType.replace(/_/g, " ")} document for the project "${project.title}".`,
        `Production type: ${project.format || "film"}`,
        completenessBlock,
        qualBlock,
        styleBlock,
        additionalContext ? `## CREATIVE DIRECTION (MUST INCORPORATE)\n${additionalContext}` : "",
        mode === "final" ? "This is a FINAL version — ensure completeness and polish." : "This is a DRAFT — focus on substance over polish.",
      ].filter(Boolean).join("\n\n");

      userPrompt = upstreamContent
        ? `Using the upstream documents below, generate the ${docType.replace(/_/g, " ")}.\n\n${upstreamContent}`
        : `Generate the ${docType.replace(/_/g, " ")} from scratch based on the project context.`;
    }

    // 5) Generate content
    let content: string;

    // ── Special path for vertical_episode_beats: chunked generation with completeness guard ──
    if (docType === "vertical_episode_beats" && resolvedQuals.is_series && resolvedQuals.season_episode_count) {
      content = await generateEpisodeBeatsChunked({
        apiKey,
        episodeCount: resolvedQuals.season_episode_count,
        systemPrompt: system,
        upstreamContent,
        projectTitle: project.title || "Untitled",
      });
    } else {
      content = await callLLM(apiKey, system, userPrompt);
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

    // 7) Find or create project_document record
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
          user_id: user.id,
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
        created_by: user.id,
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

    return new Response(JSON.stringify({
      success: true,
      document_id: docRecord!.id,
      version_id: newVersion!.id,
      version_number: versionNumber,
      mode,
      resolver_hash: currentHash,
      inputs_used: inputsUsed,
      depends_on: dependsOn,
    }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e: any) {
    console.error("[generate-document] error:", e);
    return new Response(JSON.stringify({ error: e.message || "Internal error" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
