import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { buildGuardrailBlock } from "../_shared/guardrails.ts";

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

    const guardrails = buildGuardrailBlock({ productionType: ctx.format, engineName: "treatment-compare" });
    console.log(`[treatment-compare] guardrails: profile=${guardrails.profileName}, hash=${guardrails.hash}`);

    const systemPrompt = `You are IFFY — an elite film industry intelligence engine used by producers, sales agents, and development executives. You provide rigorous, commercially-grounded analysis.

${guardrails.textBlock}

CRITICAL FRAMING: The TREATMENT is NOT a standalone document to be rated as if it were a script. The treatment represents a PROPOSED ADAPTATION DIRECTION — a vision for how the story COULD be reshaped, restructured, or evolved. The SCREENPLAY is the current working draft.

Your job is to evaluate:
1. What narrative changes does the treatment propose vs the current script?
2. How would adopting the treatment's direction STRENGTHEN or WEAKEN the story?
3. What is the IMPACT on packaging, castability, commercial viability, and market positioning if the script were rewritten to follow the treatment's vision?
4. Which specific changes from the treatment should be adopted, which rejected, and why?

Think like a development executive deciding whether to greenlight a rewrite based on this treatment.

SCORING CONTEXT:
- "Story Strength" = how the treatment's proposed changes affect narrative power, emotional impact, structural integrity, and audience engagement
- "Package Impact" = how the treatment's direction affects lead role magnetism, director appeal, cast attachability, and sales leverage
- "Commercial Delta" = net gain or loss in commercial viability if the treatment direction is adopted
- "Adaptation Value" = how much the treatment offers genuine improvement vs cosmetic changes

Respond ONLY with valid JSON matching this exact structure:
{
  "overall_verdict": "string — executive summary: should the script be rewritten to follow this treatment direction? Clear recommendation with reasoning.",
  "adaptation_value": {
    "score": number (0-100, how valuable are the treatment's proposed changes),
    "headline": "string — one-line on whether this treatment direction is worth pursuing",
    "gains": ["string — specific narrative improvements the treatment would bring", ...],
    "risks": ["string — what the script would lose by following this direction", ...]
  },
  "current_script_assessment": {
    "score": number (0-100, current script story strength),
    "headline": "string — one-line on the script's current state",
    "strengths": ["string — what works well in the current script", ...],
    "vulnerabilities": ["string — weaknesses the treatment might address", ...]
  },
  "story_impact": {
    "structural_changes": "string — how the treatment restructures the narrative and whether that improves or weakens it",
    "character_impact": "string — how character arcs, motivations, and depth change — stronger or weaker?",
    "emotional_trajectory": "string — how the emotional journey shifts and whether it deepens audience engagement",
    "thematic_clarity": "string — whether the treatment sharpens or muddies the thematic core"
  },
  "package_impact": {
    "lead_role_magnetism": "string — does the treatment make the lead role more or less attractive to cast? Specific analysis.",
    "director_appeal": "string — does the treatment direction attract a stronger director profile? Which type?",
    "sales_leverage": "string — how does the treatment affect international pre-sales positioning?",
    "audience_targeting": "string — does the treatment narrow or broaden the audience? Better or worse?"
  },
  "commercial_delta": {
    "score": number (-50 to +50, net commercial gain/loss from adopting the treatment),
    "market_positioning_shift": "string — how market position changes",
    "budget_implications": "string — does the treatment push the budget up/down? Production complexity?",
    "festival_vs_commercial": "string — does it push more towards festival/prestige or commercial/wide release?"
  },
  "key_proposed_changes": [
    {
      "area": "string — e.g. 'Act 2 Midpoint', 'Protagonist Arc', 'Antagonist Role'",
      "current_script": "string — what the script currently does",
      "treatment_proposes": "string — what the treatment suggests instead",
      "impact_verdict": "string — ADOPT / REJECT / MODIFY — with clear reasoning on story and package impact"
    }
  ],
  "rewrite_recommendations": ["string — specific, actionable guidance for the next draft if treatment direction is adopted", ...],
  "adoption_score": number (0-100, overall recommendation strength for following this treatment direction)
}`;

    const userPrompt = `PROJECT CONTEXT:
${contextBlock || "No additional context provided."}

===== TREATMENT (Proposed Adaptation Direction) =====
${treatmentSnippet}
${treatmentText.length > 30000 ? "\n[...truncated at 30,000 chars]" : ""}

===== CURRENT SCREENPLAY =====
${scriptSnippet}
${scriptText.length > 30000 ? "\n[...truncated at 30,000 chars]" : ""}

Analyse the treatment as a proposed rewrite direction. Evaluate how adopting its changes would affect the story strength, package viability, and commercial positioning. Provide your deep comparison now.`;

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
