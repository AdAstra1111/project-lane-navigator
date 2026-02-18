/**
 * POST /functions/v1/resolve-carried-note
 *
 * Handles two actions:
 *  - action: "mark_resolved"  → marks note resolved without AI patch
 *  - action: "ai_patch"       → generates an AI patch for the current doc, returns proposed edits
 *  - action: "apply_patch"    → writes a new document version with the patch and marks resolved
 *  - action: "dismiss"        → dismisses the note (won't reappear)
 *
 * Input: { note_id, project_id, action, current_doc_type?, current_version_id?, patch_content? }
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { callLLM, MODELS } from "../_shared/llm.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const json = (data: any, status = 200) =>
    new Response(JSON.stringify(data), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

  try {
    // ── Auth ──
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) return json({ error: "Unauthorized" }, 401);

    const token = authHeader.replace("Bearer ", "");
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const db = createClient(supabaseUrl, serviceKey);

    // Decode JWT
    let userId: string;
    try {
      const payload = JSON.parse(atob(token.split(".")[1]));
      if (!payload.sub || (payload.exp && payload.exp < Date.now() / 1000)) throw new Error("expired");
      userId = payload.sub;
    } catch {
      return json({ error: "Unauthorized" }, 401);
    }

    const body = await req.json();
    const { note_id, project_id, action, current_doc_type, current_version_id, patch_content } = body;

    if (!note_id || !project_id || !action) return json({ error: "note_id, project_id, and action required" }, 400);

    // ── Fetch the note ──
    // note_id may be a real DB UUID or a note_key string from AI analysis JSON.
    console.log("[resolve-carried-note] looking up note_id:", note_id, "project_id:", project_id);

    const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(note_id);

    let note: any = null;

    if (isUuid) {
      const { data, error } = await db
        .from("project_deferred_notes")
        .select("*")
        .eq("id", note_id)
        .eq("project_id", project_id)
        .maybeSingle();
      console.log("[resolve-carried-note] UUID lookup:", data?.id, "err:", error?.message);
      note = data;
    }

    // Fallback: look up by note_key inside note_json using RPC raw query
    // PostgREST filter syntax for JSONB text extraction: note_json->>note_key (no quotes around key)
    if (!note) {
      const { data, error } = await db
        .from("project_deferred_notes")
        .select("*")
        .eq("project_id", project_id)
        .filter("note_json->>note_key", "eq", note_id)
        .maybeSingle();
      console.log("[resolve-carried-note] note_key filter lookup:", data?.id, "err:", error?.message);
      note = data;
    }

    // Second fallback: look up by id field inside note_json
    if (!note) {
      const { data, error } = await db
        .from("project_deferred_notes")
        .select("*")
        .eq("project_id", project_id)
        .filter("note_json->>id", "eq", note_id)
        .maybeSingle();
      console.log("[resolve-carried-note] note_json id filter lookup:", data?.id, "err:", error?.message);
      note = data;
    }

    // Final fallback: fetch all project notes and find in-memory
    if (!note) {
      const { data: allNotes } = await db
        .from("project_deferred_notes")
        .select("*")
        .eq("project_id", project_id);
      if (allNotes) {
        note = allNotes.find((n: any) => {
          const nj = n.note_json as any;
          return nj?.note_key === note_id || nj?.id === note_id || n.id === note_id;
        }) || null;
      }
      console.log("[resolve-carried-note] in-memory fallback found:", note?.id);
    }

    if (!note) return json({ error: "Note not found" }, 404);
    if (note.status === "resolved" || note.status === "dismissed") {
      return json({ error: "Note already resolved/dismissed" }, 400);
    }

    // Use the real DB id (note.id) for all updates — note_id param may be a note_key string
    const dbId = note.id;

    // ── mark_resolved ──
    if (action === "mark_resolved") {
      await db.from("project_deferred_notes").update({
        status: "resolved",
        resolved_at: new Date().toISOString(),
        resolved_in_stage: current_doc_type || null,
        resolution_method: "user_marked",
        resolution_summary: "Manually marked resolved",
      }).eq("id", dbId);

      return json({ ok: true, action: "mark_resolved" });
    }

    // ── dismiss ──
    if (action === "dismiss") {
      await db.from("project_deferred_notes").update({
        status: "dismissed",
        resolved_at: new Date().toISOString(),
        resolved_in_stage: current_doc_type || null,
        resolution_method: "dismissed",
        resolution_summary: "Dismissed by user",
      }).eq("id", dbId);

      return json({ ok: true, action: "dismiss" });
    }

    // ── ai_patch — generate proposed edits without applying ──
    if (action === "ai_patch") {
      if (!current_version_id) return json({ error: "current_version_id required for ai_patch" }, 400);

      // Fetch current document version text
      const { data: ver } = await db
        .from("project_document_versions")
        .select("plaintext, doc_type, version_number")
        .eq("id", current_version_id)
        .single();

      const docText = ver?.plaintext || "";
      const noteJson = note.note_json as any;
      const noteText = noteJson?.description || noteJson?.note || JSON.stringify(noteJson);

      const apiKey = Deno.env.get("LOVABLE_API_KEY");
      if (!apiKey) return json({ error: "AI not configured" }, 500);

      const systemPrompt = `You are a script development editor operating in FIX GENERATION MODE.

A forwarded development note requires actionable fix options — not commentary, not re-evaluation.

STRICT OUTPUT RULES:
- Do NOT summarize the script.
- Do NOT re-evaluate season alignment or the entire document.
- Do NOT provide abstract advice or vague rewrites.
- Do NOT use language like "consider strengthening..." or "you might want to...".
- ALL fixes must be episode-scoped and scene-specific.

Return a JSON object with this EXACT structure:
{
  "diagnosis": "One sentence restating the note as a concrete problem.",
  "affected_scenes": ["Scene X: <evidence from the document>"],
  "root_cause": "Structural reason (pacing, missing turn, unclear motivation, escalation gap, exposition density, etc.)",
  "fix_options": [
    {
      "patch_name": "Short descriptive name",
      "where": "Specific scene or section to edit",
      "what": "Precise edit — what to add, cut, or change",
      "structural_impact": "What concretely improves",
      "risk": "Trade-off or risk of this patch"
    }
  ],
  "recommended_option": {
    "patch_name": "Name of strongest fix",
    "rationale": "Why this best satisfies the episode contract",
    "estimated_impact": "Likely CL/GP shift (e.g. +3–5 GP)"
  },
  "proposed_edits": [
    { "find": "exact verbatim text to replace", "replace": "new text", "rationale": "why" }
  ],
  "summary": "One sentence describing what was changed"
}

REQUIREMENTS:
- fix_options must contain 3–5 DISTINCT patches.
- Each fix must name the exact scene.
- proposed_edits implements the recommended_option only.
- If the note is already addressed, set fix_options to [] and explain in summary.
- If the document is an episode script, ensure fixes do not break grid/contract obligations.`;

      const userPrompt = `FORWARDED DEVELOPMENT NOTE:
${noteText}

CURRENT DOCUMENT (${current_doc_type || "document"}):
${docText.slice(0, 12000)}

Enter Fix Generation Mode. Diagnose the note, identify affected scenes with evidence, provide 3–5 distinct patch options, then choose the strongest recommended fix and generate the proposed_edits for it.`;

      const result = await callLLM({
        apiKey,
        model: MODELS.BALANCED,
        system: systemPrompt,
        user: userPrompt,
        temperature: 0.2,
        maxTokens: 2000,
      });

      let parsed: any = {};
      try {
        const m = result.content.match(/\{[\s\S]*\}/);
        if (m) parsed = JSON.parse(m[0]);
      } catch { parsed = { proposed_edits: [], summary: result.content.slice(0, 300) }; }

      return json({ ok: true, action: "ai_patch", ...parsed });
    }

    // ── apply_patch — write new doc version + mark resolved ──
    if (action === "apply_patch") {
      if (!current_version_id || !patch_content) {
        return json({ error: "current_version_id and patch_content required for apply_patch" }, 400);
      }

      // Fetch current doc + version
      const { data: ver } = await db
        .from("project_document_versions")
        .select("plaintext, doc_type, version_number, document_id")
        .eq("id", current_version_id)
        .single();

      if (!ver) return json({ error: "Version not found" }, 404);

      // Apply find/replace patches in sequence
      let newText = ver.plaintext || "";
      const edits: Array<{ find: string; replace: string }> = patch_content;
      for (const edit of edits) {
        if (edit.find && edit.replace !== undefined) {
          newText = newText.split(edit.find).join(edit.replace);
        }
      }

      // Write new version
      const { data: newVer, error: verErr } = await db
        .from("project_document_versions")
        .insert({
          document_id: ver.document_id,
          doc_type: ver.doc_type,
          version_number: (ver.version_number || 1) + 1,
          plaintext: newText,
          label: "Carried-note patch",
          created_by: userId,
        })
        .select("id, version_number")
        .single();

      if (verErr || !newVer) return json({ error: "Failed to create version" }, 500);

      // Mark note resolved
      const noteJson = note.note_json as any;
      const noteText = noteJson?.description || noteJson?.note || "";
      await db.from("project_deferred_notes").update({
        status: "resolved",
        resolved_at: new Date().toISOString(),
        resolved_in_stage: current_doc_type || ver.doc_type,
        resolution_method: "ai_patch_applied",
        resolution_summary: `Patch applied to ${ver.doc_type} v${newVer.version_number}: ${noteText.slice(0, 120)}`,
      }).eq("id", dbId);

      return json({
        ok: true,
        action: "apply_patch",
        new_version_id: newVer.id,
        new_version_number: newVer.version_number,
      });
    }

    return json({ error: `Unknown action: ${action}` }, 400);
  } catch (e: any) {
    console.error("resolve-carried-note error:", e);
    return json({ error: e.message }, 500);
  }
});
