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

    const { data: claimsData, error: claimsError } = await supabase.auth.getClaims(
      authHeader.replace("Bearer ", "")
    );
    if (claimsError || !claimsData?.claims) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { format, genres, budget_range, tone, target_audience, territories } = await req.json();

    // Check cache first (buyer data less than 14 days old)
    const serviceClient = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    const { data: cached } = await serviceClient
      .from("market_buyers")
      .select("*")
      .eq("status", "active")
      .gte("last_verified_at", new Date(Date.now() - 14 * 24 * 60 * 60 * 1000).toISOString());

    if (cached && cached.length >= 10) {
      console.log(`Cache hit: ${cached.length} buyers`);
      return new Response(JSON.stringify({ buyers: cached, source: "cache" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // ── Perplexity grounded buyer research ──
    let groundedBuyerData = "";
    if (PERPLEXITY_API_KEY) {
      try {
        const pResponse = await fetch("https://api.perplexity.ai/chat/completions", {
          method: "POST",
          headers: {
            Authorization: `Bearer ${PERPLEXITY_API_KEY}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            model: "sonar",
            messages: [
              { role: "system", content: "You are an entertainment industry acquisitions researcher. Return factual, current data about which companies are actively buying content, their recent acquisitions, and deal activity." },
              { role: "user", content: `Which distributors, sales agents, streamers, and financiers are currently acquiring ${format || "film"} content in the ${(genres || ["drama"]).join(", ")} genre space? Budget range: ${budget_range || "indie to mid-budget"}. Territories: ${(territories || ["worldwide"]).join(", ")}. Include recent acquisition deals, market activity, and any company strategy shifts.` },
            ],
            search_recency_filter: "month",
          }),
        });
        if (pResponse.ok) {
          const pData = await pResponse.json();
          const pContent = pData.choices?.[0]?.message?.content || "";
          const citations = pData.citations || [];
          groundedBuyerData = `\n\n=== REAL-TIME BUYER INTELLIGENCE (cited web sources) ===\n${pContent}\n\nSources: ${citations.join(", ")}\n=== END ===`;
          console.log("Perplexity buyer research complete, citations:", citations.length);
        }
      } catch (e) {
        console.warn("Perplexity buyer research failed:", e);
      }
    }

    const guardrails = buildGuardrailBlock({ productionType: format, engineName: "research-buyers" });
    console.log(`[research-buyers] guardrails: profile=${guardrails.profileName}, hash=${guardrails.hash}`);

    // Research via AI
    const systemPrompt = `You are an expert in international film and TV sales, distribution, and financing markets. 
You have deep knowledge of which distributors, sales agents, streamers, and financiers are actively acquiring content.
Today's date is ${new Date().toISOString().split("T")[0]}.
Provide REAL companies only — no made-up entities. If uncertain, mark confidence as "low".
${guardrails.textBlock}
${groundedBuyerData ? "\nIMPORTANT: Use the REAL-TIME BUYER INTELLIGENCE below as your primary source. It contains current, cited acquisition activity. Base your recommendations on these facts." : ""}`;

    const userPrompt = `Research and identify active buyers (distributors, sales agents, streamers, broadcasters, financiers) that are currently acquiring content matching these characteristics:

Format: ${format || 'film'}
Genres: ${genres?.join(', ') || 'Drama'}
Budget range: ${budget_range || 'not specified'}
Tone: ${tone || 'not specified'}
Target audience: ${target_audience || 'not specified'}
Key territories: ${territories?.join(', ') || 'worldwide'}
${groundedBuyerData}

Identify 15-20 real companies across different types (sales agents, distributors, streamers, financiers). 
Focus on companies that are ACTIVELY acquiring this type of content right now.
Include both major players and independent specialists.`;

    const tools = [
      {
        type: "function",
        function: {
          name: "report_buyers",
          description: "Report all active market buyers identified for this content profile.",
          parameters: {
            type: "object",
            properties: {
              buyers: {
                type: "array",
                items: {
                  type: "object",
                  properties: {
                    name: { type: "string", description: "Company name" },
                    company_type: {
                      type: "string",
                      enum: ["distributor", "sales-agent", "streamer", "broadcaster", "financier", "studio"],
                    },
                    genres_acquired: { type: "array", items: { type: "string" } },
                    budget_sweet_spot: {
                      type: "array",
                      items: { type: "string" },
                      description: "Budget ranges they typically handle, using values like: under-250k, 250k-1m, 1m-5m, 5m-15m, 15m-50m, 50m-plus",
                    },
                    formats: {
                      type: "array",
                      items: { type: "string" },
                      description: "e.g. ['film', 'tv-series']",
                    },
                    territories: {
                      type: "array",
                      items: { type: "string" },
                      description: "Territories they cover (e.g. 'North America', 'UK', 'Global')",
                    },
                    recent_acquisitions: {
                      type: "string",
                      description: "2-3 recent notable titles they acquired or distributed",
                    },
                    appetite_notes: {
                      type: "string",
                      description: "Current buying appetite and preferences",
                    },
                    deal_types: {
                      type: "array",
                      items: { type: "string", enum: ["pre-buy", "acquisition", "co-finance", "first-look", "output"] },
                    },
                    tone_preferences: {
                      type: "array",
                      items: { type: "string" },
                    },
                    market_presence: {
                      type: "string",
                      description: "Key markets they attend (e.g. 'Cannes, Berlin, AFM, Toronto')",
                    },
                    confidence: {
                      type: "string",
                      enum: ["high", "medium", "low"],
                    },
                  },
                  required: ["name", "company_type", "genres_acquired", "formats", "confidence"],
                  additionalProperties: false,
                },
              },
            },
            required: ["buyers"],
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
          tool_choice: { type: "function", function: { name: "report_buyers" } },
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
          JSON.stringify({ error: "AI credits exhausted." }),
          { status: 402, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
      throw new Error(`AI gateway error ${status}`);
    }

    const aiData = await aiResponse.json();
    const toolCall = aiData.choices?.[0]?.message?.tool_calls?.[0];

    if (!toolCall?.function?.arguments) {
      throw new Error("AI did not return structured buyer data");
    }

    const { buyers } = JSON.parse(toolCall.function.arguments);

    // Cache results
    const rows = buyers.map((b: any) => ({
      name: b.name,
      company_type: b.company_type || "distributor",
      genres_acquired: b.genres_acquired || [],
      budget_sweet_spot: b.budget_sweet_spot || [],
      formats: b.formats || [],
      territories: b.territories || [],
      recent_acquisitions: b.recent_acquisitions || "",
      appetite_notes: b.appetite_notes || "",
      deal_types: b.deal_types || [],
      tone_preferences: b.tone_preferences || [],
      market_presence: b.market_presence || "",
      status: "active",
      confidence: b.confidence || "medium",
      last_verified_at: new Date().toISOString(),
    }));

    if (rows.length > 0) {
      // Upsert by name to avoid duplicates
      for (const row of rows) {
        const { data: existing } = await serviceClient
          .from("market_buyers")
          .select("id")
          .eq("name", row.name)
          .maybeSingle();

        if (existing) {
          await serviceClient
            .from("market_buyers")
            .update({ ...row })
            .eq("id", existing.id);
        } else {
          await serviceClient
            .from("market_buyers")
            .insert(row);
        }
      }
    }

    return new Response(
      JSON.stringify({ buyers: rows, source: "ai-research" }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    console.error("research-buyers error:", error);
    const msg = error instanceof Error ? error.message : "Unknown error";
    return new Response(JSON.stringify({ error: msg }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
