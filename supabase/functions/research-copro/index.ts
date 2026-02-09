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

    const { countries, format, budget_range, genres } = await req.json();

    if (!countries || !Array.isArray(countries) || countries.length < 2) {
      return new Response(
        JSON.stringify({ error: "At least 2 countries are required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Check cache
    const cacheKey = countries.sort().join("|");
    const serviceClient = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    const { data: cached } = await serviceClient
      .from("copro_frameworks")
      .select("*")
      .eq("status", "active")
      .gte("last_verified_at", new Date(Date.now() - 14 * 24 * 60 * 60 * 1000).toISOString())
      .overlaps("eligible_countries", countries);

    if (cached && cached.length > 0) {
      console.log(`Cache hit for co-pro: ${cached.length} frameworks`);
      return new Response(JSON.stringify({ frameworks: cached, source: "cache" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const systemPrompt = `You are an expert in international film co-production treaties, conventions, and funds.
You provide accurate, current information about bilateral and multilateral co-production agreements.
Always cite the official source. If uncertain, mark confidence as "low".
Today's date is ${new Date().toISOString().split("T")[0]}.`;

    const userPrompt = `Research ALL co-production treaties, conventions, and funds that could apply to a co-production between these countries: ${countries.join(", ")}

${format ? `Format: ${format}` : ""}
${budget_range ? `Budget range: ${budget_range}` : ""}
${genres?.length ? `Genres: ${genres.join(", ")}` : ""}

Include bilateral treaties between any pair of these countries, multilateral conventions (e.g. European Convention on Cinematographic Co-Production, Ibero-American convention), and relevant funds (e.g. Eurimages, Nordic Film Fund, etc.).`;

    const tools = [
      {
        type: "function",
        function: {
          name: "report_frameworks",
          description: "Report all co-production frameworks found for the given countries.",
          parameters: {
            type: "object",
            properties: {
              frameworks: {
                type: "array",
                items: {
                  type: "object",
                  properties: {
                    name: { type: "string", description: "Official framework name" },
                    type: { type: "string", enum: ["treaty", "convention", "fund"], description: "Type" },
                    eligible_countries: { type: "array", items: { type: "string" }, description: "Countries covered" },
                    min_share_pct: { type: "number", description: "Minimum contribution % for minority co-producer (e.g. 20)" },
                    max_share_pct: { type: "number", description: "Maximum contribution % for majority co-producer (e.g. 80)" },
                    cultural_requirements: { type: "string", description: "Summary of cultural tests or requirements" },
                    notes: { type: "string", description: "Key details, deadlines, application process" },
                    source_url: { type: "string", description: "Official source URL" },
                    confidence: { type: "string", enum: ["high", "medium", "low"] },
                  },
                  required: ["name", "type", "eligible_countries", "cultural_requirements", "confidence"],
                  additionalProperties: false,
                },
              },
            },
            required: ["frameworks"],
            additionalProperties: false,
          },
        },
      },
    ];

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
          { role: "user", content: userPrompt },
        ],
        tools,
        tool_choice: { type: "function", function: { name: "report_frameworks" } },
      }),
    });

    if (!aiResponse.ok) {
      const status = aiResponse.status;
      const body = await aiResponse.text();
      console.error("AI gateway error:", status, body);
      if (status === 429) {
        return new Response(JSON.stringify({ error: "Rate limit exceeded. Please try again shortly." }), {
          status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      if (status === 402) {
        return new Response(JSON.stringify({ error: "AI credits exhausted. Please add credits." }), {
          status: 402, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      throw new Error(`AI gateway error ${status}`);
    }

    const aiData = await aiResponse.json();
    const toolCall = aiData.choices?.[0]?.message?.tool_calls?.[0];

    if (!toolCall?.function?.arguments) {
      throw new Error("AI did not return structured co-production data");
    }

    const { frameworks } = JSON.parse(toolCall.function.arguments);

    // Cache
    const rows = frameworks.map((f: any) => ({
      name: f.name,
      type: f.type || "treaty",
      eligible_countries: f.eligible_countries || [],
      min_share_pct: f.min_share_pct ?? null,
      max_share_pct: f.max_share_pct ?? null,
      cultural_requirements: f.cultural_requirements || "",
      notes: f.notes || "",
      source_url: f.source_url || "",
      confidence: f.confidence || "medium",
      status: "active",
      last_verified_at: new Date().toISOString(),
    }));

    if (rows.length > 0) {
      const { error: insertError } = await serviceClient.from("copro_frameworks").insert(rows);
      if (insertError) console.error("Cache insert error:", insertError);
    }

    return new Response(JSON.stringify({ frameworks: rows, source: "ai-research" }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    console.error("research-copro error:", error);
    const msg = error instanceof Error ? error.message : "Unknown error";
    return new Response(JSON.stringify({ error: msg }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
