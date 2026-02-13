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
  if (!response.ok) {
    const t = await response.text();
    console.error("AI error:", response.status, t);
    throw new Error(`AI call failed: ${response.status}`);
  }
  const data = await response.json();
  return data.choices?.[0]?.message?.content || "";
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

Return ONLY valid JSON:
{
  "rewritten_text": "the full rewritten material",
  "changes_summary": "bullet summary of changes",
  "creative_preserved": "what creative elements were protected",
  "commercial_improvements": "what commercial improvements were introduced"
}`;

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

      // Get version text
      const { data: version } = await supabase.from("project_document_versions")
        .select("plaintext").eq("id", versionId).single();
      if (!version) throw new Error("Version not found");

      // Get project context
      const { data: project } = await supabase.from("projects")
        .select("title, logline, genre, production_type, budget_range, assigned_lane")
        .eq("id", projectId).single();

      // Get previous scores for trajectory
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

      const userPrompt = `PRODUCTION TYPE: ${productionType || project?.production_type || "narrative_feature"}
STRATEGIC PRIORITY: ${strategicPriority || "BALANCED"}
DEVELOPMENT STAGE: ${developmentStage || "IDEA"}
ANALYSIS MODE: ${analysisMode || "DUAL"}
PROJECT: ${project?.title || "Unknown"} — ${project?.logline || ""}
GENRE: ${project?.genre || "Unknown"} | LANE: ${project?.assigned_lane || "Unknown"} | BUDGET: ${project?.budget_range || "Unknown"}
${prevContext}

MATERIAL (${version.plaintext.length} chars):
${version.plaintext.slice(0, 25000)}`;

      const raw = await callAI(LOVABLE_API_KEY, PRO_MODEL, ANALYZE_SYSTEM, userPrompt, 0.2, 6000);
      const parsed = await parseAIJson(LOVABLE_API_KEY, raw);

      // Save run
      const { data: run, error: runErr } = await supabase.from("development_runs").insert({
        project_id: projectId,
        document_id: documentId,
        version_id: versionId,
        user_id: user.id,
        run_type: "ANALYZE",
        production_type: productionType || project?.production_type || "narrative_feature",
        strategic_priority: strategicPriority || "BALANCED",
        development_stage: developmentStage || "IDEA",
        analysis_mode: analysisMode || "DUAL",
        output_json: parsed,
      }).select().single();
      if (runErr) throw runErr;

      // Save convergence history
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

      // Get version text
      const { data: version } = await supabase.from("project_document_versions")
        .select("plaintext").eq("id", versionId).single();
      if (!version) throw new Error("Version not found");

      // Get latest analysis if not provided
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

      const userPrompt = `PROTECT (non-negotiable):\n${JSON.stringify(protectItems || [])}

APPROVED NOTES:\n${JSON.stringify(approvedNotes || [])}

TARGET FORMAT: ${targetDocType || "same as source"}

MATERIAL TO REWRITE:\n${version.plaintext.slice(0, 20000)}`;

      const raw = await callAI(LOVABLE_API_KEY, BALANCED_MODEL, REWRITE_SYSTEM, userPrompt, 0.4, 12000);
      const parsed = await parseAIJson(LOVABLE_API_KEY, raw);

      // Create new version
      const { data: newVersion, error: vErr } = await supabase.from("project_document_versions").insert({
        document_id: documentId,
        version_number: version.version_number + 1,
        label: `Rewrite pass ${version.version_number + 1}`,
        plaintext: parsed.rewritten_text || "",
        created_by: user.id,
        parent_version_id: versionId,
        change_summary: parsed.changes_summary || "",
      }).select().single();
      if (vErr) throw vErr;

      // Log run
      const { data: run } = await supabase.from("development_runs").insert({
        project_id: projectId,
        document_id: documentId,
        version_id: newVersion.id,
        user_id: user.id,
        run_type: "REWRITE",
        output_json: { ...parsed, source_version_id: versionId },
      }).select().single();

      return new Response(JSON.stringify({ run, rewrite: parsed, newVersion }), {
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
        // Plain-text output — split on the change summary marker
        const markerIdx = raw.indexOf("---CHANGE_SUMMARY---");
        const convertedText = (markerIdx >= 0 ? raw.slice(0, markerIdx) : raw)
          .replace(/^```[\s\S]*?\n/, "").replace(/\n?```\s*$/, "").trim();
        const changeSummary = markerIdx >= 0 ? raw.slice(markerIdx + 20).trim() : "Converted to screenplay format";
        parsed = { converted_text: convertedText, format: "DRAFT_SCRIPT", change_summary: changeSummary };
      } else {
        parsed = await parseAIJson(LOVABLE_API_KEY, raw);
      }

      // Create new document + version
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

      // Log run
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

    throw new Error(`Unknown action: ${action}`);
  } catch (err: any) {
    console.error("dev-engine-v2 error:", err);
    return new Response(JSON.stringify({ error: err.message }), {
      status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
