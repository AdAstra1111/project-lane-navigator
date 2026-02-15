import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { buildGuardrailBlock } from "../_shared/guardrails.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

// ═══════════════════════════════════════════════════════════════
// SECTION A: ENGINE REGISTRY ROUTER (deterministic — no AI call)
// ═══════════════════════════════════════════════════════════════

type EngineType =
  | "FEATURE_FILM" | "TV_DRAMA" | "LIMITED_SERIES" | "VERTICAL_DRAMA"
  | "DOC_FEATURE" | "DOC_SERIES" | "ANIM_FEATURE" | "ANIM_SERIES"
  | "REALITY" | "BRANDED" | "PODCAST_IP" | "DIGITAL_FIRST";

type ModelTier = "REASONING_PREMIUM" | "REASONING_STANDARD" | "FAST";

interface RouterOutput {
  production_type: EngineType;
  model_tier: ModelTier;
  system_prompt_id: string;
  scoring_schema_id: string;
  output_schema_id: "IFFY_ANALYSIS_V1";
  calibrator_enabled: true;
  routing_warnings: string[];
}

interface EngineEntry {
  system_prompt_id: string;
  scoring_schema_id: string;
  model_tier: ModelTier;
}

const ENGINE_REGISTRY: Record<EngineType, EngineEntry> = {
  FEATURE_FILM:    { system_prompt_id: "IFFY_SYS_FEATURE_FILM_V2",  scoring_schema_id: "IFFY_SCORE_FEATURE_FILM_V2",  model_tier: "REASONING_PREMIUM" },
  TV_DRAMA:        { system_prompt_id: "IFFY_SYS_TV_DRAMA_V1",      scoring_schema_id: "IFFY_SCORE_TV_DRAMA_V1",      model_tier: "REASONING_PREMIUM" },
  LIMITED_SERIES:  { system_prompt_id: "IFFY_SYS_LIMITED_SERIES_V1", scoring_schema_id: "IFFY_SCORE_LIMITED_SERIES_V1", model_tier: "REASONING_PREMIUM" },
  VERTICAL_DRAMA:  { system_prompt_id: "IFFY_SYS_VERTICAL_DRAMA_V1", scoring_schema_id: "IFFY_SCORE_VERTICAL_DRAMA_V1", model_tier: "FAST" },
  DOC_FEATURE:     { system_prompt_id: "IFFY_SYS_DOC_FEATURE_V1",   scoring_schema_id: "IFFY_SCORE_DOC_FEATURE_V1",   model_tier: "REASONING_STANDARD" },
  DOC_SERIES:      { system_prompt_id: "IFFY_SYS_DOC_SERIES_V1",    scoring_schema_id: "IFFY_SCORE_DOC_SERIES_V1",    model_tier: "REASONING_STANDARD" },
  ANIM_FEATURE:    { system_prompt_id: "IFFY_SYS_ANIM_FEATURE_V1",  scoring_schema_id: "IFFY_SCORE_ANIM_FEATURE_V1",  model_tier: "REASONING_STANDARD" },
  ANIM_SERIES:     { system_prompt_id: "IFFY_SYS_ANIM_SERIES_V1",   scoring_schema_id: "IFFY_SCORE_ANIM_SERIES_V1",   model_tier: "REASONING_STANDARD" },
  REALITY:         { system_prompt_id: "IFFY_SYS_REALITY_V1",       scoring_schema_id: "IFFY_SCORE_REALITY_V1",       model_tier: "FAST" },
  BRANDED:         { system_prompt_id: "IFFY_SYS_BRANDED_V1",       scoring_schema_id: "IFFY_SCORE_BRANDED_V1",       model_tier: "FAST" },
  PODCAST_IP:      { system_prompt_id: "IFFY_SYS_PODCAST_IP_V1",    scoring_schema_id: "IFFY_SCORE_PODCAST_IP_V1",    model_tier: "FAST" },
  DIGITAL_FIRST:   { system_prompt_id: "IFFY_SYS_DIGITAL_FIRST_V1", scoring_schema_id: "IFFY_SCORE_DIGITAL_FIRST_V1", model_tier: "FAST" },
};

const FORMAT_TO_ENGINE: Record<string, EngineType> = {
  film: "FEATURE_FILM",
  "tv-series": "TV_DRAMA",
  "limited-series": "LIMITED_SERIES",
  "vertical-drama": "VERTICAL_DRAMA",
  documentary: "DOC_FEATURE",
  "documentary-series": "DOC_SERIES",
  "hybrid-documentary": "DOC_FEATURE",
  "anim-feature": "ANIM_FEATURE",
  "anim-series": "ANIM_SERIES",
  reality: "REALITY",
  commercial: "BRANDED",
  "branded-content": "BRANDED",
  "podcast-ip": "PODCAST_IP",
  "digital-series": "DIGITAL_FIRST",
  "short-film": "FEATURE_FILM",
  "music-video": "BRANDED",
  "proof-of-concept": "FEATURE_FILM",
  hybrid: "DIGITAL_FIRST",
};

function route(format: string): RouterOutput {
  const key = (format || "").toLowerCase();
  const warnings: string[] = [];
  let engineType = FORMAT_TO_ENGINE[key];
  if (!engineType) {
    engineType = "FEATURE_FILM";
    warnings.push(`Unknown format "${format}" — defaulting to FEATURE_FILM`);
  }
  if (key === "short-film") warnings.push("Short film mapped to FEATURE_FILM engine with festival focus");
  if (key === "music-video") warnings.push("Music video mapped to BRANDED engine");
  if (key === "proof-of-concept") warnings.push("Proof of concept mapped to FEATURE_FILM engine with development focus");
  if (key === "hybrid-documentary") warnings.push("Hybrid documentary mapped to DOC_FEATURE engine");
  if (key === "hybrid") warnings.push("Hybrid mapped to DIGITAL_FIRST engine");

  const entry = ENGINE_REGISTRY[engineType];
  return {
    production_type: engineType,
    model_tier: entry.model_tier,
    system_prompt_id: entry.system_prompt_id,
    scoring_schema_id: entry.scoring_schema_id,
    output_schema_id: "IFFY_ANALYSIS_V1",
    calibrator_enabled: true,
    routing_warnings: warnings,
  };
}

// ═══════════════════════════════════════════════════════════════
// SECTION C: TYPE SYSTEM PROMPTS (SPECIALIST ENGINES)
// ═══════════════════════════════════════════════════════════════

const SCHEMA_INSTRUCTION = `
You MUST return ONLY valid JSON matching IFFY_ANALYSIS_V1 schema. No prose, no markdown.
Required top-level keys: meta, strategic_snapshot, scores, greenlight_probability, lane_or_platform_target, primary_obstacle, fastest_path_to_close, tactical_moves, verdict, confidence, assumptions.
- meta: { production_type, model_tier, scoring_schema_id, version }
- strategic_snapshot: 2–3 blunt executive sentences (20–600 chars)
- scores: { axes: [{ name, score, max, rationale }], total: 0–100, caps_applied: [] }
- greenlight_probability: 0–100
- lane_or_platform_target: string
- primary_obstacle: string (10–240 chars)
- fastest_path_to_close: string (20–600 chars)
- tactical_moves: array of 3–6 strings, each 10–160 chars
- verdict: "INVEST" | "PASS" | "ONLY_IF"
- confidence: 0–100
- assumptions: array of 2–8 strings, each 5–160 chars
`;

function getSpecialistPrompt(engineType: EngineType, routerOutput: RouterOutput): string {
  const base = `You do not give generic writing notes. You only produce greenlight-relevant analysis.
${SCHEMA_INSTRUCTION}
Set meta.production_type = "${engineType}"
Set meta.model_tier = "${routerOutput.model_tier}"
Set meta.scoring_schema_id = "${routerOutput.scoring_schema_id}"
Set meta.version = "v1"
Provide 3–6 tactical_moves that are producer-executable within 2–6 weeks.`;

  const prompts: Record<EngineType, string> = {
    FEATURE_FILM: `You are IFFY_FEATURE_FILM, a Greenlight Architect for narrative feature films.
You simulate a real studio exec, streamer strategist, international sales agent, and equity financier.

AXES (100 pts):
- Conviction & Cultural Force (0–15)
- Script Power (0–15)
- Commercial Positioning (0–15)
- Packaging Leverage (probability-based, not fantasy) (0–15)
- Finance Structure Viability (0–15)
- Global Travelability (0–10)
- Market Heat & Timing (0–10)
- Execution Risk (0–5)

BUDGET CAPS (apply if budget known; otherwise note assumption):
- If budget > 15M: if Packaging <10 OR Finance <10 → cap greenlight_probability at 55 and add caps_applied note.
- If budget < 5M: if Script Power <11 → cap at 60 and add caps_applied note.
Set meta.version = "v2"`,

    TV_DRAMA: `You are IFFY_TV_DRAMA, simulating a commissioning executive + streamer strategy head + co-pro specialist.
You optimize for retention, sustainability, showrunner viability, and commissionability.

AXES (100 pts):
- Series Engine Strength (0–20)
- Pilot Impact (0–15)
- Season Arc & Future Runway (0–15)
- Character Returnability (0–15)
- Showrunner & Room Viability (0–15)
- Platform Mandate Alignment (0–10)
- International Co-Production Value (0–5)
- Production Scalability (0–5)

Include in assumptions: ideal season order (6/8/10) and renewal/cancellation risk logic.`,

    LIMITED_SERIES: `You are IFFY_LIMITED, a prestige commissioner + awards strategist.
You optimize for "event series" impact, cast heat, and contained narrative power.

AXES (100 pts):
- Contained Narrative Power (0–20)
- Event-Level Hook (0–20)
- Cast Attractiveness (probability-based) (0–20)
- Prestige Platform Alignment (0–15)
- Awards Potential (0–10)
- Global Travelability (0–10)
- Budget Efficiency (0–5)`,

    VERTICAL_DRAMA: `You are IFFY_VERTICAL, a platform algorithm strategist + micro-drama volume producer.
You optimize for hook density, cliffhanger addiction, completion probability, and scalable low-cost production.
This is addiction economics, not prestige economics.

AXES (100 pts):
- Hook in First 30 Seconds (0–20)
- Cliffhanger Density (0–20)
- Episode Velocity (0–15)
- Addictive Character Dynamics (0–15)
- Production Speed Feasibility (0–10)
- Cost Efficiency (0–10)
- Platform Trend Alignment (0–10)

BUDGET CAPS:
- If hook score < 14: cap greenlight_probability at 30.
- If cliffhanger density < 14: add caps_applied "RETENTION RISK".`,

    DOC_FEATURE: `You are IFFY_DOC_FEATURE, a festival programmer + broadcaster + grant evaluator.
You optimize for access, urgency, and funding ecosystem viability.

AXES (100 pts):
- Access & Exclusivity (0–25)
- Subject Urgency (0–20)
- Festival Positioning (0–15)
- Impact Funding Potential (0–15)
- Broadcaster Appeal (0–10)
- Global Relevance (0–10)
- Archive Strength (0–5)

BUDGET CAPS:
- If access score < 15: cap greenlight_probability at 35.
- If subject urgency < 12: add caps_applied "RELEVANCE RISK".`,

    DOC_SERIES: `You are IFFY_DOC_SERIES, a commissioner optimizing for episodic reveal structure + retention.
You optimize for ongoing tension and platform appetite.

AXES (100 pts):
- Episodic Reveal Structure (0–20)
- Ongoing Narrative Tension (0–20)
- Platform Appetite (0–15)
- Access & Credibility (0–15)
- Audience Hook Strength (0–15)
- International Appeal (0–10)
- Production Practicality (0–5)

BUDGET CAPS:
- If episodic reveal structure < 12: add caps_applied "STRUCTURE RISK".
- If audience hook < 10: cap greenlight_probability at 40.`,

    ANIM_FEATURE: `You are IFFY_ANIM_FEATURE, a long-term IP investor.
You optimize for world uniqueness, franchise upside, and production/timeline realism.

AXES (100 pts):
- Visual World Uniqueness (0–20)
- Franchise Potential (0–20)
- IP Strength (0–15)
- Presale Attractiveness (0–15)
- Voice Cast Strategy (0–10)
- Production Timeline Risk (0–10)
- Budget Scale Efficiency (0–10)`,

    ANIM_SERIES: `You are IFFY_ANIM_SERIES, a platform + merchandising strategist.
You optimize for episodic engine + licensing potential + renewal likelihood.

AXES (100 pts):
- Episodic Engine (0–20)
- Toyetic / Licensing Potential (0–20)
- Platform Demo Alignment (0–15)
- IP Strength (0–15)
- International Presale Value (0–10)
- Production Pipeline Efficiency (0–10)
- Renewal Probability (0–10)`,

    REALITY: `You are IFFY_REALITY, a format commissioner + distributor.
You optimize for repeatability, casting scalability, and cost-to-return ratio.

AXES (100 pts):
- Format Originality (0–20)
- Repeatability (0–20)
- Casting Scalability (0–15)
- Commission Likelihood (0–15)
- Cost-to-Return Ratio (0–15)
- Sponsorship / Brand Potential (0–10)
- International Format Adaptability (0–5)`,

    BRANDED: `You are IFFY_BRANDED, a brand strategist evaluating ROI, clarity, and delivery risk.
You optimize for measurable outcomes and delivery feasibility.

AXES (100 pts):
- Brand Alignment (0–25)
- Outcome Clarity (0–20)
- Shareability Potential (0–15)
- Budget Efficiency (0–15)
- Delivery Speed (0–15)
- Audience Target Accuracy (0–10)

BUDGET CAPS:
- If brand alignment < 18: add caps_applied "CLIENT RISK".
- If outcome clarity < 14: cap greenlight_probability at 45.`,

    PODCAST_IP: `You are IFFY_PODCAST_IP, an IP incubator.
You optimize for audience growth velocity and cross-media adaptation upside.

AXES (100 pts):
- Audience Growth Velocity (0–20)
- Adaptation Potential (0–20)
- Format Expandability (0–15)
- Brand Integration Potential (0–15)
- Cost vs Reach Efficiency (0–15)
- Monetisation Scalability (0–15)`,

    DIGITAL_FIRST: `You are IFFY_DIGITAL_FIRST, an algorithm + influencer strategist.
You optimize for platform-native storytelling, speed, and monetisation mix.

AXES (100 pts):
- Algorithm Compatibility (0–20)
- Influencer Leverage (0–20)
- Shareability (0–15)
- Speed to Market (0–15)
- Monetisation Mix (0–15)
- Audience Growth Flywheel (0–15)

BUDGET CAPS:
- If algorithm compatibility < 14: add caps_applied "PLATFORM FIT RISK".`,
  };

  return prompts[engineType] + "\n\n" + base;
}

// Guardrails are injected at call-time via buildGuardrailBlock in the main handler

// ═══════════════════════════════════════════════════════════════
// SECTION D: CALIBRATOR PROMPT
// ═══════════════════════════════════════════════════════════════

const CALIBRATOR_PROMPT = `You are IFFY_CALIBRATOR, a ruthless second-pass auditor.

You receive project metadata and a specialist output JSON (IFFY_ANALYSIS_V1).

Your job:
- Detect optimism bias, fantasy packaging, lane mismatch, internal contradictions.
- Apply any caps/rules implied by the production type if not already applied.
- Normalize scoring rationales so they match the claimed score severity.
- Produce FINAL JSON that MUST validate against IFFY_ANALYSIS_V1.

CALIBRATION RULES (apply across all types):
1) If packaging/cast claims are speculative (no LOI/attachment), reduce any axis referencing packaging/attachability by 2–6 points depending on certainty; add assumption.
2) If finance path is vague, reduce finance-related axis by 2–6; add assumption.
3) If lane/platform target is "hybrid" without a concrete buyer path, force a single primary lane and note why.
4) If greenlight_probability is inconsistent with total score + obstacles, adjust probability (not necessarily the total) and explain via assumptions.
5) Ensure tactical_moves are executable within 2–6 weeks.
6) For FEATURE_FILM apply budget caps if budget known.

Set meta.version to "calibrated_v1".
Keep meta.production_type and meta.scoring_schema_id unchanged.

${SCHEMA_INSTRUCTION}`;

// ═══════════════════════════════════════════════════════════════
// SECTION E: JSON REPAIR
// ═══════════════════════════════════════════════════════════════

const REPAIR_PROMPT = `You are IFFY_JSON_REPAIR.
You will be given the IFFY_ANALYSIS_V1 JSON schema description and a malformed output.
Your job: Return a corrected JSON object that validates. Preserve meaning as much as possible.
Do not add new commentary. Return JSON ONLY.

${SCHEMA_INSTRUCTION}`;

// ═══════════════════════════════════════════════════════════════
// HELPERS
// ═══════════════════════════════════════════════════════════════

function extractJSON(raw: string): string {
  let content = raw.replace(/^```[\s\S]*?\n/, "").replace(/\n?```\s*$/, "");
  if (!content.trim().startsWith("{")) {
    const i = content.indexOf("{");
    if (i >= 0) content = content.slice(i);
  }
  const last = content.lastIndexOf("}");
  if (last >= 0) content = content.slice(0, last + 1);
  return content.trim();
}

function validateAnalysisV1(obj: any): string[] {
  const errors: string[] = [];
  if (!obj.meta?.production_type) errors.push("missing meta.production_type");
  if (!obj.meta?.scoring_schema_id) errors.push("missing meta.scoring_schema_id");
  if (typeof obj.strategic_snapshot !== "string") errors.push("missing strategic_snapshot");
  if (!obj.scores?.axes || !Array.isArray(obj.scores.axes) || obj.scores.axes.length < 3) errors.push("scores.axes must be array with ≥3 items");
  if (typeof obj.scores?.total !== "number") errors.push("missing scores.total");
  if (!Array.isArray(obj.scores?.caps_applied)) errors.push("missing scores.caps_applied");
  if (typeof obj.greenlight_probability !== "number") errors.push("missing greenlight_probability");
  if (typeof obj.lane_or_platform_target !== "string") errors.push("missing lane_or_platform_target");
  if (typeof obj.primary_obstacle !== "string") errors.push("missing primary_obstacle");
  if (typeof obj.fastest_path_to_close !== "string") errors.push("missing fastest_path_to_close");
  if (!Array.isArray(obj.tactical_moves) || obj.tactical_moves.length < 3) errors.push("tactical_moves must have ≥3 items");
  if (!["INVEST", "PASS", "ONLY_IF"].includes(obj.verdict)) errors.push("verdict must be INVEST|PASS|ONLY_IF");
  if (typeof obj.confidence !== "number") errors.push("missing confidence");
  if (!Array.isArray(obj.assumptions) || obj.assumptions.length < 2) errors.push("assumptions must have ≥2 items");
  return errors;
}

function tierToModel(tier: ModelTier): string {
  switch (tier) {
    case "REASONING_PREMIUM": return "google/gemini-2.5-pro";
    case "REASONING_STANDARD": return "google/gemini-3-flash-preview";
    case "FAST": return "google/gemini-2.5-flash";
  }
}

async function callAI(apiKey: string, model: string, system: string, user: string, temperature = 0.3): Promise<string> {
  const response = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
      temperature,
      max_tokens: 5000,
    }),
  });

  if (!response.ok) {
    if (response.status === 429) throw new Error("RATE_LIMIT");
    if (response.status === 402) throw new Error("PAYMENT_REQUIRED");
    const errText = await response.text();
    console.error("AI gateway error:", response.status, errText);
    throw new Error("AI analysis failed");
  }

  const data = await response.json();
  return data.choices?.[0]?.message?.content || "";
}

// ═══════════════════════════════════════════════════════════════
// MAIN HANDLER
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

    const { projectTitle, format, genres, lane, budget, scoringGrid, riskFlags, developmentTier, financeReadiness, coverageSummary } = await req.json();

    if (!projectTitle) {
      return new Response(JSON.stringify({ error: "Project title required" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // ── STEP 1: ROUTER (deterministic) ──
    const routerOutput = route(format);
    const model = tierToModel(routerOutput.model_tier);

    // ── GUARDRAILS ──
    const guardrails = buildGuardrailBlock({ productionType: format });
    console.log(`[greenlight-simulate] guardrails: profile=${guardrails.profileName}, hash=${guardrails.hash}`);

    // ── STEP 2: SPECIALIST CALL ──
    const specialistSystem = getSpecialistPrompt(routerOutput.production_type, routerOutput) + "\n" + guardrails.textBlock;

    const userPrompt = `PROJECT: ${projectTitle}
FORMAT: ${format || "Unknown"}
GENRES: ${(genres || []).join(", ") || "N/A"}
LANE: ${lane || "N/A"}
BUDGET: ${budget || "Not specified"}
${scoringGrid ? `COVERAGE SCORES: ${JSON.stringify(scoringGrid)}` : ""}
${riskFlags?.length ? `RISK FLAGS: ${riskFlags.join(", ")}` : ""}
${developmentTier ? `DEVELOPMENT TIER: ${developmentTier}` : ""}
${financeReadiness ? `FINANCE READINESS: ${financeReadiness}` : ""}
${coverageSummary ? `\nCOVERAGE SUMMARY:\n${coverageSummary.slice(0, 3000)}` : ""}

Run the full greenlight simulation. Return JSON only.`;

    const specialistRaw = await callAI(LOVABLE_API_KEY, model, specialistSystem, userPrompt);
    let specialistJSON: string;
    let specialistResult: any;

    try {
      specialistJSON = extractJSON(specialistRaw);
      specialistResult = JSON.parse(specialistJSON);
    } catch {
      console.error("Specialist JSON parse failed, attempting repair");
      // ── STEP 4a: REPAIR (specialist output) ──
      const repairRaw = await callAI(
        LOVABLE_API_KEY, "google/gemini-2.5-flash", REPAIR_PROMPT,
        `MALFORMED OUTPUT:\n${specialistRaw.slice(0, 4000)}\n\nFix this to match IFFY_ANALYSIS_V1. Return JSON only.`
      );
      try {
        specialistResult = JSON.parse(extractJSON(repairRaw));
      } catch {
        console.error("Repair also failed");
        throw new Error("Failed to parse AI response after repair attempt");
      }
    }

    // ── STEP 3: CALIBRATOR CALL ──
    const calibratorModel = "google/gemini-2.5-flash"; // Calibrator always uses fast model
    const calibratorUser = `PROJECT METADATA:
- Title: ${projectTitle}
- Format: ${format || "Unknown"}
- Budget: ${budget || "Not specified"}
- Production Type: ${routerOutput.production_type}
${routerOutput.routing_warnings.length ? `- Routing Warnings: ${routerOutput.routing_warnings.join("; ")}` : ""}

SPECIALIST OUTPUT:
${JSON.stringify(specialistResult, null, 2)}

Calibrate this analysis. Apply all rules. Return FINAL JSON only.`;

    const calibratorRaw = await callAI(LOVABLE_API_KEY, calibratorModel, CALIBRATOR_PROMPT, calibratorUser, 0.2);
    let finalResult: any;

    try {
      finalResult = JSON.parse(extractJSON(calibratorRaw));
    } catch {
      console.error("Calibrator JSON parse failed, attempting repair");
      // ── STEP 4b: REPAIR (calibrator output) ──
      const repairRaw = await callAI(
        LOVABLE_API_KEY, "google/gemini-2.5-flash", REPAIR_PROMPT,
        `MALFORMED OUTPUT:\n${calibratorRaw.slice(0, 4000)}\n\nFix this to match IFFY_ANALYSIS_V1. Return JSON only.`
      );
      try {
        finalResult = JSON.parse(extractJSON(repairRaw));
      } catch {
        // Fall back to specialist result if calibrator completely fails
        console.error("Calibrator repair failed, using specialist result");
        finalResult = specialistResult;
      }
    }

    // ── VALIDATION ──
    const validationErrors = validateAnalysisV1(finalResult);
    if (validationErrors.length > 0) {
      console.warn("Validation warnings:", validationErrors);
      // Attempt one more repair
      const repairRaw = await callAI(
        LOVABLE_API_KEY, "google/gemini-2.5-flash", REPAIR_PROMPT,
        `VALIDATION ERRORS: ${validationErrors.join(", ")}\n\nMALFORMED OUTPUT:\n${JSON.stringify(finalResult, null, 2).slice(0, 4000)}\n\nFix this to match IFFY_ANALYSIS_V1. Return JSON only.`
      );
      try {
        const repaired = JSON.parse(extractJSON(repairRaw));
        const reErrors = validateAnalysisV1(repaired);
        if (reErrors.length < validationErrors.length) {
          finalResult = repaired;
        }
      } catch {
        // Keep current result even if imperfect
      }
    }

    // Attach router metadata
    finalResult._router = {
      production_type: routerOutput.production_type,
      model_tier: routerOutput.model_tier,
      routing_warnings: routerOutput.routing_warnings,
    };

    return new Response(JSON.stringify(finalResult), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("greenlight-simulate error:", e);
    const msg = e instanceof Error ? e.message : "Unknown error";
    const status = msg === "RATE_LIMIT" ? 429 : msg === "PAYMENT_REQUIRED" ? 402 : 500;
    const userMsg = msg === "RATE_LIMIT" ? "Rate limit exceeded. Please try again in a moment."
      : msg === "PAYMENT_REQUIRED" ? "AI usage limit reached."
      : msg;
    return new Response(JSON.stringify({ error: userMsg }), {
      status, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
