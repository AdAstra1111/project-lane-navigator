import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { buildGuardrailBlock } from "../_shared/guardrails.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) throw new Error("LOVABLE_API_KEY is not configured");
    const PERPLEXITY_API_KEY = Deno.env.get("PERPLEXITY_API_KEY");

    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
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
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { person_name, role, project_context, mode, disambiguation_hint, known_for } = await req.json();

    if (!person_name) {
      return new Response(JSON.stringify({ error: "person_name is required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const roleContext = role === "cast"
      ? "actor/actress in film and television"
      : `${project_context?.department || "crew member"} in film and television`;

    const knownForHint = known_for ? ` Known for: ${known_for}.` : "";

    // ── STEP 1: Disambiguation ──
    if (mode !== "assess") {
      const disambigResponse = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${LOVABLE_API_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: "google/gemini-3-flash-preview",
          messages: [
            {
              role: "system",
              content: `You are a film industry expert. The user is looking up a person named "${person_name}" who works as a ${roleContext}.${knownForHint} Determine if this name could refer to multiple well-known people in the film/TV industry. If there is clearly only ONE well-known person by this name in this role, return a single candidate. If ambiguous, return up to 4 candidates.`,
            },
            {
              role: "user",
              content: `Who are the notable people named "${person_name}" working as a ${roleContext}? List each distinct person with a short identifier.`,
            },
          ],
          tools: [{
            type: "function",
            function: {
              name: "report_candidates",
              description: "Return candidate matches for the given name.",
              parameters: {
                type: "object",
                properties: {
                  candidates: {
                    type: "array",
                    items: {
                      type: "object",
                      properties: {
                        name: { type: "string", description: "Full name" },
                        descriptor: { type: "string", description: "Brief identifier" },
                        known_for: { type: "string", description: "1-2 most famous credits" },
                      },
                      required: ["name", "descriptor", "known_for"],
                      additionalProperties: false,
                    },
                  },
                },
                required: ["candidates"],
                additionalProperties: false,
              },
            },
          }],
          tool_choice: { type: "function", function: { name: "report_candidates" } },
        }),
      });

      if (!disambigResponse.ok) {
        const status = disambigResponse.status;
        if (status === 429) {
          return new Response(JSON.stringify({ error: "Rate limit exceeded. Please try again shortly." }), {
            status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }
        if (status === 402) {
          return new Response(JSON.stringify({ error: "AI credits exhausted." }), {
            status: 402, headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }
        const body = await disambigResponse.text();
        console.error("AI disambiguation error:", status, body);
        throw new Error(`AI gateway error ${status}`);
      }

      const disambigData = await disambigResponse.json();
      const disambigCall = disambigData.choices?.[0]?.message?.tool_calls?.[0];
      if (!disambigCall?.function?.arguments) throw new Error("AI did not return disambiguation data");

      const { candidates } = JSON.parse(disambigCall.function.arguments);

      if (candidates.length === 1) {
        // Fall through to assessment
      } else {
        return new Response(JSON.stringify({ disambiguation: true, candidates }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
    }

    // ── STEP 2: Perplexity grounded research (if available) ──
    let groundedResearch = "";
    if (PERPLEXITY_API_KEY) {
      try {
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
                content: "You are a film/TV industry researcher. Return factual, current information about this person including recent projects, awards, upcoming releases, box office performance of recent films, any news or controversies. Be specific with dates and numbers.",
              },
              {
                role: "user",
                content: `Research ${person_name} (${disambiguation_hint || roleContext}${knownForHint}). What are their most recent projects (last 2 years), current career trajectory, any recent news, awards, upcoming releases, and market perception in the entertainment industry?`,
              },
            ],
            search_recency_filter: "month",
          }),
        });

        if (perplexityResponse.ok) {
          const pData = await perplexityResponse.json();
          const pContent = pData.choices?.[0]?.message?.content || "";
          const citations = pData.citations || [];
          groundedResearch = `\n\n=== REAL-TIME RESEARCH (cited web sources) ===\n${pContent}\n\nSources: ${citations.join(", ")}\n=== END RESEARCH ===`;
          console.log("Perplexity person research complete, citations:", citations.length);
        } else {
          console.warn("Perplexity person research failed:", perplexityResponse.status);
        }
      } catch (pErr) {
        console.warn("Perplexity lookup failed, proceeding with AI knowledge:", pErr);
      }
    }

    // ── STEP 3: Full Assessment with Gemini ──
    const identityHint = disambiguation_hint
      ? `\nIMPORTANT: The user has confirmed they mean specifically: ${disambiguation_hint}. Assess ONLY this person.`
      : known_for
        ? `\nIMPORTANT: The user has specified this person is known for: ${known_for}.`
        : "";

    const guardrails = buildGuardrailBlock({ productionType: project_context?.format, engineName: "research-person" });
    console.log(`[research-person] guardrails: profile=${guardrails.profileName}, hash=${guardrails.hash}`);

    const systemPrompt = `You are IFFY, a film finance intelligence tool. A producer is considering attaching a person to their project. Assess this person's current market value and how they affect the project's finance readiness.${identityHint}
${guardrails.textBlock}
${groundedResearch ? "\nIMPORTANT: Use the REAL-TIME RESEARCH data below as your primary factual source. It contains current, cited information. Base your assessment on these facts rather than potentially outdated training data." : ""}

Be specific about:
- Their notable recent work (last 5 years)
- Their current market perception and trajectory (rising, peak, steady, declining)
- How attaching them affects: packaging strength, foreign pre-sales value, investor confidence, festival/awards positioning
- Any risks (controversies, availability concerns, overexposure)

PROJECT CONTEXT:
${project_context ? `- Title: ${project_context.title || "Untitled"}
- Format: ${project_context.format || "Feature"}
- Budget: ${project_context.budget_range || "Not set"}
- Genres: ${(project_context.genres || []).join(", ") || "Not set"}` : "No project context provided"}
${groundedResearch}

Keep your response to 4-6 sentences. Be direct and producer-facing.`;

    const tools = [{
      type: "function",
      function: {
        name: "report_person_assessment",
        description: "Report a market value assessment of a film/TV industry professional.",
        parameters: {
          type: "object",
          properties: {
            summary: { type: "string", description: "3-6 sentence assessment of this person's current market value and impact on the project" },
            market_trajectory: { type: "string", enum: ["rising", "peak", "steady", "declining", "breakout", "unknown"] },
            packaging_impact: { type: "string", enum: ["transformative", "strong", "moderate", "marginal", "neutral", "risky"] },
            notable_credits: { type: "array", items: { type: "string" }, description: "2-4 most relevant recent credits" },
            risk_flags: { type: "array", items: { type: "string" }, description: "Any concerns (empty array if none)" },
          },
          required: ["summary", "market_trajectory", "packaging_impact", "notable_credits", "risk_flags"],
          additionalProperties: false,
        },
      },
    }];

    const aiResponse = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${LOVABLE_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "google/gemini-2.5-flash",
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: `Assess the current market value and project impact of ${person_name} (${disambiguation_hint || roleContext}).` },
        ],
        tools,
        tool_choice: { type: "function", function: { name: "report_person_assessment" } },
      }),
    });

    if (!aiResponse.ok) {
      const status = aiResponse.status;
      if (status === 429) {
        return new Response(JSON.stringify({ error: "Rate limit exceeded. Please try again shortly." }), {
          status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      if (status === 402) {
        return new Response(JSON.stringify({ error: "AI credits exhausted." }), {
          status: 402, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      const body = await aiResponse.text();
      console.error("AI gateway error:", status, body);
      throw new Error(`AI gateway error ${status}`);
    }

    const aiData = await aiResponse.json();
    const toolCall = aiData.choices?.[0]?.message?.tool_calls?.[0];
    if (!toolCall?.function?.arguments) {
      throw new Error("AI did not return structured data");
    }

    const assessment = JSON.parse(toolCall.function.arguments);

    return new Response(JSON.stringify(assessment), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    console.error("research-person error:", error);
    const msg = error instanceof Error ? error.message : "Unknown error";
    return new Response(JSON.stringify({ error: msg }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
