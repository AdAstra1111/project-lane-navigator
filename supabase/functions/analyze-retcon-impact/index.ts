/**
 * analyze-retcon-impact — Identifies episodes impacted by a core doc change.
 * Compares new vs previous doc version, checks locked ledgers for references.
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
    const { retconEventId } = await req.json();
    if (!retconEventId) throw new Error("retconEventId required");

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const apiKey = Deno.env.get("LOVABLE_API_KEY")!;
    const sb = createClient(supabaseUrl, serviceKey);

    const { data: event } = await sb.from("retcon_events").select("*").eq("id", retconEventId).single();
    if (!event) throw new Error("Retcon event not found");

    // Get the changed doc's new content
    let newContent = "";
    if (event.changed_version_id) {
      const { data: ver } = await sb.from("project_document_versions").select("plaintext").eq("id", event.changed_version_id).single();
      newContent = (ver?.plaintext as string) || "";
    }

    // Get locked episode ledgers
    const { data: ledgers } = await sb
      .from("episode_continuity_ledgers")
      .select("episode_number, summary")
      .eq("project_id", event.project_id)
      .eq("status", "locked")
      .order("episode_number", { ascending: true });

    if (!ledgers?.length) {
      const result = { impacted_episodes: [], message: "No locked episodes to impact" };
      await sb.from("retcon_events").update({ impact_analysis: result, status: "analyzed" }).eq("id", retconEventId);
      return new Response(JSON.stringify(result), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const ledgerContext = ledgers.map(l => `EP${l.episode_number}: ${JSON.stringify(l.summary)}`).join("\n");

    const system = composeSystem({
      baseSystem: `You are a retcon impact analyst. A core document was changed mid-season. Identify which locked episodes are impacted.

Return ONLY valid JSON:
{
  "fact_deltas": [{"fact": "string", "old_value": "string|null", "new_value": "string"}],
  "impacted_episodes": [{"episode_number": number, "severity": "high|medium|low", "reason": "string", "references": ["specific ledger references"]}],
  "recommendation": "string"
}`,
    });

    const userPrompt = `CHANGE SUMMARY: ${event.change_summary}
CHANGED DOC TYPE: ${event.changed_doc_type || "unknown"}

NEW DOCUMENT CONTENT:
${newContent.slice(0, 8000)}

LOCKED EPISODE LEDGERS:
${ledgerContext}

Identify fact deltas and impacted episodes.`;

    const parsed = await callLLMWithJsonRetry({ apiKey, model: MODELS.FAST, system, user: userPrompt, temperature: 0.2, maxTokens: 4000 }, {
      handler: "analyze_retcon_impact",
      validate: (d): d is any => isObject(d) && (hasArray(d, "impacted_episodes") || hasArray(d, "fact_deltas")),
    });

    await sb.from("retcon_events").update({ impact_analysis: parsed, status: "analyzed" }).eq("id", retconEventId);

    return new Response(JSON.stringify(parsed), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

  } catch (err) {
    console.error("analyze-retcon-impact error:", err);
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
