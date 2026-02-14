import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const PRO_MODEL = "google/gemini-2.5-pro";
const FAST_MODEL = "google/gemini-2.5-flash";
const BALANCED_MODEL = "google/gemini-3-flash-preview";

function extractJSON(raw: string): string {
  let c = raw.replace(/^```[\s\S]*?\n/, "").replace(/\n?```\s*$/, "");
  if (!c.trim().startsWith("{") && !c.trim().startsWith("[")) {
    const i = c.indexOf("{");
    if (i >= 0) c = c.slice(i);
  }
  const last = c.lastIndexOf("}");
  if (last >= 0) c = c.slice(0, last + 1);
  return c.trim();
}

async function callAI(apiKey: string, model: string, system: string, user: string, temperature = 0.3, maxTokens = 8000): Promise<string> {
  const MAX_RETRIES = 3;
  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    const response = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model,
        messages: [{ role: "system", content: system }, { role: "user", content: user }],
        temperature,
        max_tokens: maxTokens,
      }),
    });
    if (response.ok) {
      const data = await response.json();
      return data.choices?.[0]?.message?.content || "";
    }
    const t = await response.text();
    console.error(`AI error (attempt ${attempt + 1}/${MAX_RETRIES}):`, response.status, t);
    if (response.status >= 500 && attempt < MAX_RETRIES - 1) {
      const delay = Math.pow(2, attempt) * 2000;
      console.log(`Retrying in ${delay}ms...`);
      await new Promise(r => setTimeout(r, delay));
      continue;
    }
    throw new Error(`AI call failed: ${response.status}`);
  }
  throw new Error("AI call failed after retries");
}

async function parseAIJson(apiKey: string, raw: string): Promise<any> {
  try {
    return JSON.parse(extractJSON(raw));
  } catch {
    const repair = await callAI(apiKey, FAST_MODEL, "Fix this malformed JSON. Return ONLY valid JSON.", raw.slice(0, 6000));
    return JSON.parse(extractJSON(repair));
  }
}

// ═══════════════════════════════════════════════════════════════
// PROMPTS
// ═══════════════════════════════════════════════════════════════

const ANALYZE_SYSTEM = `You are IFFY, a Creative–Commercial Alignment Architect.
Evaluate the submitted material. Consider the production type, strategic priority, and development stage.

Return ONLY valid JSON:
{
  "ci_score": 0-100,
  "gp_score": 0-100,
  "gap": number (absolute difference),
  "allowed_gap": number (based on type: doc=40, branded=10, feature=20, series=25),
  "convergence_status": "Healthy Divergence" | "Strategic Tension" | "Dangerous Misalignment",
  "trajectory": null or "Converging" | "Eroding" | "Stalled" | "Strengthened" | "Over-Optimised",
  "primary_creative_risk": "one sentence",
  "primary_commercial_risk": "one sentence",
  "protect": ["non-negotiable creative strengths, 1-10 items"],
  "strengthen": ["items needing more force, 1-12"],
  "clarify": ["ambiguous items, 1-12"],
  "elevate": ["items that could reach higher, 1-12"],
  "remove": ["items dragging work down, 0-12"],
  "verdict": "Invest" | "Develop Further" | "Major Rethink" | "Pass",
  "executive_snapshot": "2-3 sentence strategic summary"
}`;

const NOTES_SYSTEM = `You are IFFY. Convert review findings into ranked strategic notes.
Return ONLY valid JSON:
{
  "protect": ["non-negotiable items to preserve"],
  "strengthen": ["items to improve"],
  "clarify": ["items to make clearer"],
  "elevate": ["items to push higher"],
  "remove": ["items to cut"],
  "prioritized_moves": [
    {"category": "structural|character|escalation|lane|packaging|risk", "note": "...", "impact": "high|medium|low", "convergence_lift": 1-10}
  ]
}
Rank prioritized_moves by highest convergence impact. Include 6-20 moves.`;

const REWRITE_SYSTEM = `You are IFFY. Rewrite the material applying the approved strategic notes.
Rules:
- Preserve all PROTECT items absolutely.
- Do not flatten voice for minor commercial gain.
- Strengthen escalation and improve packaging magnetism organically.
- Match the target doc type format expectations.
- OUTPUT THE FULL REWRITTEN MATERIAL — do NOT summarize or truncate.

Return ONLY valid JSON:
{
  "rewritten_text": "the full rewritten material",
  "changes_summary": "bullet summary of changes",
  "creative_preserved": "what creative elements were protected",
  "commercial_improvements": "what commercial improvements were introduced"
}`;

const REWRITE_CHUNK_SYSTEM = `You are IFFY, a professional screenplay rewriter. Rewrite this CHUNK of a screenplay applying the approved strategic notes.

Rules:
- Preserve all PROTECT items absolutely.
- Do not flatten voice for minor commercial gain.
- Maintain screenplay format: sluglines, action, dialogue.
- OUTPUT THE FULL REWRITTEN CHUNK — every scene, every line of dialogue. Do NOT summarize or skip.
- Maintain perfect continuity with the previous chunk context provided.

CRITICAL LENGTH RULE:
- Your output MUST be AT LEAST as long as the input chunk. The input chunk's character count will be provided.
- Do NOT compress, condense, or abbreviate any scenes. If anything, EXPAND scenes slightly.
- Every scene heading in the input must appear in the output. Every character who speaks must still speak.
- If your output is shorter than the input, you have failed. Add richer action lines, fuller dialogue, and more vivid description to match or exceed the original length.

Output ONLY the rewritten screenplay text. No JSON, no commentary, no markdown.`;

const CONVERT_SYSTEM = `You are IFFY. Convert the source material into the specified target format.
Preserve the creative DNA (protect items). Adapt structure and detail level to the target format.

Target format guidelines:
- BLUEPRINT: High-level structural blueprint with act breaks, key beats, character arcs, tone anchors
- ARCHITECTURE: Detailed scene-by-scene architecture with sluglines, beats, page estimates
- TREATMENT: Prose narrative treatment (3-10 pages), vivid and readable
- ONE_PAGER: One-page pitch document: logline, synopsis, key talent notes, comparable titles, market positioning
- OUTLINE: Beat-by-beat outline with numbered scenes
- DRAFT_SCRIPT: Full screenplay draft in standard screenplay format (sluglines, action, dialogue). Write it as a real screenplay — do NOT include JSON, code, markdown, or any structural markup.

CRITICAL RULES:
- Output ONLY the creative content for the target format.
- Do NOT wrap output in JSON, code fences, or markdown.
- Do NOT include field names like "converted_text:" or curly braces.
- Write the material as a human creative professional would — pure prose, screenplay, or document text.
- At the very end, on a new line after the main content, write exactly:
  ---CHANGE_SUMMARY---
  followed by a brief summary of what was adapted.`;

const CONVERT_SYSTEM_JSON = `You are IFFY. Convert the source material into the specified target format.
Preserve the creative DNA (protect items). Adapt structure and detail level to the target format.

Target format guidelines:
- BLUEPRINT: High-level structural blueprint with act breaks, key beats, character arcs, tone anchors
- ARCHITECTURE: Detailed scene-by-scene architecture with sluglines, beats, page estimates
- TREATMENT: Prose narrative treatment (3-10 pages), vivid and readable
- ONE_PAGER: One-page pitch document: logline, synopsis, key talent notes, comparable titles, market positioning
- OUTLINE: Beat-by-beat outline with numbered scenes

Return ONLY valid JSON:
{
  "converted_text": "the full converted output",
  "format": "target format name",
  "change_summary": "what was adapted/expanded/compressed"
}`;

// ── PIPELINE PROMPTS ──

const SCRIPT_PLAN_SYSTEM = `You are IFFY, a professional screenplay architect.
Given a concept/treatment/blueprint, create a detailed scene-by-scene plan for a feature-length screenplay.

RULES:
- Target 95-115 pages (approximately 250 words per page).
- Divide into 3 acts with clear act breaks.
- Each scene gets a unique ID (e.g. A1S01, A2S05), a slugline, page estimate, and purpose.
- Total page estimates across all scenes must sum to the target page count.
- Include tone_lock and non_negotiables from the source material.

Return ONLY valid JSON:
{
  "target_pages": <number between 95 and 115>,
  "format": "screenplay",
  "total_scenes": <number>,
  "acts": [
    {
      "act": 1,
      "start_page": 1,
      "end_page": <number>,
      "scenes": [
        {"scene_id": "A1S01", "slug": "INT. LOCATION - TIME", "page_estimate": <number>, "purpose": "brief description of what happens"}
      ]
    }
  ],
  "rules": {
    "tone_lock": "description of tone",
    "non_negotiables": ["list of creative elements that must be preserved"]
  }
}`;

const WRITE_BATCH_SYSTEM = `You are a professional screenwriter. Write ONLY screenplay pages in standard format.

RULES:
- Write in proper screenplay format: sluglines (INT./EXT.), action lines, character names (CAPS), dialogue.
- Do NOT include any JSON, markdown, code fences, commentary, or metadata.
- Do NOT number pages or add headers/footers.
- Write EXACTLY the scenes you are given — no more, no less.
- Each page is approximately 250 words. Hit the target page count precisely.
- Maintain consistent tone, character voices, and story momentum from previous batches.
- Output ONLY the screenplay text. Nothing else.`;

const ASSEMBLE_VALIDATE_SYSTEM = `You are a screenplay editor. Review the assembled screenplay for formatting consistency.

Check for:
- FADE IN: at the start
- Proper slugline format throughout
- Consistent character name capitalization
- FADE OUT. or FADE TO BLACK. at the end
- No duplicate scenes or missing transitions
- Clean act break transitions

If issues exist, fix them minimally. Output the corrected full screenplay text ONLY.
Do NOT include JSON, code fences, or commentary.
At the very end, on a new line, write:
---VALIDATION_NOTES---
followed by a brief list of what was fixed (or "No issues found").`;

// ═══════════════════════════════════════════════════════════════
// MAIN
// ═══════════════════════════════════════════════════════════════

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) throw new Error("LOVABLE_API_KEY not configured");

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    const token = authHeader.replace("Bearer ", "");
    const { data: { user } } = await supabase.auth.getUser(token);
    if (!user) throw new Error("Unauthorized");

    const body = await req.json();
    const { action } = body;

    // ── ANALYZE ──
    if (action === "analyze") {
      const { projectId, documentId, versionId, productionType, strategicPriority, developmentStage, analysisMode, previousVersionId } = body;
      if (!projectId || !documentId || !versionId) throw new Error("projectId, documentId, versionId required");

      const { data: version } = await supabase.from("project_document_versions")
        .select("plaintext").eq("id", versionId).single();
      if (!version) throw new Error("Version not found");

      const { data: project } = await supabase.from("projects")
        .select("title, budget_range, assigned_lane")
        .eq("id", projectId).single();

      let prevContext = "";
      if (previousVersionId) {
        const { data: prevRun } = await supabase.from("development_runs")
          .select("output_json").eq("version_id", previousVersionId).eq("run_type", "ANALYZE")
          .order("created_at", { ascending: false }).limit(1).single();
        if (prevRun?.output_json) {
          const pj = prevRun.output_json as any;
          prevContext = `\nPREVIOUS SCORES: CI=${pj.ci_score}, GP=${pj.gp_score}, Gap=${pj.gap}`;
        }
      }

      const userPrompt = `PRODUCTION TYPE: ${productionType || "narrative_feature"}
STRATEGIC PRIORITY: ${strategicPriority || "BALANCED"}
DEVELOPMENT STAGE: ${developmentStage || "IDEA"}
ANALYSIS MODE: ${analysisMode || "DUAL"}
PROJECT: ${project?.title || "Unknown"}
LANE: ${project?.assigned_lane || "Unknown"} | BUDGET: ${project?.budget_range || "Unknown"}
${prevContext}

MATERIAL (${version.plaintext.length} chars):
${version.plaintext.slice(0, 25000)}`;

      const raw = await callAI(LOVABLE_API_KEY, PRO_MODEL, ANALYZE_SYSTEM, userPrompt, 0.2, 6000);
      const parsed = await parseAIJson(LOVABLE_API_KEY, raw);

      const { data: run, error: runErr } = await supabase.from("development_runs").insert({
        project_id: projectId,
        document_id: documentId,
        version_id: versionId,
        user_id: user.id,
        run_type: "ANALYZE",
        production_type: productionType || "narrative_feature",
        strategic_priority: strategicPriority || "BALANCED",
        development_stage: developmentStage || "IDEA",
        analysis_mode: analysisMode || "DUAL",
        output_json: parsed,
      }).select().single();
      if (runErr) throw runErr;

      await supabase.from("dev_engine_convergence_history").insert({
        project_id: projectId,
        document_id: documentId,
        version_id: versionId,
        user_id: user.id,
        creative_score: parsed.ci_score || 0,
        greenlight_score: parsed.gp_score || 0,
        gap: parsed.gap ?? Math.abs((parsed.ci_score || 50) - (parsed.gp_score || 50)),
        allowed_gap: parsed.allowed_gap || 25,
        convergence_status: parsed.convergence_status || "Unknown",
        trajectory: parsed.trajectory,
      });

      return new Response(JSON.stringify({ run, analysis: parsed }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // ── NOTES ──
    if (action === "notes") {
      const { projectId, documentId, versionId, analysisJson } = body;
      if (!projectId || !documentId || !versionId) throw new Error("projectId, documentId, versionId required");

      const { data: version } = await supabase.from("project_document_versions")
        .select("plaintext").eq("id", versionId).single();
      if (!version) throw new Error("Version not found");

      let analysis = analysisJson;
      if (!analysis) {
        const { data: latestRun } = await supabase.from("development_runs")
          .select("output_json").eq("version_id", versionId).eq("run_type", "ANALYZE")
          .order("created_at", { ascending: false }).limit(1).single();
        analysis = latestRun?.output_json;
      }
      if (!analysis) throw new Error("No analysis found. Run Analyze first.");

      const userPrompt = `ANALYSIS:\n${JSON.stringify(analysis)}\n\nMATERIAL:\n${version.plaintext.slice(0, 12000)}`;
      const raw = await callAI(LOVABLE_API_KEY, PRO_MODEL, NOTES_SYSTEM, userPrompt, 0.25, 6000);
      const parsed = await parseAIJson(LOVABLE_API_KEY, raw);

      const { data: run, error: runErr } = await supabase.from("development_runs").insert({
        project_id: projectId,
        document_id: documentId,
        version_id: versionId,
        user_id: user.id,
        run_type: "NOTES",
        output_json: parsed,
      }).select().single();
      if (runErr) throw runErr;

      return new Response(JSON.stringify({ run, notes: parsed }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // ── REWRITE ──
    if (action === "rewrite") {
      const { projectId, documentId, versionId, approvedNotes, protectItems, targetDocType } = body;
      if (!projectId || !documentId || !versionId) throw new Error("projectId, documentId, versionId required");

      const { data: version } = await supabase.from("project_document_versions")
        .select("plaintext, version_number").eq("id", versionId).single();
      if (!version) throw new Error("Version not found");

      const fullText = version.plaintext || "";
      const LONG_THRESHOLD = 30000; // ~24 pages — anything above this uses chunked rewrite

      let rewrittenText = "";
      let changesSummary = "";
      let creativePreserved = "";
      let commercialImprovements = "";

      if (fullText.length <= LONG_THRESHOLD) {
        // ── Short document: single-pass rewrite ──
        const userPrompt = `PROTECT (non-negotiable):\n${JSON.stringify(protectItems || [])}

APPROVED NOTES:\n${JSON.stringify(approvedNotes || [])}

TARGET FORMAT: ${targetDocType || "same as source"}

MATERIAL TO REWRITE:\n${fullText}`;

        const raw = await callAI(LOVABLE_API_KEY, BALANCED_MODEL, REWRITE_SYSTEM, userPrompt, 0.4, 12000);
        const parsed = await parseAIJson(LOVABLE_API_KEY, raw);
        rewrittenText = parsed.rewritten_text || "";
        changesSummary = parsed.changes_summary || "";
        creativePreserved = parsed.creative_preserved || "";
        commercialImprovements = parsed.commercial_improvements || "";
      } else {
        // ── Feature-length: return error directing to chunked pipeline ──
        return new Response(JSON.stringify({ error: "Document too long for single-pass rewrite. Use rewrite-plan/rewrite-chunk/rewrite-assemble pipeline.", needsPipeline: true, charCount: fullText.length }), {
          status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      // Get max version number to avoid duplicate key conflicts
      const { data: maxRow } = await supabase.from("project_document_versions")
        .select("version_number")
        .eq("document_id", documentId)
        .order("version_number", { ascending: false })
        .limit(1)
        .single();
      const nextVersion = (maxRow?.version_number ?? 0) + 1;

      const { data: newVersion, error: vErr } = await supabase.from("project_document_versions").insert({
        document_id: documentId,
        version_number: nextVersion,
        label: `Rewrite pass ${nextVersion}`,
        plaintext: rewrittenText,
        created_by: user.id,
        parent_version_id: versionId,
        change_summary: changesSummary,
      }).select().single();
      if (vErr) throw vErr;

      const parsed = { rewritten_text: rewrittenText, changes_summary: changesSummary, creative_preserved: creativePreserved, commercial_improvements: commercialImprovements };

      const { data: run } = await supabase.from("development_runs").insert({
        project_id: projectId,
        document_id: documentId,
        version_id: newVersion.id,
        user_id: user.id,
        run_type: "REWRITE",
        output_json: { ...parsed, rewritten_text: `[${rewrittenText.length} chars]`, source_version_id: versionId },
      }).select().single();

      return new Response(JSON.stringify({ run, rewrite: { ...parsed, rewritten_text: `[${rewrittenText.length} chars — stored in version]` }, newVersion }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // ── REWRITE-PLAN (chunked rewrite step 1) ──
    if (action === "rewrite-plan") {
      const { projectId, documentId, versionId, approvedNotes, protectItems } = body;
      if (!projectId || !documentId || !versionId) throw new Error("projectId, documentId, versionId required");

      const { data: version } = await supabase.from("project_document_versions")
        .select("plaintext, version_number").eq("id", versionId).single();
      if (!version) throw new Error("Version not found");

      const fullText = version.plaintext || "";
      const CHUNK_TARGET = 12000;
      const chunks: { index: number; charCount: number }[] = [];
      const lines = fullText.split("\n");
      let currentChunk = "";
      let chunkTexts: string[] = [];

      for (const line of lines) {
        const isSlugline = /^(INT\.|EXT\.|INT\/EXT\.|I\/E\.)/.test(line.trim());
        if (isSlugline && currentChunk.length >= CHUNK_TARGET) {
          chunkTexts.push(currentChunk.trim());
          currentChunk = "";
        }
        currentChunk += line + "\n";
      }
      if (currentChunk.trim()) chunkTexts.push(currentChunk.trim());

      // Store chunk texts in a temporary development_runs record for retrieval
      const { data: planRun } = await supabase.from("development_runs").insert({
        project_id: projectId,
        document_id: documentId,
        version_id: versionId,
        user_id: user.id,
        run_type: "REWRITE_PLAN",
        output_json: {
          total_chunks: chunkTexts.length,
          chunk_char_counts: chunkTexts.map(c => c.length),
          original_char_count: fullText.length,
          approved_notes: approvedNotes || [],
          protect_items: protectItems || [],
          chunk_texts: chunkTexts,
        },
      }).select().single();

      return new Response(JSON.stringify({
        planRunId: planRun!.id,
        totalChunks: chunkTexts.length,
        originalCharCount: fullText.length,
      }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // ── REWRITE-CHUNK (chunked rewrite step 2 — one chunk at a time) ──
    if (action === "rewrite-chunk") {
      const { planRunId, chunkIndex, previousChunkEnding } = body;
      if (!planRunId || chunkIndex === undefined) throw new Error("planRunId, chunkIndex required");

      const { data: planRun } = await supabase.from("development_runs")
        .select("output_json").eq("id", planRunId).single();
      if (!planRun) throw new Error("Plan run not found");

      const plan = planRun.output_json as any;
      const chunkText = plan.chunk_texts[chunkIndex];
      if (!chunkText) throw new Error(`Chunk ${chunkIndex} not found`);

      const notesContext = `PROTECT (non-negotiable):\n${JSON.stringify(plan.protect_items || [])}\n\nAPPROVED NOTES:\n${JSON.stringify(plan.approved_notes || [])}`;
      const prevContext = previousChunkEnding
        ? `\n\nPREVIOUS CHUNK ENDING (for continuity):\n${previousChunkEnding}`
        : "";

      const chunkWordCount = chunkText.split(/\s+/).filter(Boolean).length;
      const chunkPrompt = `${notesContext}${prevContext}\n\nCHUNK ${chunkIndex + 1} OF ${plan.total_chunks} — Rewrite this section completely, maintaining all scenes and dialogue.\n\nINPUT LENGTH: ${chunkText.length} characters, ~${chunkWordCount} words. Your output MUST be at least ${chunkWordCount} words. Do NOT shorten.\n\n${chunkText}`;

      console.log(`Rewrite chunk ${chunkIndex + 1}/${plan.total_chunks} (${chunkText.length} chars)`);
      const rewrittenChunk = await callAI(
        LOVABLE_API_KEY, BALANCED_MODEL, REWRITE_CHUNK_SYSTEM, chunkPrompt, 0.4, 16000
      );

      return new Response(JSON.stringify({
        chunkIndex,
        rewrittenText: rewrittenChunk.trim(),
        charCount: rewrittenChunk.trim().length,
      }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // ── REWRITE-ASSEMBLE (chunked rewrite step 3 — save final version) ──
    if (action === "rewrite-assemble") {
      const { projectId, documentId, versionId, planRunId, assembledText } = body;
      if (!projectId || !documentId || !versionId || !assembledText) throw new Error("projectId, documentId, versionId, assembledText required");

      const { data: maxRow } = await supabase.from("project_document_versions")
        .select("version_number")
        .eq("document_id", documentId)
        .order("version_number", { ascending: false })
        .limit(1)
        .single();
      const nextVersion = (maxRow?.version_number ?? 0) + 1;

      const { data: newVersion, error: vErr } = await supabase.from("project_document_versions").insert({
        document_id: documentId,
        version_number: nextVersion,
        label: `Rewrite pass ${nextVersion}`,
        plaintext: assembledText,
        created_by: user.id,
        parent_version_id: versionId,
        change_summary: `Chunked rewrite across ${nextVersion - 1} iterations.`,
      }).select().single();
      if (vErr) throw vErr;

      // Get plan info for notes count
      let notesCount = 0;
      if (planRunId) {
        const { data: planRun } = await supabase.from("development_runs")
          .select("output_json").eq("id", planRunId).single();
        if (planRun) notesCount = ((planRun.output_json as any).approved_notes || []).length;
      }

      const { data: run } = await supabase.from("development_runs").insert({
        project_id: projectId,
        document_id: documentId,
        version_id: newVersion.id,
        user_id: user.id,
        run_type: "REWRITE",
        output_json: {
          rewritten_text: `[${assembledText.length} chars]`,
          changes_summary: `Full chunked rewrite. Applied ${notesCount} notes.`,
          source_version_id: versionId,
        },
      }).select().single();

      return new Response(JSON.stringify({ run, newVersion }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // ── CONVERT ──
    if (action === "convert") {
      const { projectId, documentId, versionId, targetOutput, protectItems } = body;
      if (!projectId || !documentId || !versionId || !targetOutput) throw new Error("projectId, documentId, versionId, targetOutput required");

      const { data: version } = await supabase.from("project_document_versions")
        .select("plaintext").eq("id", versionId).single();
      if (!version) throw new Error("Version not found");

      const { data: srcDoc } = await supabase.from("project_documents")
        .select("doc_type, title").eq("id", documentId).single();

      const userPrompt = `SOURCE FORMAT: ${srcDoc?.doc_type || "unknown"}
TARGET FORMAT: ${targetOutput}
PROTECT (non-negotiable creative DNA):\n${JSON.stringify(protectItems || [])}

MATERIAL:\n${version.plaintext.slice(0, 20000)}`;

      const isDraftScript = targetOutput === "DRAFT_SCRIPT";
      const model = isDraftScript ? PRO_MODEL : BALANCED_MODEL;
      const maxTok = isDraftScript ? 16000 : 10000;
      const systemPrompt = isDraftScript ? CONVERT_SYSTEM : CONVERT_SYSTEM_JSON;
      const raw = await callAI(LOVABLE_API_KEY, model, systemPrompt, userPrompt, 0.35, maxTok);

      let parsed: any;
      if (isDraftScript) {
        const markerIdx = raw.indexOf("---CHANGE_SUMMARY---");
        const convertedText = (markerIdx >= 0 ? raw.slice(0, markerIdx) : raw)
          .replace(/^```[\s\S]*?\n/, "").replace(/\n?```\s*$/, "").trim();
        const changeSummary = markerIdx >= 0 ? raw.slice(markerIdx + 20).trim() : "Converted to screenplay format";
        parsed = { converted_text: convertedText, format: "DRAFT_SCRIPT", change_summary: changeSummary };
      } else {
        parsed = await parseAIJson(LOVABLE_API_KEY, raw);
      }

      const docTypeMap: Record<string, string> = {
        BLUEPRINT: "blueprint", ARCHITECTURE: "architecture", TREATMENT: "treatment",
        ONE_PAGER: "one_pager", OUTLINE: "outline", DRAFT_SCRIPT: "script",
      };

      const { data: newDoc, error: dErr } = await supabase.from("project_documents").insert({
        project_id: projectId,
        user_id: user.id,
        file_name: `${srcDoc?.title || "Document"} — ${targetOutput}`,
        file_path: "",
        extraction_status: "complete",
        doc_type: docTypeMap[targetOutput] || "other",
        title: `${srcDoc?.title || "Document"} — ${targetOutput}`,
        source: "generated",
        plaintext: parsed.converted_text || "",
      }).select().single();
      if (dErr) throw dErr;

      const { data: newVersion } = await supabase.from("project_document_versions").insert({
        document_id: newDoc.id,
        version_number: 1,
        label: `Converted from ${srcDoc?.doc_type || "source"}`,
        plaintext: parsed.converted_text || "",
        created_by: user.id,
        change_summary: parsed.change_summary || "",
      }).select().single();

      await supabase.from("development_runs").insert({
        project_id: projectId,
        document_id: newDoc.id,
        version_id: newVersion!.id,
        user_id: user.id,
        run_type: "CONVERT",
        output_json: { ...parsed, source_document_id: documentId, source_version_id: versionId },
      });

      return new Response(JSON.stringify({ newDoc, newVersion, convert: parsed }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // ── CREATE DOC FROM PASTE ──
    if (action === "create-paste") {
      const { projectId, title, docType, text } = body;
      if (!projectId || !text) throw new Error("projectId and text required");

      const { data: doc, error: dErr } = await supabase.from("project_documents").insert({
        project_id: projectId,
        user_id: user.id,
        file_name: title || "Pasted Document",
        file_path: "",
        extraction_status: "complete",
        doc_type: docType || "other",
        title: title || "Pasted Document",
        source: "paste",
        plaintext: text,
        extracted_text: text,
        char_count: text.length,
      }).select().single();
      if (dErr) throw dErr;

      const { data: ver } = await supabase.from("project_document_versions").insert({
        document_id: doc.id,
        version_number: 1,
        label: "Original",
        plaintext: text,
        created_by: user.id,
      }).select().single();

      return new Response(JSON.stringify({ document: doc, version: ver }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // ═══════════════════════════════════════════════════════════
    // SCREENPLAY PIPELINE
    // ═══════════════════════════════════════════════════════════

    // ── SCRIPT PLAN ──
    if (action === "script-plan") {
      const { projectId, documentId, versionId, targetPages, protectItems } = body;
      if (!projectId || !documentId || !versionId) throw new Error("projectId, documentId, versionId required");

      const { data: version } = await supabase.from("project_document_versions")
        .select("plaintext").eq("id", versionId).single();
      if (!version) throw new Error("Version not found");

      const { data: srcDoc } = await supabase.from("project_documents")
        .select("doc_type, title").eq("id", documentId).single();

      const userPrompt = `SOURCE FORMAT: ${srcDoc?.doc_type || "unknown"}
SOURCE TITLE: ${srcDoc?.title || "Unknown"}
TARGET PAGES: ${targetPages || 100}
PROTECT (non-negotiable creative DNA): ${JSON.stringify(protectItems || [])}

MATERIAL (${version.plaintext.length} chars):
${version.plaintext.slice(0, 25000)}`;

      const raw = await callAI(LOVABLE_API_KEY, PRO_MODEL, SCRIPT_PLAN_SYSTEM, userPrompt, 0.25, 8000);
      const parsed = await parseAIJson(LOVABLE_API_KEY, raw);

      // Save plan as a run
      const { data: run, error: runErr } = await supabase.from("development_runs").insert({
        project_id: projectId,
        document_id: documentId,
        version_id: versionId,
        user_id: user.id,
        run_type: "SCRIPT_PLAN",
        output_json: parsed,
      }).select().single();
      if (runErr) throw runErr;

      // Create the master script document
      const { data: scriptDoc, error: sdErr } = await supabase.from("project_documents").insert({
        project_id: projectId,
        user_id: user.id,
        file_name: `${srcDoc?.title || "Script"} — Feature Screenplay`,
        file_path: "",
        extraction_status: "in_progress",
        doc_type: "script",
        title: `${srcDoc?.title || "Script"} — Feature Screenplay`,
        source: "generated",
        plaintext: "",
      }).select().single();
      if (sdErr) throw sdErr;

      // Create initial empty version
      const { data: scriptVersion } = await supabase.from("project_document_versions").insert({
        document_id: scriptDoc.id,
        version_number: 1,
        label: "Feature screenplay (generating…)",
        plaintext: "",
        created_by: user.id,
        change_summary: "Pipeline generation in progress",
      }).select().single();

      // Compute batches (group scenes into batches of ~5 pages each)
      const allScenes: any[] = [];
      for (const act of (parsed.acts || [])) {
        for (const scene of (act.scenes || [])) {
          allScenes.push({ ...scene, act: act.act });
        }
      }
      const batches: any[][] = [];
      let currentBatch: any[] = [];
      let currentPages = 0;
      for (const scene of allScenes) {
        currentBatch.push(scene);
        currentPages += scene.page_estimate || 2;
        if (currentPages >= 5) {
          batches.push(currentBatch);
          currentBatch = [];
          currentPages = 0;
        }
      }
      if (currentBatch.length > 0) batches.push(currentBatch);

      return new Response(JSON.stringify({
        run, plan: parsed, scriptDoc, scriptVersion,
        batches: batches.map((b, i) => ({
          index: i,
          scenes: b,
          totalPages: b.reduce((s: number, sc: any) => s + (sc.page_estimate || 2), 0),
        })),
        totalBatches: batches.length,
      }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // ── WRITE SCENES BATCH ──
    if (action === "write-batch") {
      const { projectId, scriptDocId, scriptVersionId, batchIndex, scenes, previousText, toneLock, nonNegotiables, totalBatches } = body;
      if (!projectId || !scriptDocId || !scriptVersionId || !scenes) throw new Error("Missing required fields");

      const batchPages = scenes.reduce((s: number, sc: any) => s + (sc.page_estimate || 2), 0);

      const scenesDesc = scenes.map((s: any) =>
        `${s.scene_id}: ${s.slug}\n  Purpose: ${s.purpose}\n  Target: ~${s.page_estimate || 2} pages`
      ).join("\n\n");

      // Include last ~2000 chars of previous text for continuity
      const continuityContext = previousText
        ? `\n\nPREVIOUS SCREENPLAY ENDING (for continuity — do NOT repeat this, continue from here):\n...\n${previousText.slice(-2000)}`
        : "\n\nThis is the FIRST batch. Start with FADE IN:";

      const userPrompt = `BATCH ${batchIndex + 1} OF ${totalBatches}
TARGET: ~${batchPages} pages (${batchPages * 250} words)
TONE: ${toneLock || "as established"}
NON-NEGOTIABLES: ${JSON.stringify(nonNegotiables || [])}

SCENES TO WRITE:
${scenesDesc}
${continuityContext}

Write these scenes NOW in proper screenplay format. Output ONLY screenplay text.`;

      const raw = await callAI(LOVABLE_API_KEY, PRO_MODEL, WRITE_BATCH_SYSTEM, userPrompt, 0.4, 8000);

      // Clean any accidental code fences
      const cleanText = raw
        .replace(/^```[\s\S]*?\n/, "")
        .replace(/\n?```\s*$/, "")
        .trim();

      // Save run
      await supabase.from("development_runs").insert({
        project_id: projectId,
        document_id: scriptDocId,
        version_id: scriptVersionId,
        user_id: user.id,
        run_type: "WRITE_SCENES_BATCH",
        output_json: {
          batch_index: batchIndex,
          total_batches: totalBatches,
          scenes_written: scenes.map((s: any) => s.scene_id),
          word_count: cleanText.split(/\s+/).length,
          char_count: cleanText.length,
        },
      });

      return new Response(JSON.stringify({
        batchIndex,
        text: cleanText,
        wordCount: cleanText.split(/\s+/).length,
        pageEstimate: Math.round(cleanText.split(/\s+/).length / 250),
      }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // ── ASSEMBLE SCRIPT ──
    if (action === "assemble-script") {
      const { projectId, scriptDocId, scriptVersionId, assembledText, planJson } = body;
      if (!projectId || !scriptDocId || !scriptVersionId || !assembledText) throw new Error("Missing required fields");

      const wordCount = assembledText.split(/\s+/).length;
      const pageEstimate = Math.round(wordCount / 250);

      // Save assembled text to the version
      const { error: vErr } = await supabase.from("project_document_versions")
        .update({
          plaintext: assembledText,
          label: `Feature screenplay (${pageEstimate} pages)`,
          change_summary: `Assembled from ${planJson?.total_scenes || "?"} scenes across ${planJson?.acts?.length || 3} acts. ${wordCount} words, ~${pageEstimate} pages.`,
        })
        .eq("id", scriptVersionId);
      if (vErr) throw vErr;

      // Update the document
      await supabase.from("project_documents")
        .update({
          plaintext: assembledText,
          extraction_status: "complete",
        })
        .eq("id", scriptDocId);

      // Save assembly run
      const { data: run } = await supabase.from("development_runs").insert({
        project_id: projectId,
        document_id: scriptDocId,
        version_id: scriptVersionId,
        user_id: user.id,
        run_type: "ASSEMBLE_SCRIPT",
        output_json: {
          word_count: wordCount,
          page_estimate: pageEstimate,
          target_pages: planJson?.target_pages,
          total_scenes: planJson?.total_scenes,
          acts: planJson?.acts?.length || 3,
        },
      }).select().single();

      return new Response(JSON.stringify({
        run,
        wordCount,
        pageEstimate,
        scriptDocId,
        scriptVersionId,
      }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    throw new Error(`Unknown action: ${action}`);
  } catch (err: any) {
    console.error("dev-engine-v2 error:", err);
    return new Response(JSON.stringify({ error: err.message }), {
      status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
