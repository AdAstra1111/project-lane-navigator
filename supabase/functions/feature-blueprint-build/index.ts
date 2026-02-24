import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { callLLMWithJsonRetry, callLLMChunked, MODELS } from "../_shared/llm.ts";
import { isObject, hasObject } from "../_shared/validators.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) throw new Error("Not authenticated");

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const apiKey = Deno.env.get("LOVABLE_API_KEY")!;
    const adminClient = createClient(supabaseUrl, supabaseKey);
    const userClient = createClient(supabaseUrl, Deno.env.get("SUPABASE_ANON_KEY")!, {
      global: { headers: { Authorization: authHeader } },
    });

    const { data: { user } } = await userClient.auth.getUser();
    if (!user) throw new Error("Not authenticated");

    const { projectId, blueprintId } = await req.json();
    if (!projectId || !blueprintId) throw new Error("Missing projectId or blueprintId");

    // Verify access
    const { data: bp } = await userClient.from("script_blueprints").select("id").eq("id", blueprintId).single();
    if (!bp) throw new Error("Blueprint not found or no access");

    // Load all scenes ordered
    const { data: scenes, error: scErr } = await adminClient
      .from("script_units")
      .select("id, order_index, title, slugline, location, time_of_day, plaintext, unit_json")
      .eq("project_id", projectId)
      .eq("blueprint_id", blueprintId)
      .eq("unit_type", "scene")
      .order("order_index");
    if (scErr) throw scErr;

    if (!scenes || scenes.length === 0) throw new Error("No scenes found for this blueprint");

    console.log(`[feature-blueprint-build] Building blueprint for ${scenes.length} scenes`);

    // Build scene summaries for LLM
    const sceneSummaries = scenes.map((s: any) => ({
      id: s.id,
      order: s.order_index,
      slugline: s.slugline,
      text_preview: (s.plaintext || "").slice(0, 800),
      unit_json: s.unit_json,
    }));

    const blueprintJson = await callLLMWithJsonRetry({
      apiKey,
      model: MODELS.BALANCED,
      system: `You are an expert screenplay analyst building a master blueprint for a feature film.
Given all scene summaries, generate a comprehensive blueprint JSON with this exact structure:
{
  "meta": { "format": "feature", "title": string, "genre": string, "tone": string, "draft_date": string },
  "structure": {
    "acts": [{ "act": number, "start_scene_id": string, "end_scene_id": string, "turning_points": [{ "name": string, "scene_id": string, "note": string }] }],
    "midpoint": { "scene_id": string, "note": string },
    "climax": { "scene_id": string, "note": string }
  },
  "theme": { "statement": string, "questions": [string], "motifs": [string] },
  "characters": [{ "name": string, "role": string, "goal": string, "misbelief": string, "arc": { "start": string, "shift_scenes": [string], "end": string }, "voice_rules": [string] }],
  "plot_spine": [{ "beat": string, "scene_id": string, "cause": string, "effect": string }],
  "constraints": { "timeline": string, "world_rules": [string], "rating_targets": [string], "must_keep": [string] }
}

Use actual scene IDs from the input. Return ONLY valid JSON.`,
      user: JSON.stringify(sceneSummaries),
      temperature: 0.3,
      maxTokens: 12000,
    }, {
      handler: "feature_blueprint_build",
      validate: (d): d is any => isObject(d) && (hasObject(d, "meta") || hasObject(d, "structure")),
    });

    // Save blueprint
    await adminClient
      .from("script_blueprints")
      .update({ blueprint_json: blueprintJson })
      .eq("id", blueprintId);

    console.log("[feature-blueprint-build] Building dependency links...");
    let links: any[] = [];
    const LINK_BATCH_SIZE = 15; // scenes per batch

    try {
      if (sceneSummaries.length <= LINK_BATCH_SIZE) {
        // Small enough for single call
        links = await callLLMWithJsonRetry({
          apiKey,
          model: MODELS.FAST,
          system: `You are a screenplay dependency analyzer. Given scene summaries with their unit_json metadata, identify links between scenes.
Return a JSON array of links, each with:
- "from_unit_id": string (scene id)
- "to_unit_id": string (scene id)  
- "link_type": one of "setup_payoff", "causality", "character_arc", "continuity", "thematic"
- "strength": number 0-1
- "note": string (brief explanation)

Focus on the strongest, most important connections (max 50 links). Return ONLY a JSON array.`,
          user: JSON.stringify(sceneSummaries),
          temperature: 0.2,
          maxTokens: 8000,
        }, {
          handler: "feature_blueprint_links",
          validate: (d): d is any => Array.isArray(d),
        });
      } else {
        // Chunk by scene batches
        links = await callLLMChunked({
          llmOpts: {
            apiKey,
            model: MODELS.FAST,
            system: `You are a screenplay dependency analyzer. Given scene summaries with their unit_json metadata, identify links between these scenes.
Return a JSON array of links, each with:
- "from_unit_id": string (scene id)
- "to_unit_id": string (scene id)  
- "link_type": one of "setup_payoff", "causality", "character_arc", "continuity", "thematic"
- "strength": number 0-1
- "note": string (brief explanation)

Focus on the strongest connections in this batch. Return ONLY a JSON array.`,
            temperature: 0.2,
            maxTokens: 4000,
          },
          items: sceneSummaries,
          batchSize: LINK_BATCH_SIZE,
          maxBatches: 6,
          handler: "feature_blueprint_links",
          buildUserPrompt: (batch, idx, total) =>
            `Scene batch ${idx + 1} of ${total}. Identify links among and between these scenes:\n${JSON.stringify(batch)}`,
          validate: (d): d is any => Array.isArray(d),
          extractItems: (d: any) => d,
        });
      }
    } catch {
      console.error("[feature-blueprint-build] Failed to parse links");
      links = [];
    }

    // Delete old links for this blueprint
    await adminClient.from("script_unit_links").delete().eq("blueprint_id", blueprintId);

    // Insert new links
    if (links.length > 0) {
      const validSceneIds = new Set(scenes.map((s: any) => s.id));
      const linkRows = links
        .filter((l: any) => validSceneIds.has(l.from_unit_id) && validSceneIds.has(l.to_unit_id))
        .map((l: any) => ({
          project_id: projectId,
          blueprint_id: blueprintId,
          from_unit_id: l.from_unit_id,
          to_unit_id: l.to_unit_id,
          link_type: l.link_type || "causality",
          strength: Math.max(0, Math.min(1, l.strength || 0.5)),
          note: l.note || null,
        }));

      if (linkRows.length > 0) {
        await adminClient.from("script_unit_links").insert(linkRows);
      }
      console.log(`[feature-blueprint-build] Created ${linkRows.length} links`);
    }

    // Build world state
    const worldState: any = {
      knowledge_ledger: [],
      injury_ledger: [],
      relationship_ledger: [],
      prop_ledger: [],
      timeline_notes: [],
    };

    for (const scene of scenes) {
      const uj = scene.unit_json as any;
      if (!uj?.state_delta) continue;
      const sd = uj.state_delta;
      if (sd.knowledge) {
        for (const k of sd.knowledge) {
          const existing = worldState.knowledge_ledger.find((e: any) => e.character === k.character);
          if (existing) existing.knows.push(k.learns);
          else worldState.knowledge_ledger.push({ character: k.character, knows: [k.learns] });
        }
      }
      if (sd.injuries) {
        for (const inj of sd.injuries) {
          worldState.injury_ledger.push({ character: inj.character, status: inj.change });
        }
      }
      if (sd.relationships) {
        for (const rel of sd.relationships) {
          worldState.relationship_ledger.push({ a: rel.a, b: rel.b, status: rel.change });
        }
      }
      if (uj.props) {
        for (const prop of uj.props) {
          const existing = worldState.prop_ledger.find((p: any) => p.prop === prop);
          if (existing) existing.last_seen_scene_id = scene.id;
          else worldState.prop_ledger.push({ prop, status: "present", last_seen_scene_id: scene.id });
        }
      }
    }

    await adminClient.from("script_world_state").upsert({
      project_id: projectId,
      blueprint_id: blueprintId,
      state_json: worldState,
    }, { onConflict: "project_id" });

    // Count link types
    const linkStats: Record<string, number> = {};
    for (const l of links) {
      linkStats[l.link_type] = (linkStats[l.link_type] || 0) + 1;
    }

    return new Response(JSON.stringify({
      blueprintJson,
      actBreaksSummary: blueprintJson.structure?.acts?.map((a: any) => `Act ${a.act}`) || [],
      linkStats,
    }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });

  } catch (err) {
    console.error("[feature-blueprint-build] Error:", err);
    const msg = err instanceof Error ? err.message : "Unknown error";
    const status = msg === "RATE_LIMIT" ? 429 : msg === "PAYMENT_REQUIRED" ? 402 : 500;
    return new Response(JSON.stringify({ error: msg }), {
      status,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
