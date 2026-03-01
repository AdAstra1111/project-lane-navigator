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

// ── UUID shape check ──
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

Deno.serve(async (req) => {
  // ── CORS preflight ──
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: getCorsHeaders(req) });
  }

  // ── Ping (GET or POST with action:ping) ──
  if (req.method === "GET") {
    return jsonRes({ ok: true, build: "canon-decisions-v1" }, 200, req);
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

  // ── Parse body ONCE ──
  let body: any;
  try {
    body = await req.json();
  } catch {
    return jsonRes({ error: "Invalid JSON body" }, 400, req);
  }

  // ── Ping via POST ──
  if (body.action === "ping") {
    return jsonRes({ ok: true, build: "canon-decisions-v1" }, 200, req);
  }

  const { action, projectId, decision, apply, userId: bodyUserId } = body;

  if (!projectId || !UUID_RE.test(projectId)) {
    return jsonRes({ error: "Valid projectId required" }, 400, req);
  }

  // ── Auth: determine actorUserId ──
  const authHeader = req.headers.get("Authorization") || "";
  const token = authHeader.replace("Bearer ", "");
  const isServiceRole = token === serviceKey;

  let actorUserId: string | null = null;

  if (bodyUserId && UUID_RE.test(bodyUserId)) {
    actorUserId = bodyUserId;
  } else if (isServiceRole) {
    // Fallback: project owner
    const sbAdmin = createClient(supabaseUrl, serviceKey);
    const { data: proj } = await sbAdmin
      .from("projects")
      .select("user_id")
      .eq("id", projectId)
      .single();
    actorUserId = proj?.user_id || null;
  } else {
    // Standard JWT — decode sub
    try {
      const payloadB64 = token.split(".")[1];
      if (!payloadB64) throw new Error("bad token");
      const payload = JSON.parse(
        atob(payloadB64.replace(/-/g, "+").replace(/_/g, "/"))
      );
      if (!payload.sub) throw new Error("no sub");
      if (payload.exp && payload.exp < Math.floor(Date.now() / 1000))
        throw new Error("expired");
      actorUserId = payload.sub;
    } catch {
      return jsonRes({ error: "Unauthorized" }, 401, req);
    }
  }

  // ── Hard guard: never write null or "service_role" ──
  if (!actorUserId || !UUID_RE.test(actorUserId)) {
    return jsonRes(
      { error: "Cannot determine valid actor user ID" },
      400,
      req
    );
  }

  const sb = createClient(supabaseUrl, serviceKey);

  // ── Authz ──
  const { data: hasAccess } = await sb.rpc("has_project_access", {
    _user_id: actorUserId,
    _project_id: projectId,
  });
  if (!hasAccess) {
    return jsonRes({ error: "Forbidden" }, 403, req);
  }

  try {
    // ════════════════════════════════════════════════
    // ACTION: create_and_apply
    // ════════════════════════════════════════════════
    if (action === "create_and_apply") {
      if (!decision?.type || !decision?.payload) {
        return jsonRes({ error: "decision.type and decision.payload required" }, 400, req);
      }

      const applyMode = apply?.mode || "mark_only";
      const decisionType = decision.type;
      const payload = decision.payload;

      // ── Build decision_key (scope key for superseding) ──
      let decisionKey: string;
      if (decisionType === "RENAME_ENTITY") {
        const ek = (payload.entity_kind || "character").toLowerCase();
        const on = (payload.old_name || "").toLowerCase().replace(/\s+/g, "_");
        decisionKey = `rename_${ek}_${on}`;
      } else {
        decisionKey = `canon_${decisionType.toLowerCase()}_${Date.now()}`;
      }

      // ── Supersede prior active decisions with same key ──
      await sb
        .from("decision_ledger")
        .update({ status: "superseded" } as any)
        .eq("project_id", projectId)
        .eq("decision_key", decisionKey)
        .eq("status", "active");

      // ── Insert decision ──
      const { data: dec, error: decErr } = await sb
        .from("decision_ledger")
        .insert({
          project_id: projectId,
          decision_key: decisionKey,
          title: buildTitle(decisionType, payload),
          decision_text: buildText(decisionType, payload),
          decision_value: { type: decisionType, ...payload } as any,
          scope: "project",
          source: "canon_decision",
          status: "active",
          created_by: actorUserId,
        } as any)
        .select("id")
        .single();

      if (decErr) throw decErr;
      const decisionId = (dec as any).id;

      // ── Apply dispatcher ──
      let applied: any;
      if (decisionType === "RENAME_ENTITY" && applyMode === "auto") {
        applied = await applyRenameEntity(sb, projectId, payload, actorUserId);
      } else {
        applied = await markOutOfSync(sb, projectId, decisionType);
      }

      return jsonRes(
        {
          ok: true,
          decisionId,
          applied: { mode: applyMode, ...applied },
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

// ── Title builder ──
function buildTitle(type: string, payload: any): string {
  if (type === "RENAME_ENTITY") {
    return `Rename ${payload.entity_kind || "character"}: ${payload.old_name} → ${payload.new_name}`;
  }
  return `Canon Decision: ${type}`;
}

// ── Text builder ──
function buildText(type: string, payload: any): string {
  if (type === "RENAME_ENTITY") {
    return `Rename all occurrences of "${payload.old_name}" to "${payload.new_name}" (${payload.entity_kind || "character"}).${payload.notes ? " Notes: " + payload.notes : ""}`;
  }
  return JSON.stringify(payload);
}

// ════════════════════════════════════════════════════════════════════
// RENAME_ENTITY: Deterministic whole-word propagation
// ════════════════════════════════════════════════════════════════════
async function applyRenameEntity(
  sb: any,
  projectId: string,
  payload: any,
  actorUserId: string
) {
  const oldName: string = payload.old_name;
  const newName: string = payload.new_name;

  if (!oldName || !newName || oldName === newName) {
    return { docs_scanned: 0, docs_modified: 0, modified_document_ids: [] };
  }

  // Build conservative whole-word regex
  // Handles: word boundaries, possessives ("Akiko's" → "Junko's"), quotes
  const escaped = oldName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const pattern = new RegExp(
    `(?<=[\\s"'\\(\\[,;:\\-—]|^)${escaped}(?='s\\b|[\\s"'\\)\\],.;:!?\\-—]|$)`,
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

  // Fetch current versions for all docs
  const { data: versions } = await sb
    .from("project_document_versions")
    .select("id, document_id, version_number, plaintext, status, is_current")
    .in("document_id", docIds)
    .eq("is_current", true);

  const modifiedIds: string[] = [];

  for (const ver of versions || []) {
    if (!ver.plaintext) continue;

    const updated = ver.plaintext.replace(pattern, newName);
    if (updated === ver.plaintext) continue;

    const nextVersion = (ver.version_number || 0) + 1;

    // Mark old version not current
    await sb
      .from("project_document_versions")
      .update({ is_current: false } as any)
      .eq("id", ver.id);

    // Insert new version
    await sb.from("project_document_versions").insert({
      document_id: ver.document_id,
      version_number: nextVersion,
      plaintext: updated,
      status: ver.status || "draft",
      is_current: true,
      created_by: actorUserId,
      label: `v${nextVersion} (rename: ${oldName}→${newName})`,
    } as any);

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

// ════════════════════════════════════════════════════════════════════
// MARK ONLY: flag docs as out of sync (no text rewrite)
// ════════════════════════════════════════════════════════════════════
async function markOutOfSync(sb: any, projectId: string, decisionType: string) {
  const { data: docs } = await sb
    .from("project_documents")
    .select("id")
    .eq("project_id", projectId);

  if (!docs || docs.length === 0) {
    return { docs_scanned: 0, docs_modified: 0, modified_document_ids: [] };
  }

  const markedIds: string[] = [];
  for (const doc of docs) {
    await sb
      .from("project_documents")
      .update({
        needs_reconcile: true,
        reconcile_reasons: [decisionType],
      } as any)
      .eq("id", doc.id);
    markedIds.push(doc.id);
  }

  return {
    docs_scanned: docs.length,
    docs_modified: markedIds.length,
    modified_document_ids: markedIds,
  };
}
