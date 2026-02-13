import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const { pitchIdea, expansion, productionType } = await req.json();
    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) throw new Error("LOVABLE_API_KEY not configured");

    const systemPrompt = `You are a ruthless concept stress-testing engine for ${productionType || 'film'} production. You evaluate expanded concepts across three dimensions, scoring each 0-100:

1. CREATIVE STRUCTURE (0-100): Does the concept hold up narratively? Evaluate:
   - Protagonist goal clarity and stakes
   - Structural integrity (acts, turning points, climax)
   - Thematic coherence and resonance
   - Character arc completeness
   - Originality vs derivative risk

2. MARKET ALIGNMENT (0-100): Is this commercially viable? Evaluate:
   - Genre clarity and audience targeting
   - Comparable title positioning
   - Budget-to-market-size ratio
   - Platform/distribution fit
   - Current market appetite for this type of content

3. ENGINE SUSTAINABILITY (0-100): Can this concept sustain development? Evaluate:
   - World expandability (sequels, spin-offs, adaptations)
   - IP ownership clarity
   - Production feasibility at stated budget
   - Talent attachability
   - Development timeline realism

For each dimension, provide:
- A score (0-100)
- 2-3 specific strengths
- 2-3 specific weaknesses/risks
- 1 critical question that must be answered

PASS THRESHOLD: Total average must be >= 70, and NO single dimension below 50.`;

    const userPrompt = `Stress test this concept:

TITLE: ${pitchIdea.title}
LOGLINE: ${pitchIdea.logline}
GENRE: ${pitchIdea.genre}
BUDGET: ${pitchIdea.budget_band}
LANE: ${pitchIdea.recommended_lane}
PRODUCTION TYPE: ${productionType || 'film'}

TREATMENT EXCERPT: ${(expansion.treatment || '').slice(0, 3000)}

CHARACTER BIBLE EXCERPT: ${(expansion.character_bible || '').slice(0, 2000)}

WORLD BIBLE EXCERPT: ${(expansion.world_bible || '').slice(0, 1500)}

TONE DOC EXCERPT: ${(expansion.tone_doc || '').slice(0, 1000)}

ARC MAP EXCERPT: ${(expansion.arc_map || '').slice(0, 1500)}

Score this concept ruthlessly.`;

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
        tools: [{
          type: "function",
          function: {
            name: "stress_test_results",
            description: "Return stress test scores and analysis",
            parameters: {
              type: "object",
              properties: {
                creative_structure: {
                  type: "object",
                  properties: {
                    score: { type: "number" },
                    strengths: { type: "array", items: { type: "string" } },
                    weaknesses: { type: "array", items: { type: "string" } },
                    critical_question: { type: "string" },
                  },
                  required: ["score", "strengths", "weaknesses", "critical_question"],
                },
                market_alignment: {
                  type: "object",
                  properties: {
                    score: { type: "number" },
                    strengths: { type: "array", items: { type: "string" } },
                    weaknesses: { type: "array", items: { type: "string" } },
                    critical_question: { type: "string" },
                  },
                  required: ["score", "strengths", "weaknesses", "critical_question"],
                },
                engine_sustainability: {
                  type: "object",
                  properties: {
                    score: { type: "number" },
                    strengths: { type: "array", items: { type: "string" } },
                    weaknesses: { type: "array", items: { type: "string" } },
                    critical_question: { type: "string" },
                  },
                  required: ["score", "strengths", "weaknesses", "critical_question"],
                },
                overall_verdict: { type: "string", description: "1-2 sentence overall assessment" },
              },
              required: ["creative_structure", "market_alignment", "engine_sustainability", "overall_verdict"],
              additionalProperties: false,
            },
          },
        }],
        tool_choice: { type: "function", function: { name: "stress_test_results" } },
      }),
    });

    if (!response.ok) {
      const t = await response.text();
      console.error("AI gateway error:", response.status, t);
      if (response.status === 429) return new Response(JSON.stringify({ error: "Rate limited" }), { status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      if (response.status === 402) return new Response(JSON.stringify({ error: "Credits required" }), { status: 402, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      throw new Error("AI gateway error");
    }

    const data = await response.json();
    const toolCall = data.choices?.[0]?.message?.tool_calls?.[0];
    if (!toolCall) throw new Error("No tool call in response");

    const results = JSON.parse(toolCall.function.arguments);
    const cs = results.creative_structure?.score || 0;
    const ma = results.market_alignment?.score || 0;
    const es = results.engine_sustainability?.score || 0;
    const total = Math.round((cs + ma + es) / 3);
    const passed = total >= 70 && cs >= 50 && ma >= 50 && es >= 50;

    return new Response(JSON.stringify({
      score_creative_structure: cs,
      score_market_alignment: ma,
      score_engine_sustainability: es,
      score_total: total,
      passed,
      details: results,
    }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("stress-test error:", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
