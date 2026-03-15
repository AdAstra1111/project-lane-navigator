import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { buildGuardrailBlock } from "../_shared/guardrails.ts";
import { MODELS } from "../_shared/llm.ts";

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

    const { data: { user }, error: authError } = await supabase.auth.getUser(
      authHeader.replace("Bearer ", "")
    );
    if (authError || !user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { format, budget_range, genres, territories } = await req.json();

    if (!budget_range || !territories?.length) {
      return new Response(
        JSON.stringify({ error: "budget_range and territories are required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const guardrails = buildGuardrailBlock({ productionType: format, engineName: "project-incentive-insights" });
    console.log(`[project-incentive-insights] guardrails: profile=${guardrails.profileName}, hash=${guardrails.hash}`);

    const systemPrompt = `You are an expert in international film finance, specialising in tax incentives, co-production structures, and capital stack planning.
You help producers understand which jurisdictions offer the best non-dilutive financing, and how to structure a realistic finance plan.
Today's date is ${new Date().toISOString().split("T")[0]}.
Be specific about numbers, timing, and actionable next steps. If uncertain, say so.
${guardrails.textBlock}`;

    const userPrompt = `A producer is developing a ${format || 'feature film'} project.
Budget range: ${budget_range}
Genres: ${genres?.join(', ') || 'Not specified'}
Target/flexible territories: ${territories.join(', ')}

Provide:
1. The top 3 jurisdictions from the list that offer the best incentive opportunities for this project
2. For each, explain: what incentive is available, estimated benefit range, payment timing, and key eligibility requirements
3. Whether a co-production structure between any of these territories would unlock additional value
4. A suggested financing stack order (what to secure first, second, third)
5. Key risks or blockers
6. Confidence level for each recommendation`;

    const tools = [{
      type: "function",
      function: {
        name: "report_project_incentive_insights",
        description: "Report incentive and co-production insights for a specific project.",
        parameters: {
          type: "object",
          properties: {
            top_jurisdictions: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  jurisdiction: { type: "string" },
                  incentive_name: { type: "string" },
                  estimated_benefit: { type: "string" },
                  payment_timing: { type: "string" },
                  eligibility_summary: { type: "string" },
                  confidence: { type: "string", enum: ["high", "medium", "low"] },
                  why_it_fits: { type: "string" },
                },
                required: ["jurisdiction", "incentive_name", "estimated_benefit", "why_it_fits", "confidence"],
                additionalProperties: false,
              },
            },
            copro_opportunity: {
              type: "object",
              properties: {
                recommended: { type: "boolean" },
                structure_summary: { type: "string" },
                additional_value: { type: "string" },
                risks: { type: "string" },
              },
              required: ["recommended", "structure_summary"],
              additionalProperties: false,
            },
            financing_stack: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  step: { type: "number" },
                  action: { type: "string" },
                  timing: { type: "string" },
                  notes: { type: "string" },
                },
                required: ["step", "action"],
                additionalProperties: false,
              },
            },
            risks: { type: "array", items: { type: "string" } },
            summary: { type: "string" },
          },
          required: ["top_jurisdictions", "copro_opportunity", "financing_stack", "summary"],
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
        model: MODELS.FAST,
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt },
        ],
        tools,
        tool_choice: { type: "function", function: { name: "report_project_incentive_insights" } },
      }),
    });

    if (!aiResponse.ok) {
      const status = aiResponse.status;
      const body = await aiResponse.text();
      console.error("AI gateway error:", status, body);
      if (status === 429) return new Response(JSON.stringify({ error: "Rate limit exceeded." }), { status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      if (status === 402) return new Response(JSON.stringify({ error: "AI credits exhausted." }), { status: 402, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      throw new Error(`AI gateway error ${status}`);
    }

    const aiData = await aiResponse.json();
    const toolCall = aiData.choices?.[0]?.message?.tool_calls?.[0];
    if (!toolCall?.function?.arguments) throw new Error("AI did not return structured data");

    const insights = JSON.parse(toolCall.function.arguments);

    return new Response(JSON.stringify(insights), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    console.error("project-incentive-insights error:", error);
    const msg = error instanceof Error ? error.message : "Unknown error";
    return new Response(JSON.stringify({ error: msg }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
