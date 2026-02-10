import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
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

    const { projectTitle, format, genres, budgetRange, tone, assignedLane } = await req.json();
    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) throw new Error("LOVABLE_API_KEY not configured");

    const prompt = `You are an expert film/TV casting strategist with deep knowledge of the independent and studio film landscape. Given a project, suggest 6 specific actors who would be realistic, appropriate, and strategically smart choices.

Project: "${projectTitle}"
Format: ${format}
Genres: ${genres?.join(', ')}
Budget: ${budgetRange}
Tone: ${tone}
Lane: ${assignedLane || 'unclassified'}

CRITICAL RULES:
1. Match talent to budget REALISTICALLY. A $5-15M film should not suggest A-list superstars who cost $20M+ per film. Think mid-tier talent with rising profiles, character actors with name recognition, or international stars with pre-sales value.
2. Genre and TONE are equally important. A light comedic heist film needs actors known for charisma and comic timing, not intense dramatic performers.
3. Consider current market standing and trajectory — actors who are trending upward or at their peak are more valuable than declining names.
4. Mix established names with exciting rising talent — this is how real independent films get packaged.
5. Include at least 1 non-US actor for international co-production and pre-sales value.
6. Each suggestion must include a concrete, specific reason why THIS actor fits THIS project.

For each suggestion provide:
- name: Full name of the talent
- role_type: "Lead", "Supporting Lead", "Ensemble" based on where they'd fit
- rationale: 2-3 sentences on why this specific person fits this specific project's genre, tone, and budget
- market_trajectory: "rising", "peak", "steady" - their current career trajectory
- territory_value: Which key territories their attachment would unlock for pre-sales`;

    const response = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${LOVABLE_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "google/gemini-3-flash-preview",
        messages: [
          { role: "system", content: "You are a film industry casting strategist who understands the relationship between talent, budget, genre, tone, and market value. You give realistic, actionable suggestions — not aspirational fantasy casting." },
          { role: "user", content: prompt },
        ],
        tools: [{
          type: "function",
          function: {
            name: "suggest_cast",
            description: "Return cast suggestions for the project.",
            parameters: {
              type: "object",
              properties: {
                suggestions: {
                  type: "array",
                  items: {
                    type: "object",
                    properties: {
                      name: { type: "string" },
                      role_type: { type: "string" },
                      rationale: { type: "string" },
                      market_trajectory: { type: "string" },
                      territory_value: { type: "string" },
                    },
                    required: ["name", "role_type", "rationale", "market_trajectory", "territory_value"],
                    additionalProperties: false,
                  },
                },
              },
              required: ["suggestions"],
              additionalProperties: false,
            },
          },
        }],
        tool_choice: { type: "function", function: { name: "suggest_cast" } },
      }),
    });

    if (!response.ok) {
      if (response.status === 429) {
        return new Response(JSON.stringify({ error: "Rate limited, please try again later." }), {
          status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      if (response.status === 402) {
        return new Response(JSON.stringify({ error: "Credits required." }), {
          status: 402, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      const t = await response.text();
      console.error("AI error:", response.status, t);
      throw new Error("AI gateway error");
    }

    const result = await response.json();
    const toolCall = result.choices?.[0]?.message?.tool_calls?.[0];
    if (!toolCall) throw new Error("No tool call in response");

    const parsed = JSON.parse(toolCall.function.arguments);

    return new Response(JSON.stringify(parsed), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("suggest-cast error:", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
