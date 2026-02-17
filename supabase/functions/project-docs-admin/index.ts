import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const TOPLINE_TEMPLATE = `# Topline Narrative

## Logline

[1–2 sentences]

## Short Synopsis

[150–300 words]

## Long Synopsis

[~1–2 pages]

## Story Pillars

- Theme:
- Protagonist:
- Goal:
- Stakes:
- Antagonistic force:
- Setting:
- Tone:
- Comps:

## Series Only

- Series promise / engine:
- Season arc snapshot:
`;

async function ensureToplineDoc(sb: any, projectId: string, userId: string) {
  // Idempotent: check if topline doc already exists
  const { data: existing } = await sb
    .from("project_documents")
    .select("id, latest_version_id")
    .eq("project_id", projectId)
    .eq("doc_type", "topline_narrative")
    .limit(1);

  if (existing && existing.length > 0) {
    return { documentId: existing[0].id, versionId: existing[0].latest_version_id, created: false };
  }

  // Create project_documents row (file_name + file_path are required NOT NULL)
  const { data: doc, error: docErr } = await sb
    .from("project_documents")
    .insert({
      project_id: projectId,
      user_id: userId,
      doc_type: "topline_narrative",
      title: "Topline Narrative",
      file_name: "topline_narrative.md",
      file_path: `${projectId}/topline_narrative.md`,
    })
    .select("id")
    .single();
  if (docErr) throw new Error(`Failed to create topline doc: ${docErr.message}`);

  // Create initial version — matching dev-engine-v2 insert shape
  const { data: version, error: verErr } = await sb
    .from("project_document_versions")
    .insert({
      document_id: doc.id,
      version_number: 1,
      plaintext: TOPLINE_TEMPLATE,
      created_by: userId,
      label: "Initial template",
      deliverable_type: "topline_narrative",
    })
    .select("id")
    .single();
  if (verErr) throw new Error(`Failed to create topline version: ${verErr.message}`);

  // Set latest_version_id
  await sb
    .from("project_documents")
    .update({ latest_version_id: version.id })
    .eq("id", doc.id);

  return { documentId: doc.id, versionId: version.id, created: true };
}

serve(async (req) => {
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
    const sb = createClient(supabaseUrl, serviceKey);

    const token = authHeader.replace("Bearer ", "");
    const anonClient = createClient(supabaseUrl, Deno.env.get("SUPABASE_ANON_KEY")!, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: claimsData, error: claimsErr } = await anonClient.auth.getClaims(token);
    if (claimsErr || !claimsData?.claims) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const userId = claimsData.claims.sub as string;

    const { action, projectId } = await req.json();
    if (!projectId) throw new Error("projectId required");

    // Verify project access
    const { data: project } = await sb
      .from("projects")
      .select("id, user_id")
      .eq("id", projectId)
      .single();
    if (!project) throw new Error("Project not found");

    const isOwner = project.user_id === userId;
    if (!isOwner) {
      const { data: collab } = await sb
        .from("project_collaborators")
        .select("id")
        .eq("project_id", projectId)
        .eq("user_id", userId)
        .eq("status", "accepted")
        .limit(1);
      if (!collab?.length) throw new Error("Access denied");
    }

    if (action === "ensure-topline") {
      const result = await ensureToplineDoc(sb, projectId, userId);
      return new Response(JSON.stringify(result), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    throw new Error(`Unknown action: ${action}`);
  } catch (e: any) {
    return new Response(JSON.stringify({ error: e.message }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
