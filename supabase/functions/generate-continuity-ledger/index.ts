/**
 * generate-continuity-ledger — Generates a structured continuity ledger for a locked episode.
 * Called on episode LOCK. Validates against prior ledgers for contradictions.
 */
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { composeSystem, callLLMWithJsonRetry, MODELS } from "../_shared/llm.ts";
import { isObject, hasObject } from "../_shared/validators.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const { projectId, episodeNumber } = await req.json();
    if (!projectId || !episodeNumber) throw new Error("projectId and episodeNumber required");

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const apiKey = Deno.env.get("LOVABLE_API_KEY")!;
    const sb = createClient(supabaseUrl, serviceKey);

    // Get the episode + script
    const { data: ep } = await sb.from("series_episodes").select("*").eq("project_id", projectId).eq("episode_number", episodeNumber).single();
    if (!ep?.script_id) {
      return new Response(JSON.stringify({ skipped: true, reason: "no_script", episodeNumber }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { data: script } = await sb.from("scripts").select("text_content").eq("id", ep.script_id).single();
    if (!script?.text_content) throw new Error("No script content");

    // Get prior ledgers for contradiction check
    const { data: priorLedgers } = await sb
      .from("episode_continuity_ledgers")
      .select("episode_number, summary")
      .eq("project_id", projectId)
      .lt("episode_number", episodeNumber)
      .eq("status", "locked")
      .order("episode_number", { ascending: true });

    const priorContext = (priorLedgers || []).map(l =>
      `EP${l.episode_number}: ${JSON.stringify(l.summary)}`
    ).join("\n");

    // Get resolver hash
    const { data: proj } = await sb.from("projects").select("season_episode_count").eq("id", projectId).single();

    const system = composeSystem({
      baseSystem: `You are a continuity analyst for episodic drama. Given an episode script, extract a structured continuity ledger. Also check for contradictions with prior episode ledgers.

Return ONLY valid JSON with this schema:
{
  "ledger": {
    "timeline": {"day": number, "time_of_day": "string", "location": "string"},
    "character_states": {"CHARACTER_NAME": {"goal":"...","emotion":"...","injury":"...","secret_known":["..."]}},
    "relationship_deltas": [{"a":"NAME","b":"NAME","change":"string","why":"string"}],
    "secrets_revealed": ["..."],
    "props_locations_introduced": ["..."],
    "open_threads": ["..."],
    "cliffhanger": {"type":"string","text":"..."}
  },
  "contradictions": [{"episode": number, "issue": "string", "severity": "high|medium|low"}]
}`,
    });

    const userPrompt = `EPISODE ${episodeNumber} of ${proj?.season_episode_count || 30} SCRIPT:
${script.text_content.slice(0, 12000)}

PRIOR EPISODE LEDGERS:
${priorContext || "(none — this is the first episode)"}

Extract the continuity ledger and check for contradictions.`;

    const parsed = await callLLMWithJsonRetry({ apiKey, model: MODELS.FAST, system, user: userPrompt, temperature: 0.2, maxTokens: 4000 }, {
      handler: "generate_continuity_ledger",
      validate: (d): d is any => isObject(d) && (hasObject(d, "ledger") || hasObject(d, "timeline")),
    });

    // Upsert ledger
    const authHeader = req.headers.get("Authorization");
    const token = authHeader?.replace("Bearer ", "");
    let userId = ep.user_id;
    if (token) {
      const sbAuth = createClient(supabaseUrl, Deno.env.get("SUPABASE_ANON_KEY")!);
      const { data: { user } } = await sbAuth.auth.getUser(token);
      if (user) userId = user.id;
    }

    await sb.from("episode_continuity_ledgers").upsert({
      project_id: projectId,
      episode_number: episodeNumber,
      status: "locked",
      resolver_hash: ep.resolver_hash_used || "",
      summary: parsed.ledger || parsed,
      user_id: userId,
    }, { onConflict: "project_id,episode_number" });

    return new Response(JSON.stringify({
      ledger: parsed.ledger || parsed,
      contradictions: parsed.contradictions || [],
    }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });

  } catch (err) {
    console.error("generate-continuity-ledger error:", err);
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
