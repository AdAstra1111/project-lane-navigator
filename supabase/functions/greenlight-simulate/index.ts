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

    const { projectTitle, format, genres, lane, budget, scoringGrid, riskFlags, developmentTier, financeReadiness, coverageSummary } = await req.json();

    if (!projectTitle) {
      return new Response(JSON.stringify({ error: "Project title required" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) throw new Error("LOVABLE_API_KEY not configured");

    // Determine format type for prompt conditioning
    const formatLower = (format || "").toLowerCase();
    const isVertical = formatLower.includes("vertical");
    const isTV = formatLower.includes("series") || formatLower.includes("limited");

    const systemPrompt = `You are a senior streamer development executive running an internal greenlight simulation meeting.

Your job: stress-test this project's viability as if you were deciding whether to commission it for a major streaming platform (Netflix, Apple TV+, Amazon, HBO Max, Disney+).

Be blunt, strategic, and market-aware. Do NOT overinflate positivity. Streamers are risk-aware. Attention is currency. Hook clarity > thematic subtlety. Retention > closure.

CALIBRATION RULES:
${scoringGrid ? `- Coverage scores provided: ${JSON.stringify(scoringGrid)}` : '- No coverage scores available — evaluate from project metadata alone'}
${riskFlags?.length ? `- Active risk flags: ${riskFlags.join(', ')}` : ''}
${developmentTier ? `- Development tier: ${developmentTier}` : ''}
${financeReadiness ? `- Finance readiness: ${financeReadiness}` : ''}
- If structural strength < 6: Do NOT simulate greenlight optimism
- If commercial viability < 6: Flag heavy conditional path
- Use the scoring data to ground your assessment — don't contradict it

You MUST return valid JSON with this exact structure:
{
  "exec_summary": {
    "project_type": "string",
    "genre": "string",
    "target_audience": "string",
    "budget_estimate": "string",
    "monetisation_lane": "string",
    "format": "string"
  },
  "evaluation_axes": {
    "hook_immediacy": { "score": 0-10, "rationale": "string" },
    "audience_clarity": { "score": 0-10, "rationale": "string" },
    "retention_potential": { "score": 0-10, "rationale": "string" },
    "castability": { "score": 0-10, "rationale": "string" },
    "global_travelability": { "score": 0-10, "rationale": "string" },
    "budget_vs_subscriber_value": { "score": 0-10, "rationale": "string" }
  },
  "greenlight_verdict": "GREEN|YELLOW|RED",
  "verdict_reasoning": "string (concise executive tone)",
  "exec_notes": ["string array of 5-8 realistic executive comments/questions"],
  "strategic_adjustments": {
    "creative": "string",
    "packaging": "string",
    "budget": "string"
  }
}`;

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
        max_tokens: 3000,
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
