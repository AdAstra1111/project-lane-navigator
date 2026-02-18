/**
 * export-package — Builds a ZIP of all deliverables for a project and uploads to storage.
 * POST { projectId, scope, include_master_script, include_types?, expiresInSeconds? }
 * Returns { url, signed_url, expires_at, storage_path, doc_count }
 *
 * scope: "approved_preferred" | "approved_only" | "latest_only"
 */
import { createClient } from "npm:@supabase/supabase-js@2";
// @deno-types="npm:@types/jszip"
import JSZip from "npm:jszip@3";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

// Canonical ladder per format — mirrors stage-ladders.json
const FORMAT_LADDERS: Record<string, string[]> = {
  film: ["idea","topline_narrative","concept_brief","market_sheet","blueprint","architecture","character_bible","beat_sheet","script","production_draft","deck"],
  feature: ["idea","topline_narrative","concept_brief","market_sheet","blueprint","architecture","character_bible","beat_sheet","script","production_draft","deck"],
  "tv-series": ["idea","topline_narrative","concept_brief","market_sheet","blueprint","architecture","character_bible","beat_sheet","script","season_master_script","production_draft"],
  "limited-series": ["idea","topline_narrative","concept_brief","market_sheet","blueprint","architecture","character_bible","beat_sheet","script","season_master_script","production_draft"],
  "digital-series": ["idea","topline_narrative","concept_brief","market_sheet","blueprint","architecture","character_bible","beat_sheet","script","season_master_script","production_draft"],
  "vertical-drama": ["idea","topline_narrative","concept_brief","vertical_market_sheet","format_rules","character_bible","season_arc","episode_grid","vertical_episode_beats","script","season_master_script"],
  documentary: ["idea","topline_narrative","concept_brief","market_sheet","documentary_outline","deck"],
  "documentary-series": ["idea","topline_narrative","concept_brief","market_sheet","documentary_outline","deck"],
  "hybrid-documentary": ["idea","topline_narrative","concept_brief","market_sheet","documentary_outline","blueprint","deck"],
  short: ["idea","topline_narrative","concept_brief","script"],
  animation: ["idea","topline_narrative","concept_brief","market_sheet","blueprint","character_bible","beat_sheet","script"],
  "anim-series": ["idea","topline_narrative","concept_brief","market_sheet","blueprint","architecture","character_bible","beat_sheet","script","season_master_script","production_draft"],
  reality: ["idea","topline_narrative","concept_brief","market_sheet","blueprint","beat_sheet","script"],
};

function getLadder(format: string): string[] {
  const key = (format || "film").toLowerCase().replace(/[_ ]+/g, "-");
  return FORMAT_LADDERS[key] ?? FORMAT_LADDERS["film"];
}

function toLabel(docType: string): string {
  const LABELS: Record<string, string> = {
    idea: "Idea",
    topline_narrative: "Topline Narrative",
    concept_brief: "Concept Brief",
    market_sheet: "Market Sheet",
    vertical_market_sheet: "Market Sheet (VD)",
    blueprint: "Season Blueprint",
    architecture: "Series Architecture",
    character_bible: "Character Bible",
    beat_sheet: "Episode Beat Sheet",
    script: "Script",
    season_master_script: "Master Season Script",
    production_draft: "Production Draft",
    deck: "Deck",
    documentary_outline: "Documentary Outline",
    format_rules: "Format Rules",
    season_arc: "Season Arc",
    episode_grid: "Episode Grid",
    vertical_episode_beats: "Episode Beats",
    series_writer: "Series Writer",
  };
  return LABELS[docType] ?? docType.replace(/_/g, " ").replace(/\b\w/g, c => c.toUpperCase());
}

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
    const sb = createClient(supabaseUrl, serviceKey);

    const token = authHeader.replace("Bearer ", "");
    const { data: { user } } = await sb.auth.getUser(token);
    if (!user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const body = await req.json();
    const {
      projectId,
      scope = "approved_preferred",
      include_master_script = true,
      include_types,
      expiresInSeconds = 604800, // 7 days default
    } = body;

    if (!projectId) {
      return new Response(JSON.stringify({ error: "projectId required" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Fetch project
    const { data: project, error: projErr } = await sb
      .from("projects")
      .select("id, title, format, pipeline_stage")
      .eq("id", projectId)
      .single();

    if (projErr || !project) {
      return new Response(JSON.stringify({ error: "Project not found" }), {
        status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Build ordered doc list from canonical ladder
    let ladder = getLadder(project.format);
    if (!include_master_script) {
      ladder = ladder.filter(dt => dt !== "season_master_script");
    }
    if (include_types && Array.isArray(include_types)) {
      ladder = ladder.filter(dt => include_types.includes(dt));
    }

    // Fetch all project_documents for this project
    const { data: docs } = await sb
      .from("project_documents")
      .select("id, doc_type, title, latest_version_id, file_name")
      .eq("project_id", projectId) as { data: any[] | null };

    const docMap = new Map((docs || []).map((d: any) => [d.doc_type, d]));

    // Fetch version statuses for all docs with a latest_version_id
    const latestVersionIds = (docs || [])
      .filter((d: any) => d.latest_version_id)
      .map((d: any) => d.latest_version_id as string);

    let versionMap = new Map<string, any>();
    if (latestVersionIds.length > 0) {
      const { data: versions } = await sb
        .from("project_document_versions")
        .select("id, status, plaintext, version_number")
        .in("id", latestVersionIds) as { data: any[] | null };
      versionMap = new Map((versions || []).map((v: any) => [v.id, v]));
    }

    // For approved_preferred / approved_only: also fetch final versions per doc
    type ApprovedMap = Map<string, { id: string; plaintext: string; version_number: number }>;
    let approvedMap: ApprovedMap = new Map();
    if (scope !== "latest_only") {
      const docIds = (docs || []).map((d: any) => d.id as string);
      if (docIds.length > 0) {
        const { data: finalVersions } = await sb
          .from("project_document_versions")
          .select("id, document_id, status, plaintext, version_number")
          .in("document_id", docIds)
          .eq("status", "final")
          .order("version_number", { ascending: false }) as { data: any[] | null };
        // Keep only the highest version per document
        for (const v of (finalVersions || [])) {
          if (!approvedMap.has(v.document_id)) {
            approvedMap.set(v.document_id, v);
          }
        }
      }
    }

    const zip = new JSZip();
    const metaDocs: any[] = [];

    for (let i = 0; i < ladder.length; i++) {
      const docType = ladder[i];
      const doc = docMap.get(docType);
      const orderPrefix = String(i + 1).padStart(2, "0");
      const label = toLabel(docType);

      if (!doc) {
        if (scope === "approved_only" || scope === "approved_preferred") continue; // skip missing
        // For latest_only, skip missing too
        continue;
      }

      let versionId: string | null = null;
      let plaintext: string | null = null;
      let approved = false;

      if (scope === "approved_preferred" || scope === "approved_only") {
        const approvedVer = approvedMap.get(doc.id);
        if (approvedVer) {
          versionId = approvedVer.id;
          plaintext = approvedVer.plaintext;
          approved = true;
        } else if (scope === "approved_only") {
          continue; // skip if approved_only and no approved version
        } else {
          // Fall back to latest
          const latestVer = doc.latest_version_id ? versionMap.get(doc.latest_version_id) : null;
          if (latestVer) {
            versionId = latestVer.id;
            plaintext = latestVer.plaintext;
            approved = false;
          }
        }
      } else {
        // latest_only
        const latestVer = doc.latest_version_id ? versionMap.get(doc.latest_version_id) : null;
        if (latestVer) {
          versionId = latestVer.id;
          plaintext = latestVer.plaintext;
          approved = latestVer.status === "final";
        }
      }

      if (!plaintext) continue;

      const statusSuffix = approved ? "APPROVED" : "DRAFT";
      const fileName = `${orderPrefix}_${docType}_${statusSuffix}.md`;

      zip.file(fileName, plaintext);
      metaDocs.push({
        order_index: i + 1,
        doc_type: docType,
        label,
        doc_id: doc.id,
        version_id: versionId,
        approved,
        file_name: fileName,
      });
    }

    if (metaDocs.length === 0) {
      return new Response(JSON.stringify({ error: "No documents available for export with the selected scope" }), {
        status: 422, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Add metadata.json
    const metadata = {
      project_id: projectId,
      title: project.title,
      format: project.format,
      exported_at: new Date().toISOString(),
      scope,
      docs: metaDocs,
    };
    zip.file("metadata.json", JSON.stringify(metadata, null, 2));

    // Generate ZIP buffer
    const zipBuffer = await zip.generateAsync({ type: "uint8array" });

    // Upload to exports bucket
    const timestamp = Date.now();
    const storagePath = `${user.id}/${projectId}/${timestamp}_package.zip`;

    const { error: uploadErr } = await sb.storage
      .from("exports")
      .upload(storagePath, zipBuffer, {
        contentType: "application/zip",
        upsert: true,
      });

    if (uploadErr) {
      console.error("Storage upload error:", uploadErr);
      return new Response(JSON.stringify({ error: `Storage upload failed: ${uploadErr.message}` }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Create signed URL
    const { data: signedUrlData, error: signedErr } = await sb.storage
      .from("exports")
      .createSignedUrl(storagePath, expiresInSeconds);

    if (signedErr || !signedUrlData) {
      return new Response(JSON.stringify({ error: "Failed to create signed URL" }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const expiresAt = new Date(Date.now() + expiresInSeconds * 1000).toISOString();

    // Persist share link record
    await sb.from("project_share_links").insert({
      project_id: projectId,
      scope,
      expires_at: expiresAt,
      signed_url: signedUrlData.signedUrl,
      storage_path: storagePath,
      created_by: user.id,
    } as any);

    return new Response(
      JSON.stringify({
        signed_url: signedUrlData.signedUrl,
        storage_path: storagePath,
        expires_at: expiresAt,
        doc_count: metaDocs.length,
        metadata,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err: any) {
    console.error("export-package error:", err);
    return new Response(
      JSON.stringify({ error: err.message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
