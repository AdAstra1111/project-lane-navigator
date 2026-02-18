/**
 * canon-audit-apply-fix — Applies a selected dev-notes patch or canon-audit fix
 * to the episode script, producing a NEW script version (never mutates existing).
 *
 * POST body:
 *   project_id          string (required)
 *   episode_number      number (required)
 *   episode_script_id   string | null  — current script id to read from
 *   note_id             string | null  — dev notes run id (for marking resolved)
 *   patch               { name, where, what, why }  — the selected patch
 *   apply_mode          "patch" | "rewrite"  (default: "patch")
 */
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import { callLLM, MODELS, composeSystem } from "../_shared/llm.ts";
import { fetchCoreDocs } from "../_shared/coreDocs.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceKey  = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const apiKey      = Deno.env.get("LOVABLE_API_KEY") || serviceKey;

  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), {
      status,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

  try {
    // ── Auth ──────────────────────────────────────────────────────────────────
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) return json({ error: "Unauthorized" }, 401);

    const token = authHeader.replace("Bearer ", "");
    const sbAdmin = createClient(supabaseUrl, serviceKey);

    // Local JWT decode for user id (avoids network round-trip)
    let userId: string;
    try {
      const payload = JSON.parse(atob(token.split(".")[1]));
      if (!payload.sub || (payload.exp && payload.exp < Date.now() / 1000)) throw new Error("expired");
      userId = payload.sub;
    } catch {
      return json({ error: "Unauthorized" }, 401);
    }

    // ── Parse body ────────────────────────────────────────────────────────────
    const body = await req.json();
    const {
      project_id,
      episode_number,
      episode_script_id,
      note_id,         // optional: dev notes run id to mark resolved
      patch,           // { name, where, what, why }
      apply_mode = "patch",
    } = body as {
      project_id: string;
      episode_number: number;
      episode_script_id?: string | null;
      note_id?: string | null;
      patch: { name: string; where: string; what: string; why: string };
      apply_mode?: "patch" | "rewrite";
    };

    if (!project_id || !episode_number || !patch?.what) {
      return json({ error: "project_id, episode_number, patch.what required" }, 400);
    }

    // ── Authz ─────────────────────────────────────────────────────────────────
    const { data: hasAccess } = await sbAdmin.rpc("has_project_access", {
      _user_id: userId,
      _project_id: project_id,
    });
    if (!hasAccess) return json({ error: "Forbidden" }, 403);

    // ── Resolve current script text ───────────────────────────────────────────
    let scriptId = episode_script_id || null;
    let scriptText = "";

    if (scriptId) {
      const { data: s } = await sbAdmin
        .from("scripts")
        .select("text_content")
        .eq("id", scriptId)
        .maybeSingle();
      scriptText = (s as any)?.text_content || "";
    }

    // Fall back to episode's current script
    if (!scriptText) {
      const { data: ep } = await sbAdmin
        .from("series_episodes")
        .select("script_id")
        .eq("project_id", project_id)
        .eq("episode_number", episode_number)
        .maybeSingle();
      scriptId = (ep as any)?.script_id || null;
      if (scriptId) {
        const { data: s } = await sbAdmin
          .from("scripts")
          .select("text_content")
          .eq("id", scriptId)
          .maybeSingle();
        scriptText = (s as any)?.text_content || "";
      }
    }

    if (!scriptText) {
      return json({ error: "No script text found for this episode" }, 404);
    }

    // ── Load canon context ────────────────────────────────────────────────────
    const coreDocs = await fetchCoreDocs(sbAdmin, project_id);
    const { data: canonFacts } = await sbAdmin
      .from("series_episode_canon_facts")
      .select("episode_number, recap")
      .eq("project_id", project_id)
      .lt("episode_number", episode_number)
      .order("episode_number");

    const canonContext = (canonFacts || [])
      .map((f: any) => `EP${f.episode_number}: ${f.recap}`)
      .join("\n");

    // ── Build AI prompt ───────────────────────────────────────────────────────
    const modeInstructions =
      apply_mode === "rewrite"
        ? `REWRITE MODE: Rewrite the indicated section completely, preserving tone and character voice. Then return the COMPLETE patched script.`
        : `PATCH MODE: Apply the SMALLEST possible targeted edit that resolves the issue. Change only the words/lines identified. Return the COMPLETE patched script.`;

    const system = composeSystem({
      baseSystem: `You are a professional script editor. You must apply a single, precise fix to an episode script.

PATCH TO APPLY:
Name: ${patch.name}
Where (scene/section): ${patch.where}
What to change: ${patch.what}
Why: ${patch.why}

${modeInstructions}

CRITICAL RULES:
1. Do NOT introduce new characters, locations, or canon facts.
2. Do NOT contradict prior-episode canon below.
3. Preserve ALL dialogue voice, formatting, scene headers.
4. If the target location cannot be found, apply the most reasonable equivalent change.
5. Return ONLY the complete script text — no commentary, no markdown fencing.`,
      guardrailsBlock: coreDocs.characterBible
        ? `CHARACTER BIBLE:\n${coreDocs.characterBible.slice(0, 3000)}`
        : undefined,
      conditioningBlock: canonContext
        ? `PRIOR EPISODE CANON:\n${canonContext.slice(0, 3000)}`
        : undefined,
    });

    const result = await callLLM({
      apiKey,
      model: MODELS.FAST,
      system,
      user: `CURRENT SCRIPT — Episode ${episode_number} (${scriptText.length} chars):\n\n${scriptText}`,
      temperature: 0.15,
      maxTokens: 14000,
    });

    const patchedText = result.content?.trim();
    if (!patchedText || patchedText.length < 200) {
      return json({ error: "Patch generation failed — output too short" }, 422);
    }

    // ── Create new script version ─────────────────────────────────────────────
    const { data: newScript, error: scriptErr } = await sbAdmin
      .from("scripts")
      .insert({
        project_id,
        owner_id: userId,
        created_by: userId,
        version_label: `EP${episode_number} — ${patch.name} (dev fix)`,
        text_content: patchedText,
        latest_page_count_est: Math.round(patchedText.split(/\s+/).length / 250),
      })
      .select("id")
      .single();

    if (scriptErr || !newScript) {
      throw new Error(`Failed to create script version: ${scriptErr?.message}`);
    }

    // ── Update episode to use new script ──────────────────────────────────────
    await sbAdmin
      .from("series_episodes")
      .update({
        script_id: newScript.id,
        validation_status: null,
      })
      .eq("project_id", project_id)
      .eq("episode_number", episode_number);

    // ── Mark the dev notes run as having a fix applied (best-effort) ──────────
    // We store applied patches in results_json so the UI can reflect resolution
    if (note_id) {
      const { data: run } = await sbAdmin
        .from("series_dev_notes_runs")
        .select("results_json")
        .eq("id", note_id)
        .maybeSingle();

      if (run) {
        const existing = (run as any).results_json || {};
        const applied = existing.applied_patches || [];
        applied.push({
          patch_name: patch.name,
          applied_at: new Date().toISOString(),
          new_script_id: newScript.id,
        });
        await sbAdmin
          .from("series_dev_notes_runs")
          .update({ results_json: { ...existing, applied_patches: applied } })
          .eq("id", note_id);
      }
    }

    return json({
      success: true,
      new_script_id: newScript.id,
      episode_number,
      patch_name: patch.name,
      message: `Fix "${patch.name}" applied to EP${episode_number}. New script version created.`,
    });
  } catch (e: any) {
    console.error("[canon-audit-apply-fix] error:", e);
    return json({ error: e.message || "Internal error" }, 500);
  }
});
