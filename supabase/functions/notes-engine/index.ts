/**
 * notes-engine — Unified notes lifecycle edge function.
 *
 * Actions:
 *   list_notes          — List/filter canonical notes
 *   get_note            — Get single note + recent events
 *   triage_note         — Set status, timing, destination
 *   propose_change_plan — Generate a change plan for a note fix
 *   apply_change_plan   — Apply a confirmed change plan (deterministic patching)
 *   verify_note         — Mark resolved or reopen (logs event, never mutates detail)
 *   create_note         — Create a canonical note
 *   ensure_note         — Upsert from legacy systems
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

/** Normalize doc type: spaces/dashes → underscores, lowercase */
function normDocType(s: string | null | undefined): string | null {
  if (!s) return null;
  return s.trim().toLowerCase().replace(/[\s-]+/g, "_");
}

/** Log a note event */
async function logNoteEvent(
  db: any, projectId: string, noteId: string, eventType: string,
  payload: Record<string, unknown>, userId: string
) {
  await db.from("project_note_events").insert({
    project_id: projectId, note_id: noteId,
    event_type: eventType, payload, created_by: userId,
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

      if (filters.docType) query = query.eq("doc_type", normDocType(filters.docType));
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
    // GET NOTE (single note + recent events)
    // ══════════════════════════════════════════════
    if (action === "get_note") {
      const { noteId } = body;
      if (!noteId) return json({ error: "noteId required" }, 400);

      const { data: note, error } = await db.from("project_notes")
        .select("*").eq("id", noteId).eq("project_id", projectId_).single();
      if (error || !note) return json({ error: "Note not found" }, 404);

      const { data: events } = await db.from("project_note_events")
        .select("*").eq("note_id", noteId)
        .order("created_at", { ascending: false }).limit(30);

      return json({ note, events: events || [] });
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
        doc_type: normDocType(note.doc_type),
        document_id: note.document_id || null,
        version_id: note.version_id || null,
        anchor: note.anchor || null,
        category: note.category || "story",
        severity: note.severity || "med",
        timing: note.timing || "now",
        destination_doc_type: normDocType(note.destination_doc_type),
        dependent_on_note_id: note.dependent_on_note_id || null,
        status: note.status || "open",
        title: note.title,
        summary: note.summary,
        detail: note.detail || null,
        suggested_fixes: note.suggested_fixes || null,
        legacy_key: note.legacy_key || null,
        created_by: userId,
        updated_by: userId,
      };

      const { data, error } = await db.from("project_notes").insert(insert).select().single();
      if (error) return json({ error: error.message }, 500);

      await logNoteEvent(db, projectId_, data.id, "created", { source: insert.source }, userId);
      return json({ ok: true, note: data });
    }

    // ══════════════════════════════════════════════
    // ENSURE NOTE (legacy adapter — upsert by legacy_key or title hash)
    // ══════════════════════════════════════════════
    if (action === "ensure_note") {
      const { legacy } = body;
      if (!legacy?.title || !legacy?.summary) return json({ error: "legacy.title and legacy.summary required" }, 400);

      const legacyKey = legacy.legacy_key || null;
      const source = legacy.source || "dev_engine";

      // Try find existing by legacy_key
      if (legacyKey) {
        const { data: existing } = await db.from("project_notes")
          .select("*").eq("project_id", projectId_)
          .eq("legacy_key", legacyKey).maybeSingle();
        if (existing) return json({ note: existing });
      }

      // Try find by title+summary match (fuzzy dedup)
      const { data: byTitle } = await db.from("project_notes")
        .select("*").eq("project_id", projectId_)
        .eq("source", source).eq("title", legacy.title).maybeSingle();
      if (byTitle) return json({ note: byTitle });

      // Insert new
      const insert = {
        project_id: projectId_,
        source,
        doc_type: normDocType(legacy.doc_type),
        document_id: legacy.document_id || null,
        version_id: legacy.version_id || null,
        anchor: legacy.anchor || null,
        category: legacy.category || "story",
        severity: legacy.severity || "med",
        timing: legacy.timing || "now",
        destination_doc_type: normDocType(legacy.destination_doc_type),
        dependent_on_note_id: null,
        status: "open",
        title: legacy.title,
        summary: legacy.summary,
        detail: legacy.detail || null,
        suggested_fixes: legacy.suggested_fixes || null,
        legacy_key: legacyKey,
        created_by: userId,
        updated_by: userId,
      };

      const { data, error } = await db.from("project_notes").insert(insert).select().single();
      if (error) return json({ error: error.message }, 500);

      await logNoteEvent(db, projectId_, data.id, "migrated", { source, legacy_key: legacyKey }, userId);
      return json({ note: data });
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
          update.destination_doc_type = normDocType(triage.destinationDocType);
          update.status = triage.status || "deferred";
        }
      }
      if (triage.destinationDocType) update.destination_doc_type = normDocType(triage.destinationDocType);
      if (triage.dependentOnNoteId) update.dependent_on_note_id = triage.dependentOnNoteId;

      const { data, error } = await db.from("project_notes").update(update)
        .eq("id", noteId).eq("project_id", projectId_).select().single();
      if (error) return json({ error: error.message }, 500);

      await logNoteEvent(db, projectId_, noteId, "triaged", { triage }, userId);
      return json({ ok: true, note: data });
    }

    // ══════════════════════════════════════════════
    // PROPOSE CHANGE PLAN
    // ══════════════════════════════════════════════
    if (action === "propose_change_plan") {
      const { noteId, fixId, customInstruction, scope } = body;
      if (!noteId) return json({ error: "noteId required" }, 400);

      const { data: note, error: noteErr } = await db.from("project_notes")
        .select("*").eq("id", noteId).eq("project_id", projectId_).single();
      if (noteErr || !note) return json({ error: "Note not found" }, 404);

      const docType = normDocType(note.doc_type) || normDocType(note.destination_doc_type) || "";
      const resolvedVersion = await resolveBaseVersion(db, projectId_, docType, note.version_id || body.baseVersionId);
      if (!resolvedVersion) return json({ error: `No document found for type "${docType}"`, needs_doc_creation: true }, 404);

      const baseText = resolvedVersion.plaintext || "";

      // Build fix instruction
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
    { "location": "description of where", "action": "replace|insert|delete", "original_snippet": "exact text from document to find", "new_snippet": "replacement text", "rationale": "why" }
  ],
  "scope": "selection|scene|doc",
  "estimated_impact": "Brief impact description"
}
CRITICAL RULES:
1. original_snippet MUST be an EXACT substring of the document text (copy-paste accuracy)
2. Each original_snippet must be unique within the document (if not, include enough surrounding text to disambiguate)
3. For "insert" actions, original_snippet is the text AFTER which to insert new_snippet
4. For "delete" actions, original_snippet is the exact text to remove
5. Keep patches surgical and minimal — do NOT rewrite large sections`;

      const userPrompt = `NOTE:
Title: ${note.title}
Summary: ${note.summary}
${note.detail ? `Detail: ${note.detail}` : ""}
Category: ${note.category}
${fixInstruction ? `\nFIX INSTRUCTION:\n${fixInstruction}` : ""}
${scope ? `\nSCOPE: ${scope}` : ""}

DOCUMENT (${docType}):
${baseText.slice(0, 14000)}

Generate a concrete change plan with exact text snippets from the document.`;

      const result = await callLLM({
        apiKey, model: MODELS.BALANCED, system: systemPrompt, user: userPrompt,
        temperature: 0.3, maxTokens: 3000,
      });

      let parsed: any = {};
      try { parsed = JSON.parse(extractJSON(result.content)); } catch { /* fallback */ }

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

      await db.from("project_notes").update({ status: "in_progress", updated_by: userId }).eq("id", noteId);
      await logNoteEvent(db, projectId_, noteId, "change_plan_proposed", { changeEventId: event.id }, userId);

      return json({
        ok: true,
        changeEventId: event.id,
        diffSummary: parsed.diff_summary || "",
        patchPreview: parsed.patch_sections || [],
        estimatedImpact: parsed.estimated_impact || "",
      });
    }

    // ══════════════════════════════════════════════
    // APPLY CHANGE PLAN (DETERMINISTIC PATCHING — NO LLM)
    // ══════════════════════════════════════════════
    if (action === "apply_change_plan") {
      const { changeEventId } = body;
      if (!changeEventId) return json({ error: "changeEventId required" }, 400);

      const { data: event, error: evtErr } = await db.from("note_change_events")
        .select("*").eq("id", changeEventId).eq("project_id", projectId_).single();
      if (evtErr || !event) return json({ error: "Change event not found" }, 404);
      if (event.status === "applied") return json({ error: "Already applied" }, 400);

      const { data: baseVer } = await db.from("project_document_versions")
        .select("id, document_id, plaintext, version_number")
        .eq("id", event.base_version_id).single();
      if (!baseVer) return json({ error: "Base version not found" }, 404);

      let text = baseVer.plaintext || "";
      const patches = event.proposed_patch || [];

      const { data: note } = await db.from("project_notes")
        .select("title, summary, doc_type").eq("id", event.note_id).single();

      // Deterministic patch application
      const errors: any[] = [];
      // Apply patches in reverse order of their position to maintain correct offsets
      const patchesWithPositions: Array<{ patch: any; idx: number; position: number }> = [];

      for (let i = 0; i < patches.length; i++) {
        const p = patches[i];
        if (!p.original_snippet) {
          errors.push({ patch_index: i, error: "Missing original_snippet" });
          continue;
        }

        const snippet = p.original_snippet;
        const firstIdx = text.indexOf(snippet);

        if (firstIdx === -1) {
          errors.push({ patch_index: i, error: "Snippet not found in document", snippet: snippet.slice(0, 100) });
          continue;
        }

        // Check for ambiguity
        const secondIdx = text.indexOf(snippet, firstIdx + 1);
        if (secondIdx !== -1) {
          // Multiple matches — return disambiguation error
          const matches = [];
          let searchFrom = 0;
          let matchIdx;
          while ((matchIdx = text.indexOf(snippet, searchFrom)) !== -1) {
            const contextStart = Math.max(0, matchIdx - 30);
            const contextEnd = Math.min(text.length, matchIdx + snippet.length + 30);
            matches.push({
              idx: matches.length,
              start: matchIdx,
              preview: text.slice(contextStart, contextEnd),
            });
            searchFrom = matchIdx + 1;
            if (matches.length >= 5) break;
          }
          errors.push({
            patch_index: i,
            error: "Multiple occurrences found",
            needs_user_disambiguation: true,
            matches,
          });
          continue;
        }

        patchesWithPositions.push({ patch: p, idx: i, position: firstIdx });
      }

      if (errors.length > 0) {
        const hasDisambiguation = errors.some(e => e.needs_user_disambiguation);
        await db.from("note_change_events").update({
          status: "failed",
          error: JSON.stringify(errors),
        }).eq("id", changeEventId);

        return json({
          error: "Patch application failed",
          needs_user_disambiguation: hasDisambiguation,
          patch_errors: errors,
          hint: hasDisambiguation ? "Some snippets match multiple locations. Please re-propose with more specific context." : "Some snippets were not found in the document.",
        }, 409);
      }

      // Sort by position descending so we apply from end to start (preserves offsets)
      patchesWithPositions.sort((a, b) => b.position - a.position);

      for (const { patch: p, position } of patchesWithPositions) {
        const snippet = p.original_snippet;
        if (p.action === "replace") {
          text = text.slice(0, position) + (p.new_snippet || "") + text.slice(position + snippet.length);
        } else if (p.action === "insert") {
          // Insert AFTER the snippet
          const insertPoint = position + snippet.length;
          text = text.slice(0, insertPoint) + (p.new_snippet || "") + text.slice(insertPoint);
        } else if (p.action === "delete") {
          text = text.slice(0, position) + text.slice(position + snippet.length);
        }
      }

      // Create new version
      const { data: maxVerRow } = await db.from("project_document_versions")
        .select("version_number").eq("document_id", baseVer.document_id)
        .order("version_number", { ascending: false }).limit(1).maybeSingle();

      const nextVersion = ((maxVerRow as any)?.version_number || 1) + 1;

      const { data: newVersion, error: createError } = await db.from("project_document_versions").insert({
        document_id: baseVer.document_id,
        version_number: nextVersion,
        plaintext: text,
        label: `v${nextVersion} (note fix: ${(note?.title || "").slice(0, 50)})`,
        created_by: userId,
        parent_version_id: baseVer.id,
        change_summary: `Applied change plan: ${(event.diff_summary || "").slice(0, 120)}`,
        approval_status: "draft",
      }).select("id, version_number").single();

      if (createError || !newVersion) return json({ error: "Failed to create version", detail: createError?.message }, 500);

      await db.from("note_change_events").update({
        status: "applied", result_version_id: (newVersion as any).id,
      }).eq("id", changeEventId);

      await db.from("project_notes").update({
        status: "applied",
        applied_change_event_id: changeEventId,
        updated_by: userId,
      }).eq("id", event.note_id);

      await logNoteEvent(db, projectId_, event.note_id, "applied", {
        changeEventId, newVersionId: (newVersion as any).id, newVersionNumber: (newVersion as any).version_number,
      }, userId);

      return json({
        ok: true,
        newVersionId: (newVersion as any).id,
        newVersionNumber: (newVersion as any).version_number,
      });
    }

    // ══════════════════════════════════════════════
    // VERIFY NOTE (logs event, never mutates detail)
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

      const { data, error } = await db.from("project_notes").update(update)
        .eq("id", noteId).eq("project_id", projectId_).select().single();
      if (error) return json({ error: error.message }, 500);

      // Log event instead of mutating detail
      await logNoteEvent(db, projectId_, noteId, "verified", { result: verifyResult, comment: comment || null }, userId);

      return json({ ok: true, note: data });
    }

    // ══════════════════════════════════════════════
    // BULK TRIAGE
    // ══════════════════════════════════════════════
    if (action === "bulk_triage") {
      const { noteIds, triage } = body;
      if (!noteIds?.length || !triage?.status) return json({ error: "noteIds and triage.status required" }, 400);

      // Enforce destination when timing=later
      if (triage.timing === "later" && !triage.destinationDocType) {
        return json({ error: "destinationDocType required for timing=later" }, 400);
      }

      const update: Record<string, unknown> = { status: triage.status, updated_by: userId };
      if (triage.timing) update.timing = triage.timing;
      if (triage.destinationDocType) update.destination_doc_type = normDocType(triage.destinationDocType);

      const { error } = await db.from("project_notes").update(update)
        .in("id", noteIds).eq("project_id", projectId_);
      if (error) return json({ error: error.message }, 500);

      // Log events for each note
      for (const nid of noteIds) {
        await logNoteEvent(db, projectId_, nid, "triaged", { bulk: true, triage }, userId);
      }

      return json({ ok: true, updated: noteIds.length });
    }

    // ══════════════════════════════════════════════
    // MIGRATE LEGACY
    // ══════════════════════════════════════════════
    if (action === "migrate_legacy") {
      const { data: deferred } = await db.from("project_deferred_notes")
        .select("*").eq("project_id", projectId_);

      let migrated = 0;
      for (const dn of (deferred || [])) {
        const nj = dn.note_json || {};
        const { data, error } = await db.from("project_notes").insert({
          project_id: projectId_,
          source: "dev_engine",
          doc_type: normDocType(dn.source_doc_type),
          category: nj.category || dn.category || "story",
          severity: nj.severity || dn.severity || "med",
          timing: dn.status === "resolved" || dn.status === "dismissed" ? "now" : "later",
          destination_doc_type: normDocType(dn.target_deliverable_type),
          status: dn.status === "resolved" ? "applied" : dn.status === "dismissed" ? "dismissed" : "open",
          title: nj.description || nj.note || dn.note_key || "Migrated note",
          summary: nj.description || nj.note || dn.note_key || "",
          detail: nj.why_it_matters || nj.detail || dn.resolution_summary || null,
          suggested_fixes: null,
          legacy_key: dn.note_key || dn.id,
          created_by: userId,
          updated_by: userId,
        }).select().single();
        if (!error && data) {
          await logNoteEvent(db, projectId_, data.id, "migrated", { source: "legacy_deferred", original_id: dn.id }, userId);
          migrated++;
        }
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

  const normalizedDocType = normDocType(docType) || docType;

  const { data: doc } = await db.from("project_documents")
    .select("id").eq("project_id", projectId).eq("doc_type", normalizedDocType).maybeSingle();
  if (!doc) return null;

  const { data: activeDoc } = await db.from("project_active_docs")
    .select("active_version_id").eq("project_id", projectId)
    .eq("doc_type_key", normalizedDocType).maybeSingle();

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
