/**
 * apply-note-fix — Unified fix application for any note type.
 *
 * Actions:
 *   "get_fix_options" — Generate fix options for a note (if none exist)
 *   "apply_fix"       — Apply a chosen fix, creating a new document version
 *
 * Resolves the correct target document and base version automatically.
 */
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { callLLM, MODELS } from "../_shared/llm.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) return json({ error: "Unauthorized" }, 401);

    const token = authHeader.replace("Bearer ", "");
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const apiKey = Deno.env.get("LOVABLE_API_KEY")!;
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
    const { action, project_id, note_id, note_source, note_data, fix_id, fix_object,
            target_doc_type, base_version_id, approve_after_apply } = body;

    if (!action || !project_id) return json({ error: "action and project_id required" }, 400);

    // Verify access
    const { data: hasAccess } = await db.rpc("has_project_access", {
      _user_id: userId, _project_id: project_id,
    });
    if (!hasAccess) return json({ error: "Access denied" }, 403);

    // ── get_fix_options ──
    if (action === "get_fix_options") {
      const noteText = note_data?.description || note_data?.note || note_data?.summary || "";
      const noteDetail = note_data?.detail || note_data?.why_it_matters || "";
      const noteCategory = note_data?.category || "general";
      const docType = target_doc_type || note_data?.target_doc_type || note_data?.target_deliverable_type || "";

      // Get current doc text for context
      let docText = "";
      const resolvedVersion = await resolveBaseVersion(db, project_id, docType, base_version_id);
      if (resolvedVersion) {
        docText = resolvedVersion.plaintext || "";
      }

      const systemPrompt = `You are a script/story editor generating precise fix options for a development note.

Return a JSON object:
{
  "fix_options": [
    {
      "id": "fix_1",
      "title": "Short title",
      "description": "1-2 sentence description of what this fix does",
      "patch_strategy": "rewrite_section|replace_block|insert|delete|style_adjust|canon_conform",
      "instructions": "Exact instructions for applying this fix to the document",
      "expected_effect": "What improves after this fix",
      "risk_level": "low|med|high"
    }
  ],
  "recommended_fix_id": "fix_1",
  "recommendation_reason": "Why this is the best option"
}

Generate 2-4 distinct fix options. Each must be concrete and actionable.
If this is a canon-risk note, prefer canon-safe options (adjust script to match canon, update canon, etc.).`;

      const userPrompt = `NOTE:
Category: ${noteCategory}
Summary: ${noteText}
Detail: ${noteDetail}
Target doc type: ${docType}

${docText ? `CURRENT DOCUMENT (${docType}):\n${docText.slice(0, 12000)}` : "No document text available."}

Generate fix options for this note.`;

      const result = await callLLM({
        apiKey, model: MODELS.BALANCED, system: systemPrompt, user: userPrompt,
        temperature: 0.3, maxTokens: 2000,
      });

      let parsed: any = { fix_options: [] };
      try {
        const m = result.content.match(/\{[\s\S]*\}/);
        if (m) parsed = JSON.parse(m[0]);
      } catch { /* fallback */ }

      return json({ ok: true, ...parsed });
    }

    // ── apply_fix ──
    if (action === "apply_fix") {
      const fix = fix_object || {};
      const docType = target_doc_type || note_data?.target_doc_type || note_data?.target_deliverable_type || "";

      if (!docType) return json({ error: "Cannot determine target doc type" }, 400);

      // Resolve target document + base version
      const resolvedVersion = await resolveBaseVersion(db, project_id, docType, base_version_id);
      if (!resolvedVersion) {
        return json({ error: `No document found for type "${docType}". Create the document first or defer this note.`, needs_doc_creation: true }, 404);
      }

      const baseText = resolvedVersion.plaintext || "";
      if (!baseText.trim()) {
        return json({ error: "Base version has no text content" }, 400);
      }

      const noteText = note_data?.description || note_data?.note || note_data?.summary || "";
      const noteDetail = note_data?.detail || note_data?.why_it_matters || "";

      const systemPrompt = `You are a professional script/story editor performing a targeted fix.
Apply ONLY the specified fix to the document.
RULES:
1. Preserve all content not mentioned in the fix instructions
2. Apply the fix precisely
3. Do not add new characters, subplots, or scenes unless explicitly instructed
4. Maintain the original voice, tone, and style
5. Return the COMPLETE revised document text, no commentary`;

      const userPrompt = `ORIGINAL DOCUMENT:
${baseText}

=== FIX TO APPLY ===
Note: ${noteText}
${noteDetail ? `Detail: ${noteDetail}` : ""}
Fix: ${fix.title || "Address the noted issue"}
Strategy: ${fix.patch_strategy || "rewrite_section"}
Instructions: ${fix.instructions || "Resolve the issue using minimal targeted changes"}

=== INSTRUCTION ===
Apply the fix above. Return ONLY the complete revised document text.`;

      const result = await callLLM({
        apiKey, model: MODELS.PRO, system: systemPrompt, user: userPrompt,
        temperature: 0.2, maxTokens: 16000,
      });

      const newText = result.content.trim();
      if (!newText) return json({ error: "AI returned empty result" }, 500);

      // Get next version number
      const documentId = resolvedVersion.document_id;
      const { data: maxVerRow } = await db
        .from("project_document_versions")
        .select("version_number")
        .eq("document_id", documentId)
        .order("version_number", { ascending: false })
        .limit(1)
        .maybeSingle();

      const nextVersion = ((maxVerRow as any)?.version_number || 1) + 1;

      const insertPayload: Record<string, unknown> = {
        document_id: documentId,
        version_number: nextVersion,
        plaintext: newText,
        label: `v${nextVersion} (note fix: ${(fix.title || noteText).slice(0, 50)})`,
        created_by: userId,
        parent_version_id: resolvedVersion.id,
        change_summary: `Applied fix: ${(fix.title || noteText).slice(0, 120)}`,
        approval_status: approve_after_apply ? "approved" : "draft",
      };
      if (approve_after_apply) {
        insertPayload.approved_at = new Date().toISOString();
      }

      const { data: newVersion, error: createError } = await db
        .from("project_document_versions")
        .insert(insertPayload)
        .select("id, version_number")
        .single();

      if (createError || !newVersion) {
        console.error("Version create error:", createError);
        return json({ error: "Failed to create new version", detail: createError?.message }, 500);
      }

      // If approve_after_apply, update active docs
      if (approve_after_apply) {
        await db.from("project_active_docs").upsert({
          project_id, doc_type_key: docType, active_version_id: (newVersion as any).id, activated_by: userId,
        }, { onConflict: "project_id,doc_type_key" });
      }

      // Mark the source note as applied if we can identify it
      if (note_id && note_source === "deferred") {
        await db.from("project_deferred_notes").update({
          status: "resolved",
          resolved_at: new Date().toISOString(),
          resolution_method: "fix_applied",
          resolution_summary: `Fix applied: ${(fix.title || "").slice(0, 120)} → v${(newVersion as any).version_number}`,
        }).eq("id", note_id);
      } else if (note_id && note_source === "carried") {
        await db.from("project_deferred_notes").update({
          status: "resolved",
          resolved_at: new Date().toISOString(),
          resolved_in_stage: docType,
          resolution_method: "fix_applied",
          resolution_summary: `Fix applied → v${(newVersion as any).version_number}`,
        }).eq("id", note_id);
      }

      return json({
        ok: true,
        new_version_id: (newVersion as any).id,
        new_version_number: (newVersion as any).version_number,
        target_doc_type: docType,
        target_document_id: documentId,
        approved: !!approve_after_apply,
      });
    }

    return json({ error: `Unknown action: ${action}` }, 400);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "Internal error";
    console.error("apply-note-fix error:", err);
    return json({ error: msg }, 500);
  }
});

/**
 * Resolve the base version for a target doc type.
 * Priority: explicit base_version_id > active approved > latest version.
 */
async function resolveBaseVersion(
  db: any, projectId: string, docType: string, explicitVersionId?: string
): Promise<{ id: string; document_id: string; plaintext: string; version_number: number } | null> {
  // 1. Explicit version
  if (explicitVersionId) {
    const { data } = await db
      .from("project_document_versions")
      .select("id, document_id, plaintext, version_number")
      .eq("id", explicitVersionId)
      .maybeSingle();
    if (data) return data;
  }

  // 2. Find document for this doc type
  const { data: doc } = await db
    .from("project_documents")
    .select("id")
    .eq("project_id", projectId)
    .eq("doc_type", docType)
    .maybeSingle();
  if (!doc) return null;

  // 3. Active approved version
  const { data: activeDoc } = await db
    .from("project_active_docs")
    .select("active_version_id")
    .eq("project_id", projectId)
    .eq("doc_type_key", docType)
    .maybeSingle();

  if (activeDoc?.active_version_id) {
    const { data: ver } = await db
      .from("project_document_versions")
      .select("id, document_id, plaintext, version_number")
      .eq("id", activeDoc.active_version_id)
      .maybeSingle();
    if (ver) return ver;
  }

  // 4. Latest version
  const { data: latest } = await db
    .from("project_document_versions")
    .select("id, document_id, plaintext, version_number")
    .eq("document_id", doc.id)
    .order("version_number", { ascending: false })
    .limit(1)
    .maybeSingle();

  return latest || null;
}
