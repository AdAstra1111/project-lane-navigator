import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const JSON_HEADERS = { ...corsHeaders, "Content-Type": "application/json" };

// ─── Doc Type Key Normalizer (server-side mirror) ───

const KEY_MAP: Record<string, string> = {
  concept_brief: "concept_brief", concept: "concept_brief", concept_lock: "concept_brief",
  market_sheet: "market_sheet", market: "market_sheet", market_positioning: "market_sheet",
  deck: "deck", pitch_deck: "deck", lookbook: "deck",
  blueprint: "blueprint", series_bible: "blueprint",
  beat_sheet: "beat_sheet",
  character_bible: "character_bible", character: "character_bible",
  episode_grid: "episode_grid", vertical_episode_beats: "episode_grid",
  season_arc: "season_arc",
  documentary_outline: "documentary_outline", doc_outline: "documentary_outline",
  format_rules: "format_rules",
  script: "feature_script", feature_script: "feature_script",
  pilot_script: "episode_script", episode_script: "episode_script", episode_1_script: "episode_script",
  production_draft: "production_draft",
};

const TITLE_HINTS: [RegExp, string][] = [
  [/concept\s*brief/i, "concept_brief"],
  [/market\s*(sheet|positioning)/i, "market_sheet"],
  [/\bdeck\b/i, "deck"],
  [/blueprint|series\s*bible/i, "blueprint"],
  [/beat\s*sheet/i, "beat_sheet"],
  [/character\s*bible/i, "character_bible"],
  [/episode\s*grid/i, "episode_grid"],
  [/season\s*arc/i, "season_arc"],
  [/documentary\s*outline/i, "documentary_outline"],
  [/format\s*rules/i, "format_rules"],
  [/pilot|episode\s*1\b/i, "episode_script"],
  [/\bscript\b/i, "feature_script"],
];

function resolveDocTypeKey(version: any, parentDoc: any, isSeries: boolean): string {
  const keys = [version?.deliverable_type, parentDoc?.doc_type].filter(Boolean);
  for (const k of keys) {
    const norm = k.toLowerCase().replace(/[-\s]/g, "_");
    if (KEY_MAP[norm]) {
      let key = KEY_MAP[norm];
      if (isSeries && key === "feature_script") key = "episode_script";
      return key;
    }
  }
  if (version?.label) {
    const normLabel = version.label.toLowerCase().replace(/[-\s]/g, "_");
    if (KEY_MAP[normLabel]) return KEY_MAP[normLabel];
  }
  const titleText = [parentDoc?.title, parentDoc?.file_name].filter(Boolean).join(" ");
  for (const [re, key] of TITLE_HINTS) {
    if (re.test(titleText)) {
      if (isSeries && key === "feature_script") return "episode_script";
      return key;
    }
  }
  return "other";
}

const SERIES_FORMATS = ["tv-series", "limited-series", "vertical-drama", "digital-series", "documentary-series", "anim-series"];

function isSeriesFormat(format: string): boolean {
  return SERIES_FORMATS.includes((format || "").toLowerCase().replace(/_/g, "-"));
}

// ─── Helper: mark version as approved in project_document_versions ───
async function markVersionApproved(db: any, versionId: string, userId: string) {
  await db.from("project_document_versions")
    .update({
      approval_status: "approved",
      approved_at: new Date().toISOString(),
      approved_by: userId,
    })
    .eq("id", versionId);
}

// ─── Main Handler ───

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const authHeader = req.headers.get("Authorization") || "";

    // Auth
    const anonClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const token = authHeader.replace("Bearer ", "");
    const { data: { user }, error: claimsErr } = await anonClient.auth.getUser(token);
    if (claimsErr || !user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers: JSON_HEADERS });
    }
    const userId = user.id as string;

    const db = createClient(supabaseUrl, serviceKey);
    const body = await req.json();
    const { action, projectId } = body;

    if (!projectId) {
      return new Response(JSON.stringify({ error: "Missing projectId" }), { status: 400, headers: JSON_HEADERS });
    }

    // Verify access
    const { data: hasAccess } = await db.rpc("has_project_access", { _user_id: userId, _project_id: projectId });
    if (!hasAccess) {
      return new Response(JSON.stringify({ error: "No access" }), { status: 403, headers: JSON_HEADERS });
    }

    // Get project format
    const { data: project } = await db.from("projects").select("format").eq("id", projectId).single();
    const isSeries = isSeriesFormat(project?.format || "");

    // ─── ACTION: approve ───
    if (action === "approve") {
      const { documentVersionId, sourceFlow, notes } = body;
      if (!documentVersionId) {
        return new Response(JSON.stringify({ error: "Missing documentVersionId" }), { status: 400, headers: JSON_HEADERS });
      }

      // Fetch version + parent doc
      const { data: version } = await db.from("project_document_versions")
        .select("id, deliverable_type, label, stage, document_id, approval_status")
        .eq("id", documentVersionId).single();
      if (!version) {
        return new Response(JSON.stringify({ error: "Version not found" }), { status: 404, headers: JSON_HEADERS });
      }

      const { data: parentDoc } = await db.from("project_documents")
        .select("id, doc_type, title, file_name")
        .eq("id", version.document_id).single();

      const docTypeKey = resolveDocTypeKey(version, parentDoc, isSeries);

      // Mark version as approved
      if (version.approval_status !== "approved") {
        await markVersionApproved(db, documentVersionId, userId);
      }

      // Upsert into project_active_docs
      const { data: upserted, error: upsertErr } = await db.from("project_active_docs")
        .upsert({
          project_id: projectId,
          doc_type_key: docTypeKey,
          document_version_id: documentVersionId,
          approved_at: new Date().toISOString(),
          approved_by: userId,
          source_flow: sourceFlow || "manual",
          notes: notes || null,
        }, { onConflict: "project_id,doc_type_key" })
        .select("*")
        .single();

      if (upsertErr) {
        console.error("Upsert error:", upsertErr);
        return new Response(JSON.stringify({ error: "Failed to activate doc" }), { status: 500, headers: JSON_HEADERS });
      }

      return new Response(JSON.stringify({ active: upserted, docTypeKey }), { headers: JSON_HEADERS });
    }

    // ─── ACTION: approve-many ───
    if (action === "approve-many") {
      const { documentVersionIds, sourceFlow } = body;
      if (!Array.isArray(documentVersionIds) || documentVersionIds.length === 0) {
        return new Response(JSON.stringify({ error: "Missing documentVersionIds array" }), { status: 400, headers: JSON_HEADERS });
      }

      const results: any[] = [];
      for (const versionId of documentVersionIds) {
        const { data: version } = await db.from("project_document_versions")
          .select("id, deliverable_type, label, stage, document_id, approval_status")
          .eq("id", versionId).single();
        if (!version) continue;

        const { data: parentDoc } = await db.from("project_documents")
          .select("id, doc_type, title, file_name")
          .eq("id", version.document_id).single();

        const docTypeKey = resolveDocTypeKey(version, parentDoc, isSeries);

        // Mark approved
        if (version.approval_status !== "approved") {
          await markVersionApproved(db, versionId, userId);
        }

        // Upsert active
        const { data: upserted } = await db.from("project_active_docs")
          .upsert({
            project_id: projectId,
            doc_type_key: docTypeKey,
            document_version_id: versionId,
            approved_at: new Date().toISOString(),
            approved_by: userId,
            source_flow: sourceFlow || "manual",
          }, { onConflict: "project_id,doc_type_key" })
          .select("*")
          .single();

        if (upserted) results.push(upserted);
      }

      return new Response(JSON.stringify({ activeDocs: results, count: results.length }), { headers: JSON_HEADERS });
    }

    // ─── ACTION: set-active ───
    if (action === "set-active") {
      const { docTypeKey, documentVersionId, allowDraft } = body;
      if (!docTypeKey || !documentVersionId) {
        return new Response(JSON.stringify({ error: "Missing docTypeKey or documentVersionId" }), { status: 400, headers: JSON_HEADERS });
      }

      // Validate version exists and check approval status
      const { data: version } = await db.from("project_document_versions")
        .select("id, deliverable_type, label, stage, document_id, approval_status")
        .eq("id", documentVersionId).single();
      if (!version) {
        return new Response(JSON.stringify({ error: "Version not found" }), { status: 404, headers: JSON_HEADERS });
      }

      // Require approved unless allowDraft is true
      if (version.approval_status !== "approved" && !allowDraft) {
        return new Response(JSON.stringify({
          error: "Version is not approved. Approve it first, or pass allowDraft:true.",
          approval_status: version.approval_status,
        }), { status: 400, headers: JSON_HEADERS });
      }

      const { data: parentDoc } = await db.from("project_documents")
        .select("id, doc_type, title, file_name, project_id")
        .eq("id", version.document_id).single();

      if (parentDoc?.project_id !== projectId) {
        return new Response(JSON.stringify({ error: "Version does not belong to project" }), { status: 400, headers: JSON_HEADERS });
      }

      const computedKey = resolveDocTypeKey(version, parentDoc, isSeries);
      if (computedKey !== docTypeKey && docTypeKey !== "other") {
        console.warn(`Doc type key mismatch: computed=${computedKey}, requested=${docTypeKey}`);
      }

      const { data: upserted, error: upsertErr } = await db.from("project_active_docs")
        .upsert({
          project_id: projectId,
          doc_type_key: docTypeKey,
          document_version_id: documentVersionId,
          approved_at: new Date().toISOString(),
          approved_by: userId,
          source_flow: "manual_override",
        }, { onConflict: "project_id,doc_type_key" })
        .select("*")
        .single();

      if (upsertErr) {
        return new Response(JSON.stringify({ error: "Failed to set active" }), { status: 500, headers: JSON_HEADERS });
      }

      return new Response(JSON.stringify({ active: upserted }), { headers: JSON_HEADERS });
    }

    // ─── ACTION: init (returns candidates, does NOT auto-activate) ───
    if (action === "init") {
      // Get all project docs with latest versions
      const { data: docs } = await db.from("project_documents")
        .select("id, doc_type, title, file_name, latest_version_id")
        .eq("project_id", projectId)
        .not("latest_version_id", "is", null);

      if (!docs?.length) {
        return new Response(JSON.stringify({ candidates: [] }), { headers: JSON_HEADERS });
      }

      // Get existing active docs
      const { data: existing } = await db.from("project_active_docs")
        .select("doc_type_key")
        .eq("project_id", projectId);
      const existingKeys = new Set((existing || []).map((e: any) => e.doc_type_key));

      // Get version metadata
      const versionIds = docs.map(d => d.latest_version_id).filter(Boolean);
      const { data: versions } = await db.from("project_document_versions")
        .select("id, deliverable_type, label, stage, approval_status")
        .in("id", versionIds);
      const versionMap = new Map((versions || []).map((v: any) => [v.id, v]));

      // Build candidates grouped by doc_type_key
      const byKey: Record<string, { versionId: string; title: string; approvalStatus: string }[]> = {};
      for (const doc of docs) {
        if (!doc.latest_version_id) continue;
        const version = versionMap.get(doc.latest_version_id);
        const key = resolveDocTypeKey(version || {}, doc, isSeries);
        if (key === "other") continue;
        if (existingKeys.has(key)) continue;

        if (!byKey[key]) byKey[key] = [];
        byKey[key].push({
          versionId: doc.latest_version_id,
          title: doc.title || doc.file_name || "Untitled",
          approvalStatus: version?.approval_status || "draft",
        });
      }

      // Pick best candidate per key: prefer approved, then latest
      const candidates: any[] = [];
      for (const [key, entries] of Object.entries(byKey)) {
        // Sort: approved first, then by title heuristic for pilot
        const sorted = entries.sort((a, b) => {
          if (a.approvalStatus === "approved" && b.approvalStatus !== "approved") return -1;
          if (b.approvalStatus === "approved" && a.approvalStatus !== "approved") return 1;
          // For episode_script, prefer pilot
          if (key === "episode_script") {
            const aIsPilot = /pilot|episode\s*1\b|ep\s*1\b/i.test(a.title);
            const bIsPilot = /pilot|episode\s*1\b|ep\s*1\b/i.test(b.title);
            if (aIsPilot && !bIsPilot) return -1;
            if (bIsPilot && !aIsPilot) return 1;
          }
          return 0;
        });
        const best = sorted[0];
        candidates.push({
          doc_type_key: key,
          document_version_id: best.versionId,
          title: best.title,
          approval_status: best.approvalStatus,
          reason: best.approvalStatus === "approved" ? "Latest approved version" : "Latest draft (not yet approved)",
        });
      }

      return new Response(JSON.stringify({ candidates }), { headers: JSON_HEADERS });
    }

    // ─── ACTION: list ───
    if (action === "list") {
      const { data: activeDocs } = await db.from("project_active_docs")
        .select("*")
        .eq("project_id", projectId)
        .order("doc_type_key");

      return new Response(JSON.stringify({ activeDocs: activeDocs || [] }), { headers: JSON_HEADERS });
    }

    return new Response(JSON.stringify({ error: `Unknown action: ${action}` }), { status: 400, headers: JSON_HEADERS });

  } catch (err: any) {
    console.error("Folder engine error:", err);
    return new Response(JSON.stringify({ error: err.message || "Internal error" }), {
      status: 500, headers: JSON_HEADERS,
    });
  }
});
