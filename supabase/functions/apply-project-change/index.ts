import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

/**
 * apply-project-change
 * 
 * Applies a canonical change to a project (qualifications, format, etc.),
 * re-resolves qualifications, and marks dependent documents as stale.
 */
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, serviceKey);

    const token = authHeader.replace("Bearer ", "");
    const { data: { user } } = await supabase.auth.getUser(token);
    if (!user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const body = await req.json();
    const { projectId, patch, changeType, sourceDecisionId } = body;

    if (!projectId || !patch) {
      return new Response(JSON.stringify({ error: "projectId and patch required" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // 1) Apply patch to project
    const { error: patchErr } = await supabase.from("projects")
      .update(patch)
      .eq("id", projectId);

    if (patchErr) throw new Error(`Patch failed: ${patchErr.message}`);

    // 2) Re-resolve qualifications
    const resolveRes = await fetch(`${supabaseUrl}/functions/v1/resolve-qualifications`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: authHeader,
      },
      body: JSON.stringify({ projectId }),
    });
    const resolveData = await resolveRes.json();
    if (!resolveRes.ok) throw new Error(resolveData.error || "resolve-qualifications failed");

    const newHash = resolveData.resolver_hash;

    // 3) Mark stale: find all latest doc versions where depends_on_resolver_hash != newHash
    const { data: docs } = await supabase.from("project_documents")
      .select("id, doc_type, latest_version_id")
      .eq("project_id", projectId);

    const latestVersionIds = (docs || [])
      .filter((d: any) => d.latest_version_id)
      .map((d: any) => d.latest_version_id);

    const staleDocs: string[] = [];

    if (latestVersionIds.length > 0) {
      // Get versions that have a different hash
      const { data: versions } = await supabase.from("project_document_versions")
        .select("id, document_id, depends_on_resolver_hash")
        .in("id", latestVersionIds);

      const staleVersionIds = (versions || [])
        .filter((v: any) => v.depends_on_resolver_hash && v.depends_on_resolver_hash !== newHash)
        .map((v: any) => v.id);

      if (staleVersionIds.length > 0) {
        await supabase.from("project_document_versions")
          .update({
            is_stale: true,
            stale_reason: `resolver_hash_changed (${changeType || "project_change"})`,
          })
          .in("id", staleVersionIds);

        // Map back to doc types
        const staleDocIds = new Set(
          (versions || [])
            .filter((v: any) => staleVersionIds.includes(v.id))
            .map((v: any) => v.document_id)
        );
        for (const doc of (docs || [])) {
          if (staleDocIds.has(doc.id)) staleDocs.push(doc.doc_type);
        }
      }
    }

    return new Response(JSON.stringify({
      success: true,
      new_resolver_hash: newHash,
      resolved_qualifications: resolveData.resolvedQualifications,
      stale_doc_types: staleDocs,
      stale_count: staleDocs.length,
    }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e: any) {
    console.error("[apply-project-change] error:", e);
    return new Response(JSON.stringify({ error: e.message || "Internal error" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
