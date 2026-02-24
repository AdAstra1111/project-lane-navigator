/**
 * episode-compliance — Runs template compliance scoring against the season style profile.
 * Returns tone_match, pacing_match, dialogue_voice, cliffhanger_strength, overall scores + flags.
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

    // Get episode script
    const { data: ep } = await sb.from("series_episodes").select("*").eq("project_id", projectId).eq("episode_number", episodeNumber).single();
    if (!ep?.script_id) {
      return new Response(JSON.stringify({ skipped: true, reason: "no_script", episodeNumber }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { data: script } = await sb.from("scripts").select("text_content").eq("id", ep.script_id).single();
    if (!script?.text_content) throw new Error("No script content");

    // Get season style profile
    const { data: proj } = await sb.from("projects").select("season_style_profile, season_style_template_version_id, season_episode_count").eq("id", projectId).single();

    // Get template episode content if exists
    let templateContent = "";
    const { data: templateEp } = await sb.from("series_episodes").select("script_id").eq("project_id", projectId).eq("is_season_template", true).maybeSingle();
    if (templateEp?.script_id) {
      const { data: tScript } = await sb.from("scripts").select("text_content").eq("id", templateEp.script_id).single();
      templateContent = tScript?.text_content?.slice(0, 5000) || "";
    }

    const styleProfile = proj?.season_style_profile ? JSON.stringify(proj.season_style_profile) : "No style profile set";

    const system = composeSystem({
      baseSystem: `You are a quality compliance scorer for episodic drama. Compare an episode script against the season's style template and profile.

Score each dimension 0-100 and provide flags for issues.

Return ONLY valid JSON:
{
  "scores": {
    "tone_match": 0-100,
    "pacing_match": 0-100,
    "dialogue_voice": 0-100,
    "cliffhanger_strength": 0-100,
    "overall": 0-100
  },
  "flags": ["flag1", "flag2"],
  "suggestions": "Top 3 actionable fixes as text",
  "pass": true/false
}

"pass" = overall >= 65.`,
    });

    const userPrompt = `SEASON STYLE PROFILE:
${styleProfile}

TEMPLATE EPISODE (style benchmark):
${templateContent || "(no template set)"}

EPISODE ${episodeNumber} of ${proj?.season_episode_count || 30} TO SCORE:
${script.text_content.slice(0, 10000)}

Score compliance.`;

    const parsed = await callLLMWithJsonRetry({ apiKey, model: MODELS.FAST, system, user: userPrompt, temperature: 0.2, maxTokens: 2000 }, {
      handler: "episode_compliance",
      validate: (d): d is any => isObject(d) && hasObject(d, "scores"),
    });

    // Get user from auth
    const authHeader = req.headers.get("Authorization");
    const token = authHeader?.replace("Bearer ", "");
    let userId = ep.user_id;
    if (token) {
      const sbAuth = createClient(supabaseUrl, Deno.env.get("SUPABASE_ANON_KEY")!);
      const { data: { user } } = await sbAuth.auth.getUser(token);
      if (user) userId = user.id;
    }

    // Store compliance report
    await sb.from("episode_compliance_reports").insert({
      project_id: projectId,
      episode_number: episodeNumber,
      resolver_hash: ep.resolver_hash_used || "",
      template_version_id: proj?.season_style_template_version_id || null,
      scores: parsed.scores || { tone_match: 0, pacing_match: 0, dialogue_voice: 0, cliffhanger_strength: 0, overall: 0 },
      flags: parsed.flags || [],
      suggestions: parsed.suggestions || "",
      user_id: userId,
    });

    // Update episode compliance_score
    const overall = parsed.scores?.overall || 0;
    await sb.from("series_episodes").update({ compliance_score: overall }).eq("id", ep.id);

    return new Response(JSON.stringify(parsed), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

  } catch (err) {
    console.error("episode-compliance error:", err);
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
