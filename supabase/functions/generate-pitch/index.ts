import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const { productionType, genre, budgetBand, region, platformTarget, riskLevel, count, coverageContext, feedbackContext } = await req.json();

    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) throw new Error("LOVABLE_API_KEY not configured");

    const typeLabel = productionType || "film";
    const coverageSection = coverageContext
      ? `\n\nEXISTING COVERAGE CONTEXT (generate pivot pitches based on this):\n${coverageContext}`
      : "";

    const feedbackSection = feedbackContext
      ? `\n\nPREVIOUS USER FEEDBACK (use to improve ranking and style):\n${JSON.stringify(feedbackContext)}`
      : "";

    const systemPrompt = `You are IFFY's Development Pitch Engine — an expert development executive who generates production-ready concept pitches for the entertainment industry.

PRODUCTION TYPE: ${typeLabel}
ALL outputs MUST be strictly constrained to this production type. Do not suggest formats, budgets, distribution, or packaging strategies that don't apply to ${typeLabel}.

Generate exactly ${count || 3} ranked development concepts.${coverageSection}${feedbackSection}

For each idea, you MUST call the submit_pitches function with the structured output.`;

    const userPrompt = `Generate ${count || 3} ranked pitch ideas with these filters:
- Production Type: ${typeLabel}
- Genre: ${genre || "any"}
- Budget Band: ${budgetBand || "any"}
- Region: ${region || "global"}
- Platform Target: ${platformTarget || "any"}
- Risk Level: ${riskLevel || "medium"}
${coverageContext ? "\nMode: Coverage Transformer — pivot the existing coverage into new concepts." : "Mode: Greenlight Radar — generate fresh original concepts."}`;

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
        tools: [
          {
            type: "function",
            function: {
              name: "submit_pitches",
              description: "Submit generated pitch ideas",
              parameters: {
                type: "object",
                properties: {
                  ideas: {
                    type: "array",
                    items: {
                      type: "object",
                      properties: {
                        title: { type: "string", description: "Working title" },
                        logline: { type: "string", description: "1-2 sentence logline" },
                        one_page_pitch: { type: "string", description: "Full 1-page pitch (3-5 paragraphs)" },
                        comps: { type: "array", items: { type: "string" }, description: "3-5 comparable titles" },
                        recommended_lane: { type: "string", description: "Monetisation lane key" },
                        lane_confidence: { type: "number", description: "0-100 confidence" },
                        budget_band: { type: "string", description: "Budget range" },
                        genre: { type: "string", description: "Primary genre" },
                        packaging_suggestions: {
                          type: "array",
                          items: {
                            type: "object",
                            properties: {
                              role: { type: "string" },
                              archetype: { type: "string" },
                              names: { type: "array", items: { type: "string" } },
                              rationale: { type: "string" }
                            },
                            required: ["role", "archetype", "rationale"],
                            additionalProperties: false
                          }
                        },
                        development_sprint: {
                          type: "array",
                          items: {
                            type: "object",
                            properties: {
                              week: { type: "string" },
                              milestone: { type: "string" },
                              deliverable: { type: "string" }
                            },
                            required: ["week", "milestone", "deliverable"],
                            additionalProperties: false
                          }
                        },
                        risks_mitigations: {
                          type: "array",
                          items: {
                            type: "object",
                            properties: {
                              risk: { type: "string" },
                              severity: { type: "string", enum: ["low", "medium", "high"] },
                              mitigation: { type: "string" }
                            },
                            required: ["risk", "severity", "mitigation"],
                            additionalProperties: false
                          }
                        },
                        why_us: { type: "string", description: "Why this team/company should make this" },
                        risk_level: { type: "string", enum: ["low", "medium", "high"] }
                      },
                      required: ["title", "logline", "one_page_pitch", "comps", "recommended_lane", "lane_confidence", "budget_band", "genre", "packaging_suggestions", "development_sprint", "risks_mitigations", "why_us", "risk_level"],
                      additionalProperties: false
                    }
                  }
                },
                required: ["ideas"],
                additionalProperties: false
              }
            }
          }
        ],
        tool_choice: { type: "function", function: { name: "submit_pitches" } },
      }),
    });

    if (!response.ok) {
      if (response.status === 429) {
        return new Response(JSON.stringify({ error: "Rate limit exceeded. Please try again shortly." }), {
          status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      if (response.status === 402) {
        return new Response(JSON.stringify({ error: "Usage limit reached. Please add credits." }), {
          status: 402, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      const t = await response.text();
      console.error("AI error:", response.status, t);
      throw new Error("AI generation failed");
    }

    const result = await response.json();
    const toolCall = result.choices?.[0]?.message?.tool_calls?.[0];
    if (!toolCall) throw new Error("No structured output returned");

    const ideas = JSON.parse(toolCall.function.arguments);
    return new Response(JSON.stringify(ideas), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("generate-pitch error:", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
