/**
 * backfill-vd-script-types — Admin-only edge function to migrate
 * feature_script → season_script for vertical-drama projects.
 *
 * Preserves all versions. No destructive deletes.
 *
 * POST { projectId, dryRun?: boolean }
 * GET  → ping
 */
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

function jsonRes(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  if (req.method === "GET") {
    return jsonRes({ ok: true, build: "backfill-vd-script-types-v1" });
  }

  if (req.method !== "POST") {
    return jsonRes({ error: "Method not allowed" }, 405);
  }

  // ── Auth ──
  const authHeader = req.headers.get("Authorization") || "";
  if (!authHeader.startsWith("Bearer ") || authHeader.length < 60) {
    return jsonRes({ error: "UNAUTHORIZED", code: "MISSING_TOKEN" }, 401);
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;

  // Verify user identity
  const authClient = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authHeader } },
  });
  const { data: userData, error: userErr } = await authClient.auth.getUser();
  if (userErr || !userData?.user) {
    return jsonRes({ error: "UNAUTHORIZED", code: "INVALID_TOKEN" }, 401);
  }
  const userId = userData.user.id;

  // Verify admin role
  const db = createClient(supabaseUrl, serviceKey);
  const { data: isAdmin } = await db.rpc("has_role", {
    _user_id: userId,
    _role: "admin",
  });
  if (!isAdmin) {
    return jsonRes({ error: "FORBIDDEN", code: "FORBIDDEN_NOT_ADMIN" }, 403);
  }

  // ── Parse body ──
  const body = await req.json().catch(() => ({}));
  const projectId = body.projectId as string;
  const dryRun = body.dryRun === true;

  if (!projectId) {
    return jsonRes({ error: "projectId is required" }, 400);
  }

  // ── Validate project is vertical-drama ──
  const { data: project, error: projErr } = await db
    .from("projects")
    .select("id, format, assigned_lane")
    .eq("id", projectId)
    .single();

  if (projErr || !project) {
    return jsonRes({ error: "Project not found" }, 404);
  }

  const fmt = (project.format || "").toLowerCase().replace(/[_ ]+/g, "-");
  if (fmt !== "vertical-drama") {
    return jsonRes({
      ok: true,
      updated: 0,
      message: `Project format is "${fmt}", not vertical-drama. No changes needed.`,
    });
  }

  // ── Check if season_script doc already exists ──
  const { data: existingSeasonScript } = await db
    .from("project_documents")
    .select("id")
    .eq("project_id", projectId)
    .eq("doc_type", "season_script")
    .limit(1);

  // ── Find feature_script docs ──
  const { data: featureScriptDocs } = await db
    .from("project_documents")
    .select("id, doc_type, latest_version_id")
    .eq("project_id", projectId)
    .eq("doc_type", "feature_script");

  if (!featureScriptDocs || featureScriptDocs.length === 0) {
    return jsonRes({
      ok: true,
      updated: 0,
      message: "No feature_script documents found for this VD project.",
    });
  }

  if (dryRun) {
    return jsonRes({
      ok: true,
      dryRun: true,
      wouldUpdate: featureScriptDocs.length,
      docIds: featureScriptDocs.map((d: any) => d.id),
      hasExistingSeasonScript: (existingSeasonScript?.length ?? 0) > 0,
      message: `Would migrate ${featureScriptDocs.length} feature_script doc(s) to season_script.`,
    });
  }

  // ── If season_script already exists, we can only migrate if there's one feature_script ──
  if ((existingSeasonScript?.length ?? 0) > 0 && featureScriptDocs.length > 0) {
    // Can't create duplicate doc_type slots — skip docs that would conflict
    return jsonRes({
      ok: true,
      updated: 0,
      skipped: featureScriptDocs.length,
      message:
        "season_script doc already exists. Cannot migrate feature_script without creating duplicates. Manual intervention required.",
    });
  }

  // ── Migrate: update doc_type on project_documents ──
  const updatedDocIds: string[] = [];
  const updatedVersionIds: string[] = [];

  for (const doc of featureScriptDocs) {
    // Update the document slot
    const { error: docErr } = await db
      .from("project_documents")
      .update({ doc_type: "season_script" })
      .eq("id", doc.id);

    if (docErr) {
      console.error(`[backfill-vd] Failed to update doc ${doc.id}:`, docErr);
      continue;
    }
    updatedDocIds.push(doc.id);

    // Update deliverable_type on all versions of this document
    const { data: versions, error: verErr } = await db
      .from("project_document_versions")
      .update({ deliverable_type: "season_script" })
      .eq("document_id", doc.id)
      .eq("deliverable_type", "feature_script")
      .select("id");

    if (!verErr && versions) {
      updatedVersionIds.push(...versions.map((v: any) => v.id));
    }
  }

  return jsonRes({
    ok: true,
    updated: updatedDocIds.length,
    updatedDocIds,
    updatedVersionCount: updatedVersionIds.length,
    updatedVersionIds,
    ts: new Date().toISOString(),
  });
});
