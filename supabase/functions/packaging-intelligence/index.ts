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
      greenlightVerdict, greenlightSummary,
      coverageSummary, characters,
    } = await req.json();

    if (!projectTitle) {
      return new Response(JSON.stringify({ error: "Project title required" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) throw new Error("LOVABLE_API_KEY not configured");

    const systemPrompt = `You are IFFY — a Greenlight Architect operating as a senior independent producer assembling a financing and packaging strategy.

You think like: Financier + Sales Agent + Studio Executive + Aggressive Independent Producer.

Your job: analyse the project data and generate a comprehensive packaging & attachment intelligence report that directly supports greenlight probability.

Be practical, market-aware, and strategic. Avoid generic suggestions. Align all recommendations with the project's budget tier, genre lane, and format.
Never default to generic notes. Never analyse purely for craft. Always think in terms of greenlight reality and capital efficiency.

CALIBRATION RULES:
${scoringGrid ? `- Coverage scores provided: ${JSON.stringify(scoringGrid)}` : '- No coverage scores available'}
${riskFlags?.length ? `- Active risk flags: ${riskFlags.join(', ')}` : ''}
${developmentTier ? `- Development tier: ${developmentTier}` : ''}
${greenlightVerdict ? `- Greenlight verdict: ${greenlightVerdict}` : ''}
- Do NOT suggest unrealistic A-list talent for low-budget scripts
- Do NOT provide specific actor names — describe talent profiles instead
- Align talent suggestions with budget tier, genre lane, and role magnetism

You MUST return valid JSON with this exact structure:
{
  "package_profile": {
    "project_scale": "Micro Budget|Low Budget|Mid Budget|Studio Scale",
    "genre_position": "string (e.g. Commercial Genre, Prestige, Awards Facing, Streamer Binge Engine, Vertical High-Retention, Franchise Potential)",
    "attachment_leverage": "string (e.g. Director Driven, Cast Driven, IP Driven, Concept Driven, Awards Prestige, Low Budget ROI Play)"
  },
  "role_analysis": [
    {
      "character": "string",
      "role_type": "Lead|Supporting|Antagonist",
      "magnetism_score": 0-10,
      "rationale": "string",
      "casting_notes": "string"
    }
  ],
  "director_targeting": {
    "profile_type": "string (e.g. Emerging festival voice, Elevated genre specialist, Commercial action stylist, Prestige awards director, TV-to-film crossover, Vertical drama specialist)",
    "reasoning": "string",
    "finance_impact": "string"
  },
  "sales_positioning": {
    "international_appeal": { "score": 0-10, "rationale": "string" },
    "presales_viability": "Low|Moderate|Strong",
    "tax_incentive_dependency": "Low|Moderate|High",
    "equity_risk": "Low|Moderate|High",
    "risk_mitigation": ["string array of 2-4 mitigations if equity risk is moderate/high"]
  },
  "attachment_strategy": {
    "primary_path": "string",
    "secondary_path": "string",
    "tertiary_path": "string"
  },
  "heat_simulation": {
    "talent_heat": { "score": 0-10, "rationale": "string" },
    "market_moment": { "score": 0-10, "rationale": "string" },
    "festival_strategy": { "score": 0-10, "rationale": "string" },
    "streamer_pitch": { "score": 0-10, "rationale": "string" },
    "overall_confidence": 0-10
  },
  "castability_risk": true/false
}`;

    const characterBlock = characters?.length
      ? `\nKEY CHARACTERS:\n${characters.map((c: any) => `- ${c.name} (${c.gender || 'unknown'}, ${c.scene_count || '?'} scenes): ${c.bio || 'No bio'}`).join('\n')}`
      : '';

    const userPrompt = `PROJECT: ${projectTitle}
FORMAT: ${format || 'Unknown'}
GENRES: ${(genres || []).join(', ') || 'N/A'}
LANE: ${lane || 'N/A'}
BUDGET: ${budget || 'Not specified'}
${greenlightSummary ? `\nGREENLIGHT SUMMARY:\n${greenlightSummary.slice(0, 2000)}` : ''}
${coverageSummary ? `\nCOVERAGE SUMMARY:\n${coverageSummary.slice(0, 2000)}` : ''}
${characterBlock}

Run the full packaging & attachment intelligence analysis. Return JSON only.`;

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
      console.error("Failed to parse packaging response:", content.slice(0, 500));
      throw new Error("Failed to parse AI response");
    }

    return new Response(JSON.stringify(result), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("packaging-intelligence error:", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
