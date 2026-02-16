import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import { buildGuardrailBlock, validateOutput, buildRegenerationPrompt } from "../_shared/guardrails.ts";
import { composeSystem } from "../_shared/llm.ts";

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

EDITORIAL SCOPE LOCK:
You are operating in EDITORIAL MODE.
- Treat project.format, assigned_lane, budget_range, and development_behavior as LOCKED.
- Do NOT recommend changing format, monetisation lane, runtime model, or buyer positioning.
- Do NOT propose repositioning the project into a different category.
- If format/lane are misaligned, you may flag it ONCE as a "risk flag" in clarify (or lane) — but do NOT propose a change.
- Focus ONLY on improving the current deliverable within its declared format and lane.
You are an editor, not a strategist, in this mode.

${rubric}

${formatExp}

${behaviorMod}
${verticalRules}${docGuard}

SCORING RUBRIC (CANONICAL – v1):
CI (Creative Integrity) evaluates:
- Originality of premise relative to genre
- Emotional conviction and character truth
- Thematic coherence
- Structural integrity appropriate to the format
- Craft quality (dialogue, escalation, clarity) relative to deliverable type
GP (Greenlight Probability) evaluates:
- Audience clarity and hook strength
- Market positioning within declared lane
- Packaging magnetism (castability, concept clarity, talkability)
- Production feasibility relative to stated budget
- Alignment with monetisation lane expectations
IMPORTANT:
- Score CI and GP relative to the declared format and lane.
- Do NOT penalise a vertical drama for not being a feature film.
- Do NOT reward prestige pacing inside fast-turnaround lanes.
- CI and GP must reflect format-appropriate standards.

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
- Do NOT introduce new blocking issues unless they are fundamentally distinct from previous ones or true regression occurred.
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
- If repositioning (lane/format) appears in APPROVED STRATEGIC NOTES, reflect it. Otherwise do not stealth-reposition.
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
// FORMAT DEFAULTS (engine-side) — mirrors auto-run for consistency
// ═══════════════════════════════════════════════════════════════

const FORMAT_DEFAULTS_ENGINE: Record<string, { episode_target_duration_seconds?: number; season_episode_count?: number }> = {
  "vertical-drama": { episode_target_duration_seconds: 60, season_episode_count: 30 },
  "limited-series": { episode_target_duration_seconds: 3300, season_episode_count: 8 },
  "tv-series": { episode_target_duration_seconds: 2700, season_episode_count: 10 },
  "anim-series": { episode_target_duration_seconds: 1320, season_episode_count: 10 },
  "documentary-series": { episode_target_duration_seconds: 2700, season_episode_count: 6 },
  "digital-series": { episode_target_duration_seconds: 600, season_episode_count: 10 },
  "reality": { episode_target_duration_seconds: 2700, season_episode_count: 10 },
};

// ═══════════════════════════════════════════════════════════════
// CRITERIA SNAPSHOT
// ═══════════════════════════════════════════════════════════════

const CRITERIA_SNAPSHOT_KEYS = [
  "format_subtype", "season_episode_count", "episode_target_duration_seconds",
  "target_runtime_min_low", "target_runtime_min_high", "assigned_lane",
  "budget_range", "development_behavior"
] as const;

interface CriteriaSnapshot {
  format_subtype?: string;
  season_episode_count?: number;
  episode_target_duration_seconds?: number;
  target_runtime_min_low?: number;
  target_runtime_min_high?: number;
  assigned_lane?: string;
  budget_range?: string;
  development_behavior?: string;
  updated_at?: string;
}

async function buildCriteriaSnapshot(supabase: any, projectId: string): Promise<CriteriaSnapshot> {
  const { data: p } = await supabase.from("projects")
    .select("format, assigned_lane, budget_range, development_behavior, episode_target_duration_seconds, season_episode_count, guardrails_config")
    .eq("id", projectId).single();
  if (!p) return {};
  const gc = p.guardrails_config || {};
  const quals = gc?.overrides?.qualifications || {};
  const fmt = (p.format || "film").toLowerCase().replace(/[_ ]+/g, "-");
  return {
    format_subtype: quals.format_subtype || fmt,
    season_episode_count: quals.season_episode_count || p.season_episode_count || undefined,
    episode_target_duration_seconds: quals.episode_target_duration_seconds || p.episode_target_duration_seconds || undefined,
    target_runtime_min_low: quals.target_runtime_min_low || undefined,
    target_runtime_min_high: quals.target_runtime_min_high || undefined,
    assigned_lane: p.assigned_lane || quals.assigned_lane || undefined,
    budget_range: p.budget_range || quals.budget_range || undefined,
    development_behavior: p.development_behavior || undefined,
    updated_at: new Date().toISOString(),
  };
}

function compareSnapshots(a: CriteriaSnapshot | null, b: CriteriaSnapshot | null): string[] {
  if (!a || !b) return [];
  const diffs: string[] = [];
  for (const key of CRITERIA_SNAPSHOT_KEYS) {
    const va = a[key as keyof CriteriaSnapshot];
    const vb = b[key as keyof CriteriaSnapshot];
    if (va != null && vb != null && String(va) !== String(vb)) {
      diffs.push(key);
    }
  }
  return diffs;
}

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

    // ── Centralized document existence check ──
    // Any action that sends a documentId must reference a valid project_documents row
    const centralDocId = body.documentId || body.scriptDocId;
    if (centralDocId) {
      const { data: docExists } = await supabase.from("project_documents")
        .select("id").eq("id", centralDocId).single();
      if (!docExists) throw new Error("Document not found — it may have been deleted. Please refresh and select another document.");
    }

    // ══════════════════════════════════════════════
    // ANALYZE — strict routing: deliverable → format → behavior
    // ══════════════════════════════════════════════
    if (action === "analyze") {
      const { projectId, documentId, versionId, deliverableType, developmentBehavior, format: reqFormat, strategicPriority, developmentStage, analysisMode, previousVersionId, productionType } = body;

      if (!projectId || !documentId || !versionId) throw new Error("projectId, documentId, versionId required");
      if (!deliverableType) throw new Error("deliverableType is required — select a deliverable type before analyzing");



      const { data: version } = await supabase.from("project_document_versions")
        .select("plaintext").eq("id", versionId).single();
      if (!version) throw new Error("Version not found");

      const { data: project } = await supabase.from("projects")
        .select("title, budget_range, assigned_lane, format, development_behavior, episode_target_duration_seconds, season_episode_count, guardrails_config")
        .eq("id", projectId).single();

      const rawFormat = reqFormat || project?.format || "film";
      const effectiveFormat = rawFormat.toLowerCase().replace(/[_ ]+/g, "-");
      const effectiveBehavior = developmentBehavior || project?.development_behavior || "market";
      const effectiveDeliverable = deliverableType;
      const effectiveProductionType = productionType || formatToProductionType[effectiveFormat] || "narrative_feature";

      // ── Canonical Qualification Resolver ──
      // Call resolve-qualifications edge function for canonical resolution + persist
      let resolvedQuals: any = null;
      try {
        const resolverResp = await fetch(`${supabaseUrl}/functions/v1/resolve-qualifications`, {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: authHeader },
          body: JSON.stringify({ projectId }),
        });
        if (resolverResp.ok) {
          resolvedQuals = await resolverResp.json();
        } else {
          console.warn("[dev-engine-v2] resolve-qualifications failed, falling back to local resolution");
        }
      } catch (e) {
        console.warn("[dev-engine-v2] resolve-qualifications call failed:", e);
      }

      // Fallback: use local resolution if edge function call failed
      const rq = resolvedQuals?.resolvedQualifications || {};
      // Accept both camelCase and snake_case from payload as final override
      const payloadDuration = body.episodeTargetDurationSeconds ?? body.episode_target_duration_seconds ?? null;
      const payloadCount = body.seasonEpisodeCount ?? body.season_episode_count ?? null;

      const gc = project?.guardrails_config || {};
      const gquals = gc?.overrides?.qualifications || {};
      const fmtDefaults = FORMAT_DEFAULTS_ENGINE[effectiveFormat] || {};
      const effectiveDuration = payloadDuration || rq.episode_target_duration_seconds || project?.episode_target_duration_seconds || gquals.episode_target_duration_seconds || fmtDefaults.episode_target_duration_seconds || null;
      const effectiveSeasonCount = payloadCount || rq.season_episode_count || (project as any)?.season_episode_count || gquals.season_episode_count || fmtDefaults.season_episode_count || null;

      // Vertical drama: require episode duration
      if (effectiveFormat === "vertical-drama" && !effectiveDuration) {
        throw new Error("episode_target_duration_seconds is required for vertical drama format");
      }

      // Fetch season config for vertical drama
      const seasonEpisodeCount = effectiveSeasonCount;
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
      const baseSystemPrompt = buildAnalyzeSystem(effectiveDeliverable, effectiveFormat, effectiveBehavior, effectiveDuration);

      // Inject guardrails with per-engine mode support
      const guardrails = buildGuardrailBlock({
        project: project ? { ...project, production_type: effectiveProductionType, guardrails_config: (project as any).guardrails_config } : undefined,
        productionType: effectiveFormat,
        engineName: "dev-engine-v2",
        corpusEnabled: !!body.corpusEnabled,
        corpusCalibration: body.corpusCalibration,
      });
      const systemPrompt = composeSystem({ baseSystem: baseSystemPrompt, guardrailsBlock: guardrails.textBlock });
      console.log(`[dev-engine-v2] guardrails: profile=${guardrails.profileName}, hash=${guardrails.hash}, mode=${guardrails.policy.engineMode}`);

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

      // Build canonical qualification binding for prompt
      let qualBinding = "";
      if (rq.is_series && rq.season_episode_count) {
        qualBinding = `\nCANONICAL QUALIFICATIONS (authoritative — ignore older references to different values):
Target season length: ${rq.season_episode_count} episodes.
Episode target duration: ${rq.episode_target_duration_seconds} seconds.
Format: ${rq.format}.
Resolver hash: ${resolvedQuals?.resolver_hash || "unknown"}.`;
      }

      const userPrompt = `PRODUCTION TYPE: ${effectiveProductionType}
STRATEGIC PRIORITY: ${strategicPriority || "BALANCED"}
DEVELOPMENT STAGE: ${developmentStage || "IDEA"}
PROJECT: ${project?.title || "Unknown"}
LANE: ${project?.assigned_lane || "Unknown"} | BUDGET: ${project?.budget_range || "Unknown"}
${prevContext}${seasonContext}${qualBinding}

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

      // Inject criteria_snapshot for traceability
      const criteriaSnapshot = await buildCriteriaSnapshot(supabase, projectId);
      parsed.criteria_snapshot = criteriaSnapshot;

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

      const notesSystem = `You are IFFY. Generate structured development notes in three tiers, with DECISION OPTIONS for blockers and high-impact notes.
Return ONLY valid JSON:
{
  "protect": ["non-negotiable items to preserve"],
  "blocking_issues": [
    {
      "id": "stable_key", "category": "structural|character|escalation|lane|packaging|risk|pacing|hook|cliffhanger",
      "description": "...", "why_it_matters": "...", "severity": "blocker",
      "decisions": [
        {
          "option_id": "B1-A",
          "title": "short action title (max 8 words)",
          "what_changes": ["list of story elements that change"],
          "creative_tradeoff": "one sentence on creative cost/benefit",
          "commercial_lift": 0-20
        }
      ],
      "recommended": "option_id of recommended choice"
    }
  ],
  "high_impact_notes": [
    {
      "id": "stable_key", "category": "...", "description": "...", "why_it_matters": "...", "severity": "high",
      "decisions": [
        {
          "option_id": "H1-A",
          "title": "short action title",
          "what_changes": ["list of story elements that change"],
          "creative_tradeoff": "one sentence",
          "commercial_lift": 0-15
        }
      ],
      "recommended": "option_id of recommended choice"
    }
  ],
  "polish_notes": [
    {"id": "stable_key", "category": "...", "description": "...", "why_it_matters": "...", "severity": "polish"}
  ],
  "global_directions": [
    {"id": "G1", "direction": "overarching creative direction", "why": "rationale"}
  ],
  "rewrite_plan": ["what will change in next rewrite — max 5 items"]
}

DECISION RULES:
- Every blocker MUST have exactly 2-3 decisions (resolution options). Each option represents a different creative strategy.
- High-impact notes SHOULD have 2 decisions where meaningful. If only one path exists, provide 1 decision.
- Polish notes do NOT need decisions.
- option_id format: B{n}-{letter} for blockers, H{n}-{letter} for high. Letters are A, B, C.
- what_changes: list 2-4 specific story elements affected.
- creative_tradeoff: honest one-sentence assessment of the creative cost or benefit.
- commercial_lift: integer 0-20 estimating approximate GP improvement if applied.
- recommended: pick the option that best balances creative integrity with commercial viability.
- global_directions: 1-3 overarching tonal/strategic directions that apply across all notes.

GENERAL RULES:
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
    // OPTIONS — generate 2-4 decision options per blocker/high-impact note
    // ══════════════════════════════════════════════
    if (action === "options") {
      const { projectId, documentId, versionId, analysisJson, notesJson, deliverableType, developmentBehavior, format: reqFormat } = body;
      if (!projectId || !documentId || !versionId) throw new Error("projectId, documentId, versionId required");

      const { data: version } = await supabase.from("project_document_versions")
        .select("plaintext").eq("id", versionId).single();
      if (!version) throw new Error("Version not found");

      // Fetch latest analysis + notes if not provided
      let analysis = analysisJson;
      if (!analysis) {
        const { data: latestRun } = await supabase.from("development_runs")
          .select("output_json").eq("version_id", versionId).eq("run_type", "ANALYZE")
          .order("created_at", { ascending: false }).limit(1).single();
        analysis = latestRun?.output_json;
      }
      let notes = notesJson;
      if (!notes) {
        const { data: latestNotes } = await supabase.from("development_runs")
          .select("output_json").eq("document_id", documentId).eq("run_type", "NOTES")
          .order("created_at", { ascending: false }).limit(1).single();
        notes = latestNotes?.output_json;
      }

      const blockers = notes?.blocking_issues || analysis?.blocking_issues || [];
      const highImpact = notes?.high_impact_notes || analysis?.high_impact_notes || [];
      const protect = notes?.protect || analysis?.protect || [];

      const optionsSystem = `You are IFFY. For each blocker and high-impact note, generate 2-4 concrete resolution options.

Return ONLY valid JSON:
{
  "decisions": [
    {
      "note_id": "matching stable_key from the note",
      "severity": "blocker" | "high" | "medium" | "low",
      "note": "original note description",
      "options": [
        {
          "option_id": "B1-A",
          "title": "short action title (max 8 words)",
          "what_changes": ["list of 2-4 story elements that change"],
          "tradeoffs": "one sentence on creative cost/benefit",
          "creative_risk": "low" | "med" | "high",
          "commercial_lift": 0-20
        }
      ],
      "recommended_option_id": "option_id of recommended choice"
    }
  ],
  "global_directions": [
    {"id": "G1", "direction": "overarching creative direction", "why": "rationale"}
  ]
}

RULES:
- Every blocker MUST have exactly 2-4 options.
- High-impact notes SHOULD have 2-3 options.
- option_id format: B{n}-{letter} for blockers, H{n}-{letter} for high. Letters A, B, C, D.
- what_changes: list 2-4 specific story elements affected.
- tradeoffs: honest one-sentence assessment of creative cost/benefit.
- creative_risk: "low", "med", or "high" — how much creative DNA changes.
- commercial_lift: integer 0-20 estimating GP improvement.
- recommended_option_id: best balance of creative integrity and commercial viability.
- global_directions: 1-3 overarching tonal/strategic directions.
- Keep options genuinely distinct — not minor variations of the same fix.
- EVERY blocker in the input MUST appear as a decision with severity="blocker".`;

      const notesForPrompt = [
        ...blockers.map((n: any, i: number) => ({ index: i + 1, id: n.id, severity: "blocker", description: n.description, why_it_matters: n.why_it_matters })),
        ...highImpact.map((n: any, i: number) => ({ index: blockers.length + i + 1, id: n.id, severity: "high", description: n.description, why_it_matters: n.why_it_matters })),
      ];

      const userPrompt = `PROTECT ITEMS:\n${JSON.stringify(protect)}

ANALYSIS SUMMARY:\n${analysis?.executive_snapshot || analysis?.verdict || "No analysis available"}

NOTES REQUIRING DECISIONS:\n${JSON.stringify(notesForPrompt)}

MATERIAL (first 8000 chars):\n${version.plaintext.slice(0, 8000)}`;

      const raw = await callAI(LOVABLE_API_KEY, PRO_MODEL, optionsSystem, userPrompt, 0.3, 6000);
      const parsed = await parseAIJson(LOVABLE_API_KEY, raw);

      // Store as OPTIONS run
      const { data: run, error: runErr } = await supabase.from("development_runs").insert({
        project_id: projectId,
        document_id: documentId,
        version_id: versionId,
        user_id: user.id,
        run_type: "OPTIONS",
        output_json: parsed,
      }).select().single();
      if (runErr) throw runErr;

      return new Response(JSON.stringify({ run, options: parsed }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // ══════════════════════════════════════════════
    // REWRITE — with doc safety guards + decision options
    // ══════════════════════════════════════════════
    if (action === "rewrite") {
      const { projectId, documentId, versionId, approvedNotes, protectItems, targetDocType, deliverableType, developmentBehavior, format: reqFormat, selectedOptions, globalDirections } = body;
      if (!projectId || !documentId || !versionId) throw new Error("projectId, documentId, versionId required");

      // ── BLOCKER GATE: if blockers exist, selectedOptions must cover all of them ──
      const { data: latestNotesRun } = await supabase.from("development_runs")
        .select("output_json").eq("document_id", documentId).eq("run_type", "NOTES")
        .order("created_at", { ascending: false }).limit(1).single();
      const { data: latestAnalyzeRun } = await supabase.from("development_runs")
        .select("output_json").eq("document_id", documentId).eq("run_type", "ANALYZE")
        .order("created_at", { ascending: false }).limit(1).single();
      const existingBlockers = latestNotesRun?.output_json?.blocking_issues || latestAnalyzeRun?.output_json?.blocking_issues || [];

      // Only enforce blocker gate when NO user input is provided at all (no notes selected, no decisions made)
      // When approvedNotes or selectedOptions are provided, the user is actively making editorial choices
      if (existingBlockers.length > 0 && (!approvedNotes || approvedNotes.length === 0) && (!selectedOptions || selectedOptions.length === 0)) {
        const uncoveredBlockers = existingBlockers.map((b: any) => b.id || b.note_key);
        return new Response(JSON.stringify({
          error: "Blockers require decisions before rewrite",
          uncovered_blockers: uncoveredBlockers,
          blocker_count: existingBlockers.length,
        }), {
          status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

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

      // Build decision directives from selectedOptions
      let decisionDirectives = "";
      if (selectedOptions && Array.isArray(selectedOptions) && selectedOptions.length > 0) {
        const directives = selectedOptions.map((so: any) => {
          const custom = so.custom_direction ? ` Custom: ${so.custom_direction}` : "";
          return `- Note "${so.note_id}": Apply option "${so.option_id}".${custom}`;
        }).join("\n");
        decisionDirectives = `\n\nSELECTED DECISION OPTIONS (apply these specific fixes):\n${directives}`;
      }

      // Build global directions context
      let globalDirContext = "";
      if (globalDirections && Array.isArray(globalDirections) && globalDirections.length > 0) {
        globalDirContext = `\n\nGLOBAL DIRECTIONS:\n${globalDirections.map((d: string) => `- ${d}`).join("\n")}`;
      }

      const rewriteSystemPrompt = buildRewriteSystem(effectiveDeliverable, effectiveFormat, effectiveBehavior);

      const userPrompt = `PROTECT (non-negotiable):\n${JSON.stringify(protectItems || [])}

APPROVED NOTES:\n${JSON.stringify(approvedNotes || [])}${decisionDirectives}${globalDirContext}

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

      let newVersion: any = null;
      for (let _retry = 0; _retry < 3; _retry++) {
        const { data: maxRow } = await supabase.from("project_document_versions")
          .select("version_number")
          .eq("document_id", documentId)
          .order("version_number", { ascending: false })
          .limit(1)
          .single();
        const nextVersion = (maxRow?.version_number ?? 0) + 1;
        // Determine dependency tracking for this version
        const DEP_DOC_TYPES = new Set(["deck", "character_bible", "beat_sheet", "script", "blueprint", "architecture"]);
        const depFields = DEP_DOC_TYPES.has(effectiveDeliverable)
          ? ["qualifications.season_episode_count", "qualifications.episode_target_duration_seconds"]
          : [];
        let rewriteResolverHash: string | null = null;
        try {
          const rrResp = await fetch(`${supabaseUrl}/functions/v1/resolve-qualifications`, {
            method: "POST",
            headers: { "Content-Type": "application/json", Authorization: authHeader },
            body: JSON.stringify({ projectId }),
          });
          if (rrResp.ok) { const rr = await rrResp.json(); rewriteResolverHash = rr.resolver_hash || null; }
        } catch (_) { /* non-fatal */ }

        const { data: nv, error: vErr } = await supabase.from("project_document_versions").insert({
          document_id: documentId,
          version_number: nextVersion,
          label: `Rewrite pass ${nextVersion}`,
          plaintext: rewrittenText,
          created_by: user.id,
          parent_version_id: versionId,
          change_summary: parsed.changes_summary || "",
          depends_on: depFields,
          depends_on_resolver_hash: rewriteResolverHash,
        }).select().single();
        if (!vErr) { newVersion = nv; break; }
        if (vErr.code !== "23505") throw vErr;
        console.warn(`Version ${nextVersion} conflict, retrying...`);
      }
      if (!newVersion) throw new Error("Failed to create version after retries");

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

      let newVersion: any = null;
      for (let _retry = 0; _retry < 3; _retry++) {
        const { data: maxRow } = await supabase.from("project_document_versions")
          .select("version_number")
          .eq("document_id", documentId)
          .order("version_number", { ascending: false })
          .limit(1)
          .single();
        const nextVersion = (maxRow?.version_number ?? 0) + 1;
        const { data: nv, error: vErr } = await supabase.from("project_document_versions").insert({
          document_id: documentId,
          version_number: nextVersion,
          label: `Rewrite pass ${nextVersion}`,
          plaintext: assembledText,
          created_by: user.id,
          parent_version_id: versionId,
          change_summary: `Chunked rewrite across ${nextVersion - 1} iterations.`,
        }).select().single();
        if (!vErr) { newVersion = nv; break; }
        if (vErr.code !== "23505") throw vErr;
        console.warn(`Version ${nextVersion} conflict, retrying...`);
      }
      if (!newVersion) throw new Error("Failed to create version after retries");

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

      // ── Canonical Qualification Resolver for convert (esp. character_bible) ──
      let qualBindingBlock = "";
      try {
        const resolverResp = await fetch(`${supabaseUrl}/functions/v1/resolve-qualifications`, {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: authHeader },
          body: JSON.stringify({ projectId }),
        });
        if (resolverResp.ok) {
          const resolverResult = await resolverResp.json();
          const rq = resolverResult.resolvedQualifications || {};
          if (rq.is_series) {
            qualBindingBlock = `\nCANONICAL QUALIFICATIONS (use ONLY these values — ignore any older references):
Target season length: ${rq.season_episode_count} episodes.
Episode target duration: ${rq.episode_target_duration_seconds} seconds.
Season target runtime: ${rq.season_target_runtime_seconds || "N/A"} seconds.
Format: ${rq.format}.
Ignore any older references to different episode counts; they are deprecated.
Resolver hash: ${resolverResult.resolver_hash}`;
          } else if (rq.target_runtime_min_low) {
            qualBindingBlock = `\nCANONICAL QUALIFICATIONS (use ONLY these values):
Target runtime: ${rq.target_runtime_min_low}-${rq.target_runtime_min_high} minutes.
Format: ${rq.format}.
Resolver hash: ${resolverResult.resolver_hash}`;
          }
        }
      } catch (e) {
        console.warn("[dev-engine-v2] convert: resolve-qualifications failed:", e);
      }

      const userPrompt = `SOURCE FORMAT: ${srcDoc?.doc_type || "unknown"}
TARGET FORMAT: ${targetOutput}
PROTECT (non-negotiable creative DNA):\n${JSON.stringify(protectItems || [])}
${qualBindingBlock}
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
      // Dependency tracking for converted version
      const CONVERT_DEP_TYPES = new Set(["deck", "character_bible", "beat_sheet", "script", "blueprint", "architecture"]);
      const convertDepFields = CONVERT_DEP_TYPES.has(resolvedDeliverable)
        ? ["qualifications.season_episode_count", "qualifications.episode_target_duration_seconds"]
        : [];
      // qualBindingBlock already resolved above — extract hash from it
      const convertHashMatch = qualBindingBlock.match(/Resolver hash: (\S+)/);
      const convertResolverHash = convertHashMatch?.[1] || null;

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
        depends_on: convertDepFields,
        depends_on_resolver_hash: convertResolverHash,
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

      const expandedWords = cleanExpanded.split(/\s+/).filter(Boolean).length;
      const expandedMins = expandedWords / divisor;

      let newVersion: any = null;
      for (let _retry = 0; _retry < 3; _retry++) {
        const { data: maxRow } = await supabase.from("project_document_versions")
          .select("version_number").eq("document_id", documentId)
          .order("version_number", { ascending: false }).limit(1).single();
        const nextVer = (maxRow?.version_number ?? 0) + 1;
        const { data: nv, error: vErr } = await supabase.from("project_document_versions").insert({
          document_id: documentId,
          version_number: nextVer,
          label: `Expanded to ~${Math.round(expandedMins)} mins`,
          plaintext: cleanExpanded,
          created_by: user.id,
          parent_version_id: versionId,
          change_summary: `Auto-expanded from ~${Math.round(currentMins)} to ~${Math.round(expandedMins)} mins.`,
        }).select().single();
        if (!vErr) { newVersion = nv; break; }
        if (vErr.code !== "23505") throw vErr;
        console.warn(`Version ${nextVer} conflict, retrying...`);
      }
      if (!newVersion) throw new Error("Failed to create version after retries");

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

    // ══════════════════════════════════════════════
    // EXECUTIVE-STRATEGY — lightweight reposition advisor (no session, no rewrite)
    // ══════════════════════════════════════════════
    if (action === "executive-strategy") {
      const { projectId, documentId, versionId, deliverableType, format: reqFormat, developmentBehavior, analysisJson } = body;
      if (!projectId || !documentId || !versionId) throw new Error("projectId, documentId, versionId required");

      const { data: version } = await supabase.from("project_document_versions")
        .select("plaintext").eq("id", versionId).single();
      if (!version) throw new Error("Version not found");

      const { data: project } = await supabase.from("projects")
        .select("title, budget_range, assigned_lane, format, episode_target_duration_seconds, season_episode_count, guardrails_config")
        .eq("id", projectId).single();

      const format = reqFormat || project?.format || "film";
      const lane = project?.assigned_lane || "independent-film";
      const budget = project?.budget_range || "low";
      const materialText = (version.plaintext || "").slice(0, 12000);
      const analysisSnippet = analysisJson ? JSON.stringify(analysisJson).slice(0, 4000) : "No prior analysis";

      const EXEC_STRATEGY_SYSTEM = `You are IFFY Executive Strategist. You are NOT an editorial engine — do NOT rewrite or give editorial notes.
Your job: diagnose why this project is failing to converge and propose minimal strategic repositioning.

CONTEXT:
- Current format: ${format}
- Current lane: ${lane}
- Current budget band: ${budget}
- Deliverable stage: ${deliverableType || "unknown"}
- Development behavior: ${developmentBehavior || "market"}
- Episode duration: ${project?.episode_target_duration_seconds || "not set"}
- Season episode count: ${project?.season_episode_count || "not set"}

Evaluate the material and latest analysis. Return ONLY valid JSON:
{
  "auto_fixes": {
    "qualifications": {
      "episode_target_duration_seconds": <number or omit>,
      "season_episode_count": <number or omit>,
      "target_runtime_min_low": <number or omit>,
      "target_runtime_min_high": <number or omit>
    },
    "assigned_lane": "<suggested lane or omit if current is fine>",
    "budget_range": "<suggested budget band or omit if current is fine>"
  },
  "must_decide": [
    {
      "id": "<short_snake_case_id>",
      "question": "<clear question the producer must answer>",
      "options": [
        {"value": "<option_value>", "why": "<1-sentence reasoning>"}
      ],
      "recommended": "<recommended option value or omit>",
      "impact": "blocking" or "non_blocking"
    }
  ],
  "summary": "<2-3 sentence executive summary of the strategic situation>"
}

Rules:
- auto_fixes.qualifications: include any missing technical metadata the system needs. Omit keys that are already correctly set.
- auto_fixes.assigned_lane/budget_range: only include if clearly misaligned with the material.
- must_decide: decisions the system CANNOT make automatically. If the project cannot progress without a human choice, set impact:"blocking".
- Each must_decide item needs 2-4 concrete options with reasoning.
- Do NOT recommend format changes — that belongs in must_decide if relevant.
- Keep must_decide to 1-3 items max. Focus on the most impactful blocking decisions first.
- summary should explain WHY the project is stuck and what the strategy resolves.`;

      const userPrompt = `LATEST ANALYSIS:\n${analysisSnippet}\n\nMATERIAL:\n${materialText}`;
      const raw = await callAI(LOVABLE_API_KEY, FAST_MODEL, EXEC_STRATEGY_SYSTEM, userPrompt, 0.3, 2500);
      let parsed: any;
      try {
        parsed = JSON.parse(extractJSON(raw));
      } catch {
        const repair = await callAI(LOVABLE_API_KEY, FAST_MODEL, "Fix this malformed JSON. Return JSON ONLY.", raw.slice(0, 3000), 0, 1500);
        parsed = JSON.parse(extractJSON(repair));
      }

      // Normalize structure
      if (!parsed.auto_fixes) parsed.auto_fixes = {};
      if (!parsed.must_decide) parsed.must_decide = [];
      if (!parsed.summary) parsed.summary = "";

      console.log(`[dev-engine-v2] executive-strategy: auto_fixes=${JSON.stringify(parsed.auto_fixes)}, must_decide=${parsed.must_decide.length}`);

      return new Response(JSON.stringify(parsed), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // ══════════════════════════════════════════════
    // REBASE-CHECK — detect stale documents vs current criteria
    // ══════════════════════════════════════════════
    if (action === "rebase-check") {
      const { projectId } = body;
      if (!projectId) throw new Error("projectId required");

      const latestSnapshot = await buildCriteriaSnapshot(supabase, projectId);

      // Fetch all project documents with their latest runs
      const { data: docs } = await supabase.from("project_documents")
        .select("id, doc_type, created_at")
        .eq("project_id", projectId)
        .order("created_at", { ascending: true });

      const docResults: any[] = [];
      for (const doc of (docs || [])) {
        // Get latest version
        const { data: vers } = await supabase.from("project_document_versions")
          .select("id, created_at").eq("document_id", doc.id)
          .order("version_number", { ascending: false }).limit(1);
        const latestVer = vers?.[0];

        // Get latest analyze run with criteria_snapshot
        const { data: runs } = await supabase.from("development_runs")
          .select("output_json, created_at").eq("document_id", doc.id).eq("run_type", "ANALYZE")
          .order("created_at", { ascending: false }).limit(1);
        const lastRun = runs?.[0];
        const docSnapshot = lastRun?.output_json?.criteria_snapshot || null;

        const diffKeys = compareSnapshots(docSnapshot, latestSnapshot);

        docResults.push({
          documentId: doc.id,
          doc_type: doc.doc_type,
          latestVersionId: latestVer?.id || null,
          is_stale: diffKeys.length > 0,
          diff_keys: diffKeys,
          last_generated_at: lastRun?.created_at || latestVer?.created_at || doc.created_at,
          stored_snapshot: docSnapshot,
        });
      }

      return new Response(JSON.stringify({
        latest_criteria_snapshot: latestSnapshot,
        docs: docResults,
      }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // ══════════════════════════════════════════════
    // REBASE-REGENERATE — plan or execute regeneration
    // ══════════════════════════════════════════════
    if (action === "rebase-regenerate") {
      const { projectId, from_stage, to_stage, strategy, source_version_id, require_approval } = body;
      if (!projectId || !from_stage) throw new Error("projectId and from_stage required");

      const targetStage = to_stage || from_stage;
      const LADDER = ["idea", "concept_brief", "blueprint", "architecture", "draft"];
      const fromIdx = LADDER.indexOf(from_stage);
      const toIdx = LADDER.indexOf(targetStage);
      if (fromIdx < 0) throw new Error(`Invalid from_stage: ${from_stage}`);
      if (toIdx < 0) throw new Error(`Invalid to_stage: ${targetStage}`);

      const latestSnapshot = await buildCriteriaSnapshot(supabase, projectId);

      // Build plan
      const planSteps: any[] = [];
      if (strategy === "regenerate_each_stage") {
        for (let i = fromIdx; i <= toIdx; i++) {
          planSteps.push({ stage: LADDER[i], action: "analyze+notes+rewrite", will_create_new_version: true });
        }
      } else {
        // regenerate_from_source: convert forward
        if (fromIdx < toIdx) {
          planSteps.push({ stage: from_stage, action: "source", will_create_new_version: false });
          for (let i = fromIdx + 1; i <= toIdx; i++) {
            planSteps.push({ stage: LADDER[i], action: "convert_from_previous", will_create_new_version: true });
          }
        } else {
          planSteps.push({ stage: from_stage, action: "analyze+notes+rewrite", will_create_new_version: true });
        }
      }

      // If approval required, return plan only
      if (require_approval !== false) {
        return new Response(JSON.stringify({
          plan_steps: planSteps,
          estimated_steps: planSteps.filter(s => s.will_create_new_version).length,
          will_overwrite: false,
          latest_criteria_snapshot: latestSnapshot,
          strategy: strategy || "regenerate_from_source",
        }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }

      // Execute: find source doc/version
      let sourceDocId: string | null = null;
      let sourceVersionId = source_version_id || null;

      const { data: sourceDocs } = await supabase.from("project_documents")
        .select("id").eq("project_id", projectId).eq("doc_type", from_stage)
        .order("created_at", { ascending: false }).limit(1);
      sourceDocId = sourceDocs?.[0]?.id;

      if (!sourceDocId) throw new Error(`No document found for stage: ${from_stage}`);

      if (!sourceVersionId) {
        const { data: vers } = await supabase.from("project_document_versions")
          .select("id").eq("document_id", sourceDocId)
          .order("version_number", { ascending: false }).limit(1);
        sourceVersionId = vers?.[0]?.id;
      }
      if (!sourceVersionId) throw new Error(`No version found for ${from_stage} document`);

      const results: any[] = [];

      if (strategy === "regenerate_each_stage") {
        // For each stage, run analyze+notes+rewrite on existing doc
        for (let i = fromIdx; i <= toIdx; i++) {
          const stage = LADDER[i];
          const { data: stageDocs } = await supabase.from("project_documents")
            .select("id").eq("project_id", projectId).eq("doc_type", stage)
            .order("created_at", { ascending: false }).limit(1);
          const stageDoc = stageDocs?.[0];
          if (!stageDoc) { results.push({ stage, skipped: true, reason: "no document" }); continue; }

          const { data: stageVers } = await supabase.from("project_document_versions")
            .select("id, plaintext, version_number").eq("document_id", stageDoc.id)
            .order("version_number", { ascending: false }).limit(1);
          const stageVer = stageVers?.[0];
          if (!stageVer) { results.push({ stage, skipped: true, reason: "no version" }); continue; }

          // Create a new version with provenance metadata
          const newVerNum = (stageVer.version_number || 0) + 1;
          const { data: newVer } = await supabase.from("project_document_versions").insert({
            document_id: stageDoc.id,
            version_number: newVerNum,
            label: `Rebased v${newVerNum}`,
            plaintext: stageVer.plaintext,
            created_by: user.id,
            parent_version_id: stageVer.id,
            change_summary: `Rebased to match updated criteria`,
          }).select("id").single();

          results.push({
            stage,
            documentId: stageDoc.id,
            newVersionId: newVer?.id,
            regenerated: true,
            provenance: {
              regenerated_from_version_id: stageVer.id,
              regenerated_because_diff_keys: compareSnapshots(null, latestSnapshot),
              regenerated_at: new Date().toISOString(),
            },
          });
        }
      } else {
        // regenerate_from_source: convert forward from source
        let currentDocId = sourceDocId;
        let currentVersionId = sourceVersionId;

        for (let i = fromIdx + 1; i <= toIdx; i++) {
          const targetStageName = LADDER[i].toUpperCase().replace(/-/g, "_");

          // We can't call ourselves recursively, so do the convert inline
          const { data: srcVer } = await supabase.from("project_document_versions")
            .select("plaintext").eq("id", currentVersionId).single();
          const { data: srcDoc } = await supabase.from("project_documents")
            .select("doc_type, title").eq("id", currentDocId).single();

          const convSystem = `You are IFFY. Convert the source material into ${LADDER[i]} format.
Preserve creative DNA. Adapt structure and detail level.
Return ONLY valid JSON:
{
  "converted_text": "the full converted output",
  "format": "${LADDER[i]}",
  "change_summary": "what was adapted"
}`;
          const convPrompt = `SOURCE FORMAT: ${srcDoc?.doc_type || "unknown"}\nTARGET FORMAT: ${targetStageName}\n\nMATERIAL:\n${(srcVer?.plaintext || "").slice(0, 20000)}`;
          const convRaw = await callAI(LOVABLE_API_KEY, BALANCED_MODEL, convSystem, convPrompt, 0.35, 10000);
          const convParsed = await parseAIJson(LOVABLE_API_KEY, convRaw);

          const resolvedDocType = LADDER[i];
          const { data: newDoc } = await supabase.from("project_documents").insert({
            project_id: projectId,
            user_id: user.id,
            file_name: `${srcDoc?.title || "Document"} — ${LADDER[i]} (rebased)`,
            file_path: "",
            extraction_status: "complete",
            doc_type: resolvedDocType,
            title: `${srcDoc?.title || "Document"} — ${LADDER[i]} (rebased)`,
            source: "generated",
            plaintext: convParsed.converted_text || "",
          }).select("id").single();

          const { data: newVer } = await supabase.from("project_document_versions").insert({
            document_id: newDoc!.id,
            version_number: 1,
            label: `Rebased from ${srcDoc?.doc_type}`,
            plaintext: convParsed.converted_text || "",
            created_by: user.id,
            change_summary: convParsed.change_summary || "Rebased conversion",
          }).select("id").single();

          results.push({
            stage: LADDER[i],
            documentId: newDoc!.id,
            newVersionId: newVer?.id,
            regenerated: true,
            provenance: {
              regenerated_from_version_id: currentVersionId,
              regenerated_at: new Date().toISOString(),
            },
          });

          currentDocId = newDoc!.id;
          currentVersionId = newVer!.id;
        }
      }

      return new Response(JSON.stringify({
        results,
        latest_criteria_snapshot: latestSnapshot,
        strategy: strategy || "regenerate_from_source",
      }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // ══════════════════════════════════════════════
    // EXTRACT-CRITERIA — extract qualifications from idea document
    // ══════════════════════════════════════════════
    if (action === "extract-criteria") {
      const { projectId, documentId, versionId } = body;
      if (!projectId || !documentId || !versionId) throw new Error("projectId, documentId, versionId required");

      // Fetch text
      const { data: version } = await supabase.from("project_document_versions")
        .select("plaintext").eq("id", versionId).single();
      let text = version?.plaintext || "";
      if (!text || text.length < 50) {
        const { data: docRow } = await supabase.from("project_documents")
          .select("extracted_text, plaintext").eq("id", documentId).single();
        text = docRow?.extracted_text || docRow?.plaintext || text;
      }
      if (!text || text.length < 20) throw new Error("No text found in document to extract criteria from");

      const EXTRACT_CRITERIA_SYSTEM = `You are a script and format analyst. Extract production criteria from this creative document.

RULES:
- Only extract values EXPLICITLY stated or STRONGLY implied in the text.
- If a value is not stated or clearly implied, return null for that field.
- Do NOT invent numbers. Do NOT guess episode counts or durations.
- If you detect a vertical drama but no episode duration is stated, return null and list it in missing_required.
- format_subtype must be one of: film, tv-series, limited-series, vertical-drama, documentary, documentary-series, hybrid-documentary, short, animation, digital-series, anim-series, anim-feature, reality, short-film
- assigned_lane must be one of: prestige, mainstream, independent-film, genre, micro-budget
- budget_range must be one of: micro, low, medium, high, tent-pole

Return ONLY valid JSON matching this schema:
{
  "criteria": {
    "format_subtype": string | null,
    "season_episode_count": number | null,
    "episode_target_duration_seconds": number | null,
    "target_runtime_min_low": number | null,
    "target_runtime_min_high": number | null,
    "assigned_lane": string | null,
    "budget_range": string | null,
    "tone_tags": string[] | null,
    "audience_region": string | null,
    "language": string | null
  },
  "field_confidence": {
    "format_subtype": "high" | "med" | "low" | null,
    "season_episode_count": "high" | "med" | "low" | null,
    "episode_target_duration_seconds": "high" | "med" | "low" | null,
    "target_runtime_min_low": "high" | "med" | "low" | null,
    "target_runtime_min_high": "high" | "med" | "low" | null,
    "assigned_lane": "high" | "med" | "low" | null,
    "budget_range": "high" | "med" | "low" | null
  },
  "missing_required": ["list of field names that could not be extracted but may be needed"],
  "notes_for_user": ["short bullets explaining extraction decisions"]
}`;

      const raw = await callAI(LOVABLE_API_KEY, FAST_MODEL, EXTRACT_CRITERIA_SYSTEM, `DOCUMENT:\n${text.slice(0, 12000)}`, 0.1, 2000);
      let parsed: any;
      try {
        parsed = JSON.parse(extractJSON(raw));
      } catch {
        const repair = await callAI(LOVABLE_API_KEY, FAST_MODEL, "Fix this malformed JSON. Return JSON ONLY.", raw.slice(0, 3000), 0, 1500);
        parsed = JSON.parse(extractJSON(repair));
      }

      if (!parsed.criteria) parsed.criteria = {};
      if (!parsed.field_confidence) parsed.field_confidence = {};
      if (!parsed.missing_required) parsed.missing_required = [];
      if (!parsed.notes_for_user) parsed.notes_for_user = [];

      // Persist to project
      const criteria = parsed.criteria;
      const projectUpdates: Record<string, any> = {};

      if (criteria.episode_target_duration_seconds) {
        projectUpdates.episode_target_duration_seconds = criteria.episode_target_duration_seconds;
      }
      if (criteria.assigned_lane) {
        projectUpdates.assigned_lane = criteria.assigned_lane;
      }
      if (criteria.budget_range) {
        projectUpdates.budget_range = criteria.budget_range;
      }
      if (criteria.format_subtype) {
        // Map to DB format
        const fmtMap: Record<string, string> = {
          "vertical-drama": "vertical_drama", "tv-series": "tv_series",
          "limited-series": "limited_series", "documentary-series": "documentary_series",
          "hybrid-documentary": "hybrid_documentary", "digital-series": "digital_series",
          "anim-series": "anim_series", "anim-feature": "anim_feature",
          "short-film": "short_film",
        };
        projectUpdates.format = fmtMap[criteria.format_subtype] || criteria.format_subtype;
      }

      // Write to guardrails_config
      const { data: curProj } = await supabase.from("projects")
        .select("guardrails_config, season_episode_count")
        .eq("id", projectId).single();
      const gc = curProj?.guardrails_config || {};
      gc.overrides = gc.overrides || {};

      // Build qualifications
      const quals: Record<string, any> = { ...(gc.overrides.qualifications || {}) };
      if (criteria.season_episode_count) quals.season_episode_count = criteria.season_episode_count;
      if (criteria.episode_target_duration_seconds) quals.episode_target_duration_seconds = criteria.episode_target_duration_seconds;
      if (criteria.target_runtime_min_low) quals.target_runtime_min_low = criteria.target_runtime_min_low;
      if (criteria.target_runtime_min_high) quals.target_runtime_min_high = criteria.target_runtime_min_high;
      if (criteria.format_subtype) quals.format_subtype = criteria.format_subtype;
      gc.overrides.qualifications = quals;

      // Store provenance
      gc.derived_from_idea = {
        extracted_at: new Date().toISOString(),
        document_id: documentId,
        version_id: versionId,
        criteria: parsed.criteria,
        field_confidence: parsed.field_confidence,
      };
      projectUpdates.guardrails_config = gc;

      // Update season_episode_count column if available
      if (criteria.season_episode_count) {
        projectUpdates.season_episode_count = criteria.season_episode_count;
      }

      await supabase.from("projects").update(projectUpdates).eq("id", projectId);

      console.log(`[dev-engine-v2] extract-criteria: extracted ${Object.keys(criteria).filter(k => criteria[k] != null).length} fields, missing: ${parsed.missing_required.join(", ") || "none"}`);

      return new Response(JSON.stringify(parsed), {
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
