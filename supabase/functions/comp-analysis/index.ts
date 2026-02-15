import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";
import { buildGuardrailBlock } from "../_shared/guardrails.ts";

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
    const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: claimsData, error: claimsError } = await supabase.auth.getClaims(authHeader.replace("Bearer ", ""));
    if (claimsError || !claimsData?.claims) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { title, format, genres, budget_range, tone, comparable_titles } = await req.json();

    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) throw new Error("LOVABLE_API_KEY not configured");
    const PERPLEXITY_API_KEY = Deno.env.get("PERPLEXITY_API_KEY");

    // ── STEP 1: Perplexity grounded research (if available) ──
    let groundedData = "";
    if (PERPLEXITY_API_KEY) {
      try {
        const searchQuery = `${title || ""} ${(genres || []).join(" ")} ${format || "film"} comparable movies box office performance budget ${comparable_titles || ""}`.trim();

        const perplexityResponse = await fetch("https://api.perplexity.ai/chat/completions", {
          method: "POST",
          headers: {
            Authorization: `Bearer ${PERPLEXITY_API_KEY}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            model: "sonar",
            messages: [
              {
                role: "system",
                content: "You are a film industry market researcher. Return factual data about comparable films/shows including real box office numbers, budgets, distribution deals, and awards. Be specific with numbers and sources. Focus on titles similar in genre, tone, and budget range to the project described.",
              },
              {
                role: "user",
                content: `Research comparable titles for a ${format || "feature film"} project: "${title || "Untitled"}". Genres: ${(genres || []).join(", ")}. Budget range: ${budget_range || "not specified"}. Tone: ${tone || "not specified"}. Creator-suggested comps: ${comparable_titles || "none"}. Find 4-6 comparable titles with real box office/streaming data, budgets, distribution info, and awards.`,
              },
            ],
            search_recency_filter: "year",
          }),
        });

        if (perplexityResponse.ok) {
          const pData = await perplexityResponse.json();
          const pContent = pData.choices?.[0]?.message?.content || "";
          const citations = pData.citations || [];
          groundedData = `\n\n=== GROUNDED RESEARCH DATA (from real-time web search) ===\n${pContent}\n\nSources: ${citations.join(", ")}\n=== END GROUNDED DATA ===`;
          console.log("Perplexity comp research complete, citations:", citations.length);
        } else {
          console.warn("Perplexity search failed:", perplexityResponse.status);
        }
      } catch (pErr) {
        console.warn("Perplexity lookup failed, proceeding with AI knowledge:", pErr);
      }
    }

    // ── STEP 2: Gemini strategic analysis ──
    const guardrails = buildGuardrailBlock({ productionType: format });
    console.log(`[comp-analysis] guardrails: profile=${guardrails.profileName}, hash=${guardrails.hash}`);

    const prompt = `You are a film industry market analyst. Given a project, identify 4-6 comparable titles that have been produced and released. For each, provide real market performance data.

${guardrails.textBlock}
${groundedData ? "\nIMPORTANT: Use the GROUNDED RESEARCH DATA below as your primary source of facts. Cross-reference and correct any data points using it. Prefer cited numbers over estimates." : ""}

Project:
- Title: ${title}
- Format: ${format}
- Genres: ${(genres || []).join(", ")}
- Budget Range: ${budget_range}
- Tone: ${tone}
- Creator Comparables: ${comparable_titles || "None provided"}
${groundedData}

For each comparable title, return:
- title: The film/show title
- year: Release year
- budget_estimate: Estimated production budget
- worldwide_gross: Worldwide box office (for films) or viewership metrics (for TV)
- distribution: How it was distributed (theatrical, streaming, hybrid)
- awards: Notable awards or nominations
- relevance: Why this is comparable (1-2 sentences)
- lesson: What the producer of the new project can learn from this title

Also provide:
- market_positioning: A 2-3 sentence summary of where this project sits in the current market
- packaging_insight: What talent/element would most improve this project's comparability to successful titles
- timing_note: Any timing considerations (genre fatigue, market appetite, etc.)

Return ONLY valid JSON with this structure:
{
  "comparables": [...],
  "market_positioning": "...",
  "packaging_insight": "...",
  "timing_note": "..."
}`;

    const response = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${LOVABLE_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "google/gemini-3-flash-preview",
        messages: [
          { role: "system", content: "You are a film industry market analyst with deep knowledge of box office performance, streaming data, and international sales. Return only valid JSON. When grounded research data is provided, prioritize those real numbers over estimates." },
          { role: "user", content: prompt },
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
        return new Response(JSON.stringify({ error: "AI credits exhausted. Please add credits to continue." }), {
          status: 402, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      throw new Error(`AI gateway error: ${response.status}`);
    }

    const aiData = await response.json();
    const content = aiData.choices?.[0]?.message?.content || "";
    const jsonMatch = content.match(/\{[\s\S]*\}/);
    if (!jsonMatch) throw new Error("Failed to parse AI response");

    const result = JSON.parse(jsonMatch[0]);

    return new Response(JSON.stringify(result), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("comp-analysis error:", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
