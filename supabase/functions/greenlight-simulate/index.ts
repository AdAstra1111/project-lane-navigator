import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

// ─── Production-Type Greenlight Configs ───

interface GreenlightAxis {
  key: string;
  label: string;
  max: number;
}

interface GreenlightConfig {
  psychology: string;
  axes: GreenlightAxis[];
  budgetRules: string;
  mandatoryOutputs: string[];
}

const GREENLIGHT_CONFIGS: Record<string, GreenlightConfig> = {
  film: {
    psychology: "Financier + Sales Agent + Studio Executive",
    axes: [
      { key: "conviction_cultural_force", label: "Conviction & Cultural Force", max: 15 },
      { key: "script_power", label: "Script Power", max: 15 },
      { key: "commercial_positioning", label: "Commercial Positioning", max: 15 },
      { key: "packaging_leverage", label: "Packaging Leverage", max: 15 },
      { key: "finance_structure_viability", label: "Finance Structure Viability", max: 15 },
      { key: "global_travelability", label: "Global Travelability", max: 10 },
      { key: "market_heat_timing", label: "Market Heat & Timing", max: 10 },
      { key: "execution_risk", label: "Execution Risk", max: 5 },
    ],
    budgetRules: `- If budget > $15M: Packaging and Finance must score ≥10 or cap greenlight probability at 55%.
- If budget < $5M: Script Power must score ≥11 or cap at 60%.`,
    mandatoryOutputs: [
      "greenlight_probability_pct",
      "correct_lane (Studio / Streamer / Sales-Driven Indie / Prestige Festival / Hybrid)",
      "primary_obstacle",
      "fastest_path_to_close",
      "financier_verdict (Invest / Pass / Only If…)",
    ],
  },
  "tv-series": {
    psychology: "Commissioning Executive + Streamer Strategy Head",
    axes: [
      { key: "series_engine_strength", label: "Series Engine Strength", max: 20 },
      { key: "pilot_impact", label: "Pilot Impact", max: 15 },
      { key: "season_arc_runway", label: "Season Arc & Future Runway", max: 15 },
      { key: "character_returnability", label: "Character Returnability", max: 15 },
      { key: "showrunner_room_viability", label: "Showrunner & Room Viability", max: 15 },
      { key: "platform_mandate_alignment", label: "Platform Mandate Alignment", max: 10 },
      { key: "international_copro_value", label: "International Co-Production Value", max: 5 },
      { key: "production_scalability", label: "Production Scalability", max: 5 },
    ],
    budgetRules: `- If series engine score < 15: cap greenlight probability at 40%.
- If platform mandate alignment < 6: flag PLATFORM FIT RISK.`,
    mandatoryOutputs: [
      "renewal_probability",
      "ideal_season_order (6 / 8 / 10)",
      "cancellation_risk",
      "platform_target",
      "greenlight_probability_pct",
    ],
  },
  documentary: {
    psychology: "Festival Programmer + Broadcaster + Grant Evaluator",
    axes: [
      { key: "access_exclusivity", label: "Access & Exclusivity", max: 25 },
      { key: "subject_urgency", label: "Subject Urgency", max: 20 },
      { key: "festival_positioning", label: "Festival Positioning", max: 15 },
      { key: "impact_funding_potential", label: "Impact Funding Potential", max: 15 },
      { key: "broadcaster_appeal", label: "Broadcaster Appeal", max: 10 },
      { key: "global_relevance", label: "Global Relevance", max: 10 },
      { key: "archive_strength", label: "Archive Strength", max: 5 },
    ],
    budgetRules: `- If access score < 15: cap greenlight probability at 35%.
- If subject urgency < 12: flag RELEVANCE RISK.`,
    mandatoryOutputs: [
      "grant_potential",
      "impact_investor_appeal",
      "festival_tier_target",
      "distribution_risk",
      "greenlight_probability_pct",
    ],
  },
  "documentary-series": {
    psychology: "True Crime / Topic Momentum Commissioner",
    axes: [
      { key: "episodic_reveal_structure", label: "Episodic Reveal Structure", max: 20 },
      { key: "ongoing_narrative_tension", label: "Ongoing Narrative Tension", max: 20 },
      { key: "platform_appetite", label: "Platform Appetite", max: 15 },
      { key: "access_credibility", label: "Access & Credibility", max: 15 },
      { key: "audience_hook_strength", label: "Audience Hook Strength", max: 15 },
      { key: "international_appeal", label: "International Appeal", max: 10 },
      { key: "production_practicality", label: "Production Practicality", max: 5 },
    ],
    budgetRules: `- If episodic reveal structure < 12: flag STRUCTURE RISK.
- If audience hook < 10: cap greenlight probability at 40%.`,
    mandatoryOutputs: [
      "completion_retention_likelihood",
      "platform_target",
      "greenlight_probability_pct",
    ],
  },
  "hybrid-documentary": {
    psychology: "Festival Programmer + Broadcaster + Grant Evaluator + Innovation Commissioner",
    axes: [
      { key: "access_exclusivity", label: "Access & Exclusivity", max: 20 },
      { key: "subject_urgency", label: "Subject Urgency", max: 15 },
      { key: "hybrid_innovation", label: "Hybrid Innovation", max: 15 },
      { key: "festival_positioning", label: "Festival Positioning", max: 15 },
      { key: "impact_funding_potential", label: "Impact Funding Potential", max: 10 },
      { key: "broadcaster_appeal", label: "Broadcaster Appeal", max: 10 },
      { key: "global_relevance", label: "Global Relevance", max: 10 },
      { key: "archive_strength", label: "Archive Strength", max: 5 },
    ],
    budgetRules: `- If access score < 12: cap greenlight probability at 35%.`,
    mandatoryOutputs: [
      "grant_potential",
      "festival_tier_target",
      "distribution_risk",
      "greenlight_probability_pct",
    ],
  },
  "vertical-drama": {
    psychology: "Platform Algorithm Strategist + Volume Producer",
    axes: [
      { key: "hook_first_30_seconds", label: "Hook in First 30 Seconds", max: 20 },
      { key: "cliffhanger_density", label: "Cliffhanger Density", max: 20 },
      { key: "episode_velocity", label: "Episode Velocity", max: 15 },
      { key: "addictive_character_dynamics", label: "Addictive Character Dynamics", max: 15 },
      { key: "production_speed_feasibility", label: "Production Speed Feasibility", max: 10 },
      { key: "cost_efficiency", label: "Cost Efficiency", max: 10 },
      { key: "platform_trend_alignment", label: "Platform Trend Alignment", max: 10 },
    ],
    budgetRules: `- This is addiction economics, not prestige economics.
- If hook score < 14: cap greenlight probability at 30%.
- If cliffhanger density < 14: flag RETENTION RISK.`,
    mandatoryOutputs: [
      "completion_probability",
      "binge_potential",
      "volume_scalability",
      "monetisation_model_fit",
      "greenlight_probability_pct",
    ],
  },
  commercial: {
    psychology: "Brand Strategist + Client ROI Evaluator",
    axes: [
      { key: "brand_alignment", label: "Brand Alignment", max: 25 },
      { key: "measurable_outcome_clarity", label: "Measurable Outcome Clarity", max: 20 },
      { key: "viral_shareability", label: "Viral / Shareability Potential", max: 15 },
      { key: "budget_efficiency", label: "Budget Efficiency", max: 15 },
      { key: "delivery_speed", label: "Delivery Speed", max: 15 },
      { key: "audience_target_accuracy", label: "Audience Target Accuracy", max: 10 },
    ],
    budgetRules: `- If brand alignment < 18: flag CLIENT RISK.
- If measurable outcome clarity < 14: cap greenlight probability at 45%.`,
    mandatoryOutputs: [
      "roi_logic",
      "client_retention_potential",
      "execution_risk",
      "greenlight_probability_pct",
    ],
  },
  "branded-content": {
    psychology: "Brand Strategist + Client ROI Evaluator",
    axes: [
      { key: "brand_alignment", label: "Brand Alignment", max: 25 },
      { key: "measurable_outcome_clarity", label: "Measurable Outcome Clarity", max: 20 },
      { key: "viral_shareability", label: "Viral / Shareability Potential", max: 15 },
      { key: "budget_efficiency", label: "Budget Efficiency", max: 15 },
      { key: "delivery_speed", label: "Delivery Speed", max: 15 },
      { key: "audience_target_accuracy", label: "Audience Target Accuracy", max: 10 },
    ],
    budgetRules: `- If brand alignment < 18: flag CLIENT RISK.`,
    mandatoryOutputs: [
      "roi_logic",
      "client_retention_potential",
      "execution_risk",
      "greenlight_probability_pct",
    ],
  },
  "short-film": {
    psychology: "Festival Programmer + Talent Scout + Development Executive",
    axes: [
      { key: "conviction_cultural_force", label: "Conviction & Cultural Force", max: 20 },
      { key: "script_power", label: "Script Power", max: 20 },
      { key: "festival_positioning", label: "Festival Positioning", max: 20 },
      { key: "talent_showcase", label: "Talent Showcase Value", max: 15 },
      { key: "feature_expansion_potential", label: "Feature Expansion Potential", max: 15 },
      { key: "execution_feasibility", label: "Execution Feasibility", max: 10 },
    ],
    budgetRules: `- Short films are evaluated for festival strategy and talent launchpad potential, not commercial ROI.`,
    mandatoryOutputs: [
      "festival_tier_target",
      "feature_expansion_viability",
      "talent_launchpad_value",
      "greenlight_probability_pct",
    ],
  },
  "music-video": {
    psychology: "Commissioner + Visual Strategist + Social Amplification Expert",
    axes: [
      { key: "visual_concept_strength", label: "Visual Concept Strength", max: 25 },
      { key: "artist_brand_alignment", label: "Artist Brand Alignment", max: 20 },
      { key: "social_amplification", label: "Social Amplification Potential", max: 20 },
      { key: "director_vision", label: "Director Vision", max: 15 },
      { key: "budget_execution_fit", label: "Budget / Execution Fit", max: 10 },
      { key: "awards_portfolio", label: "Awards / Portfolio Value", max: 10 },
    ],
    budgetRules: `- If visual concept < 18: flag CONCEPT RISK.`,
    mandatoryOutputs: [
      "social_impact_prediction",
      "awards_potential",
      "greenlight_probability_pct",
    ],
  },
  "proof-of-concept": {
    psychology: "Development Executive + Investor Pitch Evaluator",
    axes: [
      { key: "ip_demonstration", label: "IP Demonstration Strength", max: 25 },
      { key: "feature_series_viability", label: "Feature/Series Viability", max: 25 },
      { key: "investor_pitch_readiness", label: "Investor Pitch Readiness", max: 20 },
      { key: "technical_showcase", label: "Technical Showcase Quality", max: 15 },
      { key: "execution_feasibility", label: "Execution Feasibility", max: 15 },
    ],
    budgetRules: `- Evaluated as a strategic tool to unlock bigger production, not a finished product.`,
    mandatoryOutputs: [
      "development_path",
      "investor_appeal",
      "greenlight_probability_pct",
    ],
  },
  "digital-series": {
    psychology: "Algorithm + Influencer Strategist",
    axes: [
      { key: "algorithm_compatibility", label: "Algorithm Compatibility", max: 20 },
      { key: "influencer_leverage", label: "Influencer Leverage", max: 20 },
      { key: "shareability", label: "Shareability", max: 15 },
      { key: "speed_to_market", label: "Speed to Market", max: 15 },
      { key: "monetisation_mix", label: "Monetisation Mix", max: 15 },
      { key: "audience_growth_flywheel", label: "Audience Growth Flywheel", max: 15 },
    ],
    budgetRules: `- If algorithm compatibility < 14: flag PLATFORM FIT RISK.`,
    mandatoryOutputs: [
      "viral_probability",
      "platform_fit",
      "monetisation_path",
      "greenlight_probability_pct",
    ],
  },
  hybrid: {
    psychology: "Innovation Commissioner + Cross-Platform Strategist",
    axes: [
      { key: "cross_platform_strength", label: "Cross-Platform Strength", max: 20 },
      { key: "innovation_factor", label: "Innovation Factor", max: 20 },
      { key: "audience_engagement", label: "Audience Engagement Potential", max: 15 },
      { key: "funding_eligibility", label: "Innovation Fund Eligibility", max: 15 },
      { key: "execution_complexity", label: "Execution Complexity", max: 15 },
      { key: "market_timing", label: "Market Timing", max: 15 },
    ],
    budgetRules: `- Hybrid projects are evaluated for cross-platform innovation, not single-format ROI.`,
    mandatoryOutputs: [
      "cross_platform_viability",
      "innovation_fund_potential",
      "greenlight_probability_pct",
    ],
  },
};

function getConfig(format: string): GreenlightConfig {
  const key = (format || "film").toLowerCase();
  return GREENLIGHT_CONFIGS[key] || GREENLIGHT_CONFIGS.film;
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } }
    );

    const token = authHeader.replace("Bearer ", "");
    const { data: claimsData, error: claimsError } = await supabase.auth.getClaims(token);
    if (claimsError || !claimsData?.claims) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { projectTitle, format, genres, lane, budget, scoringGrid, riskFlags, developmentTier, financeReadiness, coverageSummary } = await req.json();

    if (!projectTitle) {
      return new Response(JSON.stringify({ error: "Project title required" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) throw new Error("LOVABLE_API_KEY not configured");

    const config = getConfig(format);

    // Build dynamic axes JSON schema
    const axesSchema = config.axes.map(a =>
      `    "${a.key}": { "score": 0-${a.max}, "rationale": "string" }`
    ).join(",\n");

    const mandatoryOutputsBlock = config.mandatoryOutputs.map(o => `  - ${o}`).join("\n");

    const systemPrompt = `You are IFFY — a Greenlight Architect.

You are NOT a script reader. You are NOT a film school tutor.

You think like:
${config.psychology}

Your job: determine whether this project can realistically be financed, commissioned, produced, and monetised in the current market.

You evaluate based on capital efficiency, packaging leverage, market appetite, structural sustainability, and execution risk.

Never default to generic notes. Never analyse purely for craft. Always think in terms of greenlight reality.

PRODUCTION TYPE: ${format || 'film'}
PRIMARY PSYCHOLOGY: ${config.psychology}

SCORING SYSTEM (100 pts total):
${config.axes.map(a => `- ${a.label} (0–${a.max})`).join("\n")}

BUDGET RULES:
${config.budgetRules}

CALIBRATION RULES:
${scoringGrid ? `- Coverage scores provided: ${JSON.stringify(scoringGrid)}` : '- No coverage scores available — evaluate from project metadata alone'}
${riskFlags?.length ? `- Active risk flags: ${riskFlags.join(', ')}` : ''}
${developmentTier ? `- Development tier: ${developmentTier}` : ''}
${financeReadiness ? `- Finance readiness: ${financeReadiness}` : ''}
- If structural scores are weak: Do NOT simulate greenlight optimism
- Use the scoring data to ground your assessment — don't contradict it

MANDATORY OUTPUTS:
${mandatoryOutputsBlock}

You MUST return valid JSON with this exact structure:
{
  "strategic_snapshot": "string (3 blunt executive sentences)",
  "evaluation_axes": {
${axesSchema}
  },
  "total_score": 0-100,
  "greenlight_probability_pct": 0-100,
  "greenlight_verdict": "GREEN|YELLOW|RED",
  "correct_lane": "string",
  "primary_obstacle": "string",
  "fastest_path_to_close": "string",
  "tactical_moves": ["string array of exactly 3 tactical moves"],
  "financier_verdict": "string (Invest / Pass / Only If… with reasoning)",
  "verdict_reasoning": "string (concise executive tone)",
  "mandatory_outputs": {${config.mandatoryOutputs.map(o => `\n    "${o.split(' ')[0]}": "string"`).join(',')}
  },
  "axes_config": ${JSON.stringify(config.axes)}
}

Do not soften analysis. Do not default to creative writing notes. This is an internal capital allocation system.
The purpose is simple: Move projects toward greenlight — or kill them early.`;

    const userPrompt = `PROJECT: ${projectTitle}
FORMAT: ${format || 'Unknown'}
GENRES: ${(genres || []).join(', ') || 'N/A'}
LANE: ${lane || 'N/A'}
BUDGET: ${budget || 'Not specified'}
${coverageSummary ? `\nCOVERAGE SUMMARY:\n${coverageSummary.slice(0, 3000)}` : ''}

Run the full greenlight simulation. Return JSON only.`;

    const response = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${LOVABLE_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "google/gemini-2.5-pro",
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt },
        ],
        temperature: 0.3,
        max_tokens: 4000,
      }),
    });

    if (!response.ok) {
      if (response.status === 429) {
        return new Response(JSON.stringify({ error: "Rate limit exceeded. Please try again in a moment." }), {
          status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      if (response.status === 402) {
        return new Response(JSON.stringify({ error: "AI usage limit reached." }), {
          status: 402, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      const errText = await response.text();
      console.error("AI gateway error:", response.status, errText);
      throw new Error("AI analysis failed");
    }

    const aiData = await response.json();
    let content = aiData.choices?.[0]?.message?.content || "";

    // Robust JSON extraction
    content = content.replace(/^```[\s\S]*?\n/, "").replace(/\n?```\s*$/, "");
    if (!content.trim().startsWith("{")) {
      const objStart = content.indexOf("{");
      if (objStart >= 0) content = content.slice(objStart);
    }
    const lastBrace = content.lastIndexOf("}");
    if (lastBrace >= 0) content = content.slice(0, lastBrace + 1);

    let result;
    try {
      result = JSON.parse(content.trim());
    } catch (e) {
      console.error("Failed to parse greenlight response:", content.slice(0, 500));
      throw new Error("Failed to parse AI response");
    }

    // Ensure axes_config is always present for the frontend
    if (!result.axes_config) {
      result.axes_config = config.axes;
    }

    return new Response(JSON.stringify(result), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("greenlight-simulate error:", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }), {
      status: e instanceof Error && e.message.includes("Rate limit") ? 429 : 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
