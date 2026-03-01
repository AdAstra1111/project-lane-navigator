import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) throw new Error("Not authenticated");

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) throw new Error("LOVABLE_API_KEY not configured");

    const supabase = createClient(supabaseUrl, serviceKey);

    // Verify user
    const anonClient = createClient(supabaseUrl, Deno.env.get("SUPABASE_ANON_KEY")!);
    const { data: { user }, error: userError } = await anonClient.auth.getUser(
      authHeader.replace("Bearer ", "")
    );
    if (userError || !user) throw new Error("Invalid auth token");

    const { pitchIdeaId } = await req.json();
    if (!pitchIdeaId) throw new Error("pitchIdeaId required");

    // Fetch the pitch idea
    const { data: idea, error: ideaErr } = await supabase
      .from("pitch_ideas")
      .select("*")
      .eq("id", pitchIdeaId)
      .eq("user_id", user.id)
      .single();

    if (ideaErr || !idea) throw new Error("Pitch idea not found or access denied");

    // Build context for DevSeed generation
    const ideaContext = {
      title: idea.title,
      logline: idea.logline,
      one_page_pitch: idea.one_page_pitch,
      genre: idea.genre,
      production_type: idea.production_type,
      budget_band: idea.budget_band,
      recommended_lane: idea.recommended_lane,
      comps: idea.comps || [],
      packaging_suggestions: idea.packaging_suggestions || [],
      risks_mitigations: idea.risks_mitigations || [],
      why_us: idea.why_us || "",
      risk_level: idea.risk_level,
      score_total: idea.score_total,
    };

    // ── Build convergence guidance block from pitch metadata (if present) ──
    let convergenceGuidanceBlock = "";
    const rawResponse = idea.raw_response || {};
    const sm = rawResponse.signals_metadata;
    if (sm?.convergence_applied && sm?.convergence_summary) {
      const cs = sm.convergence_summary;
      const parts: string[] = [];

      if (Array.isArray(cs.genre_heat) && cs.genre_heat.length > 0) {
        parts.push(`Genre Heat:\n${cs.genre_heat.map((g: any) => `  - ${g.genre} (heat=${g.score})`).join("\n")}`);
      }
      if (cs.tone_style?.tone_band || cs.tone_style?.pacing) {
        const tsParts: string[] = [];
        if (cs.tone_style.tone_band) tsParts.push(`tone=${cs.tone_style.tone_band}`);
        if (cs.tone_style.pacing) tsParts.push(`pacing=${cs.tone_style.pacing}`);
        parts.push(`Tone/Style: ${tsParts.join(", ")}`);
      }
      if (Array.isArray(cs.comparable_titles) && cs.comparable_titles.length > 0) {
        parts.push(`Audience Reference Points (do NOT clone plots — tonal/market anchors only):\n${cs.comparable_titles.map((t: string) => `  - ${t}`).join("\n")}`);
      }
      if (Array.isArray(cs.constraints_notes) && cs.constraints_notes.length > 0) {
        parts.push(`Market Constraints:\n${cs.constraints_notes.map((n: string) => `  - ${n}`).join("\n")}`);
      }
      if (Array.isArray(cs.risks) && cs.risks.length > 0) {
        parts.push(`Saturation Risks:\n${cs.risks.map((r: any) => `  - [${r.severity}] ${r.label}`).join("\n")}`);
      }

      if (parts.length > 0) {
        convergenceGuidanceBlock = `\n\n=== CONVERGENCE GUIDANCE (FROM PITCH — AUDIENCE APPETITE CONTEXT) ===\n${parts.join("\n")}\n\nINSTRUCTION:\n- Treat as strong recommendations for voice, tone, pacing, and world density.\n- Stay original; do not clone plots or characters from reference titles.\n- Keep one "novelty slot" consistent with the pitch's differentiation move.\n- Do NOT write this guidance into canon — use it to shape the creative DNA of foundation docs.\n=== END CONVERGENCE GUIDANCE ===\n`;
        console.log(`[promote-to-devseed] Convergence guidance injected: ${cs.genre_heat?.length || 0} genres, ${cs.comparable_titles?.length || 0} comps`);
      }
    }

    // Generate DevSeed via AI
    const systemPrompt = `You are IFFY's DevSeed Generator. Given a pitch idea, create a comprehensive development seed document with three sections:

1. BIBLE STARTER — The foundational creative document:
   - World: Setting, rules, visual palette, period
   - Characters: 3-5 key characters with names, roles, arcs, flaws
   - Tone & Style: Reference points, what this feels like
   - Story Engine: What drives episodes/scenes forward
   - Themes: Core thematic pillars

2. NUANCE CONTRACT — Creative guardrails for development:
   - Restraint Level: 1-10 scale with rationale
   - Conflict Mode: primary conflict driver (e.g., interpersonal, systemic, internal, survival)
   - Complexity Cap: max plot threads, max factions, max core characters
   - Melodrama Guard: what emotional beats to avoid overdoing
   - Tone Boundaries: what this show/film IS NOT

3. MARKET RATIONALE — Commercial justification:
   - Comparable Analysis: why each comp is relevant, what to take and avoid
   - Lane Justification: why this lane is optimal, alternatives considered
   - Buyer Positioning: which buyers/platforms, pitch angle for each
   - Timing: market window, trend alignment
   - Risk Summary: top 3 risks with mitigations
${convergenceGuidanceBlock}
Output as a JSON object with keys: bible_starter, nuance_contract, market_rationale. Each should be a well-structured object.`;

    // Fetch with retry for transient gateway errors (502/503)
    let response: Response | null = null;
    const MAX_RETRIES = 2;
    const aiPayload = JSON.stringify({
        model: "google/gemini-2.5-flash",
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: `Generate a DevSeed for this pitch idea:\n\n${JSON.stringify(ideaContext, null, 2)}` },
        ],
        tools: [
          {
            type: "function",
            function: {
              name: "submit_devseed",
              description: "Submit the generated DevSeed payload",
              parameters: {
                type: "object",
                properties: {
                  bible_starter: {
                    type: "object",
                    properties: {
                      world: { type: "string" },
                      characters: { type: "array", items: { type: "object", properties: { name: { type: "string" }, role: { type: "string" }, arc: { type: "string" }, flaw: { type: "string" } }, required: ["name", "role", "arc"] } },
                      tone_and_style: { type: "string" },
                      story_engine: { type: "string" },
                      themes: { type: "array", items: { type: "string" } },
                    },
                    required: ["world", "characters", "tone_and_style", "story_engine", "themes"],
                  },
                  nuance_contract: {
                    type: "object",
                    properties: {
                      restraint_level: { type: "number" },
                      restraint_rationale: { type: "string" },
                      conflict_mode: { type: "string" },
                      complexity_cap: { type: "object", properties: { max_plot_threads: { type: "number" }, max_factions: { type: "number" }, max_core_characters: { type: "number" } } },
                      melodrama_guard: { type: "string" },
                      tone_boundaries: { type: "string" },
                    },
                    required: ["restraint_level", "conflict_mode", "complexity_cap", "melodrama_guard", "tone_boundaries"],
                  },
                  market_rationale: {
                    type: "object",
                    properties: {
                      comparable_analysis: { type: "array", items: { type: "object", properties: { title: { type: "string" }, relevance: { type: "string" }, take: { type: "string" }, avoid: { type: "string" } }, required: ["title", "relevance"] } },
                      lane_justification: { type: "string" },
                      buyer_positioning: { type: "array", items: { type: "object", properties: { buyer: { type: "string" }, angle: { type: "string" } }, required: ["buyer", "angle"] } },
                      timing: { type: "string" },
                      risk_summary: { type: "array", items: { type: "object", properties: { risk: { type: "string" }, mitigation: { type: "string" } }, required: ["risk", "mitigation"] } },
                    },
                    required: ["comparable_analysis", "lane_justification", "buyer_positioning", "timing", "risk_summary"],
                  },
                },
                required: ["bible_starter", "nuance_contract", "market_rationale"],
                additionalProperties: false,
              },
            },
          },
        ],
        tool_choice: { type: "function", function: { name: "submit_devseed" } },
      });

    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      response = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${LOVABLE_API_KEY}`,
          "Content-Type": "application/json",
        },
        body: aiPayload,
      });

      if (response.ok) break;

      // Retry on transient gateway errors
      if ((response.status === 502 || response.status === 503) && attempt < MAX_RETRIES) {
        const backoffMs = 2000 * (attempt + 1);
        console.warn(`[promote-to-devseed] AI gateway returned ${response.status}, retrying in ${backoffMs}ms (attempt ${attempt + 1}/${MAX_RETRIES})`);
        await response.text(); // consume body
        await new Promise(r => setTimeout(r, backoffMs));
        continue;
      }

      const t = await response.text();
      console.error("AI error:", response.status, t);
      throw new Error(`DevSeed generation failed (AI returned ${response.status})`);
    }

    if (!response || !response.ok) {
      throw new Error("DevSeed generation failed after retries");
    }

    const result = await response.json();
    const msg = result.choices?.[0]?.message;
    const toolCall = msg?.tool_calls?.[0];

    let devSeed: any;
    if (toolCall?.function?.arguments) {
      devSeed = JSON.parse(toolCall.function.arguments);
    } else if (msg?.content) {
      const jsonMatch = msg.content.match(/\{[\s\S]*\}/);
      if (jsonMatch) devSeed = JSON.parse(jsonMatch[0]);
      else throw new Error("No structured DevSeed output");
    } else {
      throw new Error("No DevSeed output returned");
    }

    // Store as a concept_expansion record (draft, not applied)
    const { data: expansion, error: expErr } = await supabase
      .from("concept_expansions")
      .insert({
        pitch_idea_id: pitchIdeaId,
        user_id: user.id,
        production_type: idea.production_type,
        treatment: devSeed.bible_starter?.world || "",
        character_bible: JSON.stringify(devSeed.bible_starter?.characters || []),
        tone_doc: devSeed.bible_starter?.tone_and_style || "",
        world_bible: devSeed.bible_starter?.story_engine || "",
        arc_map: JSON.stringify(devSeed.bible_starter?.themes || []),
        raw_response: devSeed,
        version: 1,
      })
      .select("id")
      .single();

    if (expErr) {
      console.error("Failed to store DevSeed:", expErr);
      // Non-fatal — still return the payload
    }

    // Auto-extract episode count from format_summary and persist as devseed canon
    const ideaRawResponse = idea.raw_response || {};
    const formatSummary = ideaRawResponse.format_summary || ideaRawResponse.format || '';
    let extractedEpCount: number | null = null;
    const epMatch = formatSummary.match(/(\d+)\s*x\s*/i) || formatSummary.match(/(\d+)\s*episodes/i);
    if (epMatch) extractedEpCount = parseInt(epMatch[1]);

    const updatePayload: Record<string, any> = { status: "in-development" };
    
    // Persist canon if we extracted an episode count and none is set yet
    const existingCanon = idea.devseed_canon_json || {};
    if (extractedEpCount && extractedEpCount > 0 && !existingCanon.season_episode_count) {
      updatePayload.devseed_canon_json = {
        ...existingCanon,
        season_episode_count: extractedEpCount,
        format: idea.production_type || 'vertical-drama',
        locked: true,
        locked_at: new Date().toISOString(),
        source: 'format_summary_auto',
      };
      console.log(`[promote-to-devseed] Auto-persisted canon episode count: ${extractedEpCount} from format_summary`);
    }

    // Update pitch idea status (and canon if extracted)
    await supabase
      .from("pitch_ideas")
      .update(updatePayload)
      .eq("id", pitchIdeaId);

    return new Response(JSON.stringify({
      devseed: devSeed,
      expansion_id: expansion?.id || null,
      pitch_idea_id: pitchIdeaId,
    }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

  } catch (e) {
    console.error("promote-to-devseed error:", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
