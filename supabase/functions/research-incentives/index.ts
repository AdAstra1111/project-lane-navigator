import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

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

    // Auth check
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

    const { data: claimsData, error: claimsError } = await supabase.auth.getClaims(
      authHeader.replace("Bearer ", "")
    );
    if (claimsError || !claimsData?.claims) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { jurisdiction, format, budget_range, genres } = await req.json();

    if (!jurisdiction) {
      return new Response(
        JSON.stringify({ error: "jurisdiction is required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Check cache first (incentive data less than 7 days old)
    const { data: cached } = await supabase
      .from("incentive_programs")
      .select("*")
      .eq("jurisdiction", jurisdiction)
      .eq("status", "active")
      .gte("last_verified_at", new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString());

    if (cached && cached.length > 0) {
      console.log(`Cache hit for ${jurisdiction}: ${cached.length} programs`);
      return new Response(JSON.stringify({ programs: cached, source: "cache" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Research via AI
    const systemPrompt = `You are an expert in international film finance, tax incentives, and co-production frameworks. 
You provide accurate, current information about film and TV production incentives worldwide.
Always cite the official source (government or film commission website).
If you are uncertain about specific numbers or rules, say so and mark confidence as "low".
Today's date is ${new Date().toISOString().split("T")[0]}.`;

    const userPrompt = `Research ALL current film and TV production tax incentives, rebates, grants, and funds available in: ${jurisdiction}

${format ? `Format: ${format}` : ""}
${budget_range ? `Budget range: ${budget_range}` : ""}
${genres?.length ? `Genres: ${genres.join(", ")}` : ""}

For EACH incentive program, provide structured data.`;

    const tools = [
      {
        type: "function",
        function: {
          name: "report_incentives",
          description:
            "Report all film/TV production incentive programs found for the jurisdiction.",
          parameters: {
            type: "object",
            properties: {
              programs: {
                type: "array",
                items: {
                  type: "object",
                  properties: {
                    name: { type: "string", description: "Official program name" },
                    type: {
                      type: "string",
                      enum: ["credit", "rebate", "grant", "fund"],
                      description: "Type of incentive",
                    },
                    headline_rate: {
                      type: "string",
                      description: "e.g. '25% tax credit on qualifying spend'",
                    },
                    qualifying_spend_rules: {
                      type: "string",
                      description: "What counts as qualifying expenditure",
                    },
                    caps_limits: {
                      type: "string",
                      description: "Any caps, minimum spends, or limits",
                    },
                    formats_supported: {
                      type: "array",
                      items: { type: "string" },
                      description: "e.g. ['feature film', 'TV series', 'documentary']",
                    },
                    payment_timing: {
                      type: "string",
                      description: "When the incentive pays out (e.g. post-production, on delivery)",
                    },
                    stackability: {
                      type: "string",
                      description: "Can this be combined with other incentives?",
                    },
                    eligibility_summary: {
                      type: "string",
                      description: "Plain English summary of who qualifies",
                    },
                    source_url: {
                      type: "string",
                      description: "Official source URL",
                    },
                    confidence: {
                      type: "string",
                      enum: ["high", "medium", "low"],
                      description: "Confidence in accuracy of this data",
                    },
                    notes: {
                      type: "string",
                      description: "Any additional context or caveats",
                    },
                  },
                  required: [
                    "name",
                    "type",
                    "headline_rate",
                    "qualifying_spend_rules",
                    "eligibility_summary",
                    "confidence",
                  ],
                  additionalProperties: false,
                },
              },
            },
            required: ["programs"],
            additionalProperties: false,
          },
        },
      },
    ];

    const aiResponse = await fetch(
      "https://ai.gateway.lovable.dev/v1/chat/completions",
      {
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
          tools,
          tool_choice: { type: "function", function: { name: "report_incentives" } },
        }),
      }
    );

    if (!aiResponse.ok) {
      const status = aiResponse.status;
      const body = await aiResponse.text();
      console.error("AI gateway error:", status, body);

      if (status === 429) {
        return new Response(
          JSON.stringify({ error: "Rate limit exceeded. Please try again shortly." }),
          { status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
      if (status === 402) {
        return new Response(
          JSON.stringify({ error: "AI credits exhausted. Please add credits." }),
          { status: 402, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
      throw new Error(`AI gateway error ${status}`);
    }

    const aiData = await aiResponse.json();
    const toolCall = aiData.choices?.[0]?.message?.tool_calls?.[0];

    if (!toolCall?.function?.arguments) {
      throw new Error("AI did not return structured incentive data");
    }

    const { programs } = JSON.parse(toolCall.function.arguments);

    // Cache results using service role
    const serviceClient = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    // Mark old entries as stale
    await serviceClient
      .from("incentive_programs")
      .update({ status: "stale" })
      .eq("jurisdiction", jurisdiction)
      .eq("status", "active");

    // Insert fresh data
    const rows = programs.map((p: any) => ({
      jurisdiction,
      country_code: "",
      name: p.name,
      type: p.type || "credit",
      headline_rate: p.headline_rate || "",
      qualifying_spend_rules: p.qualifying_spend_rules || "",
      caps_limits: p.caps_limits || "",
      formats_supported: p.formats_supported || [],
      payment_timing: p.payment_timing || "",
      stackability: p.stackability || "",
      eligibility_summary: p.eligibility_summary || "",
      source_url: p.source_url || "",
      confidence: p.confidence || "medium",
      notes: p.notes || "",
      status: "active",
      last_verified_at: new Date().toISOString(),
    }));

    if (rows.length > 0) {
      const { error: insertError } = await serviceClient
        .from("incentive_programs")
        .insert(rows);
      if (insertError) {
        console.error("Cache insert error:", insertError);
      }
    }

    return new Response(
      JSON.stringify({ programs: rows, source: "ai-research" }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    console.error("research-incentives error:", error);
    const msg = error instanceof Error ? error.message : "Unknown error";
    return new Response(JSON.stringify({ error: msg }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
