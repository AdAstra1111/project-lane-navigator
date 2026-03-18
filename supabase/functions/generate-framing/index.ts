/**
 * generate-framing — AI-powered Creative Framing Engine.
 * Generates 4-6 distinct framing strategies per project + content type.
 * Uses project canon to enforce world-lock constraints.
 * POST { projectId, contentType }
 */
import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) throw new Error("LOVABLE_API_KEY not configured");

    const sbUrl = Deno.env.get("SUPABASE_URL")!;
    const sbKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const sb = createClient(sbUrl, sbKey);

    // Auth
    const anonClient = createClient(sbUrl, Deno.env.get("SUPABASE_ANON_KEY")!);
    const authHeader = req.headers.get("authorization") || "";
    const { data: { user }, error: authErr } = await anonClient.auth.getUser(
      authHeader.replace("Bearer ", "")
    );
    if (authErr || !user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { projectId, contentType = "poster" } = await req.json();
    if (!projectId) throw new Error("projectId required");

    // ── Load project data ──
    const { data: project } = await sb
      .from("projects")
      .select("title, genres, format, tone, assigned_lane, budget_range, target_audience, comparable_titles")
      .eq("id", projectId)
      .maybeSingle();
    if (!project) throw new Error("Project not found");

    // ── Load canon ──
    let canon: Record<string, any> = {};
    const { data: canonRow } = await sb
      .from("project_canon")
      .select("canon_json")
      .eq("project_id", projectId)
      .maybeSingle();
    if (canonRow?.canon_json) canon = canonRow.canon_json;

    // ── Load company branding ──
    let companyName = "Paradox House";
    const { data: links } = await sb
      .from("project_company_links")
      .select("company_id")
      .eq("project_id", projectId)
      .limit(1);
    if (links?.length) {
      const { data: co } = await sb
        .from("production_companies")
        .select("name")
        .eq("id", (links[0] as any).company_id)
        .single();
      if (co?.name) companyName = co.name;
    }

    // ── Build canon context ──
    const canonContext = {
      title: project.title || "Untitled",
      genre: project.genre || "drama",
      format: project.format || "film",
      logline: project.logline || canon.logline || "",
      tone: project.tone || canon.tone_style || "",
      themes: typeof project.themes === "string" ? project.themes : Array.isArray(project.themes) ? project.themes.join(", ") : canon.themes || "",
      worldRules: canon.world_rules || "",
      locations: canon.locations || "",
      characters: Array.isArray(canon.characters) 
        ? canon.characters.map((c: any) => `${c.name} (${c.role}): ${c.goals || c.description || ""}`).join("\n")
        : "",
      timeline: canon.timeline || "",
      premise: canon.premise || "",
      lane: project.assigned_lane || "",
      budgetRange: project.budget_range || "",
      targetAudience: project.target_audience || "",
      companyName,
    };

    // ── Content-type specific instructions ──
    const contentInstructions: Record<string, string> = {
      poster: `For POSTER framing, define:
- Composition approach (focal hierarchy, color dominance, scale)
- Emotional hook (what the viewer should feel instantly)
- Typography style (bold/minimal/distressed/elegant)
- Key visual element (character face, landscape, symbol, object)`,
      lookbook: `For LOOK BOOK framing, define:
- Narrative flow (how the deck tells the story visually)
- Visual identity system (color palette, texture, grain)
- Tone shaping (how imagery evolves across pages)
- Section emphasis (which elements get full-bleed vs. text-heavy treatment)`,
      deck: `For PITCH DECK framing, define:
- Positioning approach (how the project is sold)
- Market language (industry terminology, comp framing)
- Clarity vs intrigue balance
- Opening hook and closing call-to-action`,
      script: `For SCRIPT framing, define:
- Narrative voice (distant/intimate/unreliable/omniscient)
- Pacing approach (slow burn vs. propulsive)
- Emphasis point (character, world, plot, theme)
- Opening strategy (in medias res, cold open, establishing, etc.)`,
      pitch: `For PITCH framing, define:
- Elevator pitch angle
- Key selling point
- Emotional vs commercial emphasis
- Buyer type alignment`,
    };

    const systemPrompt = `You are a world-class creative strategist for film and television. You generate distinct FRAMING STRATEGIES for creative content.

A framing strategy defines HOW a project should be presented — not WHAT the project is.

ABSOLUTE RULES:
1. Every strategy must remain INSIDE the project's actual world. No genre drift, no era contamination, no aesthetic pollution.
2. All strategies must be for the SAME project. They differ in APPROACH, not in CONTENT.
3. Each strategy must be genuinely distinct — different intent, different creative angle, different risk profile.
4. Never mention AI, algorithms, or generation systems. Speak as a creative professional.
5. Credit line is always "Written by Sebastian Street" and company is "${canonContext.companyName}".

PROJECT CANON (HARD LOCK — do not violate):
Title: ${canonContext.title}
Genre: ${canonContext.genre}
Format: ${canonContext.format}
Logline: ${canonContext.logline}
Tone: ${canonContext.tone}
Themes: ${canonContext.themes}
World: ${canonContext.worldRules}
Locations: ${canonContext.locations}
Characters: ${canonContext.characters}
Timeline: ${canonContext.timeline}
Premise: ${canonContext.premise}
Market Lane: ${canonContext.lane}
Budget: ${canonContext.budgetRange}
Target Audience: ${canonContext.targetAudience}

${contentInstructions[contentType] || contentInstructions.poster}

Generate exactly 5 framing strategies. Return them using the suggest_strategies tool.`;

    const userPrompt = `Generate 5 distinct creative framing strategies for the ${contentType.toUpperCase()} of "${canonContext.title}".

Requirements:
1. STRATEGY 1 must be market_aligned (safe, commercially clear)
2. STRATEGY 2 must be prestige (awards/festival leaning)
3. STRATEGY 3 must be commercial (bold, high-concept)
4. STRATEGY 4 must be subversive (unexpected angle)
5. STRATEGY 5 must be experimental (boundary-pushing but canon-safe)

Each must have a distinct creative_angle, intent, and visual_language.
All must remain faithful to the actual project world.`;

    // ── Call AI with tool calling for structured output ──
    const aiResponse = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
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
        tools: [{
          type: "function",
          function: {
            name: "suggest_strategies",
            description: "Return 5 distinct creative framing strategies.",
            parameters: {
              type: "object",
              properties: {
                strategies: {
                  type: "array",
                  items: {
                    type: "object",
                    properties: {
                      strategy_key: { type: "string", description: "Unique slug, e.g. 'market_core', 'prestige_intimate'" },
                      strategy_type: { type: "string", enum: ["market_aligned", "prestige", "commercial", "subversive", "experimental", "parody"] },
                      intent: { type: "string", description: "What this version is trying to achieve (1-2 sentences)" },
                      audience_target: { type: "string", enum: ["mass", "niche", "festival", "platform_specific"] },
                      risk_level: { type: "string", enum: ["safe", "elevated", "bold", "experimental"] },
                      creative_angle: { type: "string", description: "What is being emphasized or twisted (1-2 sentences)" },
                      trope_handling: { type: "string", enum: ["follow", "invert", "subvert", "parody"] },
                      visual_language: { type: "string", description: "Visual/structural language for this strategy (2-3 sentences)" },
                      canon_lock_summary: { type: "string", description: "Key world constraints this strategy obeys" },
                      full_brief: { type: "string", description: "Complete creative brief for downstream systems (3-5 sentences)" },
                    },
                    required: ["strategy_key", "strategy_type", "intent", "audience_target", "risk_level", "creative_angle", "trope_handling", "visual_language", "canon_lock_summary", "full_brief"],
                    additionalProperties: false,
                  },
                },
              },
              required: ["strategies"],
              additionalProperties: false,
            },
          },
        }],
        tool_choice: { type: "function", function: { name: "suggest_strategies" } },
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
        return new Response(JSON.stringify({ error: "Usage credits exhausted. Please add credits." }), {
          status: 402, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      const errText = await aiResponse.text();
      console.error("AI error:", status, errText);
      throw new Error(`AI gateway error: ${status}`);
    }

    const aiData = await aiResponse.json();
    const toolCall = aiData.choices?.[0]?.message?.tool_calls?.[0];
    if (!toolCall?.function?.arguments) {
      throw new Error("No structured output from AI");
    }

    let strategies: any[];
    try {
      const parsed = JSON.parse(toolCall.function.arguments);
      strategies = parsed.strategies;
    } catch {
      throw new Error("Failed to parse AI output");
    }

    if (!Array.isArray(strategies) || strategies.length === 0) {
      throw new Error("No strategies generated");
    }

    // ── Delete old strategies for this project+contentType ──
    await sb
      .from("creative_framing_strategies")
      .delete()
      .eq("project_id", projectId)
      .eq("content_type", contentType);

    // ── Insert new strategies ──
    const rows = strategies.map((s: any, i: number) => ({
      project_id: projectId,
      content_type: contentType,
      strategy_key: s.strategy_key || `strategy_${i}`,
      strategy_type: s.strategy_type || "market_aligned",
      intent: s.intent || "",
      audience_target: s.audience_target || "mass",
      risk_level: s.risk_level || "safe",
      creative_angle: s.creative_angle || "",
      trope_handling: s.trope_handling || "follow",
      visual_language: s.visual_language || "",
      canon_lock_summary: s.canon_lock_summary || "",
      full_brief: s.full_brief || "",
      is_selected: i === 0,
      created_by: user.id,
      meta_json: {},
    }));

    const { data: inserted, error: insertErr } = await sb
      .from("creative_framing_strategies")
      .insert(rows)
      .select();

    if (insertErr) throw insertErr;

    return new Response(
      JSON.stringify({ strategies: inserted, count: inserted?.length || 0 }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (err: any) {
    console.error("generate-framing error:", err);
    return new Response(
      JSON.stringify({ error: err.message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
