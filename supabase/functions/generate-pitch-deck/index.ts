import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { buildGuardrailBlock } from "../_shared/guardrails.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const authHeader = req.headers.get("Authorization") || "";
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const lovableKey = Deno.env.get("LOVABLE_API_KEY");

    if (!lovableKey) throw new Error("LOVABLE_API_KEY not configured");

    const supabase = createClient(supabaseUrl, supabaseKey);

    // Get user from auth
    const anonClient = createClient(supabaseUrl, Deno.env.get("SUPABASE_ANON_KEY")!);
    const token = authHeader.replace("Bearer ", "");
    const { data: { user }, error: authError } = await anonClient.auth.getUser(token);
    if (authError || !user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { project_id } = await req.json();
    if (!project_id) throw new Error("project_id required");

    // Fetch project data
    const { data: project, error: projErr } = await supabase
      .from("projects")
      .select("*")
      .eq("id", project_id)
      .single();
    if (projErr || !project) throw new Error("Project not found");

    // Fetch attachments in parallel
    const [castRes, partnersRes, financeRes, dealsRes, hodsRes] = await Promise.all([
      supabase.from("project_cast").select("*").eq("project_id", project_id),
      supabase.from("project_partners").select("*").eq("project_id", project_id),
      supabase.from("project_finance_scenarios").select("*").eq("project_id", project_id),
      supabase.from("project_deals").select("*").eq("project_id", project_id),
      supabase.from("project_hods").select("*").eq("project_id", project_id),
    ]);

    const cast = castRes.data || [];
    const partners = partnersRes.data || [];
    const financeScenarios = financeRes.data || [];
    const deals = dealsRes.data || [];
    const hods = hodsRes.data || [];

    // Create deck record
    const { data: deck, error: deckErr } = await supabase
      .from("pitch_decks")
      .insert({ project_id, user_id: user.id, status: "generating" })
      .select()
      .single();
    if (deckErr) throw deckErr;

    // Build context for AI
    const analysis = project.analysis_passes || {};
    const confirmedCast = cast.filter((c: any) =>
      ["confirmed", "offer", "attached"].includes(c.status)
    );
    const confirmedPartners = partners.filter((p: any) =>
      ["confirmed", "in-talks", "in-discussion"].includes(p.status)
    );

    const formatLabel = project.format === "tv-series" ? "TV Series" :
      project.format === "documentary" ? "Documentary" :
      project.format === "short-film" ? "Short Film" : "Feature Film";

    const budgetContext = project.budget_range || "Not specified";
    const genreList = (project.genres || []).join(", ");
    const laneLabel = project.assigned_lane?.replace(/-/g, " ") || "Not classified";

    const castNames = confirmedCast.map((c: any) => `${c.person_name} (${c.role_name || c.status})`).join(", ");
    const partnerNames = confirmedPartners.map((p: any) => `${p.person_name} (${p.role})`).join(", ");
    const hodNames = hods.map((h: any) => `${h.person_name} (${h.department})`).join(", ");

    const closedDeals = deals.filter((d: any) => d.status === "closed");
    const dealSummary = closedDeals.length > 0
      ? closedDeals.map((d: any) => `${d.territory || d.deal_type}: $${d.minimum_guarantee || "TBD"}`).join("; ")
      : "No closed deals yet";

    const financeSummary = financeScenarios.length > 0
      ? financeScenarios.map((f: any) => `${f.scenario_name}: ${f.category} - $${f.amount || 0}`).join("; ")
      : "Finance structure pending";

    const guardrails = buildGuardrailBlock({ productionType: project.format });
    console.log(`[generate-pitch-deck] guardrails: profile=${guardrails.profileName}, hash=${guardrails.hash}`);

    const prompt = `You are a world-class film/TV pitch deck writer. Generate compelling, strategic slide content for a pitch deck.

${guardrails.textBlock}

PROJECT DATA:
- Title: ${project.title}
- Format: ${formatLabel}
- Genres: ${genreList || "Not specified"}
- Budget: ${budgetContext}
- Lane: ${laneLabel}
- Logline: ${project.reasoning || "Not provided"}
- Target Audience: ${project.target_audience || "Not specified"}
- Tone: ${project.tone || "Not specified"}
- Comparable Titles: ${project.comparable_titles || "Not specified"}
- Confidence Score: ${project.confidence || "N/A"}%

CAST & PACKAGE:
${castNames || "No cast attached yet"}
Key Creatives: ${partnerNames || "None confirmed"}
HODs: ${hodNames || "None assigned"}

FINANCIAL:
Deals: ${dealSummary}
Finance Structure: ${financeSummary}

AI ANALYSIS:
Verdict: ${analysis.verdict || "Pending"}
Structure: ${JSON.stringify(analysis.structural_read || {})}
Creative: ${JSON.stringify(analysis.creative_signal || {})}
Market: ${JSON.stringify(analysis.market_reality || {})}
Next Steps: ${JSON.stringify(analysis.do_next || [])}

TONE ADAPTATION:
Adapt your writing tone based on the project:
- For big-budget/studio projects: Confident, powerful, high-stakes language
- For indie/prestige: Sophisticated, artful, festival-circuit language
- For genre/market-driven: Commercial, audience-focused, market-savvy language
- For low-budget: Scrappy, resourceful, ROI-focused language
- For documentaries: Important, impactful, socially relevant language

Generate the content for each slide as a JSON array.`;

    const response = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${lovableKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "google/gemini-2.5-flash",
        messages: [
          { role: "system", content: "You are a pitch deck content generator. Return only valid JSON." },
          { role: "user", content: prompt },
        ],
        tools: [
          {
            type: "function",
            function: {
              name: "generate_slides",
              description: "Generate all slides for a cinematic pitch deck",
              parameters: {
                type: "object",
                properties: {
                  slides: {
                    type: "array",
                    items: {
                      type: "object",
                      properties: {
                        slide_type: {
                          type: "string",
                          enum: [
                            "title",
                            "opportunity",
                            "creative_vision",
                            "package",
                            "financial",
                            "market",
                            "readiness",
                            "the_ask",
                          ],
                        },
                        headline: { type: "string", description: "Bold, punchy slide headline" },
                        subheadline: { type: "string", description: "Supporting line under headline" },
                        body: { type: "string", description: "1-3 paragraphs of strategic narrative" },
                        bullet_points: {
                          type: "array",
                          items: { type: "string" },
                          description: "Key data points or talking points",
                        },
                        pull_quote: { type: "string", description: "Optional powerful one-liner for visual emphasis" },
                      },
                      required: ["slide_type", "headline", "body"],
                      additionalProperties: false,
                    },
                  },
                },
                required: ["slides"],
                additionalProperties: false,
              },
            },
          },
        ],
        tool_choice: { type: "function", function: { name: "generate_slides" } },
      }),
    });

    if (!response.ok) {
      const status = response.status;
      if (status === 429) {
        await supabase.from("pitch_decks").update({ status: "error" }).eq("id", deck.id);
        return new Response(JSON.stringify({ error: "Rate limited, please try again later" }), {
          status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      if (status === 402) {
        await supabase.from("pitch_decks").update({ status: "error" }).eq("id", deck.id);
        return new Response(JSON.stringify({ error: "AI credits exhausted" }), {
          status: 402, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      const errText = await response.text();
      console.error("AI error:", status, errText);
      await supabase.from("pitch_decks").update({ status: "error" }).eq("id", deck.id);
      throw new Error("AI generation failed");
    }

    const aiResult = await response.json();
    const toolCall = aiResult.choices?.[0]?.message?.tool_calls?.[0];
    let slides: any[] = [];

    if (toolCall?.function?.arguments) {
      try {
        const parsed = JSON.parse(toolCall.function.arguments);
        slides = parsed.slides || [];
      } catch {
        console.error("Failed to parse tool call arguments");
      }
    }

    // Enrich slides with project data
    const enrichedSlides = slides.map((slide: any) => ({
      ...slide,
      project_data: getSlideData(slide.slide_type, {
        project,
        cast: confirmedCast,
        partners: confirmedPartners,
        hods,
        deals,
        financeScenarios,
        analysis,
      }),
    }));

    // Update deck with slides
    await supabase
      .from("pitch_decks")
      .update({ slides: enrichedSlides, status: "ready" })
      .eq("id", deck.id);

    return new Response(
      JSON.stringify({ deck_id: deck.id, share_token: deck.share_token, slides: enrichedSlides }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (e) {
    console.error("generate-pitch-deck error:", e);
    return new Response(
      JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});

function getSlideData(slideType: string, ctx: any) {
  const { project, cast, partners, hods, deals, financeScenarios, analysis } = ctx;
  switch (slideType) {
    case "title":
      return {
        title: project.title,
        format: project.format,
        genres: project.genres,
        lane: project.assigned_lane,
        logline: project.reasoning,
        comparable_titles: project.comparable_titles,
        hero_image_url: project.hero_image_url,
      };
    case "package":
      return {
        cast: cast.map((c: any) => ({ name: c.person_name, role: c.role_name, status: c.status })),
        partners: partners.map((p: any) => ({ name: p.person_name, role: p.role })),
        hods: hods.map((h: any) => ({ name: h.person_name, department: h.department })),
      };
    case "financial":
      return {
        budget_range: project.budget_range,
        deals: deals.map((d: any) => ({
          type: d.deal_type, territory: d.territory, amount: d.minimum_guarantee, status: d.status,
        })),
        finance_scenarios: financeScenarios.map((f: any) => ({
          name: f.scenario_name, category: f.category, amount: f.amount,
        })),
      };
    case "readiness":
      return {
        confidence: project.confidence,
        viability_breakdown: project.viability_breakdown,
      };
    default:
      return {};
  }
}
