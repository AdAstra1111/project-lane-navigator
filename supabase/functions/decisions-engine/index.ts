import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};
const JSON_H = { ...corsHeaders, "Content-Type": "application/json" };

// ─── Simple djb2 hash ───
function djb2(str: string): string {
  let hash = 5381;
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) + hash + str.charCodeAt(i)) >>> 0;
  }
  return hash.toString(36);
}

function normalizeText(s: string): string {
  return (s || "").toLowerCase().replace(/[^a-z0-9\s]/g, "").replace(/\s+/g, " ").trim();
}

function noteFingerprint(note: any): string {
  const key = note.note_key || note.id || "";
  const severity = note.severity || "";
  const desc = normalizeText(note.description || note.note || "");
  if (key) return `${key}::${severity}::${djb2(desc)}`;
  const cat = note.category || "unknown";
  return `${cat}::${severity}::${djb2(desc.slice(0, 60))}`;
}

function decisionKeyFromNote(note: any): string {
  if (note.note_key) return note.note_key;
  if (note.id) return note.id;
  const cat = note.category || "general";
  const desc = (note.description || note.note || "").toLowerCase().replace(/[^a-z0-9\s]/g, "");
  return `${cat}_${desc.split(/\s+/).slice(0, 6).join("_") || "decision"}`;
}

function decisionTextFromNote(note: any, option?: any): string {
  const desc = note.description || note.note || "Decision";
  if (note.resolution_directive) return `${desc} | Resolution: ${note.resolution_directive}`;
  if (option?.custom_direction) return `${desc} | Custom: ${option.custom_direction}`;
  if (option?.option_id) return `${desc} | Option: ${option.option_id}`;
  return desc;
}

const CATEGORY_TARGETS: Record<string, string[]> = {
  structural: ["blueprint", "beat_sheet", "feature_script", "episode_script", "season_arc"],
  character: ["character_bible", "feature_script", "episode_script", "blueprint"],
  escalation: ["blueprint", "beat_sheet", "feature_script", "episode_script"],
  lane: ["market_sheet", "deck", "concept_brief"],
  packaging: ["market_sheet", "deck", "concept_brief"],
  pacing: ["blueprint", "beat_sheet", "feature_script", "episode_script"],
  hook: ["concept_brief", "deck", "feature_script", "episode_script"],
  format: ["format_rules", "episode_script", "feature_script", "episode_grid", "season_arc"],
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers: JSON_H });
    }
    const token = authHeader.replace("Bearer ", "");
    const sbAnon = createClient(supabaseUrl, anonKey);
    const { data: { user } } = await sbAnon.auth.getUser(token);
    if (!user) return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers: JSON_H });

    const sb = createClient(supabaseUrl, serviceKey);
    const body = await req.json();
    const { action, projectId } = body;

    if (!projectId) return new Response(JSON.stringify({ error: "projectId required" }), { status: 400, headers: JSON_H });

    // Authz
    const { data: hasAccess } = await sb.rpc("has_project_access", { _user_id: user.id, _project_id: projectId });
    if (!hasAccess) return new Response(JSON.stringify({ error: "Forbidden" }), { status: 403, headers: JSON_H });

    // ══════════════════════════════════════════════
    // ACTION: record-resolutions
    // ══════════════════════════════════════════════
    if (action === "record-resolutions") {
      const { source, sourceRunId, notes = [], selectedOptions = [], globalDirections = [], currentDocTypeKey } = body;
      const optionMap = new Map<string, any>();
      for (const so of selectedOptions) optionMap.set(so.note_id, so);

      const recorded: any[] = [];
      const reconcileKeys = new Set<string>();

      // Process notes
      for (const note of notes) {
        const noteId = note.id || note.note_key || "";
        const option = optionMap.get(noteId);
        const fp = noteFingerprint(note);
        const dKey = decisionKeyFromNote(note);
        const dText = decisionTextFromNote(note, option);

        // Supersede previous with same key
        await sb.from("decision_ledger")
          .update({ status: "superseded" })
          .eq("project_id", projectId)
          .eq("decision_key", dKey)
          .eq("status", "active");

        // Insert new decision
        const { data: dec } = await sb.from("decision_ledger").insert({
          project_id: projectId,
          decision_key: dKey,
          title: (note.description || note.note || "Decision").slice(0, 200),
          decision_text: dText,
          decision_value: option ? { option_id: option.option_id, custom_direction: option.custom_direction } : null,
          scope: "project",
          targets: { doc_type_keys: CATEGORY_TARGETS[note.category?.toLowerCase()] || [] },
          source: source || "dev_engine_rewrite",
          source_run_id: sourceRunId || null,
          source_note_id: noteId || null,
          status: "active",
          created_by: user.id,
        }).select("id").single();

        // Upsert resolved note
        await sb.from("resolved_notes").upsert({
          project_id: projectId,
          note_fingerprint: fp,
          decision_id: dec?.id || null,
          status: "active",
          updated_at: new Date().toISOString(),
        }, { onConflict: "project_id,note_fingerprint" });

        // Collect targets for reconcile
        const targets = CATEGORY_TARGETS[note.category?.toLowerCase()] || [];
        for (const t of targets) {
          if (t !== currentDocTypeKey) reconcileKeys.add(t);
        }

        recorded.push({ decision_key: dKey, fingerprint: fp, decision_id: dec?.id });
      }

      // Process selected options without matching notes
      for (const so of selectedOptions) {
        if (notes.some((n: any) => (n.id || n.note_key) === so.note_id)) continue;
        const synth = { id: so.note_id, note_key: so.note_id, category: "general", description: `Decision for ${so.note_id}` };
        const fp = noteFingerprint(synth);
        const dKey = decisionKeyFromNote(synth);

        await sb.from("decision_ledger")
          .update({ status: "superseded" })
          .eq("project_id", projectId).eq("decision_key", dKey).eq("status", "active");

        const { data: dec } = await sb.from("decision_ledger").insert({
          project_id: projectId,
          decision_key: dKey,
          title: `Decision: ${so.note_id}`,
          decision_text: decisionTextFromNote(synth, so),
          decision_value: { option_id: so.option_id, custom_direction: so.custom_direction },
          scope: "project",
          source: source || "dev_engine_decision",
          source_note_id: so.note_id,
          status: "active",
          created_by: user.id,
        }).select("id").single();

        await sb.from("resolved_notes").upsert({
          project_id: projectId,
          note_fingerprint: fp,
          decision_id: dec?.id || null,
          status: "active",
          updated_at: new Date().toISOString(),
        }, { onConflict: "project_id,note_fingerprint" });

        recorded.push({ decision_key: dKey, fingerprint: fp, decision_id: dec?.id });
      }

      // Global directions as decisions
      for (const dir of globalDirections) {
        const dirStr = typeof dir === "string" ? dir : (dir as any).direction || "";
        if (!dirStr) continue;
        const dKey = `global_${djb2(dirStr.slice(0, 40))}`;

        await sb.from("decision_ledger")
          .update({ status: "superseded" })
          .eq("project_id", projectId).eq("decision_key", dKey).eq("status", "active");

        await sb.from("decision_ledger").insert({
          project_id: projectId,
          decision_key: dKey,
          title: `Global Direction: ${dirStr.slice(0, 120)}`,
          decision_text: dirStr,
          scope: "project",
          source: source || "dev_engine_rewrite",
          source_run_id: sourceRunId || null,
          status: "active",
          created_by: user.id,
        });
      }

      // Mark affected docs as needing reconcile
      const reconcileMarked: string[] = [];
      if (reconcileKeys.size > 0) {
        // Find project docs that match affected types by doc_type
        const { data: docs } = await sb.from("project_documents")
          .select("id, doc_type")
          .eq("project_id", projectId);

        for (const doc of docs || []) {
          const dt = (doc.doc_type || "").toLowerCase().replace(/[\s-]+/g, "_");
          if (reconcileKeys.has(dt)) {
            const existing = (doc as any).reconcile_reasons || [];
            const reasons = [...(Array.isArray(existing) ? existing : []), ...Array.from(reconcileKeys)];
            await sb.from("project_documents")
              .update({ needs_reconcile: true, reconcile_reasons: [...new Set(reasons)] })
              .eq("id", doc.id);
            reconcileMarked.push(dt);
          }
        }
      }

      return new Response(JSON.stringify({ recorded: recorded.length, decisions: recorded, reconcileMarked }), { headers: JSON_H });
    }

    // ══════════════════════════════════════════════
    // ACTION: record-canon-fix
    // ══════════════════════════════════════════════
    if (action === "record-canon-fix") {
      const { runId, issueId, episodeNumber, selectedFixOption } = body;

      // Load issue
      const { data: issue } = await sb.from("series_continuity_issues")
        .select("*").eq("id", issueId).single();

      if (!issue) return new Response(JSON.stringify({ error: "Issue not found" }), { status: 404, headers: JSON_H });

      const fp = noteFingerprint({
        note_key: issue.issue_type,
        severity: issue.severity,
        description: `${issue.title}: ${issue.why_it_conflicts || ""}`,
      });

      const dKey = `canon_${issue.issue_type}_ep${episodeNumber || 0}_${djb2(issue.title || "")}`;

      await sb.from("decision_ledger")
        .update({ status: "superseded" })
        .eq("project_id", projectId).eq("decision_key", dKey).eq("status", "active");

      const { data: dec } = await sb.from("decision_ledger").insert({
        project_id: projectId,
        decision_key: dKey,
        title: `Canon Fix: ${(issue.title || "").slice(0, 150)}`,
        decision_text: `${issue.title} — ${selectedFixOption || "auto fix"}. Conflict: ${issue.why_it_conflicts || "N/A"}`,
        decision_value: { fix_option: selectedFixOption, episode_number: episodeNumber },
        scope: episodeNumber ? "episode" : "project",
        targets: { doc_type_keys: ["episode_script", "character_bible", "season_arc", "blueprint"], episode_numbers: episodeNumber ? [episodeNumber] : [] },
        source: "canon_fix",
        source_run_id: runId || null,
        source_issue_id: issueId,
        status: "active",
        created_by: user.id,
      }).select("id").single();

      await sb.from("resolved_notes").upsert({
        project_id: projectId,
        note_fingerprint: fp,
        decision_id: dec?.id || null,
        status: "active",
        updated_at: new Date().toISOString(),
      }, { onConflict: "project_id,note_fingerprint" });

      // Mark affected docs
      const { data: docs } = await sb.from("project_documents")
        .select("id, doc_type").eq("project_id", projectId);
      const affectedTypes = new Set(["episode_script", "character_bible", "season_arc", "blueprint"]);
      for (const doc of docs || []) {
        const dt = (doc.doc_type || "").toLowerCase().replace(/[\s-]+/g, "_");
        if (affectedTypes.has(dt)) {
          await sb.from("project_documents")
            .update({ needs_reconcile: true, reconcile_reasons: [dKey] })
            .eq("id", doc.id);
        }
      }

      return new Response(JSON.stringify({ recorded: 1, decision_id: dec?.id }), { headers: JSON_H });
    }

    // ══════════════════════════════════════════════
    // ACTION: list-decisions
    // ══════════════════════════════════════════════
    if (action === "list-decisions") {
      const { data: decisions } = await sb.from("decision_ledger")
        .select("*")
        .eq("project_id", projectId)
        .eq("status", "active")
        .order("created_at", { ascending: false })
        .limit(50);

      return new Response(JSON.stringify({ decisions: decisions || [] }), { headers: JSON_H });
    }

    // ══════════════════════════════════════════════
    // ACTION: list-resolved-notes
    // ══════════════════════════════════════════════
    if (action === "list-resolved-notes") {
      const { data: resolved } = await sb.from("resolved_notes")
        .select("*")
        .eq("project_id", projectId)
        .eq("status", "active");

      return new Response(JSON.stringify({ resolved: resolved || [] }), { headers: JSON_H });
    }

    // ══════════════════════════════════════════════
    // ACTION: clear-reconcile
    // ══════════════════════════════════════════════
    if (action === "clear-reconcile") {
      const { documentId } = body;
      if (documentId) {
        await sb.from("project_documents")
          .update({ needs_reconcile: false, reconcile_reasons: null })
          .eq("id", documentId);
      } else {
        await sb.from("project_documents")
          .update({ needs_reconcile: false, reconcile_reasons: null })
          .eq("project_id", projectId);
      }
      return new Response(JSON.stringify({ cleared: true }), { headers: JSON_H });
    }

    return new Response(JSON.stringify({ error: `Unknown action: ${action}` }), { status: 400, headers: JSON_H });

  } catch (e: any) {
    console.error("[decisions-engine] error:", e);
    return new Response(JSON.stringify({ error: e.message || "Internal error" }), { status: 500, headers: JSON_H });
  }
});
