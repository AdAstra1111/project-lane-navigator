import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { buildGuardrailBlock } from "../_shared/guardrails.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const { productionType, genre, subgenre, budgetBand, region, platformTarget, audienceDemo, riskLevel, count, coverageContext, feedbackContext, briefNotes } = await req.json();

    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) throw new Error("LOVABLE_API_KEY not configured");

    const typeLabel = productionType || "film";
    const coverageSection = coverageContext
      ? `\n\nEXISTING COVERAGE CONTEXT (generate pivot pitches based on this):\n${coverageContext}`
      : "";

    const feedbackSection = feedbackContext
      ? `\n\nPREVIOUS USER FEEDBACK (use to improve ranking and style):\n${JSON.stringify(feedbackContext)}`
      : "";

    const notesSection = briefNotes ? `\n\nADDITIONAL BRIEF NOTES FROM PRODUCER:\n${briefNotes}` : "";
    // Inject guardrails
    const guardrails = buildGuardrailBlock({ productionType: typeLabel, engineName: "generate-pitch" });
    console.log(`[generate-pitch] guardrails: profile=${guardrails.profileName}, hash=${guardrails.hash}`);

    const systemPrompt = `You are IFFY's Development Pitch Engine — an expert development executive who generates production-ready concept pitches for the entertainment industry.

${guardrails.textBlock}

PRODUCTION TYPE: ${typeLabel}
ALL outputs MUST be strictly constrained to this production type. Do not suggest formats, budgets, distribution, or packaging strategies that don't apply to ${typeLabel}.

Generate exactly ${count || 3} ranked development concepts.${coverageSection}${feedbackSection}${notesSection}

For each idea, you MUST also provide weighted scores (0-100 each) for:
- market_heat: How hot is this genre/concept in the current market
- feasibility: How realistic is this to produce given budget and constraints
- lane_fit: How well does this match the recommended monetisation lane
- saturation_risk: INVERSE score — high = low saturation (good), low = oversaturated market
- company_fit: How well this suits an independent producer's strengths

The total_score should be calculated as: (market_heat × 0.30) + (feasibility × 0.25) + (lane_fit × 0.20) + (saturation_risk × 0.15) + (company_fit × 0.10)

RANK ideas by total_score descending.

CRITICAL — CHARACTER NAME DIVERSITY: Do NOT reuse generic placeholder names like "Maya", "Kai", "Zara", "Eli", etc. across pitches. Every character in every pitch must have a DISTINCT, specific name that fits the story's cultural and geographic setting. Vary ethnicity, era, and naming conventions across ideas. If you catch yourself defaulting to the same name, change it.

For each idea, you MUST call the submit_pitches function with the structured output.`;

    const userPrompt = `Generate ${count || 3} ranked pitch ideas with these filters:
- Production Type: ${typeLabel}
- Genre: ${genre || "any"}${subgenre ? `\n- Subgenre: ${subgenre}` : ""}
- Budget Band: ${budgetBand || "any"}
- Region: ${region || "global"}
- Platform Target: ${platformTarget || "any"}${audienceDemo ? `\n- Audience Demo: ${audienceDemo}` : ""}
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
              description: "Submit generated pitch ideas with scoring",
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
                        risk_level: { type: "string", enum: ["low", "medium", "high"] },
                        score_market_heat: { type: "number", description: "0-100 market heat score" },
                        score_feasibility: { type: "number", description: "0-100 feasibility score" },
                        score_lane_fit: { type: "number", description: "0-100 lane fit score" },
                        score_saturation_risk: { type: "number", description: "0-100 inverse saturation score" },
                        score_company_fit: { type: "number", description: "0-100 company fit score" },
                        score_total: { type: "number", description: "Weighted total score" }
                      },
                      required: ["title", "logline", "one_page_pitch", "comps", "recommended_lane", "lane_confidence", "budget_band", "genre", "packaging_suggestions", "development_sprint", "risks_mitigations", "why_us", "risk_level", "score_market_heat", "score_feasibility", "score_lane_fit", "score_saturation_risk", "score_company_fit", "score_total"],
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
    const msg = result.choices?.[0]?.message;
    const toolCall = msg?.tool_calls?.[0];

    let ideas: any;
    if (toolCall?.function?.arguments) {
      ideas = JSON.parse(toolCall.function.arguments);
    } else if (msg?.content) {
      // Fallback: extract JSON from content
      const raw = msg.content;
      const jsonMatch = raw.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        ideas = JSON.parse(jsonMatch[0]);
      } else {
        console.error("No parseable JSON in content:", raw.substring(0, 500));
        throw new Error("No structured output returned");
      }
    } else {
      console.error("Unexpected response shape:", JSON.stringify(result).substring(0, 500));
      throw new Error("No structured output returned");
    }

    // Normalize: ensure { ideas: [...] } shape
    if (Array.isArray(ideas)) ideas = { ideas };
    if (!ideas.ideas) ideas = { ideas: [ideas] };

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
