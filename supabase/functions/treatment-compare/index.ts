import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const { treatmentText, scriptText, projectContext } = await req.json();

    if (!treatmentText || !scriptText) {
      return new Response(JSON.stringify({ error: "Both treatment and script text are required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) throw new Error("LOVABLE_API_KEY is not configured");

    const treatmentSnippet = treatmentText.slice(0, 30000);
    const scriptSnippet = scriptText.slice(0, 30000);

    const ctx = projectContext || {};
    const contextBlock = [
      ctx.title ? `Title: ${ctx.title}` : null,
      ctx.genres?.length ? `Genres: ${ctx.genres.join(", ")}` : null,
      ctx.format ? `Format: ${ctx.format}` : null,
      ctx.tone ? `Tone: ${ctx.tone}` : null,
      ctx.budget_range ? `Budget: ${ctx.budget_range}` : null,
      ctx.assigned_lane ? `Lane: ${ctx.assigned_lane}` : null,
      ctx.target_audience ? `Target Audience: ${ctx.target_audience}` : null,
      ctx.comparable_titles ? `Comparables: ${ctx.comparable_titles}` : null,
    ].filter(Boolean).join("\n");

    const systemPrompt = `You are IFFY — an elite film industry intelligence engine used by producers, sales agents, and development executives. You provide rigorous, commercially-grounded analysis.

You are comparing a TREATMENT (narrative prose document outlining the story) against the SCREENPLAY (the formatted script). Your job is to deliver a comprehensive, actionable deep-comparison.

Respond ONLY with valid JSON matching this exact structure:
{
  "overall_verdict": "string — one-paragraph executive summary of the comparison",
  "treatment_rating": {
    "score": number (0-100),
    "headline": "string — one-line verdict on the treatment",
    "strengths": ["string", "string", ...],
    "weaknesses": ["string", "string", ...]
  },
  "script_rating": {
    "score": number (0-100),
    "headline": "string — one-line verdict on the script",
    "strengths": ["string", "string", ...],
    "weaknesses": ["string", "string", ...]
  },
  "narrative_comparison": {
    "structural_alignment": "string — how closely the script follows the treatment structure",
    "character_evolution": "string — how characters developed from treatment to script",
    "tone_consistency": "string — whether tonal intent carried through",
    "pacing_analysis": "string — pacing differences between the two"
  },
  "commercial_analysis": {
    "market_positioning": "string — which version positions better commercially",
    "audience_clarity": "string — which version has clearer audience targeting",
    "packaging_leverage": "string — which version offers stronger packaging hooks",
    "budget_implications": "string — any budget impact from changes between versions"
  },
  "key_divergences": [
    {
      "area": "string — e.g. 'Act 2 Midpoint'",
      "treatment_approach": "string",
      "script_approach": "string",
      "verdict": "string — which is stronger and why"
    }
  ],
  "recommendations": ["string — actionable next steps", ...],
  "fidelity_score": number (0-100, how faithfully the script implements the treatment)
}`;

    const userPrompt = `PROJECT CONTEXT:
${contextBlock || "No additional context provided."}

===== TREATMENT TEXT =====
${treatmentSnippet}
${treatmentText.length > 30000 ? "\n[...truncated at 30,000 chars]" : ""}

===== SCREENPLAY TEXT =====
${scriptSnippet}
${scriptText.length > 30000 ? "\n[...truncated at 30,000 chars]" : ""}

Provide your deep comparison analysis now.`;

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
      }),
    });

    if (!response.ok) {
      if (response.status === 429) {
        return new Response(JSON.stringify({ error: "Rate limit exceeded. Please try again in a moment." }), {
          status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      if (response.status === 402) {
        return new Response(JSON.stringify({ error: "AI credits exhausted. Please add credits." }), {
          status: 402, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      const t = await response.text();
      console.error("AI gateway error:", response.status, t);
      throw new Error(`AI gateway error: ${response.status}`);
    }

    const data = await response.json();
    const raw = data.choices?.[0]?.message?.content || "";

    // Robust JSON extraction
    let cleaned = raw.replace(/```(?:json)?\s*/gi, "").replace(/```/g, "").trim();
    const firstBrace = cleaned.indexOf("{");
    const lastBrace = cleaned.lastIndexOf("}");
    if (firstBrace !== -1 && lastBrace !== -1) {
      cleaned = cleaned.slice(firstBrace, lastBrace + 1);
    }

    let parsed;
    try {
      parsed = JSON.parse(cleaned);
    } catch {
      console.error("Failed to parse AI response:", cleaned.slice(0, 500));
      return new Response(JSON.stringify({ error: "Failed to parse AI analysis. Please try again." }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    return new Response(JSON.stringify(parsed), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("treatment-compare error:", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
