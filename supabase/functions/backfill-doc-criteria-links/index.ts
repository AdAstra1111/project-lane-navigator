import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    const { projectId } = await req.json();
    if (!projectId) {
      return new Response(
        JSON.stringify({ error: "projectId required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Get project's current resolver hash
    const { data: project, error: pErr } = await supabase
      .from("projects")
      .select("id, resolved_qualifications_hash")
      .eq("id", projectId)
      .single();

    if (pErr || !project) {
      return new Response(
        JSON.stringify({ error: "Project not found", detail: pErr?.message }),
        { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const hash = project.resolved_qualifications_hash;
    if (!hash) {
      return new Response(
        JSON.stringify({ error: "No resolved_qualifications_hash on project", updated: 0 }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Get all document IDs for this project
    const { data: docs } = await supabase
      .from("project_documents")
      .select("id, latest_version_id")
      .eq("project_id", projectId);

    if (!docs || docs.length === 0) {
      return new Response(
        JSON.stringify({ updated: 0, message: "No documents found" }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const versionIds = docs
      .map((d: any) => d.latest_version_id)
      .filter(Boolean);

    if (versionIds.length === 0) {
      return new Response(
        JSON.stringify({ updated: 0, message: "No versions found" }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Update versions that have generator_id (seed-pack/devseed-promote) but no resolver hash
    const { data: updated, error: uErr } = await supabase
      .from("project_document_versions")
      .update({ depends_on_resolver_hash: hash })
      .in("id", versionIds)
      .is("depends_on_resolver_hash", null)
      .in("generator_id", ["seed-pack", "devseed-promote"])
      .select("id, document_id");

    if (uErr) {
      return new Response(
        JSON.stringify({ error: "Update failed", detail: uErr.message }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    return new Response(
      JSON.stringify({
        updated: updated?.length || 0,
        resolver_hash: hash,
        version_ids: (updated || []).map((r: any) => r.id),
      }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err) {
    return new Response(
      JSON.stringify({ error: (err as Error).message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
