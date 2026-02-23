/**
 * notes-engine — Unified notes lifecycle edge function.
 *
 * Actions:
 *   list_notes          — List/filter canonical notes
 *   triage_note         — Set status, timing, destination
 *   propose_change_plan — Generate a change plan for a note fix
 *   apply_change_plan   — Apply a confirmed change plan (creates new version)
 *   verify_note         — Mark resolved or reopen
 *   create_note         — Create a canonical note
 *   bulk_triage         — Bulk defer/dismiss
 *   migrate_legacy      — Copy legacy notes into project_notes
 */
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { callLLM, MODELS, extractJSON } from "../_shared/llm.ts";

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

function parseUserId(token: string): string {
  const payload = JSON.parse(atob(token.split(".")[1]));
  if (!payload.sub || (payload.exp && payload.exp < Date.now() / 1000)) throw new Error("expired");
  return payload.sub;
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

    let userId: string;
    try { userId = parseUserId(token); }
    catch { return json({ error: "Unauthorized" }, 401); }

    const body = await req.json();
    const { action, projectId, project_id: pid2 } = body;
    const projectId_ = projectId || pid2;
    if (!action || !projectId_) return json({ error: "action and projectId required" }, 400);

    // Verify access
    const { data: hasAccess } = await db.rpc("has_project_access", {
      _user_id: userId, _project_id: projectId_,
    });
    if (!hasAccess) return json({ error: "Access denied" }, 403);

    // ══════════════════════════════════════════════
    // LIST NOTES
    // ══════════════════════════════════════════════
    if (action === "list_notes") {
      const { filters = {} } = body;
      let query = db.from("project_notes").select("*").eq("project_id", projectId_);

      if (filters.docType) query = query.eq("doc_type", filters.docType);
      if (filters.documentId) query = query.eq("document_id", filters.documentId);
      if (filters.versionId) query = query.eq("version_id", filters.versionId);
      if (filters.status) query = query.eq("status", filters.status);
      if (filters.timing) query = query.eq("timing", filters.timing);
      if (filters.category) query = query.eq("category", filters.category);
      if (filters.severity) query = query.eq("severity", filters.severity);
      if (filters.statuses && Array.isArray(filters.statuses)) {
        query = query.in("status", filters.statuses);
      }

      query = query.order("created_at", { ascending: false }).limit(200);
      const { data, error } = await query;
      if (error) return json({ error: error.message }, 500);
      return json({ notes: data || [] });
    }

    // ══════════════════════════════════════════════
    // CREATE NOTE
    // ══════════════════════════════════════════════
    if (action === "create_note") {
      const { note } = body;
      if (!note?.title || !note?.summary) return json({ error: "title and summary required" }, 400);

      const insert = {
        project_id: projectId_,
        source: note.source || "user",
        doc_type: note.doc_type || null,
        document_id: note.document_id || null,
        version_id: note.version_id || null,
        anchor: note.anchor || null,
        category: note.category || "story",
        severity: note.severity || "med",
        timing: note.timing || "now",
        destination_doc_type: note.destination_doc_type || null,
        dependent_on_note_id: note.dependent_on_note_id || null,
        status: note.status || "open",
        title: note.title,
        summary: note.summary,
        detail: note.detail || null,
        suggested_fixes: note.suggested_fixes || null,
        created_by: userId,
        updated_by: userId,
      };

      const { data, error } = await db.from("project_notes").insert(insert).select().single();
      if (error) return json({ error: error.message }, 500);
      return json({ ok: true, note: data });
    }

    // ══════════════════════════════════════════════
    // TRIAGE NOTE
    // ══════════════════════════════════════════════
    if (action === "triage_note") {
      const { noteId, triage } = body;
      if (!noteId || !triage) return json({ error: "noteId and triage required" }, 400);

      const update: Record<string, unknown> = { updated_by: userId };

      if (triage.status) update.status = triage.status;
      if (triage.timing) {
        update.timing = triage.timing;
        if (triage.timing === "later") {
          if (!triage.destinationDocType) return json({ error: "destinationDocType required for timing=later" }, 400);
          update.destination_doc_type = triage.destinationDocType;
          update.status = triage.status || "deferred";
        }
      }
      if (triage.destinationDocType) update.destination_doc_type = triage.destinationDocType;
      if (triage.dependentOnNoteId) update.dependent_on_note_id = triage.dependentOnNoteId;

      const { data, error } = await db.from("project_notes").update(update)
        .eq("id", noteId).eq("project_id", projectId_).select().single();
      if (error) return json({ error: error.message }, 500);
      return json({ ok: true, note: data });
    }

    // ══════════════════════════════════════════════
    // PROPOSE CHANGE PLAN
    // ══════════════════════════════════════════════
    if (action === "propose_change_plan") {
      const { noteId, fixId, customInstruction, scope } = body;
      if (!noteId) return json({ error: "noteId required" }, 400);

      // Get the note
      const { data: note, error: noteErr } = await db.from("project_notes")
        .select("*").eq("id", noteId).eq("project_id", projectId_).single();
      if (noteErr || !note) return json({ error: "Note not found" }, 404);

      // Resolve target document + version
      const docType = note.doc_type || note.destination_doc_type || "";
      const resolvedVersion = await resolveBaseVersion(db, projectId_, docType, note.version_id || body.baseVersionId);
      if (!resolvedVersion) return json({ error: `No document found for type "${docType}"`, needs_doc_creation: true }, 404);

      const baseText = resolvedVersion.plaintext || "";

      // Get selected fix or use custom instruction
      let fixInstruction = customInstruction || "";
      if (fixId && note.suggested_fixes) {
        const fixes = Array.isArray(note.suggested_fixes) ? note.suggested_fixes : [];
        const fix = fixes.find((f: any) => f.id === fixId);
        if (fix) fixInstruction = `Fix: ${fix.title}\nStrategy: ${fix.patch_strategy || "rewrite_section"}\nInstructions: ${fix.instructions || fix.description}`;
      }

      const systemPrompt = `You are a script/story editor generating a change plan.
Return JSON:
{
  "diff_summary": "Human-readable summary of what will change",
  "patch_sections": [
    { "location": "description of where", "action": "replace|insert|delete", "original_snippet": "...", "new_snippet": "...", "rationale": "why" }
  ],
  "scope": "selection|scene|doc",
  "estimated_impact": "Brief impact description"
}`;

      const userPrompt = `NOTE:
Title: ${note.title}
Summary: ${note.summary}
${note.detail ? `Detail: ${note.detail}` : ""}
Category: ${note.category}
${fixInstruction ? `\nFIX INSTRUCTION:\n${fixInstruction}` : ""}
${scope ? `\nSCOPE: ${scope}` : ""}

DOCUMENT (${docType}):
${baseText.slice(0, 14000)}

Generate a concrete change plan.`;

      const result = await callLLM({
        apiKey, model: MODELS.BALANCED, system: systemPrompt, user: userPrompt,
        temperature: 0.3, maxTokens: 3000,
      });

      let parsed: any = {};
      try { parsed = JSON.parse(extractJSON(result.content)); } catch { /* fallback */ }

      // Create change event
      const { data: event, error: evtErr } = await db.from("note_change_events").insert({
        project_id: projectId_,
        note_id: noteId,
        document_id: resolvedVersion.document_id,
        base_version_id: resolvedVersion.id,
        proposed_patch: parsed.patch_sections || [],
        diff_summary: parsed.diff_summary || result.content.slice(0, 500),
        status: "proposed",
      }).select().single();

      if (evtErr) return json({ error: evtErr.message }, 500);

      // Update note status
      await db.from("project_notes").update({ status: "in_progress", updated_by: userId }).eq("id", noteId);

      return json({
        ok: true,
        changeEventId: event.id,
        diffSummary: parsed.diff_summary || "",
        patchPreview: parsed.patch_sections || [],
        estimatedImpact: parsed.estimated_impact || "",
      });
    }

    // ══════════════════════════════════════════════
    // APPLY CHANGE PLAN
    // ══════════════════════════════════════════════
    if (action === "apply_change_plan") {
      const { changeEventId } = body;
      if (!changeEventId) return json({ error: "changeEventId required" }, 400);

      // Get the change event
      const { data: event, error: evtErr } = await db.from("note_change_events")
        .select("*").eq("id", changeEventId).eq("project_id", projectId_).single();
      if (evtErr || !event) return json({ error: "Change event not found" }, 404);
      if (event.status === "applied") return json({ error: "Already applied" }, 400);

      // Get base version text
      const { data: baseVer } = await db.from("project_document_versions")
        .select("id, document_id, plaintext, version_number")
        .eq("id", event.base_version_id).single();
      if (!baseVer) return json({ error: "Base version not found" }, 404);

      const baseText = baseVer.plaintext || "";
      const patches = event.proposed_patch || [];

      // Get the note for context
      const { data: note } = await db.from("project_notes")
        .select("title, summary, doc_type").eq("id", event.note_id).single();

      // Apply via LLM
      const systemPrompt = `You are a professional script/story editor. Apply the specified changes to the document.
RULES:
1. Apply ONLY the specified changes
2. Preserve all content not mentioned in the changes
3. Maintain original voice, tone, and style
4. Return the COMPLETE revised document text, no commentary`;

      const userPrompt = `ORIGINAL DOCUMENT:\n${baseText}\n\n=== CHANGES TO APPLY ===\n${JSON.stringify(patches, null, 2)}\n${event.diff_summary ? `\nSummary: ${event.diff_summary}` : ""}\n\nApply the changes. Return ONLY the complete revised document text.`;

      const result = await callLLM({
        apiKey, model: MODELS.PRO, system: systemPrompt, user: userPrompt,
        temperature: 0.2, maxTokens: 16000,
      });

      const newText = result.content.trim();
      if (!newText) return json({ error: "AI returned empty result" }, 500);

      // Create new version
      const { data: maxVerRow } = await db.from("project_document_versions")
        .select("version_number").eq("document_id", baseVer.document_id)
        .order("version_number", { ascending: false }).limit(1).maybeSingle();

      const nextVersion = ((maxVerRow as any)?.version_number || 1) + 1;

      const { data: newVersion, error: createError } = await db.from("project_document_versions").insert({
        document_id: baseVer.document_id,
        version_number: nextVersion,
        plaintext: newText,
        label: `v${nextVersion} (note fix: ${(note?.title || "").slice(0, 50)})`,
        created_by: userId,
        parent_version_id: baseVer.id,
        change_summary: `Applied change plan: ${(event.diff_summary || "").slice(0, 120)}`,
        approval_status: "draft",
      }).select("id, version_number").single();

      if (createError || !newVersion) return json({ error: "Failed to create version", detail: createError?.message }, 500);

      // Update change event
      await db.from("note_change_events").update({
        status: "applied", result_version_id: (newVersion as any).id,
      }).eq("id", changeEventId);

      // Update note
      await db.from("project_notes").update({
        status: "applied",
        applied_change_event_id: changeEventId,
        updated_by: userId,
      }).eq("id", event.note_id);

      return json({
        ok: true,
        newVersionId: (newVersion as any).id,
        newVersionNumber: (newVersion as any).version_number,
      });
    }

    // ══════════════════════════════════════════════
    // VERIFY NOTE
    // ══════════════════════════════════════════════
    if (action === "verify_note") {
      const { noteId, result: verifyResult, comment } = body;
      if (!noteId || !verifyResult) return json({ error: "noteId and result required" }, 400);

      const update: Record<string, unknown> = { updated_by: userId };
      if (verifyResult === "resolved") {
        update.status = "applied";
      } else if (verifyResult === "reopen") {
        update.status = "reopened";
      } else {
        return json({ error: "result must be 'resolved' or 'reopen'" }, 400);
      }

      if (comment) update.detail = (update.detail || "") + `\n[Verify: ${comment}]`;

      const { data, error } = await db.from("project_notes").update(update)
        .eq("id", noteId).eq("project_id", projectId_).select().single();
      if (error) return json({ error: error.message }, 500);
      return json({ ok: true, note: data });
    }

    // ══════════════════════════════════════════════
    // BULK TRIAGE
    // ══════════════════════════════════════════════
    if (action === "bulk_triage") {
      const { noteIds, triage } = body;
      if (!noteIds?.length || !triage?.status) return json({ error: "noteIds and triage.status required" }, 400);

      const update: Record<string, unknown> = { status: triage.status, updated_by: userId };
      if (triage.timing) update.timing = triage.timing;
      if (triage.destinationDocType) update.destination_doc_type = triage.destinationDocType;

      const { error } = await db.from("project_notes").update(update)
        .in("id", noteIds).eq("project_id", projectId_);
      if (error) return json({ error: error.message }, 500);
      return json({ ok: true, updated: noteIds.length });
    }

    // ══════════════════════════════════════════════
    // MIGRATE LEGACY — copy from project_deferred_notes into project_notes
    // ══════════════════════════════════════════════
    if (action === "migrate_legacy") {
      // Migrate deferred notes
      const { data: deferred } = await db.from("project_deferred_notes")
        .select("*").eq("project_id", projectId_);

      let migrated = 0;
      for (const dn of (deferred || [])) {
        const nj = dn.note_json || {};
        const { error } = await db.from("project_notes").insert({
          project_id: projectId_,
          source: "dev_engine",
          doc_type: dn.source_doc_type || null,
          category: nj.category || dn.category || "story",
          severity: nj.severity || dn.severity || "med",
          timing: dn.status === "resolved" || dn.status === "dismissed" ? "now" : "later",
          destination_doc_type: dn.target_deliverable_type || null,
          status: dn.status === "resolved" ? "applied" : dn.status === "dismissed" ? "dismissed" : "open",
          title: nj.description || nj.note || dn.note_key || "Migrated note",
          summary: nj.description || nj.note || dn.note_key || "",
          detail: nj.why_it_matters || nj.detail || dn.resolution_summary || null,
          suggested_fixes: null,
          created_by: userId,
          updated_by: userId,
        }).select();
        if (!error) migrated++;
      }

      return json({ ok: true, migrated });
    }

    return json({ error: `Unknown action: ${action}` }, 400);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "Internal error";
    console.error("notes-engine error:", err);
    return json({ error: msg }, 500);
  }
});

/**
 * Resolve the base version for a target doc type.
 */
async function resolveBaseVersion(
  db: any, projectId: string, docType: string, explicitVersionId?: string
): Promise<{ id: string; document_id: string; plaintext: string; version_number: number } | null> {
  if (explicitVersionId) {
    const { data } = await db.from("project_document_versions")
      .select("id, document_id, plaintext, version_number")
      .eq("id", explicitVersionId).maybeSingle();
    if (data) return data;
  }

  const { data: doc } = await db.from("project_documents")
    .select("id").eq("project_id", projectId).eq("doc_type", docType).maybeSingle();
  if (!doc) return null;

  const { data: activeDoc } = await db.from("project_active_docs")
    .select("active_version_id").eq("project_id", projectId)
    .eq("doc_type_key", docType).maybeSingle();

  if (activeDoc?.active_version_id) {
    const { data: ver } = await db.from("project_document_versions")
      .select("id, document_id, plaintext, version_number")
      .eq("id", activeDoc.active_version_id).maybeSingle();
    if (ver) return ver;
  }

  const { data: latest } = await db.from("project_document_versions")
    .select("id, document_id, plaintext, version_number")
    .eq("document_id", doc.id).order("version_number", { ascending: false })
    .limit(1).maybeSingle();
  return latest || null;
}
