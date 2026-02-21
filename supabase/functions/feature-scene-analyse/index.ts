import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { callLLM, parseJsonSafe, MODELS } from "../_shared/llm.ts";

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

    const { projectId, unitId, proposedPlaintext } = await req.json();
    if (!projectId || !unitId) throw new Error("Missing projectId or unitId");

    // Load the scene
    const { data: unit } = await adminClient
      .from("script_units")
      .select("id, blueprint_id, order_index, title, slugline, plaintext, unit_json, project_id")
      .eq("id", unitId)
      .single();
    if (!unit) throw new Error("Scene unit not found");

    // Load blueprint
    const { data: bp } = await adminClient
      .from("script_blueprints")
      .select("blueprint_json")
      .eq("id", unit.blueprint_id)
      .single();

    // Load links involving this unit
    const { data: linksFrom } = await adminClient
      .from("script_unit_links")
      .select("id, to_unit_id, link_type, strength, note")
      .eq("from_unit_id", unitId);
    const { data: linksTo } = await adminClient
      .from("script_unit_links")
      .select("id, from_unit_id, link_type, strength, note")
      .eq("to_unit_id", unitId);

    // Load connected scenes (1 hop)
    const connectedIds = new Set<string>();
    for (const l of (linksFrom || [])) connectedIds.add(l.to_unit_id);
    for (const l of (linksTo || [])) connectedIds.add(l.from_unit_id);
    connectedIds.delete(unitId);

    let connectedScenes: any[] = [];
    if (connectedIds.size > 0) {
      const { data } = await adminClient
        .from("script_units")
        .select("id, order_index, title, slugline, plaintext, unit_json")
        .in("id", Array.from(connectedIds));
      connectedScenes = data || [];
    }

    // Load world state
    const { data: worldState } = await adminClient
      .from("script_world_state")
      .select("state_json")
      .eq("project_id", projectId)
      .single();

    const currentText = unit.plaintext || "";
    const textToAnalyze = proposedPlaintext || currentText;
    const hasProposed = !!proposedPlaintext && proposedPlaintext !== currentText;

    // Build analysis prompt
    const context = {
      scene: {
        id: unit.id,
        order_index: unit.order_index,
        slugline: unit.slugline,
        current_text: currentText.slice(0, 3000),
        proposed_text: hasProposed ? proposedPlaintext.slice(0, 3000) : null,
        unit_json: unit.unit_json,
      },
      blueprint: bp?.blueprint_json || {},
      connected_scenes: connectedScenes.map((s: any) => ({
        id: s.id,
        order_index: s.order_index,
        slugline: s.slugline,
        text_preview: (s.plaintext || "").slice(0, 500),
        unit_json: s.unit_json,
      })),
      links_from: linksFrom || [],
      links_to: linksTo || [],
      world_state: worldState?.state_json || {},
    };

    const result = await callLLM({
      apiKey,
      model: MODELS.BALANCED,
      system: `You are a professional script supervisor and story analyst for feature films.
Analyze the given scene in context of the full screenplay blueprint, connected scenes, and world state.
${hasProposed ? "The user has proposed changes to the scene text. Identify what changed and analyze implications." : "Analyze the current scene for issues."}

Return a JSON object with:
{
  "notes": [
    {
      "id": string (unique),
      "severity": "must" | "should" | "could",
      "scope": "scene" | "dependency" | "blueprint",
      "summary": string,
      "detail": string,
      "impacted_unit_ids": [string],
      "suggested_fixes": [
        { "fix_id": string, "label": string, "action": "rewrite_scene" | "patch_impacted" | "update_blueprint", "payload": {} }
      ]
    }
  ],
  "impacts": [{ "unit_id": string, "why": string }],
  "updated_unit_json_preview": <updated unit_json reflecting proposed changes>
}

Focus on:
- Setup/payoff breaks (tag mismatches)
- Character inconsistencies vs arc/voice rules in blueprint
- Continuity issues vs world state (knowledge, injuries, props)
- Pacing/act-turn risks if scene function changes
- New character introductions not in blueprint (flag as MUST)
- Chronology violations

Return ONLY valid JSON.`,
      user: JSON.stringify(context),
      temperature: 0.3,
      maxTokens: 8000,
    });

    const analysis = await parseJsonSafe(result.content, apiKey);

    return new Response(JSON.stringify(analysis), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

  } catch (err) {
    console.error("[feature-scene-analyse] Error:", err);
    const msg = err instanceof Error ? err.message : "Unknown error";
    const status = msg === "RATE_LIMIT" ? 429 : msg === "PAYMENT_REQUIRED" ? 402 : 500;
    return new Response(JSON.stringify({ error: msg }), {
      status,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
