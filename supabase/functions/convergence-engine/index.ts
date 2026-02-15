import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import { buildGuardrailBlock } from "../_shared/guardrails.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

// ═══════════════════════════════════════════════════════════════
// CONVERGENCE ENGINE TYPES
// ═══════════════════════════════════════════════════════════════

type StrategicPriority = "PRESTIGE" | "BALANCED" | "COMMERCIAL_EXPANSION" | "CASHFLOW_STABILISATION";
type DevelopmentStage = "IDEA" | "EARLY_DRAFT" | "REDRAFT" | "PRE_PACKAGING" | "FINANCE";
type AnalysisMode = "CREATIVE_INTEGRITY" | "GREENLIGHT_ARCHITECT" | "DUAL";

interface ConvergenceOutput {
  executive_snapshot: string;
  creative_integrity_score: number;
  greenlight_probability: number;
  gap: number;
  allowed_gap: number;
  convergence_status: string;
  trajectory: string | null;
  primary_creative_risk: string;
  primary_commercial_risk: string;
  leverage_moves: string[];
  format_advisory: {
    triggered: boolean;
    alternative_formats?: string[];
    predicted_ci_impact?: string;
    predicted_gp_impact?: string;
    repositioning_risk?: string;
    advisory_verdict?: string;
    rationale?: string;
  } | null;
  executive_guidance: string;
  creative_detail?: any;
  greenlight_detail?: any;
}

// ═══════════════════════════════════════════════════════════════
// CONVERGENCE CALCULATOR (deterministic)
// ═══════════════════════════════════════════════════════════════

const BASE_TOLERANCE: Record<string, number> = {
  FEATURE_FILM: 25, TV_DRAMA: 20, LIMITED_SERIES: 30, VERTICAL_DRAMA: 15,
  DOC_FEATURE: 40, DOC_SERIES: 25, ANIM_FEATURE: 25, ANIM_SERIES: 20,
  REALITY: 15, BRANDED: 10, PODCAST_IP: 25, DIGITAL_FIRST: 15,
};

function budgetModifier(budget: string): number {
  const b = (budget || "").toLowerCase();
  if (b.includes("micro") || b.includes("low") || b.includes("under")) return 10;
  if (b.includes("high") || b.includes("big")) return -10;
  if (b.includes("mega") || b.includes("studio") || b.includes("100")) return -15;
  return 0;
}

function priorityModifier(priority: StrategicPriority): number {
  switch (priority) {
    case "PRESTIGE": return 10;
    case "BALANCED": return 0;
    case "COMMERCIAL_EXPANSION": return -10;
    case "CASHFLOW_STABILISATION": return -15;
  }
}

function classifyConvergence(gap: number, allowed: number): string {
  if (gap <= allowed) return "Healthy Divergence";
  if (gap <= allowed + 15) return "Strategic Tension";
  return "Dangerous Misalignment";
}

function classifyTrajectory(
  ci: number, gp: number, gap: number,
  prevCI?: number, prevGP?: number, prevGap?: number
): string | null {
  if (prevCI == null || prevGP == null || prevGap == null) return null;
  const gapDelta = gap - prevGap;
  const ciDelta = ci - prevCI;
  const gpDelta = gp - prevGP;
  if (gapDelta < -5 && ciDelta >= 0 && gpDelta >= 0) return "Converging";
  if (gapDelta > 5) return "Diverging";
  if (Math.abs(gapDelta) <= 3 && Math.abs(ciDelta) <= 3 && Math.abs(gpDelta) <= 3) return "Stalled";
  if (ciDelta < -5 && gpDelta >= 0) return "Eroding";
  if ((ciDelta > 0 || gpDelta > 0) && gapDelta <= 0) return "Improving";
  return "Stalled";
}

// ═══════════════════════════════════════════════════════════════
// FORMAT MAP
// ═══════════════════════════════════════════════════════════════

const FORMAT_TO_ENGINE: Record<string, string> = {
  film: "FEATURE_FILM", "tv-series": "TV_DRAMA", "limited-series": "LIMITED_SERIES",
  "vertical-drama": "VERTICAL_DRAMA", documentary: "DOC_FEATURE",
  "documentary-series": "DOC_SERIES", "hybrid-documentary": "DOC_FEATURE",
  "anim-feature": "ANIM_FEATURE", "anim-series": "ANIM_SERIES",
  reality: "REALITY", commercial: "BRANDED", "branded-content": "BRANDED",
  "podcast-ip": "PODCAST_IP", "digital-series": "DIGITAL_FIRST",
  "short-film": "FEATURE_FILM", "music-video": "BRANDED",
  "proof-of-concept": "FEATURE_FILM", hybrid: "DIGITAL_FIRST",
};

// ═══════════════════════════════════════════════════════════════
// AI PROMPTS
// ═══════════════════════════════════════════════════════════════

const CONVERGENCE_SYSTEM = `You are IFFY, a Creative–Commercial Alignment Architect.
You are not a script reader, film school tutor, or algorithmic optimizer.

Your purpose:
1) Protect originality.
2) Simulate real greenlight conditions.
3) Track convergence between art and commerce.
4) Advise — not dictate — on format repositioning.
5) Improve trajectory toward dual strength (high creative + high finance viability).

You must never override human decision-making. You provide structured executive insight only.

You MUST return ONLY valid JSON matching this exact structure (no prose, no markdown):
{
  "executive_snapshot": "3 blunt sentences",
  "creative_integrity": {
    "score": 0-100,
    "originality_delta": "vs market noise assessment",
    "emotional_conviction": "assessment",
    "thematic_coherence": "assessment",
    "voice_strength": "assessment",
    "directorial_magnetism": "assessment",
    "scene_memorability": "assessment",
    "risk_taking_value": "assessment",
    "edge_retention": "assessment (especially if redraft)",
    "flags": ["Identity Erosion" or "Productive Refinement" if applicable]
  },
  "greenlight_probability": {
    "score": 0-100,
    "packaging_probability": "assessment",
    "finance_viability": "assessment",
    "lane_clarity": "assessment",
    "market_timing": "assessment",
    "risk_exposure": "assessment",
    "travelability": "assessment if relevant",
    "detail": "any type-specific assessment"
  },
  "primary_creative_risk": "one sentence",
  "primary_commercial_risk": "one sentence",
  "leverage_moves": ["3 highest-leverage moves"],
  "format_advisory": {
    "triggered": true/false,
    "alternative_formats": ["if triggered"],
    "predicted_ci_impact": "↑ / ↓ / Neutral",
    "predicted_gp_impact": "↑ / ↓ / Neutral",
    "repositioning_risk": "assessment",
    "advisory_verdict": "Stay Course | Explore Parallel Outline | Consider Strategic Reposition",
    "rationale": "why"
  },
  "executive_guidance": "Accelerate | Refine | Protect & Rebuild | Reposition (Advisory Only) | Hold"
}`;

function buildUserPrompt(params: any): string {
  return `PROJECT: ${params.projectTitle}
FORMAT: ${params.format || "Unknown"}
PRODUCTION TYPE: ${params.productionType}
GENRES: ${(params.genres || []).join(", ") || "N/A"}
LANE: ${params.lane || "N/A"}
BUDGET: ${params.budget || "Not specified"}
STRATEGIC PRIORITY: ${params.strategicPriority}
DEVELOPMENT STAGE: ${params.developmentStage}
ANALYSIS MODE: ${params.analysisMode}
${params.previousCreativeScore != null ? `PREVIOUS CREATIVE SCORE: ${params.previousCreativeScore}` : ""}
${params.previousGreenlightScore != null ? `PREVIOUS GREENLIGHT SCORE: ${params.previousGreenlightScore}` : ""}
${params.previousGap != null ? `PREVIOUS GAP: ${params.previousGap}` : ""}
${params.coverageSummary ? `\nCOVERAGE SUMMARY:\n${params.coverageSummary.slice(0, 3000)}` : ""}
${params.scoringGrid ? `COVERAGE SCORES: ${JSON.stringify(params.scoringGrid)}` : ""}
${params.riskFlags?.length ? `RISK FLAGS: ${params.riskFlags.join(", ")}` : ""}

Run full Creative–Commercial Convergence analysis. Return JSON only.
${params.analysisMode === "CREATIVE_INTEGRITY" ? "Focus primarily on Creative Integrity with minimal greenlight commentary." : ""}
${params.analysisMode === "GREENLIGHT_ARCHITECT" ? "Focus primarily on Greenlight probability with minimal creative commentary." : ""}
${params.analysisMode === "DUAL" ? "Give equal weight to both Creative Integrity and Greenlight probability." : ""}

Format Advisory should ONLY be triggered if convergence is dangerous or GP < 50 after iterations.`;
}

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

async function callAI(apiKey: string, model: string, system: string, user: string, temperature = 0.3): Promise<string> {
  const response = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model, messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
      temperature, max_tokens: 5000,
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

    const body = await req.json();
    const {
      projectId, projectTitle, format, genres, lane, budget,
      scoringGrid, riskFlags, coverageSummary,
      strategicPriority = "BALANCED",
      developmentStage = "IDEA",
      analysisMode = "DUAL",
      previousCreativeScore, previousGreenlightScore, previousGap,
    } = body;

    if (!projectTitle) {
      return new Response(JSON.stringify({ error: "Project title required" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const productionType = FORMAT_TO_ENGINE[(format || "").toLowerCase()] || "FEATURE_FILM";

    // Use Tier 1 model for dual analysis
    const model = "google/gemini-2.5-pro";

    const userPrompt = buildUserPrompt({
      projectTitle, format, productionType, genres, lane, budget,
      strategicPriority, developmentStage, analysisMode,
      previousCreativeScore, previousGreenlightScore, previousGap,
      coverageSummary, scoringGrid, riskFlags,
    });

    // Inject guardrails
    const guardrails = buildGuardrailBlock({ productionType: format || "film" });
    const guardrailedSystem = `${CONVERGENCE_SYSTEM}\n${guardrails.textBlock}`;
    console.log(`[convergence-engine] guardrails: profile=${guardrails.profileName}, hash=${guardrails.hash}`);

    const raw = await callAI(LOVABLE_API_KEY, model, guardrailedSystem, userPrompt);
    let parsed: any;

    try {
      parsed = JSON.parse(extractJSON(raw));
    } catch {
      // Repair attempt
      const repairRaw = await callAI(
        LOVABLE_API_KEY, "google/gemini-2.5-flash",
        `You are IFFY_JSON_REPAIR. Fix this malformed JSON to match the convergence output schema. Return JSON ONLY.`,
        `MALFORMED:\n${raw.slice(0, 4000)}\n\nFix and return valid JSON.`
      );
      try {
        parsed = JSON.parse(extractJSON(repairRaw));
      } catch {
        throw new Error("Failed to parse convergence analysis");
      }
    }

    // Extract scores
    const ciScore = parsed.creative_integrity?.score ?? parsed.creative_integrity_score ?? 50;
    const gpScore = parsed.greenlight_probability?.score ?? parsed.greenlight_probability ?? 50;
    const gap = Math.abs(ciScore - gpScore);

    // Calculate allowed gap
    const baseTolerance = BASE_TOLERANCE[productionType] ?? 25;
    const budgetMod = budgetModifier(budget || "");
    const priorityMod = priorityModifier(strategicPriority as StrategicPriority);
    const allowedGap = Math.max(5, baseTolerance + budgetMod + priorityMod);

    // Classify
    const convergenceStatus = classifyConvergence(gap, allowedGap);
    const trajectory = classifyTrajectory(
      ciScore, gpScore, gap,
      previousCreativeScore, previousGreenlightScore, previousGap
    );

    // Check if format advisory should be triggered
    const formatAdvisory = parsed.format_advisory || null;
    if (formatAdvisory && !formatAdvisory.triggered) {
      // Force trigger check
      if (convergenceStatus === "Dangerous Misalignment" || gpScore < 50) {
        formatAdvisory.triggered = true;
      }
    }

    const result: ConvergenceOutput = {
      executive_snapshot: parsed.executive_snapshot || "",
      creative_integrity_score: ciScore,
      greenlight_probability: gpScore,
      gap,
      allowed_gap: allowedGap,
      convergence_status: convergenceStatus,
      trajectory,
      primary_creative_risk: parsed.primary_creative_risk || "",
      primary_commercial_risk: parsed.primary_commercial_risk || "",
      leverage_moves: parsed.leverage_moves || [],
      format_advisory: formatAdvisory,
      executive_guidance: parsed.executive_guidance || "Refine",
      creative_detail: parsed.creative_integrity,
      greenlight_detail: parsed.greenlight_probability,
    };

    // Save to DB
    try {
      const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
      const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
      const supabase = createClient(supabaseUrl, supabaseKey);

      // Extract user_id from JWT
      const token = authHeader.replace("Bearer ", "");
      const { data: { user } } = await supabase.auth.getUser(token);

      if (user && projectId) {
        await supabase.from("convergence_scores").insert({
          project_id: projectId,
          user_id: user.id,
          creative_integrity_score: ciScore,
          greenlight_probability: gpScore,
          gap,
          allowed_gap: allowedGap,
          convergence_status: convergenceStatus,
          trajectory,
          strategic_priority: strategicPriority,
          development_stage: developmentStage,
          analysis_mode: analysisMode,
          executive_snapshot: result.executive_snapshot,
          primary_creative_risk: result.primary_creative_risk,
          primary_commercial_risk: result.primary_commercial_risk,
          leverage_moves: result.leverage_moves,
          format_advisory: result.format_advisory,
          executive_guidance: result.executive_guidance,
          full_result: result,
        });
      }
    } catch (dbErr) {
      console.error("Failed to save convergence score:", dbErr);
      // Non-fatal — still return result
    }

    return new Response(JSON.stringify(result), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("convergence-engine error:", e);
    const msg = e instanceof Error ? e.message : "Unknown error";
    const status = msg === "RATE_LIMIT" ? 429 : msg === "PAYMENT_REQUIRED" ? 402 : 500;
    const userMsg = msg === "RATE_LIMIT" ? "Rate limit exceeded. Please try again in a moment."
      : msg === "PAYMENT_REQUIRED" ? "AI usage limit reached." : msg;
    return new Response(JSON.stringify({ error: userMsg }), {
      status, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
