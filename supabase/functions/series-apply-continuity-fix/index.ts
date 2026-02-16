import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import { callLLM, MODELS, composeSystem } from "../_shared/llm.ts";
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
    const { projectId, runId, issueId, episodeNumber, episodeVersionId } = body;

    if (!projectId || !issueId || !episodeNumber) {
      return new Response(JSON.stringify({ error: "projectId, issueId, episodeNumber required" }), {
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

    // ── Load issue ──
    const { data: issue, error: issueErr } = await sbAdmin.from("series_continuity_issues")
      .select("*").eq("id", issueId).single();
    if (issueErr || !issue) {
      return new Response(JSON.stringify({ error: "Issue not found" }), {
        status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Verify issue belongs to project
    if (issue.project_id !== projectId) {
      return new Response(JSON.stringify({ error: "Issue does not belong to project" }), {
        status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // ── Load current episode script ──
    let scriptId = episodeVersionId;
    let scriptText = "";
    if (scriptId) {
      const { data: s } = await sbAdmin.from("scripts").select("text_content").eq("id", scriptId).maybeSingle();
      scriptText = (s as any)?.text_content || "";
    }
    if (!scriptText) {
      const { data: ep } = await sbAdmin.from("series_episodes")
        .select("script_id").eq("project_id", projectId).eq("episode_number", episodeNumber).maybeSingle();
      scriptId = (ep as any)?.script_id;
      if (scriptId) {
        const { data: s } = await sbAdmin.from("scripts").select("text_content").eq("id", scriptId).maybeSingle();
        scriptText = (s as any)?.text_content || "";
      }
    }

    if (!scriptText) {
      return new Response(JSON.stringify({ error: "No script text found for episode" }), {
        status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // ── Load core docs + canon facts ──
    const coreDocs = await fetchCoreDocs(sbAdmin, projectId);
    const { data: canonFacts } = await sbAdmin.from("series_episode_canon_facts")
      .select("episode_number, recap, facts_json")
      .eq("project_id", projectId)
      .lt("episode_number", episodeNumber)
      .order("episode_number");

    const canonContext = (canonFacts || []).map((f: any) =>
      `EP${f.episode_number}: ${f.recap}`
    ).join("\n");

    // ── Build patch prompt ──
    const patch = issue.proposed_patch || {};
    const editInstructions = (patch as any).edit_instructions
      ? (patch as any).edit_instructions.map((ei: any, i: number) =>
          `${i + 1}. [${ei.scope}] Target: ${ei.target}\n   Change: ${ei.instruction}\n   MUST NOT CHANGE: ${(ei.must_not_change || []).join(", ")}`
        ).join("\n")
      : "Apply minimal fix as described.";

    const fixSystem = composeSystem({
      baseSystem: `You are a script continuity fixer. Your task is to apply a MINIMAL patch to an episode script to resolve a specific continuity conflict.

RULES (NON-NEGOTIABLE):
1. Do NOT introduce new characters, locations, lore, or timeline events unless explicitly permitted by canon.
2. Do NOT contradict any facts in the canon snapshot or character bible.
3. Prefer the SMALLEST localized change that resolves the conflict.
4. If uncertainty exists, leave the passage unchanged and note the uncertainty.
5. Preserve all formatting, scene structure, and character voice.
6. Return the COMPLETE patched script — not just the changed section.

ISSUE TO FIX:
Title: ${issue.title}
Severity: ${issue.severity}
Type: ${issue.issue_type}
Claim in episode: ${issue.claim_in_episode || "N/A"}
Why it conflicts: ${issue.why_it_conflicts || "N/A"}
Fix options: ${JSON.stringify(issue.fix_options || [])}

EDIT INSTRUCTIONS:
${editInstructions}`,
      guardrailsBlock: coreDocs.characterBible ? `CHARACTER BIBLE (authoritative):\n${coreDocs.characterBible.slice(0, 4000)}` : undefined,
      conditioningBlock: canonContext ? `PRIOR EPISODE CANON:\n${canonContext.slice(0, 4000)}` : undefined,
    });

    const patchResult = await callLLM({
      apiKey, model: MODELS.FAST,
      system: fixSystem,
      user: `Here is the COMPLETE current script for Episode ${episodeNumber}. Apply the minimal fix and return the FULL patched script:\n\n${scriptText}`,
      temperature: 0.15,
      maxTokens: 12000,
    });

    const patchedText = patchResult.content;

    if (!patchedText || patchedText.length < 100) {
      return new Response(JSON.stringify({ error: "Patch generation failed — output too short" }), {
        status: 422, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // ── Create new script version ──
    const { data: newScript, error: scriptErr } = await sbAdmin.from("scripts").insert({
      project_id: projectId,
      owner_id: user.id,
      created_by: user.id,
      version_label: `EP${episodeNumber} (patched: ${issue.title})`,
      text_content: patchedText,
      latest_page_count_est: Math.round(patchedText.split(/\s+/).length / 250),
    }).select("id").single();

    if (scriptErr) throw new Error(`Failed to create script: ${scriptErr.message}`);

    // ── Update episode to point to new script ──
    await sbAdmin.from("series_episodes").update({
      script_id: newScript.id,
      status: "complete",
      validation_status: null,
    }).eq("project_id", projectId).eq("episode_number", episodeNumber);

    // ── Mark issue as applied ──
    await sbAdmin.from("series_continuity_issues").update({
      status: "applied",
    }).eq("id", issueId);

    return new Response(JSON.stringify({
      success: true,
      newScriptId: newScript.id,
      issueId,
      episodeNumber,
      message: `Patch applied for "${issue.title}". Re-audit recommended.`,
    }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });

  } catch (e: any) {
    console.error("[series-apply-continuity-fix] error:", e);
    return new Response(JSON.stringify({ error: e.message || "Internal error" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
