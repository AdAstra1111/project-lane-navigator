/**
 * export-package — Builds a ZIP or merged PDF of all deliverables for a project.
 * POST { projectId, scope, include_master_script, include_types?, expiresInSeconds?, output_format? }
 * output_format: "zip" (default) | "pdf"
 * Returns { signed_url, expires_at, storage_path, doc_count }
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
  film: ["idea","topline_narrative","concept_brief","market_sheet","blueprint","architecture","character_bible","beat_sheet","feature_script","production_draft","deck"],
  feature: ["idea","topline_narrative","concept_brief","market_sheet","blueprint","architecture","character_bible","beat_sheet","feature_script","production_draft","deck"],
  "tv-series": ["idea","topline_narrative","concept_brief","market_sheet","blueprint","architecture","character_bible","beat_sheet","episode_script","season_master_script","production_draft"],
  "limited-series": ["idea","topline_narrative","concept_brief","market_sheet","blueprint","architecture","character_bible","beat_sheet","episode_script","season_master_script","production_draft"],
  "digital-series": ["idea","topline_narrative","concept_brief","market_sheet","blueprint","architecture","character_bible","beat_sheet","episode_script","season_master_script","production_draft"],
  "vertical-drama": ["idea","topline_narrative","concept_brief","vertical_market_sheet","format_rules","character_bible","season_arc","episode_grid","vertical_episode_beats","season_script","complete_season_script","season_master_script"],
  documentary: ["idea","topline_narrative","concept_brief","market_sheet","documentary_outline","deck"],
  "documentary-series": ["idea","topline_narrative","concept_brief","market_sheet","documentary_outline","deck"],
  "hybrid-documentary": ["idea","topline_narrative","concept_brief","market_sheet","documentary_outline","blueprint","deck"],
  short: ["idea","topline_narrative","concept_brief","feature_script"],
  animation: ["idea","topline_narrative","concept_brief","market_sheet","blueprint","character_bible","beat_sheet","feature_script"],
  "anim-series": ["idea","topline_narrative","concept_brief","market_sheet","blueprint","architecture","character_bible","beat_sheet","episode_script","season_master_script","production_draft"],
  reality: ["idea","topline_narrative","concept_brief","market_sheet","blueprint","beat_sheet","episode_script"],
};

function getLadder(format: string): string[] {
  const key = (format || "film").toLowerCase().replace(/[_ ]+/g, "-");
  return FORMAT_LADDERS[key] ?? FORMAT_LADDERS["film"];
}

function toLabel(docType: string, format?: string): string {
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
    feature_script: "Feature Script",
    episode_script: "Episode Script",
    season_script: "Season Script",
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
  const NON_SERIES = new Set(["film", "feature", "short", "documentary", "hybrid-documentary", "short-film"]);
  const FILM_OVERRIDES: Record<string, string> = {
    blueprint: "Blueprint",
    architecture: "Architecture",
    beat_sheet: "Beat Sheet",
    feature_script: "Script",
  };
  const normalizedFormat = (format || "").toLowerCase().replace(/[\s_]+/g, "-");
  if (normalizedFormat && NON_SERIES.has(normalizedFormat)) {
    const override = FILM_OVERRIDES[docType];
    if (override) return override;
  }
  return LABELS[docType] ?? docType.replace(/_/g, " ").replace(/\b\w/g, c => c.toUpperCase());
}

/** Build a minimal PDF from plain-text sections using raw PDF byte generation */
function buildPdf(sections: Array<{ label: string; text: string }>): Uint8Array {
  const objects: string[] = [];
  let objNum = 0;

  function addObj(content: string): number {
    objNum++;
    objects.push(`${objNum} 0 obj\n${content}\nendobj`);
    return objNum;
  }

  function escPdf(s: string): string {
    return s.replace(/\\/g, "\\\\").replace(/\(/g, "\\(").replace(/\)/g, "\\)");
  }

  // Font
  const fontRef = addObj(`<<\n/Type /Font\n/Subtype /Type1\n/BaseFont /Courier\n>>`);

  const PAGE_WIDTH = 612;
  const PAGE_HEIGHT = 792;
  const MARGIN_LEFT = 50;
  const MARGIN_TOP = 742;   // y of first line (from bottom of page)
  const LINE_HEIGHT = 13;   // pt per line
  const LINES_PER_PAGE = Math.floor((MARGIN_TOP - 40) / LINE_HEIGHT); // ~53 lines

  const pageRefs: string[] = [];

  for (const sec of sections) {
    // Wrap text into lines <= 90 chars
    const rawLines: string[] = [];
    for (const line of sec.text.split("\n")) {
      let rem = line;
      while (rem.length > 90) {
        rawLines.push(rem.slice(0, 90));
        rem = rem.slice(90);
      }
      rawLines.push(rem);
    }

    // Split into pages, reserving 2 lines at top for section header + separator
    const CONTENT_LINES = LINES_PER_PAGE - 2;
    const chunks: string[][] = [];
    for (let i = 0; i < rawLines.length; i += CONTENT_LINES) {
      chunks.push(rawLines.slice(i, i + CONTENT_LINES));
    }
    if (chunks.length === 0) chunks.push([]);

    for (let ci = 0; ci < chunks.length; ci++) {
      const chunk = chunks[ci];
      const isFirst = ci === 0;
      const headerLabel = isFirst ? sec.label : `${sec.label} (cont.)`;

      // Use Tm (text matrix) for absolute positioning, then T* for relative line advances.
      // Tm: 1 0 0 1 x y sets text position absolutely.
      // TL: sets text leading (line spacing) used by T*.
      let stream = `BT\n`;
      stream += `${LINE_HEIGHT} TL\n`;
      stream += `1 0 0 1 ${MARGIN_LEFT} ${MARGIN_TOP} Tm\n`;
      stream += `/F1 14 Tf\n`;
      stream += `(${escPdf(headerLabel)}) Tj\n`;
      stream += `T*\n/F1 10 Tf\n`;
      stream += `(----------------------------------------------------------------) Tj\n`;
      stream += `/F1 11 Tf\n`;
      for (const line of chunk) {
        stream += `T*\n(${escPdf(line)}) Tj\n`;
      }
      stream += `ET`;

      const streamBytes = new TextEncoder().encode(stream);
      const contentRef = addObj(`<<\n/Length ${streamBytes.length}\n>>\nstream\n${stream}\nendstream`);
      const resourcesRef = addObj(`<<\n/Font <<\n/F1 ${fontRef} 0 R\n>>\n>>`);
      const pageRef = addObj(
        `<<\n/Type /Page\n/MediaBox [0 0 ${PAGE_WIDTH} ${PAGE_HEIGHT}]\n` +
        `/Contents ${contentRef} 0 R\n/Resources ${resourcesRef} 0 R\n>>`
      );
      pageRefs.push(`${pageRef} 0 R`);
    }
  }

  const pagesRef = addObj(
    `<<\n/Type /Pages\n/Kids [${pageRefs.join(" ")}]\n/Count ${pageRefs.length}\n>>`
  );
  const catalogRef = addObj(`<<\n/Type /Catalog\n/Pages ${pagesRef} 0 R\n>>`);

  // Serialise with correct byte offsets for xref
  const header = "%PDF-1.4\n";
  let body = header;
  const byteOffsets: number[] = [];

  for (const obj of objects) {
    byteOffsets.push(body.length);
    body += obj + "\n";
  }

  const xrefOffset = body.length;
  body += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const off of byteOffsets) {
    body += String(off).padStart(10, "0") + " 00000 n \n";
  }
  body += `trailer\n<<\n/Size ${objects.length + 1}\n/Root ${catalogRef} 0 R\n>>\n`;
  body += `startxref\n${xrefOffset}\n%%EOF`;

  return new TextEncoder().encode(body);
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
      expiresInSeconds = 604800,
      output_format = "zip", // "zip" | "pdf"
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

    // Fetch all project_documents
    const { data: docs } = await sb
      .from("project_documents")
      .select("id, doc_type, title, latest_version_id, file_name")
      .eq("project_id", projectId) as { data: any[] | null };

    const allDocs: any[] = docs || [];
    // Group docs by doc_type (multiple docs can share the same doc_type, e.g. multiple scripts)
    const docMap = new Map<string, any[]>();
    for (const d of allDocs) {
      if (!docMap.has(d.doc_type)) docMap.set(d.doc_type, []);
      docMap.get(d.doc_type)!.push(d);
    }

    // --- Build approved version map (final status) ---
    type ApprovedMap = Map<string, { id: string; plaintext: string; version_number: number }>;
    let approvedMap: ApprovedMap = new Map();
    if (scope !== "latest_only") {
      const docIds = allDocs.map((d: any) => d.id as string);
      if (docIds.length > 0) {
        const { data: finalVersions } = await sb
          .from("project_document_versions")
          .select("id, document_id, status, plaintext, version_number")
          .in("document_id", docIds)
          .eq("status", "final")
          .order("version_number", { ascending: false }) as { data: any[] | null };
        for (const v of (finalVersions || [])) {
          if (!approvedMap.has(v.document_id)) {
            approvedMap.set(v.document_id, v);
          }
        }
      }
    }

    // --- Build latest version map (two-pass: pointer first, then highest version_number) ---
    const latestByDocId = new Map<string, any>();

    const latestVersionIds = allDocs
      .filter((d: any) => d.latest_version_id)
      .map((d: any) => d.latest_version_id as string);

    if (latestVersionIds.length > 0) {
      const { data: latestVersions } = await sb
        .from("project_document_versions")
        .select("id, document_id, status, plaintext, version_number, created_at")
        .in("id", latestVersionIds) as { data: any[] | null };
      for (const v of latestVersions || []) {
        latestByDocId.set(v.document_id, v);
      }
    }

    // Fallback: docs still missing a latest — fetch by highest version_number
    const docsStillMissing = allDocs.filter((d: any) => !latestByDocId.has(d.id));
    if (docsStillMissing.length > 0) {
      const missingIds = docsStillMissing.map((d: any) => d.id as string);
      const { data: fallbackVersions } = await sb
        .from("project_document_versions")
        .select("id, document_id, status, plaintext, version_number, created_at")
        .in("document_id", missingIds)
        .order("version_number", { ascending: false }) as { data: any[] | null };
      for (const v of fallbackVersions || []) {
        if (!latestByDocId.has(v.document_id)) {
          latestByDocId.set(v.document_id, v);
        }
      }
    }

    // --- Build deliverable list in ladder order ---
    const metaDocs: any[] = [];
    const sections: Array<{ label: string; text: string }> = [];

    let globalOrder = 1;
    for (let i = 0; i < ladder.length; i++) {
      const docType = ladder[i];
      const docsForType = docMap.get(docType);
      if (!docsForType || docsForType.length === 0) continue;

      for (const doc of docsForType) {
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
            continue;
          } else {
            const latestVer = latestByDocId.get(doc.id);
            if (latestVer) {
              versionId = latestVer.id;
              plaintext = latestVer.plaintext;
              approved = false;
            }
          }
        } else {
          const latestVer = latestByDocId.get(doc.id);
          if (latestVer) {
            versionId = latestVer.id;
            plaintext = latestVer.plaintext;
            approved = latestVer.status === "final";
          }
        }

        if (!plaintext) continue;

        const orderPrefix = String(globalOrder).padStart(2, "0");
        const label = toLabel(docType, project.format);
        const statusSuffix = approved ? "APPROVED" : "DRAFT";
        const fileName = `${orderPrefix}_${docType}_${statusSuffix}.md`;

        sections.push({ label: `${label} (${statusSuffix})`, text: plaintext });
        metaDocs.push({
          order_index: globalOrder,
          doc_type: docType,
          label,
          doc_id: doc.id,
          version_id: versionId,
          approved,
          file_name: fileName,
          plaintext,
        });
        globalOrder++;
      }
    }

    if (metaDocs.length === 0) {
      return new Response(JSON.stringify({ error: "No documents available for export with the selected scope" }), {
        status: 422, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // --- Generate output (ZIP or PDF) ---
    let fileBuffer: Uint8Array;
    let contentType: string;
    let fileExtension: string;

    if (output_format === "pdf") {
      fileBuffer = buildPdf(sections);
      contentType = "application/pdf";
      fileExtension = "pdf";
    } else {
      const zip = new JSZip();
      for (const doc of metaDocs) {
        zip.file(doc.file_name, doc.plaintext);
      }
      // metadata
      const metadata = {
        project_id: projectId,
        title: project.title,
        format: project.format,
        exported_at: new Date().toISOString(),
        scope,
        docs: metaDocs.map(({ plaintext: _pt, ...rest }) => rest),
      };
      zip.file("metadata.json", JSON.stringify(metadata, null, 2));
      fileBuffer = await zip.generateAsync({ type: "uint8array" });
      contentType = "application/zip";
      fileExtension = "zip";
    }

    // --- Build a meaningful filename ---
    // Find the latest created_at across all included versions
    let lastEditedDate = new Date(0);
    for (const doc of metaDocs) {
      // Check in latestByDocId and approvedMap for created_at
      const ver = latestByDocId.get(doc.doc_id) || approvedMap.get(doc.doc_id);
      if (ver?.created_at) {
        const d = new Date(ver.created_at);
        if (d > lastEditedDate) lastEditedDate = d;
      }
    }
    const dateStr = lastEditedDate > new Date(0)
      ? lastEditedDate.toISOString().slice(0, 10)
      : new Date().toISOString().slice(0, 10);
    const safeTitle = (project.title || "package")
      .replace(/[^a-zA-Z0-9\s-]/g, "")
      .trim()
      .replace(/\s+/g, "_")
      .slice(0, 40);
    const suggestedFileName = `${safeTitle}_${dateStr}.${fileExtension}`;

    // Upload to exports bucket
    const timestamp = Date.now();
    const storagePath = `${user.id}/${projectId}/${timestamp}_package.${fileExtension}`;

    const { error: uploadErr } = await sb.storage
      .from("exports")
      .upload(storagePath, fileBuffer, { contentType, upsert: true });

    if (uploadErr) {
      console.error("Storage upload error:", uploadErr);
      return new Response(JSON.stringify({ error: `Storage upload failed: ${uploadErr.message}` }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { data: signedUrlData, error: signedErr } = await sb.storage
      .from("exports")
      .createSignedUrl(storagePath, expiresInSeconds);

    if (signedErr || !signedUrlData) {
      return new Response(JSON.stringify({ error: "Failed to create signed URL" }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const expiresAt = new Date(Date.now() + expiresInSeconds * 1000).toISOString();

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
        output_format: fileExtension,
        file_name: suggestedFileName,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err: any) {
    console.error("export-package error:", err);
    if (err.message === "RATE_LIMIT") {
      return new Response(JSON.stringify({ error: "RATE_LIMIT" }), {
        status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    return new Response(
      JSON.stringify({ error: err.message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
