import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

/**
 * publish-package edge function
 *
 * Called during "Finalize & Progress". For each required doc_type:
 * 1. Creates a FINAL snapshot version
 * 2. Exports to Storage as LATEST.md
 * 3. Updates project_documents.latest_version_id
 * 4. Marks older finals as superseded
 * 5. Attaches current resolver_hash
 *
 * Body: { projectId, docTypes: string[], advanceStage?: boolean }
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
    const { projectId, docTypes, advanceStage } = body;

    if (!projectId) {
      return new Response(JSON.stringify({ error: "projectId required" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // 1. Fetch project for format + current resolver hash
    const { data: project, error: projErr } = await supabase
      .from("projects")
      .select("id, format, pipeline_stage, resolved_qualifications_hash")
      .eq("id", projectId)
      .single();

    if (projErr || !project) {
      return new Response(JSON.stringify({ error: "Project not found" }), {
        status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // 2. Resolve current qualifications hash
    let resolverHash = project.resolved_qualifications_hash;
    if (!resolverHash) {
      // Call resolve-qualifications to get fresh hash
      const { data: resolveData } = await supabase.functions.invoke("resolve-qualifications", {
        body: { projectId },
        headers: { Authorization: `Bearer ${token}` },
      });
      resolverHash = resolveData?.resolver_hash || null;
    }

    // 3. Process each doc_type
    const results: any[] = [];
    const errors: string[] = [];
    const docsToPublish = docTypes || [];

    for (const docType of docsToPublish) {
      try {
        // Find the project_document for this doc_type
        const { data: doc } = await supabase
          .from("project_documents")
          .select("id, doc_type, title")
          .eq("project_id", projectId)
          .eq("doc_type", docType)
          .single();

        if (!doc) {
          errors.push(`${docType}: No document found`);
          continue;
        }

        // Get the latest version (highest version_number)
        const { data: latestVersion } = await supabase
          .from("project_document_versions")
          .select("*")
          .eq("document_id", doc.id)
          .order("version_number", { ascending: false })
          .limit(1)
          .single();

        if (!latestVersion || !latestVersion.plaintext) {
          errors.push(`${docType}: No version content found`);
          continue;
        }

        // Mark all existing 'final' versions as superseded
        await supabase
          .from("project_document_versions")
          .update({ status: "superseded" })
          .eq("document_id", doc.id)
          .eq("status", "final")
          .neq("id", latestVersion.id);

        // Mark current version as final + attach resolver hash
        await supabase
          .from("project_document_versions")
          .update({
            status: "final",
            depends_on_resolver_hash: resolverHash,
          })
          .eq("id", latestVersion.id);

        // Compute export path
        const format = (project.format || "film").toLowerCase().replace(/[_ ]+/g, "-");
        const order = String(docsToPublish.indexOf(docType) + 1).padStart(2, "0");
        const exportPath = `${projectId}/package/${order}_${docType}/LATEST.md`;

        // Upload to storage
        const content = latestVersion.plaintext;
        const blob = new Blob([content], { type: "text/markdown" });

        const { error: uploadErr } = await supabase.storage
          .from("projects")
          .upload(exportPath, blob, { upsert: true, contentType: "text/markdown" });

        if (uploadErr) {
          console.warn(`[publish-package] Storage upload error for ${docType}:`, uploadErr);
          errors.push(`${docType}: Storage upload failed — ${uploadErr.message}`);
        }

        // Also save a versioned copy
        const isoDate = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
        const historyPath = `${projectId}/package/${order}_${docType}/versions/${isoDate}_v${latestVersion.version_number}.md`;
        await supabase.storage
          .from("projects")
          .upload(historyPath, new Blob([content], { type: "text/markdown" }), { upsert: true, contentType: "text/markdown" });

        // Update project_document with latest pointers
        await supabase
          .from("project_documents")
          .update({
            latest_version_id: latestVersion.id,
            latest_export_path: exportPath,
          })
          .eq("id", doc.id);

        results.push({
          docType,
          documentId: doc.id,
          versionId: latestVersion.id,
          versionNumber: latestVersion.version_number,
          exportPath,
          resolverHash,
          status: "published",
        });
      } catch (e: any) {
        errors.push(`${docType}: ${e.message}`);
      }
    }

    // 4. Optionally advance pipeline stage
    let newStage = project.pipeline_stage;
    if (advanceStage && errors.length === 0) {
      const stageOrder = ["development", "packaging", "pre_production", "production", "post_production", "sales_delivery"];
      const currentIdx = stageOrder.indexOf(
        (project.pipeline_stage || "development").toLowerCase().replace(/[- ]+/g, "_")
      );
      if (currentIdx >= 0 && currentIdx < stageOrder.length - 1) {
        newStage = stageOrder[currentIdx + 1];
        await supabase
          .from("projects")
          .update({ pipeline_stage: newStage })
          .eq("id", projectId);
      }
    }

    return new Response(JSON.stringify({
      published: results,
      errors,
      resolverHash,
      newStage,
      advancedStage: advanceStage && errors.length === 0,
    }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e: any) {
    return new Response(JSON.stringify({ error: e.message || "Internal error" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
