import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

// ── Dynamic CORS (echo origin, credentials true) ──
function getCorsHeaders(req: Request) {
  const origin = req.headers.get("Origin") || "*";
  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Credentials": "true",
    "Access-Control-Allow-Headers":
      "authorization, apikey, x-client-info, content-type, prefer, accept, origin, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
    "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
  };
}

function jsonRes(body: Record<string, any>, status: number, req: Request) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...getCorsHeaders(req), "Content-Type": "application/json" },
  });
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// ── Schema discovery cache (per invocation) ──
const _schemaCache = new Map<string, Set<string>>();

async function discoverColumns(sb: any, tableName: string): Promise<Set<string>> {
  if (_schemaCache.has(tableName)) return _schemaCache.get(tableName)!;
  try {
    const { data } = await sb.rpc("", {}).maybeSingle(); // won't use this
  } catch { /* ignore */ }
  // Use raw SQL via information_schema
  const { data, error } = await sb
    .from("information_schema.columns" as any)
    .select("column_name")
    .eq("table_schema", "public")
    .eq("table_name", tableName);
  const cols = new Set<string>();
  if (!error && data) {
    for (const row of data) cols.add(row.column_name);
  }
  if (cols.size === 0) {
    // Fallback: try a limit-0 select to get column names from response shape
    const { data: sampleData } = await sb.from(tableName).select("*").limit(0);
    // If we get column info from an empty result, we can't infer columns this way
    // Last resort: hardcode known columns for decision_ledger
    if (tableName === "decision_ledger") {
      for (const c of [
        "id", "project_id", "decision_key", "title", "decision_text",
        "decision_value", "scope", "targets", "source", "source_run_id",
        "source_note_id", "source_issue_id", "status", "superseded_by",
        "created_by", "created_at",
      ]) cols.add(c);
    } else if (tableName === "project_document_versions") {
      for (const c of [
        "id", "document_id", "version_number", "plaintext", "status",
        "is_current", "created_by", "created_at", "label",
        "approval_status", "deliverable_type", "meta_json",
      ]) cols.add(c);
    } else if (tableName === "project_documents") {
      for (const c of [
        "id", "project_id", "doc_type", "title", "user_id",
        "needs_reconcile", "reconcile_reasons", "updated_at",
        "latest_version_id", "meta_json",
      ]) cols.add(c);
    }
  }
  console.log(`[canon-decisions] discovered ${cols.size} columns for ${tableName}: ${[...cols].join(", ")}`);
  _schemaCache.set(tableName, cols);
  return cols;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: getCorsHeaders(req) });
  }

  if (req.method === "GET") {
    return jsonRes({ ok: true, build: "canon-decisions-v2" }, 200, req);
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;

  // ── Parse body ONCE ──
  let body: any;
  try {
    body = await req.json();
  } catch {
    return jsonRes({ error: "Invalid JSON body" }, 400, req);
  }

  if (body.action === "ping") {
    return jsonRes({ ok: true, build: "canon-decisions-v2" }, 200, req);
  }

  const { action, projectId, decision, apply, userId: bodyUserId } = body;

  if (!projectId || !UUID_RE.test(projectId)) {
    return jsonRes({ error: "Valid projectId required" }, 400, req);
  }

  // ── Auth ──
  const authHeader = req.headers.get("Authorization") || "";
  const token = authHeader.replace("Bearer ", "");
  const isServiceRole = token === serviceKey;

  let actorUserId: string | null = null;

  // Priority 1: explicit body.userId (for orchestrators)
  if (bodyUserId && UUID_RE.test(bodyUserId)) {
    actorUserId = bodyUserId;
  } else if (isServiceRole) {
    // Priority 2: service-role → fallback to project owner
    // NEVER call auth.getUser() with service-role token
    const sbAdmin = createClient(supabaseUrl, serviceKey);
    const { data: proj } = await sbAdmin
      .from("projects")
      .select("user_id")
      .eq("id", projectId)
      .single();
    actorUserId = proj?.user_id || null;
  } else {
    // Priority 3: normal user JWT — validate via auth.getUser()
    const sbUser = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: userData, error: authErr } = await sbUser.auth.getUser();
    if (authErr || !userData?.user?.id) {
      return jsonRes({ error: "Unauthorized" }, 401, req);
    }
    actorUserId = userData.user.id;
  }

  // Hard guard: never null
  if (!actorUserId || !UUID_RE.test(actorUserId)) {
    return jsonRes({ error: "Cannot determine valid actor user ID" }, 400, req);
  }

  const sb = createClient(supabaseUrl, serviceKey);

  // Authz
  const { data: hasAccess } = await sb.rpc("has_project_access", {
    _user_id: actorUserId,
    _project_id: projectId,
  });
  if (!hasAccess) {
    return jsonRes({ error: "Forbidden" }, 403, req);
  }

  try {
    if (action === "create_and_apply") {
      if (!decision?.type || !decision?.payload) {
        return jsonRes({ error: "decision.type and decision.payload required" }, 400, req);
      }

      const applyMode = apply?.mode || "mark_only";
      const decisionType: string = decision.type;
      const payload = decision.payload;
      const warnings: string[] = [];

      // ── Discover decision_ledger schema ──
      const dlCols = await discoverColumns(sb, "decision_ledger");

      // ── Build decision_key ──
      let decisionKey: string | null = null;
      if (decisionType === "RENAME_ENTITY") {
        const ek = (payload.entity_kind || "character").toLowerCase();
        const on = (payload.old_name || "").toLowerCase().replace(/\s+/g, "_");
        decisionKey = `rename_${ek}_${on}`;
      } else {
        decisionKey = `canon_${decisionType.toLowerCase()}_${Date.now()}`;
      }

      // ── Supersede prior active ──
      if (dlCols.has("decision_key") && dlCols.has("status")) {
        await sb
          .from("decision_ledger")
          .update({ status: "superseded" } as any)
          .eq("project_id", projectId)
          .eq("decision_key", decisionKey)
          .eq("status", "active");
      } else {
        warnings.push("supersede=skipped_no_decision_key_column");
      }

      // ── Build insert payload ──
      const insertRow: Record<string, any> = {};
      insertRow.project_id = projectId;

      if (dlCols.has("status")) insertRow.status = "active";
      if (dlCols.has("decision_key")) insertRow.decision_key = decisionKey;
      if (dlCols.has("title")) insertRow.title = buildTitle(decisionType, payload);
      if (dlCols.has("decision_text")) insertRow.decision_text = buildText(decisionType, payload);
      if (dlCols.has("scope")) insertRow.scope = "project";
      if (dlCols.has("source")) insertRow.source = "canon_decision";

      // created_by / user_id attribution
      if (dlCols.has("created_by")) {
        insertRow.created_by = actorUserId;
      } else if (dlCols.has("user_id")) {
        insertRow.user_id = actorUserId;
      } else if (dlCols.has("actor_user_id")) {
        insertRow.actor_user_id = actorUserId;
      }

      // Type column
      if (dlCols.has("decision_type")) {
        insertRow.decision_type = decisionType;
      } else if (dlCols.has("type")) {
        insertRow.type = decisionType;
      } else if (dlCols.has("kind")) {
        insertRow.kind = decisionType;
      }

      // JSON payload — find best column
      const jsonPayload = { type: decisionType, ...payload };
      const jsonColCandidates = ["decision_value", "payload_json", "meta_json", "decision_json"];
      const jsonCol = jsonColCandidates.find((c) => dlCols.has(c));
      if (jsonCol) {
        insertRow[jsonCol] = jsonPayload;
      } else {
        warnings.push("storage=partial_no_json_column");
      }

      const { data: dec, error: decErr } = await sb
        .from("decision_ledger")
        .insert(insertRow as any)
        .select("id")
        .single();

      if (decErr) throw decErr;
      const decisionId = (dec as any)?.id || null;

      // ── Apply dispatcher ──
      let applied: any;
      if (decisionType === "RENAME_ENTITY" && applyMode === "auto") {
        applied = await applyRenameEntity(sb, projectId, payload, actorUserId, warnings);
      } else {
        applied = await markOutOfSync(sb, projectId, decisionType, warnings);
      }

      return jsonRes(
        {
          ok: true,
          decisionId,
          applied: { mode: applyMode, ...applied, warnings },
        },
        200,
        req
      );
    }

    return jsonRes({ error: `Unknown action: ${action}` }, 400, req);
  } catch (e: any) {
    console.error("[canon-decisions] error:", e);
    return jsonRes({ error: e.message || "Internal error" }, 500, req);
  }
});

function buildTitle(type: string, payload: any): string {
  if (type === "RENAME_ENTITY") {
    return `Rename ${payload.entity_kind || "character"}: ${payload.old_name} → ${payload.new_name}`;
  }
  return `Canon Decision: ${type}`;
}

function buildText(type: string, payload: any): string {
  if (type === "RENAME_ENTITY") {
    return `Rename all occurrences of "${payload.old_name}" to "${payload.new_name}" (${payload.entity_kind || "character"}).${payload.notes ? " Notes: " + payload.notes : ""}`;
  }
  return JSON.stringify(payload);
}

// ════════════════════════════════════════════════════════════════
// RENAME_ENTITY: Deterministic whole-word propagation
// NO LOOKBEHIND. Uses capture-group prefix approach.
// ════════════════════════════════════════════════════════════════
async function applyRenameEntity(
  sb: any,
  projectId: string,
  payload: any,
  actorUserId: string,
  warnings: string[]
) {
  const oldName: string = payload.old_name;
  const newName: string = payload.new_name;

  if (!oldName || !newName || oldName === newName) {
    return { docs_scanned: 0, docs_modified: 0, modified_document_ids: [] };
  }

  const escaped = escapeRegex(oldName);

  // Safe regex WITHOUT lookbehind:
  // Group 1 = boundary prefix (start-of-string OR non-word char)
  // Group 2 = the old name
  // Lookahead ensures non-word char or end follows (including possessive 's)
  const re = new RegExp(
    `(^|[^\\w])` +
    `(${escaped})` +
    `(?=[^\\w]|$)`,
    "g"
  );

  // Fetch all project documents
  const { data: docs } = await sb
    .from("project_documents")
    .select("id, doc_type")
    .eq("project_id", projectId);

  if (!docs || docs.length === 0) {
    return { docs_scanned: 0, docs_modified: 0, modified_document_ids: [] };
  }

  const docIds = docs.map((d: any) => d.id);

  // Discover version columns
  const verCols = await discoverColumns(sb, "project_document_versions");

  if (!verCols.has("plaintext")) {
    warnings.push("versioning=no_plaintext_column");
    return { docs_scanned: docs.length, docs_modified: 0, modified_document_ids: [] };
  }

  // Fetch current versions — adapt to whether is_current exists
  let versions: any[] = [];
  if (verCols.has("is_current")) {
    const { data } = await sb
      .from("project_document_versions")
      .select("id, document_id, version_number, plaintext, status, is_current")
      .in("document_id", docIds)
      .eq("is_current", true);
    versions = data || [];
  } else {
    // Fallback: get latest version per doc by version_number desc
    // Fetch all and deduplicate client-side
    const { data } = await sb
      .from("project_document_versions")
      .select("id, document_id, version_number, plaintext, status")
      .in("document_id", docIds)
      .order("version_number", { ascending: false });
    const seen = new Set<string>();
    for (const v of data || []) {
      if (!seen.has(v.document_id)) {
        seen.add(v.document_id);
        versions.push(v);
      }
    }
    warnings.push("versioning=no_is_current_column");
  }

  const modifiedIds: string[] = [];

  for (const ver of versions) {
    if (!ver.plaintext) continue;

    // Apply rename — callback preserves the prefix character
    const updated = ver.plaintext.replace(
      re,
      (_match: string, prefix: string) => `${prefix}${newName}`
    );

    if (updated === ver.plaintext) continue;

    const nextVersion = (ver.version_number || 0) + 1;

    // Mark old version not current (if column exists)
    if (verCols.has("is_current")) {
      await sb
        .from("project_document_versions")
        .update({ is_current: false } as any)
        .eq("id", ver.id);
    }

    // Build new version row
    const newVerRow: Record<string, any> = {
      document_id: ver.document_id,
      plaintext: updated,
    };

    if (verCols.has("version_number")) newVerRow.version_number = nextVersion;
    if (verCols.has("status")) newVerRow.status = ver.status || "draft";
    if (verCols.has("is_current")) newVerRow.is_current = true;
    if (verCols.has("label")) newVerRow.label = `v${nextVersion} (rename: ${oldName}→${newName})`;

    if (verCols.has("created_by")) {
      newVerRow.created_by = actorUserId;
    } else if (verCols.has("user_id")) {
      newVerRow.user_id = actorUserId;
    }

    await sb.from("project_document_versions").insert(newVerRow as any);

    // Update project_documents.updated_at
    await sb
      .from("project_documents")
      .update({ updated_at: new Date().toISOString() } as any)
      .eq("id", ver.document_id);

    modifiedIds.push(ver.document_id);
  }

  return {
    docs_scanned: docs.length,
    docs_modified: modifiedIds.length,
    modified_document_ids: modifiedIds,
  };
}

// ════════════════════════════════════════════════════════════════
// MARK ONLY: flag docs out-of-sync (schema-adaptive, never hard-fails)
// ════════════════════════════════════════════════════════════════
async function markOutOfSync(
  sb: any,
  projectId: string,
  decisionType: string,
  warnings: string[]
) {
  const { data: docs } = await sb
    .from("project_documents")
    .select("id")
    .eq("project_id", projectId);

  if (!docs || docs.length === 0) {
    return { docs_scanned: 0, docs_modified: 0, modified_document_ids: [] };
  }

  const docCols = await discoverColumns(sb, "project_documents");

  // Determine which flag mechanism to use
  if (docCols.has("needs_reconcile")) {
    const updatePayload: Record<string, any> = { needs_reconcile: true };
    if (docCols.has("reconcile_reasons")) {
      updatePayload.reconcile_reasons = [decisionType];
    }
    for (const doc of docs) {
      await sb
        .from("project_documents")
        .update(updatePayload as any)
        .eq("id", doc.id);
    }
    return {
      docs_scanned: docs.length,
      docs_modified: docs.length,
      modified_document_ids: docs.map((d: any) => d.id),
    };
  }

  if (docCols.has("meta_json")) {
    for (const doc of docs) {
      // Fetch existing meta_json to merge
      const { data: existing } = await sb
        .from("project_documents")
        .select("meta_json")
        .eq("id", doc.id)
        .single();
      const meta = (existing?.meta_json && typeof existing.meta_json === "object")
        ? { ...existing.meta_json }
        : {};
      meta.out_of_sync_with_canon = true;
      meta.out_of_sync_reason = decisionType;
      meta.out_of_sync_at = new Date().toISOString();
      await sb
        .from("project_documents")
        .update({ meta_json: meta } as any)
        .eq("id", doc.id);
    }
    return {
      docs_scanned: docs.length,
      docs_modified: docs.length,
      modified_document_ids: docs.map((d: any) => d.id),
    };
  }

  // No supported columns — skip gracefully
  warnings.push("mark_only=no_supported_fields");
  return {
    docs_scanned: docs.length,
    docs_modified: 0,
    modified_document_ids: [],
  };
}
