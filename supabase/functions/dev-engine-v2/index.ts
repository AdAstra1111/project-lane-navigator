import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const PRO_MODEL = "google/gemini-2.5-pro";
const FAST_MODEL = "google/gemini-2.5-flash";
const BALANCED_MODEL = "google/gemini-3-flash-preview";

const SCHEMA_VERSION = "v3";

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
      const text = await response.text();
      if (!text || text.trim().length === 0) {
        console.error(`Empty response body from AI (attempt ${attempt + 1}/${MAX_RETRIES})`);
        if (attempt < MAX_RETRIES - 1) {
          await new Promise(r => setTimeout(r, Math.pow(2, attempt) * 2000));
          continue;
        }
        throw new Error("AI returned empty response after retries");
      }
      let data: any;
      try {
        data = JSON.parse(text);
      } catch {
        const lastBrace = text.lastIndexOf("}");
        if (lastBrace > 0) {
          try {
            data = JSON.parse(text.substring(0, lastBrace + 1));
            console.warn("Recovered truncated JSON from AI response");
          } catch {
            throw new Error("AI returned unparseable response");
          }
        } else {
          throw new Error("AI returned unparseable response");
        }
      }
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
// DELIVERABLE-AWARE RUBRICS
// ═══════════════════════════════════════════════════════════════

const DELIVERABLE_RUBRICS: Record<string, string> = {
  idea: `Evaluate as an IDEA/LOGLINE. Score clarity, originality, market hook, audience identification. Do NOT evaluate dialogue, pacing, or scene structure.`,
  concept_brief: `Evaluate as a CONCEPT BRIEF. Score premise strength, theme clarity, genre positioning, tonal consistency. Do NOT evaluate scene-level craft or dialogue.`,
  market_sheet: `Evaluate as a MARKET SHEET. Score market positioning, comparable titles, audience targeting, budget alignment. Do NOT evaluate narrative craft.`,
  blueprint: `Evaluate as a BLUEPRINT. Score structural architecture, act breaks, key beats, escalation logic, thematic spine. Do NOT evaluate dialogue quality or specific prose.`,
  architecture: `Evaluate as an ARCHITECTURE document. Score scene-by-scene planning, page allocation, structural balance, pacing blueprint. Do NOT evaluate dialogue.`,
  character_bible: `Evaluate as a CHARACTER BIBLE. Score character depth, arc design, relationship dynamics, thematic integration. Do NOT evaluate scene structure or pacing.`,
  beat_sheet: `Evaluate as a BEAT SHEET. Score beat progression, dramatic escalation, turning points, structural completeness. Do NOT evaluate prose quality or dialogue.`,
  script: `Evaluate as a SCRIPT/SCREENPLAY. Score dialogue craft, scene dynamics, pacing, character voice, visual storytelling, structural integrity.`,
  production_draft: `Evaluate as a PRODUCTION DRAFT. Score production readiness, clarity for department heads, scene feasibility, schedule implications. Also evaluate script quality.`,
  deck: `Evaluate as a DECK/PITCH DOCUMENT. Score clarity of vision, market positioning, visual storytelling strategy, talent strategy. Do NOT invent characters or scenes. Do NOT use INT./EXT. scene headings.`,
  documentary_outline: `Evaluate as a DOCUMENTARY OUTLINE. Score narrative structure, subject access, thematic coherence, editorial approach. Do NOT invent characters, fabricate scenes, or generate INT./EXT. sluglines. Use [PLACEHOLDER] for missing information.`,
};

const BEHAVIOR_MODIFIERS: Record<string, string> = {
  efficiency: `BEHAVIOR MODE: Efficiency — prioritize clarity and directness. Score thresholds are relaxed. Focus on actionable, time-efficient improvements.`,
  market: `BEHAVIOR MODE: Market — balanced rigor. Standard scoring thresholds apply.`,
  prestige: `BEHAVIOR MODE: Prestige — highest structural and thematic standards. Scores must reach 85/80 minimum. Require deep craft analysis. Two rewrite cycles minimum for convergence.`,
};

const FORMAT_EXPECTATIONS: Record<string, string> = {
  "film": `FORMAT: Feature Film — expect 3-act structure, 90-110 minute runtime, midpoint reversal, escalating stakes.`,
  "feature": `FORMAT: Feature Film — expect 3-act structure, 90-110 minute runtime, midpoint reversal, escalating stakes.`,
  "tv-series": `FORMAT: TV Series — evaluate pilot structure, series engine sustainability, episode-to-episode hooks.`,
  "limited-series": `FORMAT: Limited Series — evaluate closed narrative arc, episode pacing, thematic unity across episodes.`,
  "vertical-drama": `FORMAT: Vertical Drama — short-form mobile-first content. Hook must occur within first 10 seconds. Require cliffhanger ending. Enforce beat density per minute. Do NOT apply feature film pacing logic.`,
  "documentary": `FORMAT: Documentary — evaluate editorial approach, subject access, ethical considerations. STRICT: Do NOT invent characters, fabricate scenes, or use INT./EXT. scene headings.`,
  "documentary-series": `FORMAT: Documentary Series — multi-episode documentary. Same non-fabrication rules as documentary.`,
  "hybrid-documentary": `FORMAT: Hybrid Documentary — docudrama approach. Non-fabrication rules apply to documentary sections.`,
  "short": `FORMAT: Short Film — evaluate economy of storytelling, single-idea clarity, impact within constrained runtime.`,
  "animation": `FORMAT: Animation — evaluate visual storytelling potential, world-building, character design implications.`,
  "digital-series": `FORMAT: Digital Series — evaluate episode hooks, platform-native pacing, audience retention strategy.`,
};

// ═══════════════════════════════════════════════════════════════
// STANDARDIZED OUTPUT SCHEMA (v3)
// ═══════════════════════════════════════════════════════════════

function buildAnalyzeSystem(deliverable: string, format: string, behavior: string, episodeDuration?: number): string {
  const rubric = DELIVERABLE_RUBRICS[deliverable] || DELIVERABLE_RUBRICS.script;
  const behaviorMod = BEHAVIOR_MODIFIERS[behavior] || BEHAVIOR_MODIFIERS.market;
  const formatExp = FORMAT_EXPECTATIONS[format] || FORMAT_EXPECTATIONS.film;

  let verticalRules = "";
  if (format === "vertical-drama" && episodeDuration) {
    const beatMin = episodeDuration <= 90 ? 3 : episodeDuration <= 120 ? 4 : episodeDuration <= 150 ? 5 : episodeDuration <= 180 ? 6 : 7;
    const beatsPerMin = behavior === "efficiency" ? 2.5 : behavior === "prestige" ? 2.5 : 3.0;
    verticalRules = `\nVERTICAL DRAMA RULES: Episode duration = ${episodeDuration}s. Required beat minimum = ${beatMin}. Required beats-per-minute ≥ ${beatsPerMin}. Hook within first 10s. Cliffhanger ending required.`;
  }

  // Documentary/deck safeguard
  const isDocSafe = ["deck", "documentary_outline"].includes(deliverable) ||
    ["documentary", "documentary-series", "hybrid-documentary"].includes(format);
  const docGuard = isDocSafe
    ? "\nDOCUMENTARY/DECK GUARD: Do NOT invent characters, fabricate scenes, or generate INT./EXT. sluglines. Use [PLACEHOLDER] for missing information."
    : "";

  return `You are IFFY, a Creative–Commercial Alignment Architect.

${rubric}

${formatExp}

${behaviorMod}
${verticalRules}${docGuard}

Return ONLY valid JSON matching this EXACT schema:
{
  "meta": {
    "deliverable_type": "${deliverable}",
    "format": "${format}",
    "development_behavior": "${behavior}",
    "schema_version": "${SCHEMA_VERSION}"
  },
  "summary": ["max 5 bullet points — key findings"],
  "scores": {
    "ci_score": 0-100,
    "gp_score": 0-100,
    "gap": number,
    "allowed_gap": number
  },
  "blocking_issues": [
    {"id": "unique_stable_key", "note_key": "same_as_id", "category": "structural|character|escalation|lane|packaging|risk|pacing|hook|cliffhanger", "description": "...", "why_it_matters": "...", "severity": "blocker"}
  ],
  "high_impact_notes": [
    {"id": "unique_stable_key", "note_key": "same_as_id", "category": "structural|character|escalation|lane|packaging|risk|pacing|hook|cliffhanger", "description": "...", "why_it_matters": "...", "severity": "high"}
  ],
  "polish_notes": [
    {"id": "unique_stable_key", "note_key": "same_as_id", "category": "structural|character|escalation|lane|packaging|risk|pacing|hook|cliffhanger", "description": "...", "why_it_matters": "...", "severity": "polish"}
  ],
  "rewrite_plan": ["what will change in next rewrite — max 5 items"],
  "convergence": {
    "status": "not_started" | "in_progress" | "converged",
    "reasons": ["why this status"],
    "blockers_remaining": number,
    "high_impact_remaining": number,
    "polish_remaining": number,
    "next_best_document": "MUST be one of: idea, concept_brief, market_sheet, blueprint, architecture, character_bible, beat_sheet, script, production_draft, deck, documentary_outline"
  },
  "protect": ["non-negotiable creative strengths, 1-10 items"],
  "verdict": "Invest" | "Develop Further" | "Major Rethink" | "Pass",
  "executive_snapshot": "2-3 sentence strategic summary",
  "trajectory": null or "Converging" | "Eroding" | "Stalled" | "Strengthened" | "Over-Optimised",
  "primary_creative_risk": "one sentence",
  "primary_commercial_risk": "one sentence",
  "extracted_core": {
    "protagonist": "main character name and one-line description",
    "antagonist": "antagonist or opposing force",
    "stakes": "what is at stake",
    "midpoint": "key midpoint event",
    "climax": "climactic moment",
    "tone": "overall tone",
    "audience": "target audience",
    "genre": "primary genre"
  }
}

RULES FOR NOTE GENERATION:
- Each note id and note_key MUST be identical, stable, descriptive snake_case keys (e.g. "weak_act2_midpoint", "flat_protagonist_arc"). Use consistent keys across runs.
- blocking_issues: ONLY items that fundamentally prevent the document from working. Max 5. These gate convergence.
- high_impact_notes: Significant improvements but do NOT block convergence. Max 5.
- polish_notes: Optional refinements. NEVER block convergence. Max 5.
- If an existing note_key persists, refer to it by the same key — do NOT rephrase the same issue under a new key.
- Once blockers reach zero, do NOT invent new blockers unless drift or regression is detected.
- If high_impact_notes <= 3 AND polish_notes <= 5 AND blockers == 0, set convergence.status to "converged".
- CONVERGENCE RULE: convergence.status = "converged" if and only if blocking_issues is empty.`;
}

function buildRewriteSystem(deliverable: string, format: string, behavior: string): string {
  const isDocSafe = ["deck", "documentary_outline"].includes(deliverable) ||
    ["documentary", "documentary-series", "hybrid-documentary"].includes(format);

  let docGuard = "";
  if (isDocSafe) {
    docGuard = `\n\nHARD SAFEGUARDS:
- FORBID inventing characters not present in the original
- FORBID inventing scenes not present in the original
- FORBID using INT./EXT. scene headings (unless already in source)
- Use [PLACEHOLDER] instead of fabricating information
- If you cannot rewrite without invention, return the original text unchanged with a note explaining why.`;
  }

  let formatRules = "";
  if (format === "vertical-drama") {
    formatRules = "\n\nVERTICAL DRAMA: Preserve hook in first 10 seconds. Maintain cliffhanger ending. Do NOT apply feature pacing logic.";
  }

  return `You are IFFY. Rewrite the material applying the approved strategic notes.
DELIVERABLE TYPE: ${deliverable}
FORMAT: ${format}
BEHAVIOR: ${behavior}

Rules:
- Preserve all PROTECT items absolutely.
- Do not flatten voice for minor commercial gain.
- Strengthen escalation and improve packaging magnetism organically.
- Match the target deliverable type format expectations.
- OUTPUT THE FULL REWRITTEN MATERIAL — do NOT summarize or truncate.
${docGuard}${formatRules}

Return ONLY valid JSON:
{
  "rewritten_text": "the full rewritten material",
  "changes_summary": "bullet summary of changes",
  "creative_preserved": "what creative elements were protected",
  "commercial_improvements": "what commercial improvements were introduced"
}`;
}

// ═══════════════════════════════════════════════════════════════
// POST-PROCESSING SAFEGUARD
// ═══════════════════════════════════════════════════════════════

function validateDocSafety(originalText: string, rewrittenText: string, deliverable: string, format: string): string | null {
  const isDocSafe = ["deck", "documentary_outline"].includes(deliverable) ||
    ["documentary", "documentary-series", "hybrid-documentary"].includes(format);
  if (!isDocSafe) return null;

  // Check for INT./EXT. scene headings not in original
  const sceneHeadingPattern = /^(INT\.|EXT\.|INT\/EXT\.|I\/E\.)\s/gm;
  const originalHeadings = new Set((originalText.match(sceneHeadingPattern) || []).map(h => h.trim()));
  const newHeadings = (rewrittenText.match(sceneHeadingPattern) || []).map(h => h.trim());
  const addedHeadings = newHeadings.filter(h => !originalHeadings.has(h));

  if (addedHeadings.length > 0) {
    return `Safety guard triggered: Rewrite introduced ${addedHeadings.length} new scene heading(s) not present in the original (${addedHeadings.slice(0, 3).join(", ")}). For documentary/deck deliverables, the engine cannot invent scenes. The original text has been preserved.`;
  }

  return null;
}

// ═══════════════════════════════════════════════════════════════
// PIPELINE PROMPTS (unchanged)
// ═══════════════════════════════════════════════════════════════

const REWRITE_CHUNK_SYSTEM = `You are rewriting a feature-length screenplay for professional quality.

GOALS:
- Tight, well-written prose and dialogue.
- Stronger clarity, pacing, and dramatic impact.
- Preserve professional screenplay formatting.
- Preserve all PROTECT items absolutely.
- Maintain perfect continuity with the previous chunk context provided.

CRITICAL:
- Do NOT summarize the story.
- Do NOT collapse multiple beats into one line.
- Do NOT turn scenes into summaries.
- Maintain full feature-length pacing and dramatic beats.
- You may tighten within moments, but do not reduce the film's overall scope or runtime.

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
// DRIFT DETECTION
// ═══════════════════════════════════════════════════════════════

const CORE_FIELDS = ["protagonist", "antagonist", "stakes", "midpoint", "climax", "tone", "audience", "genre"] as const;

function textSimilarity(a: string, b: string): number {
  if (!a || !b) return 0;
  const wordsA = new Set(a.toLowerCase().split(/\s+/).filter(w => w.length > 2));
  const wordsB = new Set(b.toLowerCase().split(/\s+/).filter(w => w.length > 2));
  if (wordsA.size === 0 && wordsB.size === 0) return 100;
  if (wordsA.size === 0 || wordsB.size === 0) return 0;
  let overlap = 0;
  for (const w of wordsA) { if (wordsB.has(w)) overlap++; }
  const union = new Set([...wordsA, ...wordsB]).size;
  return Math.round((overlap / union) * 100);
}

function detectDrift(currentCore: Record<string, string>, inheritedCore: Record<string, string>): { level: string; items: Array<{ field: string; similarity: number; inherited: string; current: string }> } {
  const items: Array<{ field: string; similarity: number; inherited: string; current: string }> = [];
  let hasIdentityChange = false;

  for (const field of CORE_FIELDS) {
    const inherited = inheritedCore[field] || "";
    const current = currentCore[field] || "";
    if (!inherited && !current) continue;
    const sim = textSimilarity(inherited, current);
    if (sim < 85) {
      items.push({ field, similarity: sim, inherited, current });
      if (["protagonist", "antagonist", "stakes"].includes(field) && sim < 40) {
        hasIdentityChange = true;
      }
    }
  }

  if (items.length === 0) return { level: "none", items: [] };
  const avgSim = items.reduce((s, i) => s + i.similarity, 0) / items.length;
  if (avgSim < 60 || hasIdentityChange) return { level: "major", items };
  return { level: "moderate", items };
}

function extractCoreFromText(text: string): Record<string, string> {
  // Simple heuristic extraction — will be enhanced by AI in analyze
  const lower = text.toLowerCase();
  const lines = text.split("\n").filter(l => l.trim());
  return {
    protagonist: "",
    antagonist: "",
    stakes: "",
    midpoint: "",
    climax: "",
    tone: "",
    audience: "",
    genre: "",
  };
}

// ═══════════════════════════════════════════════════════════════
// FORMAT HELPERS
// ═══════════════════════════════════════════════════════════════

const formatToProductionType: Record<string, string> = {
  "vertical-drama": "vertical_drama",
  "tv-series": "tv_series",
  "limited-series": "limited_series",
  "documentary": "documentary",
  "documentary-series": "documentary_series",
  "hybrid-documentary": "hybrid_documentary",
  "short": "short_film",
  "animation": "animation",
  "digital-series": "digital_series",
};

const docTypeMap: Record<string, string> = {
  IDEA: "idea",
  CONCEPT_BRIEF: "concept_brief",
  "CONCEPT BRIEF": "concept_brief",
  MARKET_SHEET: "market_sheet",
  "MARKET SHEET": "market_sheet",
  BLUEPRINT: "blueprint",
  ARCHITECTURE: "architecture",
  CHARACTER_BIBLE: "character_bible",
  "CHARACTER BIBLE": "character_bible",
  BEAT_SHEET: "beat_sheet",
  "BEAT SHEET": "beat_sheet",
  SCRIPT: "script",
  PILOT_SCRIPT: "script",
  "PILOT SCRIPT": "script",
  PRODUCTION_DRAFT: "production_draft",
  "PRODUCTION DRAFT": "production_draft",
  DECK: "deck",
  DOCUMENTARY_OUTLINE: "documentary_outline",
  "DOCUMENTARY OUTLINE": "documentary_outline",
  TREATMENT: "treatment",
  ONE_PAGER: "one_pager",
  OUTLINE: "blueprint",
  EPISODE_OUTLINE: "blueprint",
  "EPISODE OUTLINE": "blueprint",
  "EPISODE_BEAT_SHEET": "beat_sheet",
  "EPISODE BEAT SHEET": "beat_sheet",
  DRAFT_SCRIPT: "script",
};

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

    // ══════════════════════════════════════════════
    // ANALYZE — strict routing: deliverable → format → behavior
    // ══════════════════════════════════════════════
    if (action === "analyze") {
      const { projectId, documentId, versionId, deliverableType, developmentBehavior, format: reqFormat, episodeTargetDurationSeconds, strategicPriority, developmentStage, analysisMode, previousVersionId, productionType } = body;
      if (!projectId || !documentId || !versionId) throw new Error("projectId, documentId, versionId required");
      if (!deliverableType) throw new Error("deliverableType is required — select a deliverable type before analyzing");

      const { data: version } = await supabase.from("project_document_versions")
        .select("plaintext").eq("id", versionId).single();
      if (!version) throw new Error("Version not found");

      const { data: project } = await supabase.from("projects")
        .select("title, budget_range, assigned_lane, format, development_behavior, episode_target_duration_seconds, season_episode_count")
        .eq("id", projectId).single();

      const rawFormat = reqFormat || project?.format || "film";
      const effectiveFormat = rawFormat.toLowerCase().replace(/_/g, "-");
      const effectiveBehavior = developmentBehavior || project?.development_behavior || "market";
      const effectiveDeliverable = deliverableType;
      const effectiveDuration = episodeTargetDurationSeconds || project?.episode_target_duration_seconds;
      const effectiveProductionType = productionType || formatToProductionType[effectiveFormat] || "narrative_feature";

      // Vertical drama: require episode duration
      if (effectiveFormat === "vertical-drama" && !effectiveDuration) {
        throw new Error("episode_target_duration_seconds is required for vertical drama format");
      }

      // Fetch season config for vertical drama
      const seasonEpisodeCount = body.seasonEpisodeCount || (project as any)?.season_episode_count;
      let seasonArchitecture: any = null;
      if (effectiveFormat === "vertical-drama" && seasonEpisodeCount) {
        // Compute season architecture inline (mirrors dev-os-config.ts logic)
        const E = seasonEpisodeCount;
        if (E >= 10) {
          const actSize = Math.floor(E * 0.2);
          const remainder = E - actSize * 5;
          const acts: any[] = [];
          let cursor = 1;
          for (let a = 1; a <= 5; a++) {
            const extra = a > (5 - remainder) ? 1 : 0;
            const count = actSize + extra;
            acts.push({ act: a, start_episode: cursor, end_episode: cursor + count - 1, episode_count: count });
            cursor += count;
          }
          seasonArchitecture = {
            model: "5-act", episode_count: E, acts,
            anchors: { reveal_index: Math.round(E * 0.25), mid_index: Math.round(E * 0.50), pre_finale_index: Math.round(E * 0.80), finale_index: E },
          };
        } else {
          const act1 = Math.round(E * 0.3); const act3 = Math.round(E * 0.3); const act2 = E - act1 - act3;
          seasonArchitecture = {
            model: "3-act", episode_count: E,
            acts: [
              { act: 1, start_episode: 1, end_episode: act1, episode_count: act1 },
              { act: 2, start_episode: act1 + 1, end_episode: act1 + act2, episode_count: act2 },
              { act: 3, start_episode: act1 + act2 + 1, end_episode: E, episode_count: act3 },
            ],
            anchors: { reveal_index: Math.round(E * 0.33), mid_index: Math.round(E * 0.55), finale_index: E },
          };
        }
      }

      // Build deliverable-aware system prompt (routing order: deliverable → format → behavior)
      const systemPrompt = buildAnalyzeSystem(effectiveDeliverable, effectiveFormat, effectiveBehavior, effectiveDuration);

      let prevContext = "";
      if (previousVersionId) {
        const { data: prevRun } = await supabase.from("development_runs")
          .select("output_json").eq("version_id", previousVersionId).eq("run_type", "ANALYZE")
          .order("created_at", { ascending: false }).limit(1).single();
        if (prevRun?.output_json) {
          const pj = prevRun.output_json as any;
          const scores = pj.scores || pj;
          prevContext = `\nPREVIOUS SCORES: CI=${scores.ci_score}, GP=${scores.gp_score}, Gap=${scores.gap}`;
        }
      }

      let seasonContext = "";
      if (seasonArchitecture) {
        seasonContext = `\nSEASON ARCHITECTURE: ${seasonArchitecture.episode_count} episodes, ${seasonArchitecture.model} model. Anchors: reveal=${seasonArchitecture.anchors.reveal_index}, midpoint=${seasonArchitecture.anchors.mid_index}${seasonArchitecture.anchors.pre_finale_index ? `, pre-finale=${seasonArchitecture.anchors.pre_finale_index}` : ""}, finale=${seasonArchitecture.anchors.finale_index}.`;
      }

      const userPrompt = `PRODUCTION TYPE: ${effectiveProductionType}
STRATEGIC PRIORITY: ${strategicPriority || "BALANCED"}
DEVELOPMENT STAGE: ${developmentStage || "IDEA"}
PROJECT: ${project?.title || "Unknown"}
LANE: ${project?.assigned_lane || "Unknown"} | BUDGET: ${project?.budget_range || "Unknown"}
${prevContext}${seasonContext}

MATERIAL (${version.plaintext.length} chars):
${version.plaintext.slice(0, 25000)}`;

      const raw = await callAI(LOVABLE_API_KEY, PRO_MODEL, systemPrompt, userPrompt, 0.2, 6000);
      const parsed = await parseAIJson(LOVABLE_API_KEY, raw);

      // Normalize: ensure scores are at top level for backward compat
      const scores = parsed.scores || {};
      if (scores.ci_score != null && parsed.ci_score == null) {
        parsed.ci_score = scores.ci_score;
        parsed.gp_score = scores.gp_score;
        parsed.gap = scores.gap;
        parsed.allowed_gap = scores.allowed_gap;
      }
      // Ensure meta is present
      if (!parsed.meta) {
        parsed.meta = { deliverable_type: effectiveDeliverable, format: effectiveFormat, development_behavior: effectiveBehavior, schema_version: SCHEMA_VERSION };
      }
      parsed.deliverable_type = effectiveDeliverable;
      parsed.development_behavior = effectiveBehavior;

      // Validate next_best_document — must be a valid deliverable type key
      const VALID_DELIVERABLES = new Set(["idea","concept_brief","market_sheet","blueprint","architecture","character_bible","beat_sheet","script","production_draft","deck","documentary_outline"]);
      if (parsed.convergence?.next_best_document) {
        const raw_nbd = parsed.convergence.next_best_document;
        const normalized_nbd = raw_nbd.toLowerCase().replace(/[\s\-]+/g, "_").replace(/[^a-z_]/g, "");
        // Try direct match, then docTypeMap, then fuzzy
        if (VALID_DELIVERABLES.has(normalized_nbd)) {
          parsed.convergence.next_best_document = normalized_nbd;
        } else if (docTypeMap[raw_nbd.toUpperCase()]) {
          parsed.convergence.next_best_document = docTypeMap[raw_nbd.toUpperCase()];
        } else {
          // Fuzzy: find best match from valid set
          const fuzzyMatch = [...VALID_DELIVERABLES].find(d => normalized_nbd.includes(d) || d.includes(normalized_nbd));
          parsed.convergence.next_best_document = fuzzyMatch || "script";
        }
      }

      // Enforce caps: max 5 per tier
      if (parsed.blocking_issues && parsed.blocking_issues.length > 5) parsed.blocking_issues = parsed.blocking_issues.slice(0, 5);
      if (parsed.high_impact_notes && parsed.high_impact_notes.length > 5) parsed.high_impact_notes = parsed.high_impact_notes.slice(0, 5);
      if (parsed.polish_notes && parsed.polish_notes.length > 5) parsed.polish_notes = parsed.polish_notes.slice(0, 5);

      // Ensure note_key = id for all notes
      for (const arr of [parsed.blocking_issues, parsed.high_impact_notes, parsed.polish_notes]) {
        if (arr) for (const n of arr) { if (!n.note_key) n.note_key = n.id; if (!n.id) n.id = n.note_key; }
      }

      // Blocker-based convergence override: blockers gate convergence, not high/polish
      const blockerCount = (parsed.blocking_issues || []).length;
      const highCount = (parsed.high_impact_notes || []).length;
      const polishCount = (parsed.polish_notes || []).length;
      if (parsed.convergence) {
        parsed.convergence.blockers_remaining = blockerCount;
        parsed.convergence.high_impact_remaining = highCount;
        parsed.convergence.polish_remaining = polishCount;
        // Override AI convergence: only blockers prevent convergence
        if (blockerCount > 0 && parsed.convergence.status === "converged") {
          parsed.convergence.status = "in_progress";
          parsed.convergence.reasons = [...(parsed.convergence.reasons || []), "Blocking issues remain"];
        }
        if (blockerCount === 0 && parsed.convergence.status !== "converged") {
          // Check score thresholds still apply
          const ciOk = (parsed.ci_score || 0) >= 60;
          const gpOk = (parsed.gp_score || 0) >= 60;
          if (ciOk && gpOk) {
            parsed.convergence.status = "converged";
            if (!parsed.convergence.reasons) parsed.convergence.reasons = [];
            parsed.convergence.reasons.push("All blockers resolved");
          }
        }
      }

      // Stability status
      parsed.stability_status = blockerCount === 0 && highCount <= 3 && polishCount <= 5
        ? "structurally_stable" : blockerCount === 0 ? "refinement_phase" : "in_progress";

      const { data: run, error: runErr } = await supabase.from("development_runs").insert({
        project_id: projectId,
        document_id: documentId,
        version_id: versionId,
        user_id: user.id,
        run_type: "ANALYZE",
        production_type: effectiveProductionType,
        strategic_priority: strategicPriority || "BALANCED",
        development_stage: developmentStage || "IDEA",
        analysis_mode: analysisMode || "DUAL",
        output_json: parsed,
        deliverable_type: effectiveDeliverable,
        development_behavior: effectiveBehavior,
        format: effectiveFormat,
        episode_target_duration_seconds: effectiveDuration || null,
        schema_version: SCHEMA_VERSION,
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
        convergence_status: parsed.convergence?.status || parsed.convergence_status || "Unknown",
        trajectory: parsed.trajectory,
      });

      // ── DRIFT DETECTION ──
      const extractedCore = parsed.extracted_core || {};
      let driftReport: any = { level: "none", items: [], acknowledged: false, resolved: false };

      // Get inherited_core from version
      const { data: versionMeta } = await supabase.from("project_document_versions")
        .select("inherited_core").eq("id", versionId).single();

      if (versionMeta?.inherited_core) {
        const drift = detectDrift(extractedCore, versionMeta.inherited_core as Record<string, string>);
        driftReport = { ...drift, acknowledged: false, resolved: false };

        if (drift.level !== "none") {
          // Store drift event
          await supabase.from("document_drift_events").insert({
            project_id: projectId,
            document_version_id: versionId,
            drift_level: drift.level,
            drift_items: drift.items,
          });
        }

        // Store drift snapshot on version
        await supabase.from("project_document_versions")
          .update({ drift_snapshot: driftReport })
          .eq("id", versionId);

        // Drift-aware convergence: modify status if unresolved
        if (drift.level === "major") {
          if (parsed.convergence) {
            parsed.convergence.status = "in_progress";
            parsed.convergence.reasons = [...(parsed.convergence.reasons || []), "Unresolved major structural drift detected"];
          }
        } else if (drift.level === "moderate") {
          if (parsed.convergence?.status === "converged") {
            parsed.convergence.status = "in_progress";
            parsed.convergence.reasons = [...(parsed.convergence.reasons || []), "Unacknowledged moderate drift requires resolution"];
          }
        }
      }

      // Store extracted core on version for future drift comparisons
      await supabase.from("project_document_versions")
        .update({ drift_snapshot: { ...driftReport, extracted_core: extractedCore } })
        .eq("id", versionId);

      parsed.drift_report = driftReport;
      if (seasonArchitecture) parsed.season_architecture = seasonArchitecture;

      return new Response(JSON.stringify({ run, analysis: parsed }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // ══════════════════════════════════════════════
    // NOTES — tiered structured notes with tracking
    // ══════════════════════════════════════════════
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

      // Check previous note keys to prevent endless repetition
      const { data: prevNotes } = await supabase.from("development_notes")
        .select("note_key, severity, resolved")
        .eq("document_id", documentId);
      const previouslyResolved = new Set((prevNotes || []).filter(n => n.resolved).map(n => n.note_key));
      const existingUnresolved = (prevNotes || []).filter(n => !n.resolved);
      const previousBlockerCount = existingUnresolved.filter(n => n.severity === 'blocker').length;

      let antiRepeatRule = "";
      if (previouslyResolved.size > 0) {
        antiRepeatRule = `\nPREVIOUSLY RESOLVED NOTE KEYS (do NOT re-raise as blockers unless regression detected): ${[...previouslyResolved].join(", ")}`;
      }
      if (previousBlockerCount === 0 && existingUnresolved.length > 0) {
        antiRepeatRule += `\nPREVIOUS ROUND HAD ZERO BLOCKERS. Do NOT invent new blockers unless drift/regression occurred. Only generate high/polish notes.`;
      }

      const notesSystem = `You are IFFY. Generate structured development notes in three tiers.
Return ONLY valid JSON:
{
  "protect": ["non-negotiable items to preserve"],
  "blocking_issues": [
    {"id": "stable_key", "category": "structural|character|escalation|lane|packaging|risk|pacing|hook|cliffhanger", "description": "...", "why_it_matters": "...", "severity": "blocker"}
  ],
  "high_impact_notes": [
    {"id": "stable_key", "category": "...", "description": "...", "why_it_matters": "...", "severity": "high"}
  ],
  "polish_notes": [
    {"id": "stable_key", "category": "...", "description": "...", "why_it_matters": "...", "severity": "polish"}
  ],
  "rewrite_plan": ["what will change in next rewrite — max 5 items"]
}

RULES:
- Each id and note_key must be identical, stable, descriptive snake_case keys (e.g. "weak_act2_midpoint").
- blocking_issues: ONLY items fundamentally preventing the document from working. Max 5.
- high_impact_notes: Significant but non-blocking improvements. Max 5.
- polish_notes: Optional refinements. Max 5.
- Sort within each tier by structural importance.
- Do NOT re-raise previously resolved issues as blockers.
- If an existing note_key persists, use the same key — do NOT rephrase under a new key.${antiRepeatRule}`;

      const userPrompt = `ANALYSIS:\n${JSON.stringify(analysis)}\n\nMATERIAL:\n${version.plaintext.slice(0, 12000)}`;
      const raw = await callAI(LOVABLE_API_KEY, PRO_MODEL, notesSystem, userPrompt, 0.25, 6000);
      const parsed = await parseAIJson(LOVABLE_API_KEY, raw);

      // Backward compat: build actionable_notes from tiered notes
      const allTieredNotes = [
        ...(parsed.blocking_issues || []).map((n: any) => ({ ...n, impact: "high", convergence_lift: 10, severity: "blocker" })),
        ...(parsed.high_impact_notes || []).map((n: any) => ({ ...n, impact: "high", convergence_lift: 5, severity: "high" })),
        ...(parsed.polish_notes || []).map((n: any) => ({ ...n, impact: "low", convergence_lift: 1, severity: "polish" })),
      ];
      parsed.actionable_notes = allTieredNotes.map(n => ({
        category: n.category,
        note: n.description,
        impact: n.impact,
        convergence_lift: n.convergence_lift,
        severity: n.severity,
        id: n.id,
        why_it_matters: n.why_it_matters,
      }));
      parsed.prioritized_moves = parsed.actionable_notes;

      // Track notes in development_notes table
      const currentNoteKeys = new Set(allTieredNotes.map((n: any) => n.id).filter(Boolean));

      // Mark previously unresolved notes that are no longer present as resolved
      for (const prev of existingUnresolved) {
        if (!currentNoteKeys.has(prev.note_key)) {
          await supabase.from("development_notes")
            .update({ resolved: true, resolved_in_version: versionId })
            .eq("note_key", prev.note_key)
            .eq("document_id", documentId)
            .eq("resolved", false);
        }
      }

      // Check for regressions (previously resolved notes that reappear)
      for (const note of allTieredNotes) {
        if (note.id && previouslyResolved.has(note.id)) {
          // Regressed — mark old resolved entry
          await supabase.from("development_notes")
            .update({ regressed: true })
            .eq("note_key", note.id)
            .eq("document_id", documentId)
            .eq("resolved", true);
        }
      }

      // Insert new note records
      const noteInserts = allTieredNotes
        .filter((n: any) => n.id)
        .map((n: any) => ({
          project_id: projectId,
          document_id: documentId,
          document_version_id: versionId,
          note_key: n.id,
          category: n.category,
          severity: n.severity,
          description: n.description,
          why_it_matters: n.why_it_matters,
        }));
      if (noteInserts.length > 0) {
        await supabase.from("development_notes").insert(noteInserts);
      }

      // Compute resolution summary
      const resolvedCount = existingUnresolved.filter(n => !currentNoteKeys.has(n.note_key)).length;
      const regressedCount = allTieredNotes.filter((n: any) => n.id && previouslyResolved.has(n.id)).length;
      parsed.resolution_summary = {
        resolved: resolvedCount,
        regressed: regressedCount,
        blockers_remaining: (parsed.blocking_issues || []).length,
        high_impact_remaining: (parsed.high_impact_notes || []).length,
        polish_remaining: (parsed.polish_notes || []).length,
      };

      // Stability status
      const blockerCount = (parsed.blocking_issues || []).length;
      const highCount = (parsed.high_impact_notes || []).length;
      const polishCount = (parsed.polish_notes || []).length;
      parsed.stability_status = blockerCount === 0 && highCount <= 3 && polishCount <= 5
        ? "structurally_stable" : blockerCount === 0 ? "refinement_phase" : "in_progress";

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

    // ══════════════════════════════════════════════
    // REWRITE — with doc safety guards
    // ══════════════════════════════════════════════
    if (action === "rewrite") {
      const { projectId, documentId, versionId, approvedNotes, protectItems, targetDocType, deliverableType, developmentBehavior, format: reqFormat } = body;
      if (!projectId || !documentId || !versionId) throw new Error("projectId, documentId, versionId required");

      const { data: version } = await supabase.from("project_document_versions")
        .select("plaintext, version_number").eq("id", versionId).single();
      if (!version) throw new Error("Version not found");

      const { data: project } = await supabase.from("projects")
        .select("format, development_behavior").eq("id", projectId).single();

      const effectiveFormat = (reqFormat || project?.format || "film").toLowerCase().replace(/_/g, "-");
      const effectiveBehavior = developmentBehavior || project?.development_behavior || "market";
      const effectiveDeliverable = deliverableType || "script";

      const fullText = version.plaintext || "";
      const LONG_THRESHOLD = 30000;

      if (fullText.length > LONG_THRESHOLD) {
        return new Response(JSON.stringify({ error: "Document too long for single-pass rewrite. Use rewrite-plan/rewrite-chunk/rewrite-assemble pipeline.", needsPipeline: true, charCount: fullText.length }), {
          status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const rewriteSystemPrompt = buildRewriteSystem(effectiveDeliverable, effectiveFormat, effectiveBehavior);

      const userPrompt = `PROTECT (non-negotiable):\n${JSON.stringify(protectItems || [])}

APPROVED NOTES:\n${JSON.stringify(approvedNotes || [])}

TARGET FORMAT: ${targetDocType || "same as source"}

MATERIAL TO REWRITE:\n${fullText}`;

      const raw = await callAI(LOVABLE_API_KEY, BALANCED_MODEL, rewriteSystemPrompt, userPrompt, 0.4, 12000);
      const parsed = await parseAIJson(LOVABLE_API_KEY, raw);
      let rewrittenText = parsed.rewritten_text || "";

      // Post-processing safety guard for documentary/deck
      const safetyViolation = validateDocSafety(fullText, rewrittenText, effectiveDeliverable, effectiveFormat);
      if (safetyViolation) {
        return new Response(JSON.stringify({ error: safetyViolation, safety_blocked: true }), {
          status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

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
        change_summary: parsed.changes_summary || "",
      }).select().single();
      if (vErr) throw vErr;

      // Store rewrite run with schema_version and deliverable metadata
      const { data: run } = await supabase.from("development_runs").insert({
        project_id: projectId,
        document_id: documentId,
        version_id: newVersion.id,
        user_id: user.id,
        run_type: "REWRITE",
        output_json: {
          changes_summary: parsed.changes_summary || "",
          creative_preserved: parsed.creative_preserved || "",
          commercial_improvements: parsed.commercial_improvements || "",
          rewritten_text: `[${rewrittenText.length} chars]`,
          source_version_id: versionId,
        },
        deliverable_type: effectiveDeliverable,
        development_behavior: effectiveBehavior,
        format: effectiveFormat,
        schema_version: SCHEMA_VERSION,
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
      const lines = fullText.split("\n");
      let currentChunk = "";
      const chunkTexts: string[] = [];

      for (const line of lines) {
        const isSlugline = /^(INT\.|EXT\.|INT\/EXT\.|I\/E\.)/.test(line.trim());
        if (isSlugline && currentChunk.length >= CHUNK_TARGET) {
          chunkTexts.push(currentChunk.trim());
          currentChunk = "";
        }
        currentChunk += line + "\n";
      }
      if (currentChunk.trim()) chunkTexts.push(currentChunk.trim());

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

    // ── REWRITE-CHUNK (chunked rewrite step 2) ──
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

      const chunkPrompt = `${notesContext}${prevContext}\n\nCHUNK ${chunkIndex + 1} OF ${plan.total_chunks} — Rewrite this section, applying notes while preserving all scenes and story beats:\n\n${chunkText}`;

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

    // ── REWRITE-ASSEMBLE (chunked rewrite step 3) ──
    if (action === "rewrite-assemble") {
      const { projectId, documentId, versionId, planRunId, assembledText } = body;
      if (!projectId || !documentId || !versionId || !assembledText) throw new Error("projectId, documentId, versionId, assembledText required");

      function estimateRuntimeMinutes(text: string, mode: string) {
        const words = (text || "").trim().split(/\s+/).filter(Boolean).length;
        const divisor = mode === 'dialogue_heavy' ? 200 : mode === 'lean' ? 240 : mode === 'action_heavy' ? 240 : 220;
        return { words, minutes: words / divisor };
      }

      const { data: projectRow } = await supabase.from("projects")
        .select("min_runtime_minutes, min_runtime_hard_floor, runtime_estimation_mode")
        .eq("id", projectId).single();

      const mode = (projectRow as any)?.runtime_estimation_mode ?? 'feature';
      const softMin = (projectRow as any)?.min_runtime_minutes ?? null;
      const hardMin = (projectRow as any)?.min_runtime_hard_floor ?? null;
      const { words: newWords, minutes: newMins } = estimateRuntimeMinutes(assembledText, mode);

      let runtimeWarning: string | null = null;
      if (hardMin && newMins < hardMin - 2) {
        throw new Error(
          `Script too short for feature: ~${Math.round(newMins)} mins (words=${newWords}). ` +
          `Hard floor is ${hardMin} mins. Generate a fuller feature draft.`
        );
      } else if (hardMin && newMins < hardMin) {
        runtimeWarning = `Draft is near the hard floor: ~${Math.round(newMins)} mins (floor: ${hardMin}). Consider expanding.`;
      }
      if (!runtimeWarning && softMin && newMins < softMin) {
        runtimeWarning = `This draft estimates ~${Math.round(newMins)} mins (below preferred minimum ${softMin} mins).`;
      }

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
        schema_version: SCHEMA_VERSION,
      }).select().single();

      return new Response(JSON.stringify({
        run, newVersion,
        runtimeWarning,
        estimatedMinutes: Math.round(newMins),
        wordCount: newWords,
      }), {
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

      const normalizedTarget = (targetOutput || "").toUpperCase().replace(/\s+/g, "_");
      let resolvedDocType = docTypeMap[targetOutput] || docTypeMap[normalizedTarget] || docTypeMap[(targetOutput || "").toUpperCase()] || "other";

      const VALID_DELIVERABLES_SET = new Set(["idea","concept_brief","market_sheet","blueprint","architecture","character_bible","beat_sheet","script","production_draft","deck","documentary_outline"]);
      if (resolvedDocType === "other") {
        // Fuzzy match: strip numbers, parens, normalize
        const aggressive = (targetOutput || "").toLowerCase().replace(/[\s\-()0-9]+/g, "_").replace(/_+/g, "_").replace(/^_|_$/g, "");
        const fuzzy = [...VALID_DELIVERABLES_SET].find(d => aggressive.includes(d) || d.includes(aggressive));
        resolvedDocType = fuzzy || "script"; // Never fall through to "other"
      }

      const { data: newDoc, error: dErr } = await supabase.from("project_documents").insert({
        project_id: projectId,
        user_id: user.id,
        file_name: `${srcDoc?.title || "Document"} — ${targetOutput}`,
        file_path: "",
        extraction_status: "complete",
        doc_type: resolvedDocType,
        title: `${srcDoc?.title || "Document"} — ${targetOutput}`,
        source: "generated",
        plaintext: parsed.converted_text || "",
      }).select().single();
      if (dErr) throw dErr;

      // Get upstream drift snapshot for inherited_core
      const { data: upstreamVersion } = await supabase.from("project_document_versions")
        .select("drift_snapshot").eq("id", versionId).single();
      const upstreamCore = (upstreamVersion?.drift_snapshot as any)?.extracted_core || {};

      const resolvedDeliverable = resolvedDocType === "other" ? "script" : resolvedDocType;
      const { data: newVersion } = await supabase.from("project_document_versions").insert({
        document_id: newDoc.id,
        version_number: 1,
        label: `Converted from ${srcDoc?.doc_type || "source"}`,
        plaintext: parsed.converted_text || "",
        created_by: user.id,
        change_summary: parsed.change_summary || "",
        deliverable_type: resolvedDeliverable,
        inherited_core: upstreamCore,
        source_document_ids: [documentId],
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

    // ═══════════════════════════════════════════════
    // SCREENPLAY PIPELINE
    // ═══════════════════════════════════════════════

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

      const { data: run, error: runErr } = await supabase.from("development_runs").insert({
        project_id: projectId,
        document_id: documentId,
        version_id: versionId,
        user_id: user.id,
        run_type: "SCRIPT_PLAN",
        output_json: parsed,
      }).select().single();
      if (runErr) throw runErr;

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

      const { data: scriptVersion } = await supabase.from("project_document_versions").insert({
        document_id: scriptDoc.id,
        version_number: 1,
        label: "Feature screenplay (generating…)",
        plaintext: "",
        created_by: user.id,
        change_summary: "Pipeline generation in progress",
      }).select().single();

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

    if (action === "write-batch") {
      const { projectId, scriptDocId, scriptVersionId, batchIndex, scenes, previousText, toneLock, nonNegotiables, totalBatches } = body;
      if (!projectId || !scriptDocId || !scriptVersionId || !scenes) throw new Error("Missing required fields");

      const batchPages = scenes.reduce((s: number, sc: any) => s + (sc.page_estimate || 2), 0);
      const scenesDesc = scenes.map((s: any) =>
        `${s.scene_id}: ${s.slug}\n  Purpose: ${s.purpose}\n  Target: ~${s.page_estimate || 2} pages`
      ).join("\n\n");

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
      const cleanText = raw.replace(/^```[\s\S]*?\n/, "").replace(/\n?```\s*$/, "").trim();

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

    if (action === "assemble-script") {
      const { projectId, scriptDocId, scriptVersionId, assembledText, planJson } = body;
      if (!projectId || !scriptDocId || !scriptVersionId || !assembledText) throw new Error("Missing required fields");

      const wordCount = assembledText.split(/\s+/).length;
      const pageEstimate = Math.round(wordCount / 250);

      function estimateScriptRuntime(text: string, mode: string) {
        const w = (text || "").trim().split(/\s+/).filter(Boolean).length;
        const divisor = mode === 'dialogue_heavy' ? 200 : mode === 'lean' ? 240 : mode === 'action_heavy' ? 240 : 220;
        return { words: w, minutes: w / divisor };
      }
      const { data: projRow } = await supabase.from("projects")
        .select("min_runtime_minutes, min_runtime_hard_floor, runtime_estimation_mode")
        .eq("id", projectId).single();
      const sMode = (projRow as any)?.runtime_estimation_mode ?? 'feature';
      const sHardMin = (projRow as any)?.min_runtime_hard_floor ?? null;
      const { words: sWords, minutes: sMins } = estimateScriptRuntime(assembledText, sMode);

      if (sHardMin && sMins < sHardMin - 2) {
        throw new Error(
          `Script too short for feature: ~${Math.round(sMins)} mins (words=${sWords}). Hard floor is ${sHardMin} mins.`
        );
      }

      const { error: vErr } = await supabase.from("project_document_versions")
        .update({
          plaintext: assembledText,
          label: `Feature screenplay (${pageEstimate} pages)`,
          change_summary: `Assembled from ${planJson?.total_scenes || "?"} scenes. ${wordCount} words, ~${pageEstimate} pages.`,
        })
        .eq("id", scriptVersionId);
      if (vErr) throw vErr;

      await supabase.from("project_documents")
        .update({ plaintext: assembledText, extraction_status: "complete" })
        .eq("id", scriptDocId);

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
        run, wordCount, pageEstimate, scriptDocId, scriptVersionId,
      }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (action === "expand-to-feature-floor") {
      const { projectId, documentId, versionId, currentText } = body;
      if (!projectId || !documentId || !versionId || !currentText) throw new Error("projectId, documentId, versionId, currentText required");

      const { data: proj } = await supabase.from("projects")
        .select("min_runtime_minutes, runtime_estimation_mode")
        .eq("id", projectId).single();

      const eMode = (proj as any)?.runtime_estimation_mode ?? 'feature';
      const softMin = (proj as any)?.min_runtime_minutes ?? 80;
      const divisor = eMode === 'dialogue_heavy' ? 200 : eMode === 'lean' ? 240 : eMode === 'action_heavy' ? 240 : 220;
      const currentWords = currentText.trim().split(/\s+/).filter(Boolean).length;
      const currentMins = currentWords / divisor;
      const targetWords = Math.ceil(softMin * divisor);

      const expandSystem = `You are expanding a feature screenplay that is too short (~${Math.round(currentMins)} mins, needs at least ${softMin} mins).

Do NOT add filler. Expand cinematic beats: obstacles, reversals, complications, aftermath moments, and set-pieces where structurally appropriate.
Strengthen Act 2 escalation and character dynamics.
Do NOT summarize. Output full screenplay pages in proper format.
Target approximately ${targetWords} words total.
Output ONLY the expanded screenplay text. No JSON, no commentary, no markdown.`;

      const expanded = await callAI(LOVABLE_API_KEY, PRO_MODEL, expandSystem, currentText, 0.4, 16000);
      const cleanExpanded = expanded.replace(/^```[\s\S]*?\n/, "").replace(/\n?```\s*$/, "").trim();

      const { data: maxRow } = await supabase.from("project_document_versions")
        .select("version_number").eq("document_id", documentId)
        .order("version_number", { ascending: false }).limit(1).single();
      const nextVer = (maxRow?.version_number ?? 0) + 1;

      const expandedWords = cleanExpanded.split(/\s+/).filter(Boolean).length;
      const expandedMins = expandedWords / divisor;

      const { data: newVersion, error: vErr } = await supabase.from("project_document_versions").insert({
        document_id: documentId,
        version_number: nextVer,
        label: `Expanded to ~${Math.round(expandedMins)} mins`,
        plaintext: cleanExpanded,
        created_by: user.id,
        parent_version_id: versionId,
        change_summary: `Auto-expanded from ~${Math.round(currentMins)} to ~${Math.round(expandedMins)} mins.`,
      }).select().single();
      if (vErr) throw vErr;

      await supabase.from("development_runs").insert({
        project_id: projectId,
        document_id: documentId,
        version_id: newVersion.id,
        user_id: user.id,
        run_type: "EXPAND",
        output_json: {
          from_minutes: Math.round(currentMins),
          to_minutes: Math.round(expandedMins),
          from_words: currentWords,
          to_words: expandedWords,
        },
      });

      return new Response(JSON.stringify({
        newVersion,
        estimatedMinutes: Math.round(expandedMins),
        wordCount: expandedWords,
      }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // ══════════════════════════════════════════════
    // DRIFT RESOLUTION ACTIONS
    // ══════════════════════════════════════════════
    if (action === "drift-acknowledge") {
      const { driftEventId } = body;
      if (!driftEventId) throw new Error("driftEventId required");
      const { error } = await supabase.from("document_drift_events")
        .update({ acknowledged: true })
        .eq("id", driftEventId);
      if (error) throw error;
      return new Response(JSON.stringify({ success: true }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (action === "drift-resolve") {
      const { driftEventId, resolutionType, versionId: targetVersionId } = body;
      if (!driftEventId || !resolutionType) throw new Error("driftEventId and resolutionType required");

      if (resolutionType === "accept_drift") {
        // Accept drift — just mark acknowledged
        await supabase.from("document_drift_events")
          .update({ acknowledged: true, resolved: false, resolution_type: "accept_drift" })
          .eq("id", driftEventId);
      } else if (resolutionType === "intentional_pivot") {
        // Mark as intentional — update inherited_core to current core
        const { data: event } = await supabase.from("document_drift_events")
          .select("document_version_id").eq("id", driftEventId).single();
        if (event) {
          const { data: verData } = await supabase.from("project_document_versions")
            .select("drift_snapshot").eq("id", event.document_version_id).single();
          const currentCore = (verData?.drift_snapshot as any)?.extracted_core || {};
          await supabase.from("project_document_versions")
            .update({ inherited_core: currentCore })
            .eq("id", event.document_version_id);
        }
        await supabase.from("document_drift_events")
          .update({ resolved: true, resolved_at: new Date().toISOString(), resolved_by: user.id, resolution_type: "intentional_pivot" })
          .eq("id", driftEventId);
      } else if (resolutionType === "reseed") {
        // Re-seed: replace inherited fields in current version
        const { data: event } = await supabase.from("document_drift_events")
          .select("document_version_id").eq("id", driftEventId).single();
        if (event) {
          const { data: verData } = await supabase.from("project_document_versions")
            .select("inherited_core, drift_snapshot").eq("id", event.document_version_id).single();
          // Reset drift snapshot to reflect alignment
          await supabase.from("project_document_versions")
            .update({ drift_snapshot: { level: "none", items: [], acknowledged: false, resolved: true, extracted_core: verData?.inherited_core } })
            .eq("id", event.document_version_id);
        }
        await supabase.from("document_drift_events")
          .update({ resolved: true, resolved_at: new Date().toISOString(), resolved_by: user.id, resolution_type: "reseed" })
          .eq("id", driftEventId);
      }

      return new Response(JSON.stringify({ success: true, resolutionType }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // ══════════════════════════════════════════════
    // ENGINE WEIGHT RECOMMENDATION (Step 3)
    // ══════════════════════════════════════════════
    if (action === "recommend-weights") {
      const { projectId } = body;
      if (!projectId) throw new Error("projectId required");

      const { data: project } = await supabase.from("projects")
        .select("title, format, genres, tone, target_audience, budget_range, assigned_lane")
        .eq("id", projectId).single();
      if (!project) throw new Error("Project not found");

      const { data: conceptDocs } = await supabase.from("project_documents")
        .select("plaintext, extracted_text")
        .eq("project_id", projectId)
        .in("doc_type", ["concept_brief", "idea", "treatment", "blueprint"])
        .order("created_at", { ascending: false })
        .limit(1);
      const conceptText = conceptDocs?.[0]?.plaintext || conceptDocs?.[0]?.extracted_text || "";

      const weightSystem = `You are IFFY. Analyze the project concept and recommend Vertical Drama engine weights.

The 5 engines are:
- power_conflict: Power struggles, authority clashes, corporate politics
- romantic_tension: Love triangles, forbidden attraction, emotional manipulation
- thriller_mystery: Suspense, secrets, reveals, investigation
- revenge_arc: Payback, justice, escalating retaliation
- social_exposure: Public shame, viral moments, reputation destruction

Weights must total exactly 100.

Return ONLY valid JSON:
{
  "compatibility": {"power_conflict": 0-100, "romantic_tension": 0-100, "thriller_mystery": 0-100, "revenge_arc": 0-100, "social_exposure": 0-100},
  "recommended_weights": {"power_conflict": number, "romantic_tension": number, "thriller_mystery": number, "revenge_arc": number, "social_exposure": number},
  "rationale": ["max 5 bullets"],
  "example_cliffs": ["3-6 example cliffhangers"],
  "suggested_escalation_style": ["max 3 bullets"]
}`;

      const userPrompt = `PROJECT: ${project.title}\nGENRES: ${(project.genres || []).join(", ")}\nTONE: ${project.tone || "Unknown"}\nAUDIENCE: ${project.target_audience || "Unknown"}\nLANE: ${project.assigned_lane || "Unknown"}\n\nCONCEPT:\n${conceptText.slice(0, 8000)}`;
      const raw = await callAI(LOVABLE_API_KEY, BALANCED_MODEL, weightSystem, userPrompt, 0.3, 4000);
      const parsed = await parseAIJson(LOVABLE_API_KEY, raw);

      return new Response(JSON.stringify({ recommendation: parsed }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (action === "save-weights") {
      const { projectId, weights } = body;
      if (!projectId || !weights) throw new Error("projectId and weights required");
      const total = Object.values(weights).reduce((s: number, v: any) => s + Number(v), 0);
      if (Math.abs(total - 100) > 1) throw new Error(`Weights must total 100 (got ${total})`);
      await supabase.from("projects").update({ vertical_engine_weights: weights }).eq("id", projectId);
      return new Response(JSON.stringify({ success: true }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // ══════════════════════════════════════════════
    // GENERATE EPISODE GRID (Step 6)
    // ══════════════════════════════════════════════
    if (action === "generate-grid") {
      const { projectId } = body;
      if (!projectId) throw new Error("projectId required");

      const { data: project } = await supabase.from("projects")
        .select("season_episode_count, episode_target_duration_seconds, vertical_engine_weights, development_behavior")
        .eq("id", projectId).single();
      if (!project) throw new Error("Project not found");

      const E = (project as any).season_episode_count;
      const duration = project.episode_target_duration_seconds;
      const weights = (project as any).vertical_engine_weights || { power_conflict: 20, romantic_tension: 20, thriller_mystery: 20, revenge_arc: 20, social_exposure: 20 };

      if (!E || !duration) throw new Error("season_episode_count and episode_target_duration_seconds required");

      // Compute season architecture
      let arch: any;
      if (E >= 10) {
        const actSize = Math.floor(E * 0.2);
        const remainder = E - actSize * 5;
        const acts: any[] = [];
        let cursor = 1;
        for (let a = 1; a <= 5; a++) {
          const extra = a > (5 - remainder) ? 1 : 0;
          const count = actSize + extra;
          acts.push({ act: a, start_episode: cursor, end_episode: cursor + count - 1, episode_count: count });
          cursor += count;
        }
        arch = { model: "5-act", episode_count: E, acts, anchors: { reveal_index: Math.round(E * 0.25), mid_index: Math.round(E * 0.50), pre_finale_index: Math.round(E * 0.80), finale_index: E } };
      } else {
        const act1 = Math.round(E * 0.3); const act3 = Math.round(E * 0.3); const act2 = E - act1 - act3;
        arch = { model: "3-act", episode_count: E, acts: [
          { act: 1, start_episode: 1, end_episode: act1, episode_count: act1 },
          { act: 2, start_episode: act1 + 1, end_episode: act1 + act2, episode_count: act2 },
          { act: 3, start_episode: act1 + act2 + 1, end_episode: E, episode_count: act3 },
        ], anchors: { reveal_index: Math.round(E * 0.33), mid_index: Math.round(E * 0.55), finale_index: E } };
      }

      const beatMin = duration <= 90 ? 3 : duration <= 120 ? 4 : duration <= 150 ? 5 : duration <= 180 ? 6 : 7;
      const engines = Object.keys(weights) as string[];
      const weightValues = engines.map(k => weights[k] as number);
      const totalWeight = weightValues.reduce((s, v) => s + v, 0);

      // Build cliff type pool proportional to weights, then distribute
      const cliffPool: string[] = [];
      for (let i = 0; i < engines.length; i++) {
        const count = Math.max(1, Math.round((weightValues[i] / totalWeight) * E));
        for (let j = 0; j < count; j++) cliffPool.push(engines[i]);
      }
      while (cliffPool.length > E) cliffPool.pop();
      while (cliffPool.length < E) cliffPool.push(engines[0]);
      for (let i = cliffPool.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [cliffPool[i], cliffPool[j]] = [cliffPool[j], cliffPool[i]];
      }

      const grid = [];
      for (let ep = 1; ep <= E; ep++) {
        const act = arch.acts.find((a: any) => ep >= a.start_episode && ep <= a.end_episode);
        const progress = ep / E;
        let intensity = progress > 0.75 ? 1.0 : progress > 0.5 ? 0.7 : progress > 0.25 ? 0.4 : 0.2;
        if (ep === arch.anchors.mid_index || ep === arch.anchors.pre_finale_index) intensity = Math.min(1.0, intensity + 0.2);
        if (ep === arch.anchors.finale_index) intensity = 1.0;
        intensity = Math.round(intensity * 10) / 10;

        let cliff_tier = "soft";
        if (ep === arch.anchors.finale_index) cliff_tier = "ultimate";
        else if (ep === arch.anchors.mid_index || ep === arch.anchors.pre_finale_index) cliff_tier = "hard";
        else if (progress > 0.5) cliff_tier = "hard";

        let anchor_type: string | null = null;
        if (ep === arch.anchors.reveal_index) anchor_type = "reveal";
        else if (ep === arch.anchors.mid_index) anchor_type = "midpoint";
        else if (ep === arch.anchors.pre_finale_index) anchor_type = "pre_finale";
        else if (ep === arch.anchors.finale_index) anchor_type = "finale";

        grid.push({
          episode_number: ep, act_number: act?.act || 1, escalation_intensity: intensity,
          hook: "", escalation: "", turn: "", cliff: "",
          cliff_type: cliffPool[ep - 1], cliff_tier,
          anchor_flags: anchor_type ? [anchor_type] : [],
          beat_minimum: beatMin,
        });
      }

      return new Response(JSON.stringify({
        architecture: arch, grid, engine_weights: weights, beat_minimum: beatMin,
        short_season_warning: E < 10 ? `Short season (${E} episodes): using 3-act model` : null,
      }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // ══════════════════════════════════════════════
    // BRANCH MANAGEMENT (Step 7)
    // ══════════════════════════════════════════════
    if (action === "create-branch") {
      const { projectId, branchName, branchType } = body;
      if (!projectId || !branchName) throw new Error("projectId and branchName required");
      const { data: branch, error } = await supabase.from("development_branches").insert({
        project_id: projectId, branch_name: branchName, branch_type: branchType || "sandbox", user_id: user.id,
      }).select().single();
      if (error) throw error;

      if (branchType === "sandbox" || !branchType) {
        const { data: mainline } = await supabase.from("development_branches")
          .select("id").eq("project_id", projectId).eq("branch_type", "mainline").eq("status", "active").limit(1).single();
        if (mainline) {
          const { data: mainlineVersions } = await supabase.from("project_document_versions")
            .select("*").eq("branch_id", mainline.id).order("version_number", { ascending: false });
          if (mainlineVersions && mainlineVersions.length > 0) {
            const copies = mainlineVersions.map((v: any) => ({
              document_id: v.document_id, version_number: v.version_number,
              label: `[Sandbox] ${v.label || ''}`, plaintext: v.plaintext,
              created_by: user.id, parent_version_id: v.id,
              change_summary: `Branched from mainline`, branch_id: branch.id,
              inherited_core: v.inherited_core, source_document_ids: v.source_document_ids,
            }));
            await supabase.from("project_document_versions").insert(copies);
          }
        }
      }
      return new Response(JSON.stringify({ branch }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    if (action === "replace-mainline") {
      const { projectId, sandboxBranchId } = body;
      if (!projectId || !sandboxBranchId) throw new Error("projectId and sandboxBranchId required");
      await supabase.from("development_branches").update({ status: "archived" })
        .eq("project_id", projectId).eq("branch_type", "mainline").eq("status", "active");
      await supabase.from("development_branches").update({ branch_type: "mainline", status: "active" })
        .eq("id", sandboxBranchId);
      return new Response(JSON.stringify({ success: true }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    if (action === "list-branches") {
      const { projectId } = body;
      if (!projectId) throw new Error("projectId required");
      const { data: branches, error } = await supabase.from("development_branches")
        .select("*").eq("project_id", projectId).order("created_at", { ascending: true });
      if (error) throw error;
      return new Response(JSON.stringify({ branches: branches || [] }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    throw new Error(`Unknown action: ${action}`);
  } catch (err: any) {
    console.error("dev-engine-v2 error:", err);
    return new Response(JSON.stringify({ error: err.message }), {
      status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
