/**
 * propose-retcon-patches — Generates minimal patch suggestions for impacted episodes.
 */
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { composeSystem, callLLMWithJsonRetry, MODELS } from "../_shared/llm.ts";
import { isObject, hasArray } from "../_shared/validators.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const { retconEventId, episodeNumbers } = await req.json();
    if (!retconEventId || !episodeNumbers?.length) throw new Error("retconEventId and episodeNumbers required");

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const apiKey = Deno.env.get("LOVABLE_API_KEY")!;
    const sb = createClient(supabaseUrl, serviceKey);

    const { data: event } = await sb.from("retcon_events").select("*").eq("id", retconEventId).single();
    if (!event) throw new Error("Retcon event not found");

    const patches: any[] = [];

    for (const epNum of episodeNumbers) {
      // Get episode script
      const { data: ep } = await sb.from("series_episodes").select("script_id, title").eq("project_id", event.project_id).eq("episode_number", epNum).single();
      if (!ep?.script_id) continue;

      const { data: script } = await sb.from("scripts").select("text_content").eq("id", ep.script_id).single();
      if (!script?.text_content) continue;

      // Get ledger
      const { data: ledger } = await sb.from("episode_continuity_ledgers").select("summary").eq("project_id", event.project_id).eq("episode_number", epNum).maybeSingle();

      const system = composeSystem({
        baseSystem: `You are a script patch specialist. Given a change to a core document, propose MINIMAL changes to an episode script to maintain consistency. Preserve as much of the original as possible.

Return ONLY valid JSON:
{
  "changes": [{"location": "description of where in script", "original": "original text snippet", "replacement": "new text", "reason": "why this change"}],
  "summary": "one-line summary of all changes",
  "risk_level": "low|medium|high"
}`,
      });

      const userPrompt = `RETCON: ${event.change_summary}
IMPACT ANALYSIS: ${JSON.stringify(event.impact_analysis)}

EPISODE ${epNum} "${ep.title}" SCRIPT:
${script.text_content.slice(0, 10000)}

CONTINUITY LEDGER:
${ledger ? JSON.stringify(ledger.summary) : "(none)"}

Propose minimal patches.`;

      const parsed = await callLLMWithJsonRetry({ apiKey, model: MODELS.FAST, system, user: userPrompt, temperature: 0.3, maxTokens: 3000 }, {
        handler: "propose_retcon_patches",
        validate: (d): d is any => isObject(d) && hasArray(d, "changes"),
      });

      patches.push({ episode_number: epNum, ...parsed });
    }

    // Store patches on event
    await sb.from("retcon_events").update({
      patch_suggestions: patches,
      status: "patches_ready",
    }).eq("id", retconEventId);

    return new Response(JSON.stringify({ patches }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

  } catch (err) {
    console.error("propose-retcon-patches error:", err);
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
