import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import { callLLM, MODELS, composeSystem, parseJsonSafe } from "../_shared/llm.ts";
import { fetchCoreDocs } from "../_shared/coreDocs.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
  const apiKey = Deno.env.get("LOVABLE_API_KEY") || serviceKey;

  try {
    // ── Auth ──
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const token = authHeader.replace("Bearer ", "");
    const sbAnon = createClient(supabaseUrl, anonKey);
    const { data: { user } } = await sbAnon.auth.getUser(token);
    if (!user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const sbAdmin = createClient(supabaseUrl, serviceKey);
    const body = await req.json();
    const { projectId, episodeNumber, episodeScriptId } = body;

    if (!projectId || !episodeNumber) {
      return new Response(JSON.stringify({ error: "projectId and episodeNumber required" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // ── Authz ──
    const { data: hasAccess } = await sbAdmin.rpc("has_project_access", {
      _user_id: user.id, _project_id: projectId,
    });
    if (!hasAccess) {
      return new Response(JSON.stringify({ error: "Forbidden" }), {
        status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // ── Create run row ──
    const { data: run, error: runErr } = await sbAdmin.from("series_dev_notes_runs").insert({
      project_id: projectId,
      episode_number: episodeNumber,
      script_id: episodeScriptId || null,
      status: "running",
      started_by: user.id,
    }).select("id").single();
    if (runErr) throw new Error(`Failed to create run: ${runErr.message}`);
    const runId = run.id;

    let logs = "";
    const log = (msg: string) => {
      logs += `[${new Date().toISOString()}] ${msg}\n`;
      if (logs.length > 20000) logs = logs.slice(-18000);
    };

    try {
      // ── Fetch core docs ──
      log("Fetching core docs...");
      const coreDocs = await fetchCoreDocs(sbAdmin, projectId);

      // ── Fetch episode script text ──
      log(`Fetching episode ${episodeNumber} script...`);
      let scriptText = "";
      if (episodeScriptId) {
        const { data: s } = await sbAdmin.from("scripts").select("text_content").eq("id", episodeScriptId).maybeSingle();
        scriptText = (s as any)?.text_content || "";
      }
      if (!scriptText) {
        const { data: ep } = await sbAdmin.from("series_episodes")
          .select("script_id").eq("project_id", projectId).eq("episode_number", episodeNumber).maybeSingle();
        if ((ep as any)?.script_id) {
          const { data: s } = await sbAdmin.from("scripts").select("text_content").eq("id", (ep as any).script_id).maybeSingle();
          scriptText = (s as any)?.text_content || "";
        }
      }
      if (!scriptText) throw new Error(`No script text found for episode ${episodeNumber}`);
      log(`Script: ${scriptText.length} chars`);

      // ── Fetch canon facts for context (enriched) ──
      const { data: canonFacts } = await sbAdmin.from("series_episode_canon_facts")
        .select("episode_number, recap, facts_json")
        .eq("project_id", projectId)
        .lt("episode_number", episodeNumber)
        .order("episode_number");

      // Build enriched canon context with facts_json, not just recaps
      let canonContext = "";
      let canonLen = 0;
      const MAX_CANON_CHARS = 8000;
      for (const f of (canonFacts || []) as any[]) {
        let block = `EP${f.episode_number}: ${f.recap || ""}`;
        // Include structured facts if available
        if (f.facts_json && typeof f.facts_json === 'object') {
          const fj = f.facts_json;
          const parts: string[] = [];
          if (fj.characters?.length) parts.push(`Characters: ${JSON.stringify(fj.characters).slice(0, 600)}`);
          if (fj.timeline_events?.length) parts.push(`Timeline: ${JSON.stringify(fj.timeline_events).slice(0, 400)}`);
          if (fj.world_rules?.length) parts.push(`Rules: ${JSON.stringify(fj.world_rules).slice(0, 300)}`);
          if (fj.relationships?.length) parts.push(`Relationships: ${JSON.stringify(fj.relationships).slice(0, 300)}`);
          if (fj.unresolved_threads?.length) parts.push(`Unresolved: ${JSON.stringify(fj.unresolved_threads).slice(0, 300)}`);
          if (fj.revealed_secrets?.length) parts.push(`Secrets: ${JSON.stringify(fj.revealed_secrets).slice(0, 200)}`);
          if (fj.injuries?.length || fj.status_changes?.length) {
            parts.push(`Status: ${JSON.stringify(fj.injuries || fj.status_changes || []).slice(0, 200)}`);
          }
          if (parts.length) block += `\n  ${parts.join("\n  ")}`;
        }
        block += "\n";
        if (canonLen + block.length > MAX_CANON_CHARS) {
          // Truncate this block to fit
          const remaining = MAX_CANON_CHARS - canonLen;
          if (remaining > 100) canonContext += block.slice(0, remaining) + "...\n";
          break;
        }
        canonContext += block;
        canonLen += block.length;
      }

      // ── Build dev notes prompt ──
      const bibleBlock = coreDocs.characterBible ? `\n## CHARACTER BIBLE\n${coreDocs.characterBible.slice(0, 5000)}` : "";
      const arcBlock = coreDocs.seasonArc ? `\n## SEASON ARC\n${coreDocs.seasonArc.slice(0, 3000)}` : "";
      const gridBlock = coreDocs.episodeGrid ? `\n## EPISODE GRID\n${coreDocs.episodeGrid.slice(0, 3000)}` : "";
      const formatBlock = coreDocs.formatRules ? `\n## FORMAT RULES\n${coreDocs.formatRules.slice(0, 2000)}` : "";

      const devNotesSystem = composeSystem({
        baseSystem: `You are an expert script development executive and story editor. You are giving development notes on Episode ${episodeNumber} of a serialized series.

Your job is to provide actionable, specific notes that improve the script while RESPECTING established canon. Do NOT suggest changes that would contradict prior episodes or the character bible.

Analyze the episode for:
1. STRUCTURE — Act breaks, pacing, scene flow, cold open effectiveness, cliffhanger quality
2. CHARACTER — Motivation clarity, arc progression, voice consistency, emotional beats
3. DIALOGUE — Naturalism, subtext usage, exposition handling, distinctive voice per character
4. PACING — Scene length distribution, tension management, breathing room vs momentum
5. ENGAGEMENT — Hook strength, retention drivers, curiosity gaps, emotional peaks
6. CLARITY — Plot logic, unclear references, confusing transitions

For EACH note, you MUST set the "canon_safe" field:
- canon_safe=true: the suggestion does NOT conflict with any established canon facts, character bible, or prior episodes
- canon_safe=false: the suggestion MIGHT conflict with established canon (explain why in the detail field)

If you are unsure whether a suggestion is canon-safe, set canon_safe=false and explain your uncertainty.

Return ONLY valid JSON:
{
  "episode": ${episodeNumber},
  "overall_grade": "A|B|C|D|F",
  "summary": "2-3 sentence overall assessment",
  "notes": [
    {
      "tier": "blocking|high_impact|polish",
      "category": "structure|character|dialogue|pacing|engagement|clarity",
      "title": "short label",
      "detail": "specific note with scene/line references where possible",
      "suggestion": "concrete actionable fix",
      "canon_safe": true
    }
  ],
  "strengths": ["what's working well"],
  "overall_recommendations": "1 paragraph of key priorities"
}

RULES:
- Maximum 5 notes per tier (blocking, high_impact, polish)
- "blocking" = issues that prevent the episode from working at all
- "high_impact" = significant improvements that would elevate quality
- "polish" = optional refinements
- Set canon_safe=false if a suggestion might conflict with established canon (and explain why)
- Be specific: reference scenes, characters, lines where possible
- Do NOT hallucinate plot points or characters not in the script
- Do NOT suggest introducing new characters, locations, or lore that contradicts canon`,
        guardrailsBlock: "Never suggest changes that contradict established canon facts or the character bible. If uncertain, mark canon_safe=false.",
        conditioningBlock: canonContext ? `PRIOR EPISODE CANON (for reference only — do not suggest contradicting these):\n${canonContext}` : undefined,
      });

      const userPrompt = `${bibleBlock}${arcBlock}${gridBlock}${formatBlock}\n\n## EPISODE ${episodeNumber} SCRIPT\n${scriptText.slice(0, 12000)}`;

      log("Calling AI for dev notes...");
      const result = await callLLM({
        apiKey, model: MODELS.FAST,
        system: devNotesSystem,
        user: userPrompt,
        temperature: 0.2, maxTokens: 6000,
      });

      const parsed = await parseJsonSafe(result.content, apiKey);

      // ── Canon safety validation pass ──
      const allNotes = parsed.notes || [];
      const canonSafeNotes: any[] = [];
      const canonRiskNotes: any[] = [];

      for (const note of allNotes) {
        if (note.canon_safe === true) {
          canonSafeNotes.push(note);
        } else {
          // Missing or false — treat as canon risk
          note.canon_safe = false;
          canonRiskNotes.push(note);
        }
      }

      parsed.notes = canonSafeNotes;
      parsed.canon_risk_notes = canonRiskNotes;
      parsed.canon_risk_count = canonRiskNotes.length;

      log(`Dev notes complete: ${canonSafeNotes.length} safe, ${canonRiskNotes.length} canon-risk`);

      // ── Update run ──
      await sbAdmin.from("series_dev_notes_runs").update({
        status: "completed",
        summary: parsed.summary || "Dev notes complete",
        results_json: parsed,
        logs,
        finished_at: new Date().toISOString(),
      }).eq("id", runId);

      return new Response(JSON.stringify({
        runId, status: "completed", results: parsed,
      }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });

    } catch (innerErr: any) {
      log(`ERROR: ${innerErr.message}`);
      await sbAdmin.from("series_dev_notes_runs").update({
        status: "failed", summary: innerErr.message, logs,
        finished_at: new Date().toISOString(),
      }).eq("id", runId);
      throw innerErr;
    }

  } catch (e: any) {
    console.error("[series-dev-notes] error:", e);
    return new Response(JSON.stringify({ error: e.message || "Internal error" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
