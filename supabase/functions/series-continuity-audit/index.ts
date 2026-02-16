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

    // ── Authz ──
    const body = await req.json();
    const { projectId, episodeNumber, episodeVersionId } = body;
    if (!projectId || !episodeNumber) {
      return new Response(JSON.stringify({ error: "projectId and episodeNumber required" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { data: hasAccess } = await sbAdmin.rpc("has_project_access", {
      _user_id: user.id, _project_id: projectId,
    });
    if (!hasAccess) {
      return new Response(JSON.stringify({ error: "Forbidden" }), {
        status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // ── Create run row ──
    const { data: run, error: runErr } = await sbAdmin.from("series_continuity_runs").insert({
      project_id: projectId,
      episode_number: episodeNumber,
      episode_version_id: episodeVersionId || "00000000-0000-0000-0000-000000000000",
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

      // ── Fetch current episode text ──
      log(`Fetching episode ${episodeNumber} script...`);
      let currentEpisodeText = "";
      if (episodeVersionId) {
        const { data: ver } = await sbAdmin.from("scripts").select("text_content").eq("id", episodeVersionId).maybeSingle();
        currentEpisodeText = (ver as any)?.text_content || "";
      }
      if (!currentEpisodeText) {
        // Fallback: find from series_episodes
        const { data: ep } = await sbAdmin.from("series_episodes")
          .select("script_id").eq("project_id", projectId).eq("episode_number", episodeNumber).maybeSingle();
        if ((ep as any)?.script_id) {
          const { data: s } = await sbAdmin.from("scripts").select("text_content").eq("id", (ep as any).script_id).maybeSingle();
          currentEpisodeText = (s as any)?.text_content || "";
        }
      }
      if (!currentEpisodeText) {
        throw new Error(`No script text found for episode ${episodeNumber}`);
      }
      log(`Episode ${episodeNumber} text: ${currentEpisodeText.length} chars`);

      // ── Fetch previous episodes (1..N-1) ──
      log("Fetching previous episodes...");
      const { data: prevEps } = await sbAdmin.from("series_episodes")
        .select("episode_number, script_id, title, logline, locked_at")
        .eq("project_id", projectId)
        .lt("episode_number", episodeNumber)
        .eq("is_deleted", false)
        .order("episode_number");

      // Check for existing canon facts
      const { data: existingFacts } = await sbAdmin.from("series_episode_canon_facts")
        .select("*").eq("project_id", projectId).order("episode_number");
      const factsMap = new Map((existingFacts || []).map((f: any) => [f.episode_number, f]));

      // Build prior episode texts for episodes without cached facts
      const episodesNeedingSnapshot: { epNum: number; text: string; title: string }[] = [];
      const cachedRecaps: string[] = [];

      for (const ep of (prevEps || [])) {
        const cached = factsMap.get(ep.episode_number);
        if (cached && cached.recap && Object.keys(cached.facts_json || {}).length > 0) {
          cachedRecaps.push(`EP${ep.episode_number} "${ep.title}": ${cached.recap}`);
        } else if (ep.script_id) {
          const { data: s } = await sbAdmin.from("scripts")
            .select("text_content").eq("id", ep.script_id).maybeSingle();
          const text = (s as any)?.text_content || "";
          if (text) {
            episodesNeedingSnapshot.push({ epNum: ep.episode_number, text: text.slice(0, 8000), title: ep.title || `Episode ${ep.episode_number}` });
          }
        }
      }

      log(`Cached canon facts: ${cachedRecaps.length}, Need snapshot: ${episodesNeedingSnapshot.length}`);

      // ── PASS 1: Build canon snapshots for uncached episodes ──
      if (episodesNeedingSnapshot.length > 0) {
        log("PASS 1: Building canon snapshots...");

        // Process in batches of 3 to avoid token limits
        for (let i = 0; i < episodesNeedingSnapshot.length; i += 3) {
          const batch = episodesNeedingSnapshot.slice(i, i + 3);
          const batchInput = batch.map(e =>
            `--- EPISODE ${e.epNum}: "${e.title}" ---\n${e.text}`
          ).join("\n\n");

          const snapshotSystem = `You are a continuity analyst. For each episode below, extract a structured canon snapshot.
Return ONLY valid JSON array with one object per episode:
[{
  "episode_number": N,
  "recap": "1 paragraph summary",
  "facts": {
    "characters": [{"name":"...","status":"alive|dead|injured|missing","relationships":[{"with":"...","type":"..."}],"key_actions":["..."]}],
    "timeline": [{"event":"...","when":"..."}],
    "world_rules": ["..."],
    "objects": [{"name":"...","status":"...","location":"..."}],
    "locations": [{"name":"...","significance":"..."}],
    "unresolved_threads": ["..."],
    "revealed_secrets": ["..."],
    "injuries_status": [{"character":"...","condition":"..."}]
  }
}]`;

          const snapshotResult = await callLLM({
            apiKey, model: MODELS.FAST,
            system: snapshotSystem,
            user: batchInput,
            temperature: 0.1, maxTokens: 6000,
          });

          const parsed = await parseJsonSafe(snapshotResult.content, apiKey);
          const snapshots = Array.isArray(parsed) ? parsed : [parsed];

          for (const snap of snapshots) {
            if (!snap.episode_number) continue;
            await sbAdmin.from("series_episode_canon_facts").upsert({
              project_id: projectId,
              episode_number: snap.episode_number,
              recap: snap.recap || "",
              facts_json: snap.facts || {},
            }, { onConflict: "project_id,episode_number" });

            cachedRecaps.push(`EP${snap.episode_number}: ${snap.recap || ""}`);
          }
          log(`Processed batch ${i + 1}-${Math.min(i + 3, episodesNeedingSnapshot.length)}`);
        }
      }

      // ── Reload all facts for aggregation ──
      const { data: allFacts } = await sbAdmin.from("series_episode_canon_facts")
        .select("*").eq("project_id", projectId).lt("episode_number", episodeNumber).order("episode_number");

      const aggregatedFacts = JSON.stringify(
        (allFacts || []).map((f: any) => ({
          episode: f.episode_number,
          recap: f.recap,
          facts: f.facts_json,
        })),
        null, 1
      );

      // ── PASS 2: Conflict detection ──
      log("PASS 2: Running conflict detection...");

      const bibleBlock = coreDocs.characterBible ? `\n## CHARACTER BIBLE\n${coreDocs.characterBible.slice(0, 6000)}` : "";
      const arcBlock = coreDocs.seasonArc ? `\n## SEASON ARC\n${coreDocs.seasonArc.slice(0, 4000)}` : "";
      const gridBlock = coreDocs.episodeGrid ? `\n## EPISODE GRID\n${coreDocs.episodeGrid.slice(0, 4000)}` : "";
      const formatBlock = coreDocs.formatRules ? `\n## FORMAT RULES\n${coreDocs.formatRules.slice(0, 3000)}` : "";

      const conflictSystem = composeSystem({
        baseSystem: `You are a professional continuity auditor for serialized TV/film.
You compare EPISODE ${episodeNumber} against all prior canon (previous episode facts + bible docs).
Find ALL continuity conflicts and categorize by severity.

SEVERITY GUIDE:
- BLOCKER: Direct factual contradiction with established canon (dead character alive, wrong timeline, contradicted world rule). MUST be fixed.
- MAJOR: Significant inconsistency that damages story coherence (character behavior contradicts established traits, missing setup).
- MINOR: Small inconsistency that most viewers might not notice but professionals would catch.
- NIT: Stylistic or tonal inconsistency, not a factual error.

ISSUE TYPES: timeline, character, world_rule, object, location, relationship, setup_payoff, dialogue_fact, other

For each issue, provide a minimal proposed patch that fixes ONLY that conflict without changing anything else.

Return ONLY valid JSON:
{
  "episode": ${episodeNumber},
  "summary": "overall assessment",
  "issues": [
    {
      "severity": "BLOCKER|MAJOR|MINOR|NIT",
      "issue_type": "timeline|character|...",
      "title": "short label",
      "claim_in_episode": "quote or paraphrase from ep ${episodeNumber}",
      "conflicts_with": [{"source": "episode_N|character_bible|format_rules|season_arc", "episode_number": null, "evidence": "..."}],
      "why_it_conflicts": "...",
      "fix_options": ["option 1", "option 2"],
      "proposed_patch": {
        "patch_goal": "minimal change to resolve",
        "edit_instructions": [{"scope": "dialogue|action|scene|beat", "target": "where", "instruction": "what to change", "must_not_change": ["..."]}]
      }
    }
  ],
  "notes": {"creative": [], "retention": [], "market": []},
  "canon_updates_from_episode": {"new_facts": [], "changed_facts": [], "open_threads_added": []}
}

If no issues found, return empty issues array. Be thorough but precise — do NOT hallucinate conflicts.`,
        guardrailsBlock: "Never invent canon facts. Only cite evidence that exists in the provided context.",
      });

      const conflictUser = `## AGGREGATED CANON FROM EPISODES 1-${episodeNumber - 1}\n${aggregatedFacts.slice(0, 12000)}${bibleBlock}${arcBlock}${gridBlock}${formatBlock}\n\n## EPISODE ${episodeNumber} (UNDER AUDIT)\n${currentEpisodeText.slice(0, 10000)}`;

      const conflictResult = await callLLM({
        apiKey, model: MODELS.FAST,
        system: conflictSystem,
        user: conflictUser,
        temperature: 0.1, maxTokens: 8000,
      });

      const results = await parseJsonSafe(conflictResult.content, apiKey);
      log(`Found ${results.issues?.length || 0} issues`);

      // ── Persist issues ──
      const issues = results.issues || [];
      let hasBlockers = false;

      for (const issue of issues) {
        if (issue.severity === "BLOCKER") hasBlockers = true;
        await sbAdmin.from("series_continuity_issues").insert({
          run_id: runId,
          project_id: projectId,
          episode_number: episodeNumber,
          severity: issue.severity || "MINOR",
          issue_type: issue.issue_type || "other",
          title: issue.title || "Untitled issue",
          claim_in_episode: issue.claim_in_episode || null,
          conflicts_with: issue.conflicts_with || [],
          why_it_conflicts: issue.why_it_conflicts || null,
          fix_options: issue.fix_options || [],
          proposed_patch: issue.proposed_patch || {},
          status: "open",
        });
      }

      // ── Update canon facts for current episode ──
      if (results.canon_updates_from_episode) {
        await sbAdmin.from("series_episode_canon_facts").upsert({
          project_id: projectId,
          episode_number: episodeNumber,
          episode_version_id: episodeVersionId || null,
          recap: results.summary || "",
          facts_json: results.canon_updates_from_episode || {},
        }, { onConflict: "project_id,episode_number" });
      }

      const finalStatus = hasBlockers ? "completed_with_blockers" : "completed";
      await sbAdmin.from("series_continuity_runs").update({
        status: finalStatus,
        summary: results.summary || "Audit complete",
        results_json: results,
        logs,
        finished_at: new Date().toISOString(),
      }).eq("id", runId);

      // Load persisted issues for response
      const { data: savedIssues } = await sbAdmin.from("series_continuity_issues")
        .select("*").eq("run_id", runId).order("created_at");

      return new Response(JSON.stringify({
        runId, status: finalStatus, results_json: results, issues: savedIssues || [],
      }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });

    } catch (innerErr: any) {
      log(`ERROR: ${innerErr.message}`);
      await sbAdmin.from("series_continuity_runs").update({
        status: "failed", summary: innerErr.message, logs,
        finished_at: new Date().toISOString(),
      }).eq("id", runId);
      throw innerErr;
    }

  } catch (e: any) {
    console.error("[series-continuity-audit] error:", e);
    return new Response(JSON.stringify({ error: e.message || "Internal error" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
