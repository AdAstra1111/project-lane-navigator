import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const TOPLINE_TEMPLATE = `# LOGLINE

[1–2 sentences]

# SHORT SYNOPSIS

[150–300 words]

# LONG SYNOPSIS

[~1–2 pages]

# STORY PILLARS

- Theme:
- Protagonist:
- Goal:
- Stakes:
- Antagonistic force:
- Setting:
- Tone:
- Comps:

# SERIES ONLY

- Series promise / engine:
- Season arc snapshot:
`;

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) throw new Error("Not authenticated");

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const sb = createClient(supabaseUrl, serviceKey);

    const anonClient = createClient(supabaseUrl, Deno.env.get("SUPABASE_ANON_KEY")!);
    const { data: { user }, error: userError } = await anonClient.auth.getUser(
      authHeader.replace("Bearer ", "")
    );
    if (userError || !user) throw new Error("Invalid auth token");

    const { action, projectId } = await req.json();
    if (!projectId) throw new Error("projectId required");

    // Verify project access
    const { data: project } = await sb
      .from("projects")
      .select("id, user_id")
      .eq("id", projectId)
      .single();
    if (!project) throw new Error("Project not found");

    // Check access: owner or collaborator
    const isOwner = project.user_id === user.id;
    if (!isOwner) {
      const { data: collab } = await sb
        .from("project_collaborators")
        .select("id")
        .eq("project_id", projectId)
        .eq("user_id", user.id)
        .eq("status", "accepted")
        .limit(1);
      if (!collab?.length) throw new Error("Access denied");
    }

    if (action === "ensure-topline") {
      // Check if topline doc already exists
      const { data: existing } = await sb
        .from("project_documents")
        .select("id, latest_version_id")
        .eq("project_id", projectId)
        .eq("doc_type", "topline_narrative")
        .limit(1);

      if (existing && existing.length > 0) {
        return new Response(JSON.stringify({
          documentId: existing[0].id,
          versionId: existing[0].latest_version_id,
          created: false,
        }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }

      // Create document
      const { data: doc, error: docErr } = await sb
        .from("project_documents")
        .insert({
          project_id: projectId,
          user_id: user.id,
          doc_type: "topline_narrative",
          title: "Topline Narrative",
          file_name: "topline_narrative.md",
          file_path: `${projectId}/topline_narrative.md`,
          extraction_status: "complete",
        })
        .select("id")
        .single();
      if (docErr) throw new Error(`Failed to create doc: ${docErr.message}`);

      // Create initial version
      const { data: version, error: verErr } = await sb
        .from("project_document_versions")
        .insert({
          document_id: doc.id,
          version_number: 1,
          deliverable_type: "topline_narrative",
          approval_status: "draft",
          status: "draft",
          plaintext: TOPLINE_TEMPLATE,
          created_by: user.id,
        })
        .select("id")
        .single();
      if (verErr) throw new Error(`Failed to create version: ${verErr.message}`);

      // Set latest_version_id
      await sb
        .from("project_documents")
        .update({ latest_version_id: version.id })
        .eq("id", doc.id);

      return new Response(JSON.stringify({
        documentId: doc.id,
        versionId: version.id,
        created: true,
      }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    throw new Error(`Unknown action: ${action}`);
  } catch (e: any) {
    return new Response(JSON.stringify({ error: e.message }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
