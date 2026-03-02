import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const BUILD = "backfill-doc-criteria-links-v2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

function jsonRes(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  // ── Ping ──
  if (req.method === "GET") {
    return jsonRes({ ok: true, build: BUILD });
  }

  try {
    // ── Parse body once ──
    const body = await req.json().catch(() => ({}));

    // Also support ping via POST
    if (body?.action === "ping") {
      return jsonRes({ ok: true, build: BUILD });
    }

    // ── Auth: require Bearer JWT ──
    const authHeader = req.headers.get("Authorization") || "";
    if (!authHeader.startsWith("Bearer ") || authHeader.length < 60) {
      return jsonRes({ error: "UNAUTHORIZED", code: "MISSING_OR_INVALID_TOKEN" }, 401);
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    // Authed client (anon key + user's JWT) for getUser
    const authedClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });

    const { data: userData, error: userErr } = await authedClient.auth.getUser();
    if (userErr || !userData?.user) {
      return jsonRes({ error: "UNAUTHORIZED", code: "INVALID_USER" }, 401);
    }
    const userId = userData.user.id;

    // Service-role client for admin check + data operations
    const db = createClient(supabaseUrl, serviceRoleKey);

    // ── Admin check via has_role RPC ──
    const { data: isAdmin, error: roleErr } = await db.rpc("has_role", {
      _user_id: userId,
      _role: "admin",
    });

    if (roleErr || !isAdmin) {
      return jsonRes({ error: "FORBIDDEN", code: "FORBIDDEN_NOT_ADMIN" }, 403);
    }

    // ── Validate input ──
    const { projectId } = body;
    if (!projectId || typeof projectId !== "string") {
      return jsonRes({ error: "BAD_REQUEST", code: "PROJECT_ID_REQUIRED" }, 400);
    }

    // ── Get project resolver hash ──
    const { data: project, error: pErr } = await db
      .from("projects")
      .select("id, resolved_qualifications_hash")
      .eq("id", projectId)
      .single();

    if (pErr || !project) {
      return jsonRes({ error: "NOT_FOUND", code: "PROJECT_NOT_FOUND" }, 404);
    }

    const hash = project.resolved_qualifications_hash;
    if (!hash) {
      return jsonRes({
        ok: true,
        updated: 0,
        message: "No resolved_qualifications_hash on project",
        ts: new Date().toISOString(),
      });
    }

    // ── Get all document IDs for project ──
    const { data: docs } = await db
      .from("project_documents")
      .select("id")
      .eq("project_id", projectId);

    const docIds = (docs || []).map((d: any) => d.id);
    if (docIds.length === 0) {
      return jsonRes({
        ok: true,
        updated: 0,
        message: "No documents found",
        ts: new Date().toISOString(),
      });
    }

    // ── Backfill: update versions by document_id (not just latest) ──
    const { data: updated, error: uErr } = await db
      .from("project_document_versions")
      .update({ depends_on_resolver_hash: hash })
      .in("document_id", docIds)
      .is("depends_on_resolver_hash", null)
      .in("generator_id", ["seed-pack", "devseed-promote"])
      .select("id, document_id");

    if (uErr) {
      return jsonRes({ error: "UPDATE_FAILED", detail: uErr.message }, 500);
    }

    return jsonRes({
      ok: true,
      updated: updated?.length || 0,
      resolver_hash: hash,
      version_ids: (updated || []).map((r: any) => r.id),
      ts: new Date().toISOString(),
    });
  } catch (err) {
    return jsonRes({ error: "INTERNAL", detail: (err as Error).message }, 500);
  }
});
