import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

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

    const {
      projectTitle, format, genres, lane, budget,
      scoringGrid, riskFlags, developmentTier,
      greenlightVerdict, packagingProfile,
      coverageSummary, castSummary,
    } = await req.json();

    if (!projectTitle) {
      return new Response(JSON.stringify({ error: "Project title required" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) throw new Error("LOVABLE_API_KEY not configured");

    const systemPrompt = `You are a senior independent film financier evaluating a project's financing viability.

Your job: simulate realistic independent film/TV financing logic including pre-sales, equity risk, tax incentives, and recoupment positioning.

Be measured, strategic, and realistic. Align with independent production realities. Avoid unrealistic optimism. Do not assume streamer acquisition unless justified.

CALIBRATION RULES:
${scoringGrid ? `- Coverage scores: ${JSON.stringify(scoringGrid)}` : '- No coverage scores available'}
${riskFlags?.length ? `- Risk flags: ${riskFlags.join(', ')}` : ''}
${developmentTier ? `- Development tier: ${developmentTier}` : ''}
${greenlightVerdict ? `- Greenlight verdict: ${greenlightVerdict}` : ''}
${packagingProfile ? `- Packaging profile: ${JSON.stringify(packagingProfile)}` : ''}
- Use Commercial Viability + Packaging scores as anchor
- If equity exceeds 50%: flag HIGH EQUITY EXPOSURE
- If pre-sales score < 6: flag PRE-SALES RISK

You MUST return valid JSON with this exact structure:
{
  "finance_profile": {
    "format": "string",
    "genre": "string",
    "budget_estimate": "string",
    "target_market": "Streamer|Theatrical|Hybrid|Vertical Platform",
    "primary_territories": ["string array"]
  },
  "presales_analysis": {
    "genre_marketability": { "score": 0-10, "rationale": "string" },
    "cast_value_leverage": { "score": 0-10, "rationale": "string" },
    "director_bankability": { "score": 0-10, "rationale": "string" },
    "comparable_titles": { "score": 0-10, "rationale": "string" },
    "presales_risk": true/false
  },
  "finance_stack": {
    "presales_pct": 0-100,
    "tax_incentives_pct": 0-100,
    "equity_pct": 0-100,
    "gap_pct": 0-100,
    "streamer_pct": 0-100,
    "negative_pickup_pct": 0-100,
    "high_equity_exposure": true/false,
    "stack_rationale": "string"
  },
  "risk_assessment": {
    "budget_risk": { "score": 0-10, "rationale": "string" },
    "cast_dependency": { "score": 0-10, "rationale": "string" },
    "market_timing": { "score": 0-10, "rationale": "string" },
    "recoupment_clarity": { "score": 0-10, "rationale": "string" },
    "overall_risk": "Low|Moderate|High"
  },
  "recoupment_simulation": {
    "waterfall": [
      { "position": 1, "tranche": "string", "estimated_pct": "string" }
    ],
    "roi_band": "Loss Likely|Break Even Possible|Moderate Upside|Strong Upside Potential",
    "roi_rationale": "string"
  },
  "finance_verdict": "GREEN|YELLOW|RED",
  "verdict_label": "string",
  "verdict_reasoning": "string",
  "improvement_strategies": {
    "budget_adjustment": "string",
    "attachment_upgrade": "string",
    "market_repositioning": "string"
  }
}`;

    const userPrompt = `PROJECT: ${projectTitle}
FORMAT: ${format || 'Unknown'}
GENRES: ${(genres || []).join(', ') || 'N/A'}
LANE: ${lane || 'N/A'}
BUDGET: ${budget || 'Not specified'}
${castSummary ? `\nCAST SUMMARY:\n${castSummary.slice(0, 1500)}` : ''}
${coverageSummary ? `\nCOVERAGE SUMMARY:\n${coverageSummary.slice(0, 2000)}` : ''}

Run the full finance & pre-sales prediction analysis. Return JSON only.`;

    const response = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${LOVABLE_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "google/gemini-3-flash-preview",
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
      console.error("Failed to parse finance response:", content.slice(0, 500));
      throw new Error("Failed to parse AI response");
    }

    return new Response(JSON.stringify(result), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("finance-predict error:", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
