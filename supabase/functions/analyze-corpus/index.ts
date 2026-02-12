import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const ANALYSIS_MODEL = "google/gemini-2.5-flash";

async function callAIWithTools(apiKey: string, systemPrompt: string, userPrompt: string, tools: any[], toolChoice: any) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 55000);
  try {
    const resp = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      signal: controller.signal,
      body: JSON.stringify({
        model: ANALYSIS_MODEL,
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt },
        ],
        tools,
        tool_choice: toolChoice,
      }),
    });
    if (!resp.ok) {
      if (resp.status === 429) throw new Error("Rate limit exceeded. Please try again in a moment.");
      if (resp.status === 402) throw new Error("AI usage limit reached. Please add credits.");
      throw new Error(`AI error ${resp.status}`);
    }
    const data = await resp.json();
    const toolCall = data.choices?.[0]?.message?.tool_calls?.[0];
    if (toolCall) return JSON.parse(toolCall.function.arguments);
    // Fallback: parse content as JSON
    const content = data.choices?.[0]?.message?.content || "";
    const m = content.match(/\{[\s\S]*\}/);
    return m ? JSON.parse(m[0]) : {};
  } finally {
    clearTimeout(timeout);
  }
}

function median(arr: number[]): number {
  if (arr.length === 0) return 0;
  const sorted = [...arr].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) throw new Error("Missing auth header");

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const lovableKey = Deno.env.get("LOVABLE_API_KEY");
    if (!lovableKey) throw new Error("LOVABLE_API_KEY not configured");

    const userClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: { user }, error: authErr } = await userClient.auth.getUser();
    if (authErr || !user) throw new Error("Unauthorized");

    const db = createClient(supabaseUrl, supabaseKey);
    const { action, ...params } = await req.json();

    // ═══ ACTION: ANALYZE (single script) ═══
    if (action === "analyze") {
      const { script_id } = params;
      if (!script_id) throw new Error("script_id required");

      // Get script + its chunks for text
      const { data: script, error: sErr } = await db
        .from("corpus_scripts")
        .select("*, approved_sources(title)")
        .eq("id", script_id)
        .eq("user_id", user.id)
        .single();
      if (sErr || !script) throw new Error("Script not found");

      // Mark as analyzing
      await db.from("corpus_scripts").update({ analysis_status: "analyzing" }).eq("id", script_id);

      // Get script text from chunks
      const { data: chunks } = await db
        .from("corpus_chunks")
        .select("chunk_text")
        .eq("script_id", script_id)
        .order("chunk_index", { ascending: true });

      const fullText = (chunks || []).map((c: any) => c.chunk_text).join("\n");
      const excerpt = fullText.slice(0, 20000);
      const title = script.approved_sources?.title || "Unknown";

      const systemPrompt = `You are a professional screenplay analyst. Analyze the provided screenplay "${title}" and extract structured intelligence. Be precise with numbers. Base all metrics on the actual text provided.`;

      const userPrompt = `Analyze this screenplay excerpt and extract all structural intelligence:

SCREENPLAY TEXT:
${excerpt}

Extract: format type, genre, subgenre, page count, estimated runtime, scene count, word count, average scene length (in pages), dialogue-to-action ratio (0-1), cast count (speaking roles), location count, INT/EXT ratio, DAY/NIGHT ratio, VFX intensity (boolean), budget tier (micro/low/medium/high/mega), quality score (0-100), market success likelihood, midpoint position (fraction 0-1), climax position (fraction 0-1).

Also extract up to 30 scene patterns and up to 15 character profiles.`;

      const tools = [{
        type: "function",
        function: {
          name: "store_analysis",
          description: "Store the structured analysis results",
          parameters: {
            type: "object",
            properties: {
              title: { type: "string" },
              production_type: { type: "string", enum: ["film", "tv-series", "short-film", "documentary", "tv-pilot"] },
              format_subtype: { type: "string" },
              genre: { type: "string" },
              subgenre: { type: "string" },
              page_count: { type: "integer" },
              runtime_est: { type: "number" },
              scene_count: { type: "integer" },
              word_count: { type: "integer" },
              avg_scene_length: { type: "number" },
              avg_dialogue_ratio: { type: "number" },
              cast_count: { type: "integer" },
              location_count: { type: "integer" },
              int_ext_ratio: { type: "number" },
              day_night_ratio: { type: "number" },
              vfx_flag: { type: "boolean" },
              budget_tier_est: { type: "string" },
              quality_score_est: { type: "number" },
              market_success_flag: { type: "boolean" },
              midpoint_position: { type: "number" },
              climax_position: { type: "number" },
              scene_patterns: {
                type: "array",
                items: {
                  type: "object",
                  properties: {
                    scene_number: { type: "integer" },
                    act_estimate: { type: "integer" },
                    has_turn: { type: "boolean" },
                    conflict_type: { type: "string" },
                    scene_length_est: { type: "number" },
                  },
                  required: ["scene_number", "act_estimate"],
                },
              },
              character_profiles: {
                type: "array",
                items: {
                  type: "object",
                  properties: {
                    character_name: { type: "string" },
                    dialogue_ratio: { type: "number" },
                    arc_type: { type: "string" },
                    protagonist_flag: { type: "boolean" },
                  },
                  required: ["character_name"],
                },
              },
            },
            required: ["production_type", "genre", "page_count", "scene_count", "avg_dialogue_ratio"],
          },
        },
      }];

      const result = await callAIWithTools(lovableKey, systemPrompt, userPrompt, tools, {
        type: "function", function: { name: "store_analysis" },
      });

      // Update corpus_scripts with analysis results
      await db.from("corpus_scripts").update({
        title: result.title || title,
        production_type: result.production_type || "film",
        format_subtype: result.format_subtype || "",
        genre: result.genre || "",
        subgenre: result.subgenre || "",
        page_count: result.page_count || null,
        runtime_est: result.runtime_est || null,
        scene_count: result.scene_count || null,
        word_count: result.word_count || null,
        avg_scene_length: result.avg_scene_length || null,
        avg_dialogue_ratio: result.avg_dialogue_ratio || null,
        cast_count: result.cast_count || null,
        location_count: result.location_count || null,
        int_ext_ratio: result.int_ext_ratio || null,
        day_night_ratio: result.day_night_ratio || null,
        vfx_flag: result.vfx_flag || false,
        budget_tier_est: result.budget_tier_est || null,
        quality_score_est: result.quality_score_est || null,
        market_success_flag: result.market_success_flag || false,
        midpoint_position: result.midpoint_position || null,
        climax_position: result.climax_position || null,
        analysis_status: "complete",
      }).eq("id", script_id);

      // Insert scene patterns
      if (result.scene_patterns?.length) {
        // Clear existing
        await db.from("corpus_scene_patterns").delete().eq("corpus_script_id", script_id);
        const rows = result.scene_patterns.map((sp: any) => ({
          corpus_script_id: script_id,
          user_id: user.id,
          scene_number: sp.scene_number,
          act_estimate: sp.act_estimate,
          has_turn: sp.has_turn || false,
          conflict_type: sp.conflict_type || "",
          scene_length_est: sp.scene_length_est || null,
        }));
        await db.from("corpus_scene_patterns").insert(rows);
      }

      // Insert character profiles
      if (result.character_profiles?.length) {
        await db.from("corpus_character_profiles").delete().eq("corpus_script_id", script_id);
        const rows = result.character_profiles.map((cp: any) => ({
          corpus_script_id: script_id,
          user_id: user.id,
          character_name: cp.character_name,
          dialogue_ratio: cp.dialogue_ratio || null,
          arc_type: cp.arc_type || "",
          protagonist_flag: cp.protagonist_flag || false,
        }));
        await db.from("corpus_character_profiles").insert(rows);
      }

      return new Response(JSON.stringify({ success: true, script_id, analysis: result }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // ═══ ACTION: AGGREGATE (build calibration models) ═══
    if (action === "aggregate") {
      const { data: completed } = await db
        .from("corpus_scripts")
        .select("*")
        .eq("user_id", user.id)
        .eq("analysis_status", "complete");

      if (!completed?.length) throw new Error("No completed analyses to aggregate");

      // Group by production_type
      const groups: Record<string, any[]> = {};
      for (const s of completed) {
        const key = s.production_type || "film";
        if (!groups[key]) groups[key] = [];
        groups[key].push(s);
      }

      // Clear existing insights for this user
      await db.from("corpus_insights").delete().eq("user_id", user.id).eq("insight_type", "calibration");

      const insights: any[] = [];
      for (const [prodType, scripts] of Object.entries(groups)) {
        const pattern = {
          sample_size: scripts.length,
          median_page_count: median(scripts.map(s => s.page_count).filter(Boolean)),
          median_scene_count: median(scripts.map(s => s.scene_count).filter(Boolean)),
          median_runtime: median(scripts.map(s => s.runtime_est).filter(Boolean)),
          median_dialogue_ratio: median(scripts.map(s => s.avg_dialogue_ratio).filter(Boolean)),
          median_cast_size: median(scripts.map(s => s.cast_count).filter(Boolean)),
          median_location_count: median(scripts.map(s => s.location_count).filter(Boolean)),
          median_midpoint_position: median(scripts.map(s => s.midpoint_position).filter(Boolean)),
          median_climax_position: median(scripts.map(s => s.climax_position).filter(Boolean)),
          median_avg_scene_length: median(scripts.map(s => s.avg_scene_length).filter(Boolean)),
          median_quality_score: median(scripts.map(s => s.quality_score_est).filter(Boolean)),
          vfx_rate: scripts.filter(s => s.vfx_flag).length / scripts.length,
          budget_distribution: scripts.reduce((acc: Record<string, number>, s) => {
            const tier = s.budget_tier_est || "unknown";
            acc[tier] = (acc[tier] || 0) + 1;
            return acc;
          }, {}),
        };

        insights.push({
          user_id: user.id,
          insight_type: "calibration",
          production_type: prodType,
          lane: null,
          pattern,
          weight: scripts.length,
        });
      }

      if (insights.length > 0) {
        await db.from("corpus_insights").insert(insights);
      }

      return new Response(JSON.stringify({ success: true, groups: Object.keys(groups).length, total: completed.length }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // ═══ ACTION: GENERATE-PLAYBOOKS ═══
    if (action === "generate-playbooks") {
      const { data: topScripts } = await db
        .from("corpus_scripts")
        .select("*")
        .eq("user_id", user.id)
        .eq("analysis_status", "complete")
        .gte("quality_score_est", 70)
        .order("quality_score_est", { ascending: false })
        .limit(20);

      if (!topScripts?.length) throw new Error("No high-quality scripts analyzed yet");

      const scriptSummaries = topScripts.map(s =>
        `"${s.title}" (${s.production_type}, ${s.genre}) — pages: ${s.page_count}, scenes: ${s.scene_count}, dialogue: ${Math.round((s.avg_dialogue_ratio || 0) * 100)}%, midpoint: ${s.midpoint_position}, quality: ${s.quality_score_est}`
      ).join("\n");

      const systemPrompt = "You are a screenplay development strategist. Extract rewrite playbooks from patterns in successful scripts.";
      const userPrompt = `From these top-scoring scripts, extract 5-8 rewrite playbooks — actionable structural patterns that can improve weaker drafts:

${scriptSummaries}

Each playbook should have: name, description, operations (array of specific rewrite steps), applicable_production_types, and priority (1-3).`;

      const tools = [{
        type: "function",
        function: {
          name: "store_playbooks",
          description: "Store extracted rewrite playbooks",
          parameters: {
            type: "object",
            properties: {
              playbooks: {
                type: "array",
                items: {
                  type: "object",
                  properties: {
                    name: { type: "string" },
                    description: { type: "string" },
                    operations: { type: "array", items: { type: "string" } },
                    applicable_production_types: { type: "array", items: { type: "string" } },
                    priority: { type: "integer" },
                  },
                  required: ["name", "description", "operations"],
                },
              },
            },
            required: ["playbooks"],
          },
        },
      }];

      const result = await callAIWithTools(lovableKey, systemPrompt, userPrompt, tools, {
        type: "function", function: { name: "store_playbooks" },
      });

      // Clear existing playbooks and store new
      await db.from("corpus_insights").delete().eq("user_id", user.id).eq("insight_type", "playbook");

      if (result.playbooks?.length) {
        const rows = result.playbooks.map((pb: any) => ({
          user_id: user.id,
          insight_type: "playbook",
          production_type: (pb.applicable_production_types || []).join(","),
          lane: null,
          pattern: pb,
          weight: pb.priority || 2,
        }));
        await db.from("corpus_insights").insert(rows);
      }

      return new Response(JSON.stringify({ success: true, playbooks: result.playbooks?.length || 0 }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    throw new Error(`Unknown action: ${action}`);
  } catch (e) {
    console.error("analyze-corpus error:", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }), {
      status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
