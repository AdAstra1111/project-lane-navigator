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

// ════════════════════════════════════════════════════════════════
// SAFE DB HELPERS — strip unknown columns on error, retry
// ════════════════════════════════════════════════════════════════

const REQUIRED_KEYS = new Set(["project_id", "document_id", "plaintext"]);
const MAX_STRIP_RETRIES = 8;

function parseUnknownColumn(errMsg: string): string | null {
  // Postgres: column "xyz" of relation "table" does not exist
  let m = errMsg.match(/column "([^"]+)" of relation "[^"]+" does not exist/i);
  if (m) return m[1];
  // PostgREST schema cache: Could not find the "xyz" column
  m = errMsg.match(/Could not find the "([^"]+)" column/i);
  if (m) return m[1];
  // PostgREST: "Could not find the 'xyz' column"
  m = errMsg.match(/Could not find the '([^']+)' column/i);
  if (m) return m[1];
  return null;
}

function stripKey(obj: Record<string, any>, key: string): Record<string, any> {
  const out: Record<string, any> = {};
  for (const k of Object.keys(obj)) {
    if (k !== key) out[k] = obj[k];
  }
  return out;
}

async function safeInsert(
  sb: any,
  table: string,
  row: Record<string, any>,
  selectCols: string,
  warnings: string[]
): Promise<{ data: any; error: any }> {
  let current = { ...row };
  for (let i = 0; i < MAX_STRIP_RETRIES; i++) {
    const { data, error } = await sb
      .from(table)
      .insert(current as any)
      .select(selectCols)
      .single();
    if (!error) return { data, error: null };
    const badCol = parseUnknownColumn(error.message || "");
    if (!badCol || REQUIRED_KEYS.has(badCol)) return { data: null, error };
    warnings.push(`schema_strip:${table}.${badCol}`);
    current = stripKey(current, badCol);
    if (Object.keys(current).length === 0) return { data: null, error };
  }
  // Final attempt after max strips
  const { data, error } = await sb
    .from(table)
    .insert(current as any)
    .select(selectCols)
    .single();
  return { data, error };
}

async function safeUpdate(
  sb: any,
  table: string,
  match: Record<string, any>,
  patch: Record<string, any>,
  warnings: string[]
): Promise<{ data: any; error: any; stripped_all: boolean }> {
  let currentPatch = { ...patch };
  for (let i = 0; i < MAX_STRIP_RETRIES; i++) {
    if (Object.keys(currentPatch).length === 0) {
      return { data: null, error: null, stripped_all: true };
    }
    let q = sb.from(table).update(currentPatch as any);
    for (const [k, v] of Object.entries(match)) {
      q = q.eq(k, v);
    }
    const { data, error } = await q;
    if (!error) return { data, error: null, stripped_all: false };
    const badCol = parseUnknownColumn(error.message || "");
    if (!badCol) return { data: null, error, stripped_all: false };
    // Check if bad col is in match keys — if so, this table doesn't support the filter
    if (badCol in match) {
      warnings.push(`schema_strip:${table}.${badCol}(filter)`);
      return { data: null, error: null, stripped_all: true };
    }
    if (REQUIRED_KEYS.has(badCol)) return { data: null, error, stripped_all: false };
    warnings.push(`schema_strip:${table}.${badCol}`);
    currentPatch = stripKey(currentPatch, badCol);
  }
  if (Object.keys(currentPatch).length === 0) {
    return { data: null, error: null, stripped_all: true };
  }
  let q = sb.from(table).update(currentPatch as any);
  for (const [k, v] of Object.entries(match)) {
    q = q.eq(k, v);
  }
  const { data, error } = await q;
  return { data, error, stripped_all: false };
}

// ════════════════════════════════════════════════════════════════

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: getCorsHeaders(req) });
  }

  if (req.method === "GET") {
    return jsonRes({ ok: true, build: "canon-decisions-v4" }, 200, req);
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
    return jsonRes({ ok: true, build: "canon-decisions-v4" }, 200, req);
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

  if (bodyUserId && UUID_RE.test(bodyUserId)) {
    actorUserId = bodyUserId;
  } else if (isServiceRole) {
    const sbAdmin = createClient(supabaseUrl, serviceKey);
    const { data: proj } = await sbAdmin
      .from("projects")
      .select("user_id")
      .eq("id", projectId)
      .single();
    actorUserId = proj?.user_id || null;
  } else {
    const sbUser = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: userData, error: authErr } = await sbUser.auth.getUser();
    if (authErr || !userData?.user?.id) {
      return jsonRes({ error: "Unauthorized" }, 401, req);
    }
    actorUserId = userData.user.id;
  }

  if (!actorUserId || !UUID_RE.test(actorUserId)) {
    return jsonRes({ error: "Cannot determine valid actor user ID" }, 400, req);
  }

  const sb = createClient(supabaseUrl, serviceKey);

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

      // ── Build decision_key ──
      let decisionKey: string | null = null;
      if (decisionType === "RENAME_ENTITY") {
        const ek = (payload.entity_kind || "character").toLowerCase();
        const on = (payload.old_name || "").toLowerCase().replace(/\s+/g, "_");
        decisionKey = `rename_${ek}_${on}`;
      } else if (decisionType === "APPLY_SEED_INTEL_PACK") {
        decisionKey = `apply_seed_intel_pack`;
      } else {
        decisionKey = `canon_${decisionType.toLowerCase()}_${Date.now()}`;
      }

      // ── Supersede prior active decisions ──
      const { stripped_all: supersedeStripped } = await safeUpdate(
        sb,
        "decision_ledger",
        { project_id: projectId, decision_key: decisionKey, status: "active" },
        { status: "superseded" },
        warnings
      );
      if (supersedeStripped) {
        warnings.push("supersede=skipped_no_supported_columns");
      }

      // ── Build maximal insert row ──
      const jsonPayload = { type: decisionType, ...payload };
      const nowISO = new Date().toISOString();

      const insertRow: Record<string, any> = {
        project_id: projectId,
        status: "active",
        decision_key: decisionKey,
        title: buildTitle(decisionType, payload),
        decision_text: buildText(decisionType, payload),
        decision_value: jsonPayload,
        scope: "project",
        source: "canon_decision",
        created_by: actorUserId,
        user_id: actorUserId,
        actor_user_id: actorUserId,
        decision_type: decisionType,
        type: decisionType,
        kind: decisionType,
        payload_json: jsonPayload,
        meta_json: jsonPayload,
        decision_json: jsonPayload,
      };

      const { data: dec, error: decErr } = await safeInsert(
        sb, "decision_ledger", insertRow, "id", warnings
      );

      if (decErr) throw decErr;
      const decisionId = dec?.id || null;

      // ── Apply dispatcher ──
      let applied: any;
      if (decisionType === "RENAME_ENTITY" && applyMode === "auto") {
        applied = await applyRenameEntity(sb, projectId, payload, actorUserId, warnings);
      } else if (decisionType === "APPLY_SEED_INTEL_PACK" && applyMode === "auto") {
        applied = await applySeedIntelPack(sb, projectId, payload, actorUserId, warnings);
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
  if (type === "APPLY_SEED_INTEL_PACK") {
    const packAt = payload.seed_intel_pack?.generated_at || "unknown";
    return `Apply Seed Intel Pack (${packAt})`;
  }
  return `Canon Decision: ${type}`;
}

function buildText(type: string, payload: any): string {
  if (type === "RENAME_ENTITY") {
    return `Rename all occurrences of "${payload.old_name}" to "${payload.new_name}" (${payload.entity_kind || "character"}).${payload.notes ? " Notes: " + payload.notes : ""}`;
  }
  if (type === "APPLY_SEED_INTEL_PACK") {
    const pack = payload.seed_intel_pack;
    const comps = pack?.comparable_candidates?.length || 0;
    const signals = pack?.demand_signals?.length || 0;
    return `Seed Intel Pack applied: ${comps} comparables, ${signals} demand signals. Source: ${payload.source_label || "seed_intel_pack"}`;
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
  const re = new RegExp(
    `(^|[^\\w])(${escaped})(?=[^\\w]|$)`,
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

  // Try fetching current versions with is_current first
  let versions: any[] = [];
  const { data: verData, error: verErr } = await sb
    .from("project_document_versions")
    .select("id, document_id, version_number, plaintext, status")
    .in("document_id", docIds)
    .eq("is_current", true);

  if (!verErr && verData) {
    versions = verData;
  } else {
    // is_current may not exist or query failed — fallback to latest by version_number
    if (verErr) warnings.push("schema_strip:project_document_versions.is_current(filter)");
    const { data: fallbackData } = await sb
      .from("project_document_versions")
      .select("id, document_id, version_number, plaintext, status")
      .in("document_id", docIds)
      .order("version_number", { ascending: false });
    const seen = new Set<string>();
    for (const v of fallbackData || []) {
      if (!seen.has(v.document_id)) {
        seen.add(v.document_id);
        versions.push(v);
      }
    }
  }

  const modifiedIds: string[] = [];

  for (const ver of versions) {
    if (!ver.plaintext) continue;

    const updated = ver.plaintext.replace(
      re,
      (_match: string, prefix: string) => `${prefix}${newName}`
    );

    if (updated === ver.plaintext) continue;

    const nextVersion = (ver.version_number || 0) + 1;

    // Mark old version not current
    await safeUpdate(
      sb,
      "project_document_versions",
      { id: ver.id },
      { is_current: false },
      warnings
    );

    // Build maximal new version row
    const newVerRow: Record<string, any> = {
      document_id: ver.document_id,
      plaintext: updated,
      version_number: nextVersion,
      status: ver.status || "draft",
      is_current: true,
      label: `v${nextVersion} (rename: ${oldName}→${newName})`,
      created_by: actorUserId,
      user_id: actorUserId,
    };

    const { error: insertErr } = await safeInsert(
      sb, "project_document_versions", newVerRow, "id", warnings
    );
    if (insertErr) {
      console.error(`[canon-decisions] version insert error for doc ${ver.document_id}:`, insertErr);
      warnings.push(`version_insert_failed:${ver.document_id}`);
      continue;
    }

    // Touch project_documents.updated_at
    await safeUpdate(
      sb,
      "project_documents",
      { id: ver.document_id },
      { updated_at: new Date().toISOString() },
      warnings
    );

    modifiedIds.push(ver.document_id);
  }

  return {
    docs_scanned: docs.length,
    docs_modified: modifiedIds.length,
    modified_document_ids: modifiedIds,
  };
}

// ════════════════════════════════════════════════════════════════
// MARK ONLY: flag docs out-of-sync (safe-update, never hard-fails)
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

  const modifiedIds: string[] = [];

  for (const doc of docs) {
    // Try setting needs_reconcile + reconcile_reasons first
    const { stripped_all } = await safeUpdate(
      sb,
      "project_documents",
      { id: doc.id },
      { needs_reconcile: true, reconcile_reasons: [decisionType] },
      warnings
    );

    if (!stripped_all) {
      modifiedIds.push(doc.id);
      continue;
    }

    // Fallback: try meta_json merge
    const { data: existing } = await sb
      .from("project_documents")
      .select("meta_json")
      .eq("id", doc.id)
      .single();

    if (existing) {
      const meta = (existing.meta_json && typeof existing.meta_json === "object")
        ? { ...existing.meta_json }
        : {};
      meta.out_of_sync_with_canon = true;
      meta.out_of_sync_reason = decisionType;
      meta.out_of_sync_at = new Date().toISOString();

      const { stripped_all: metaStripped } = await safeUpdate(
        sb,
        "project_documents",
        { id: doc.id },
        { meta_json: meta },
        warnings
      );
      if (!metaStripped) {
        modifiedIds.push(doc.id);
        continue;
      }
    }
    // If both approaches stripped all, this doc couldn't be marked
  }

  if (modifiedIds.length === 0) {
    warnings.push("mark_only=no_supported_fields");
  }

  return {
    docs_scanned: docs.length,
    docs_modified: modifiedIds.length,
    modified_document_ids: modifiedIds,
  };
}

// ════════════════════════════════════════════════════════════════
// APPLY_SEED_INTEL_PACK: Deterministic canon mutation
// Writes seed_intel_pack + optionally inits comparables
// ════════════════════════════════════════════════════════════════
async function applySeedIntelPack(
  sb: any,
  projectId: string,
  payload: any,
  actorUserId: string,
  warnings: string[]
) {
  const pack = payload.seed_intel_pack;
  if (!pack || typeof pack !== "object") {
    warnings.push("no_pack_provided");
    return { docs_scanned: 0, docs_modified: 0, modified_document_ids: [] };
  }

  const initComps = payload.init_comparables_if_empty !== false;
  const compsMax = typeof payload.comparables_from_pack_max === "number"
    ? payload.comparables_from_pack_max : 12;
  const sourceLabel = payload.source_label || "seed_intel_pack";

  // Load existing canon
  const { data: canonRow } = await sb
    .from("project_canon")
    .select("canon_json")
    .eq("project_id", projectId)
    .maybeSingle();

  const existing = (canonRow?.canon_json && typeof canonRow.canon_json === "object")
    ? { ...canonRow.canon_json } : {};

  // Overwrite seed_intel_pack deterministically
  existing.seed_intel_pack = pack;

  // Init comparables if empty or only contains seed-pack-sourced non-locked items
  let compsInitialized = false;
  if (initComps && Array.isArray(pack.comparable_candidates) && pack.comparable_candidates.length > 0) {
    const currentComps = Array.isArray(existing.comparables) ? existing.comparables : [];
    const hasUserCurated = currentComps.some(
      (c: any) => c.locked === true || (c.source && c.source !== sourceLabel)
    );

    if (currentComps.length === 0 || !hasUserCurated) {
      existing.comparables = pack.comparable_candidates
        .slice(0, compsMax)
        .map((c: any) => ({
          title: c.title,
          type: c.type,
          year: c.year,
          reference_axis: c.reference_axis,
          weight: c.weight,
          source: sourceLabel,
          confidence: c.confidence || "medium",
          locked: false,
          reason: c.reason,
        }));
      compsInitialized = true;
    } else {
      warnings.push("comparables_preserved:user_curated_or_locked_items_exist");
    }
  }

  // Write back via project_canon update
  const { error: updateErr } = await safeUpdate(
    sb,
    "project_canon",
    { project_id: projectId },
    { canon_json: existing, updated_by: actorUserId },
    warnings
  );

  if (updateErr) {
    throw new Error(`Canon update failed: ${updateErr.message}`);
  }

  console.log(
    `[canon-decisions] APPLY_SEED_INTEL_PACK: comps_initialized=${compsInitialized}, ` +
    `demand_signals=${pack.demand_signals?.length || 0}, ` +
    `comparable_candidates=${pack.comparable_candidates?.length || 0}`
  );

  return {
    docs_scanned: 1,
    docs_modified: 1,
    modified_document_ids: [],
    comps_initialized: compsInitialized,
  };
}
