import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    // Auth check
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: claimsData, error: claimsError } = await supabase.auth.getClaims(authHeader.replace("Bearer ", ""));
    if (claimsError || !claimsData?.claims) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { scriptText, projectTitle, format, genres } = await req.json();

    if (!scriptText || scriptText.length < 100) {
      return new Response(JSON.stringify({ error: "Script text too short for coverage analysis" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) throw new Error("LOVABLE_API_KEY not configured");

    // Production type conditioning
    const FORMAT_LABELS: Record<string, string> = {
      film: 'Feature Film', 'tv-series': 'TV Series', documentary: 'Documentary Feature',
      'documentary-series': 'Documentary Series', commercial: 'Commercial / Advert',
      'branded-content': 'Branded Content', 'short-film': 'Short Film',
      'music-video': 'Music Video', 'proof-of-concept': 'Proof of Concept',
      'digital-series': 'Digital / Social Series', hybrid: 'Hybrid Project',
    };
    const formatLabel = FORMAT_LABELS[format] || 'Film';
    const isNarrativeFormat = ['film', 'tv-series', 'short-film'].includes(format);
    const isDocFormat = ['documentary', 'documentary-series'].includes(format);
    const isCommercialFormat = ['commercial', 'branded-content', 'music-video'].includes(format);

    const systemPrompt = `You are a professional script reader and coverage analyst working for a film/TV production company. You provide sharp, industry-standard coverage notes that help producers assess a project's viability.

PRODUCTION TYPE: ${formatLabel}
${isCommercialFormat ? 'Adapt your coverage for commercial/branded content — assess treatment strength, brand alignment, and visual concept rather than traditional narrative structure.' : ''}
${isDocFormat ? 'Adapt your coverage for documentary — assess subject access, editorial stance, archive potential, and impact potential rather than fictional narrative structure.' : ''}

Your coverage must include:
1. LOGLINE: A single compelling sentence (25 words max)
2. SYNOPSIS: 3-4 sentence summary covering setup, conflict, and resolution direction
3. THEMES: 3-5 key themes with one sentence each
4. STRUCTURAL ANALYSIS: Assessment of ${isCommercialFormat ? 'treatment structure, visual flow, and brand narrative' : isDocFormat ? 'subject access, editorial approach, and story arc' : 'act structure, pacing, and narrative momentum'} (3-4 sentences)
5. CHARACTER ANALYSIS: Brief assessment of ${isDocFormat ? 'subject complexity and narrative voice' : 'protagonist complexity, antagonist strength, and supporting cast'} (3-4 sentences)
6. COMPARABLE TITLES: 3-5 recent comparable ${formatLabel.toLowerCase()}s with brief reasoning
7. STRENGTHS: 3-5 bullet points of what works well
8. WEAKNESSES: 3-5 bullet points of areas that need work
9. MARKET POSITIONING: 2-3 sentences on where this sits in the current market
10. OVERALL RECOMMENDATION: One of CONSIDER / PASS / RECOMMEND with a 2-sentence justification

Be honest, specific, and cite moments from the script where possible. Avoid generic praise. Write as an experienced reader would for a sales company or financier.`;

    const userPrompt = `Provide professional script coverage for the following:

PROJECT: ${projectTitle || 'Untitled'}
FORMAT: ${formatLabel}
GENRES: ${(genres || []).join(', ') || 'Not specified'}

SCRIPT TEXT:
${scriptText.slice(0, 80000)}

${scriptText.length > 80000 ? '\n[Note: Script was truncated at 80,000 characters for analysis]' : ''}

Respond with a JSON object using these exact keys:
{
  "logline": "string",
  "synopsis": "string",
  "themes": [{"name": "string", "description": "string"}],
  "structural_analysis": "string",
  "character_analysis": "string",
  "comparable_titles": [{"title": "string", "reason": "string"}],
  "strengths": ["string"],
  "weaknesses": ["string"],
  "market_positioning": "string",
  "recommendation": "CONSIDER" | "PASS" | "RECOMMEND",
  "recommendation_reason": "string"
}`;

    const response = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${LOVABLE_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "google/gemini-2.5-flash",
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt },
        ],
        temperature: 0.3,
      }),
    });

    if (!response.ok) {
      if (response.status === 429) {
        return new Response(JSON.stringify({ error: "Rate limit exceeded. Please try again in a moment." }), {
          status: 429,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      if (response.status === 402) {
        return new Response(JSON.stringify({ error: "AI usage limit reached. Please add credits." }), {
          status: 402,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      const errText = await response.text();
      console.error("AI gateway error:", response.status, errText);
      throw new Error("AI analysis failed");
    }

    const aiData = await response.json();
    const content = aiData.choices?.[0]?.message?.content || "";

    // Parse JSON from response
    let coverage;
    try {
      const jsonMatch = content.match(/\{[\s\S]*\}/);
      coverage = jsonMatch ? JSON.parse(jsonMatch[0]) : JSON.parse(content);
    } catch {
      console.error("Failed to parse coverage JSON:", content.slice(0, 500));
      throw new Error("Failed to parse AI coverage response");
    }

    return new Response(JSON.stringify(coverage), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("script-coverage error:", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
