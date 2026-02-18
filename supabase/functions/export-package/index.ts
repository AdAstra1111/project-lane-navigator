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

/** Build a minimal PDF from plain-text sections using raw PDF byte generation */
function buildPdf(sections: Array<{ label: string; text: string }>): Uint8Array {
  // We'll produce a valid PDF with one page per section using plain text streams.
  // This avoids any native PDF library dependency.
  const objects: string[] = [];
  let objNum = 0;
  const offsets: number[] = [];

  function addObj(content: string): number {
    objNum++;
    offsets.push(0); // filled in during xref
    objects.push(`${objNum} 0 obj\n${content}\nendobj`);
    return objNum;
  }

  // Font
  const fontRef = addObj(`<<\n/Type /Font\n/Subtype /Type1\n/BaseFont /Courier\n>>`);

  const pageRefs: string[] = [];

  for (const sec of sections) {
    // Escape text for PDF string literals
    const escapedLabel = sec.label.replace(/\\/g, "\\\\").replace(/\(/g, "\\(").replace(/\)/g, "\\)");

    // Split body text into lines, limit to ~80 chars per line, ~50 lines per page
    const rawLines: string[] = [];
    for (const line of sec.text.split("\n")) {
      // wrap long lines
      let remaining = line;
      while (remaining.length > 90) {
        rawLines.push(remaining.slice(0, 90));
        remaining = remaining.slice(90);
      }
      rawLines.push(remaining);
    }

    // Chunk into pages of ~50 lines
    const LINES_PER_PAGE = 50;
    const chunks: string[][] = [];
    for (let i = 0; i < rawLines.length; i += LINES_PER_PAGE) {
      chunks.push(rawLines.slice(i, i + LINES_PER_PAGE));
    }
    if (chunks.length === 0) chunks.push([]);

    for (let ci = 0; ci < chunks.length; ci++) {
      const chunk = chunks[ci];
      const isFirst = ci === 0;

      // Build stream content
      let streamContent = `BT\n/F1 12 Tf\n`;
      let y = 750;

      // Title on first page of each section
      if (isFirst) {
        streamContent += `50 ${y} Td\n/F1 14 Tf\n(${escapedLabel}) Tj\n/F1 11 Tf\n`;
        y -= 24;
        streamContent += `0 -8 Td\n`;
      } else {
        streamContent += `50 ${y} Td\n/F1 9 Tf\n(${escapedLabel} cont.) Tj\n/F1 11 Tf\n`;
        y -= 20;
        streamContent += `0 -4 Td\n`;
      }

      for (const line of chunk) {
        const escaped = line.replace(/\\/g, "\\\\").replace(/\(/g, "\\(").replace(/\)/g, "\\)");
        streamContent += `50 ${y} Td\n(${escaped}) Tj\n`;
        y -= 14;
        streamContent += `0 0 Td\n`;
      }
      streamContent += `ET`;

      const streamBytes = new TextEncoder().encode(streamContent);
      const contentRef = addObj(`<<\n/Length ${streamBytes.length}\n>>\nstream\n${streamContent}\nendstream`);
      const resourcesRef = addObj(`<<\n/Font <<\n/F1 ${fontRef} 0 R\n>>\n>>`);
      const pageRef = addObj(`<<\n/Type /Page\n/MediaBox [0 0 612 792]\n/Contents ${contentRef} 0 R\n/Resources ${resourcesRef} 0 R\n>>`);
      pageRefs.push(`${pageRef} 0 R`);
    }
  }

  const pagesRef = addObj(`<<\n/Type /Pages\n/Kids [${pageRefs.join(" ")}]\n/Count ${pageRefs.length}\n>>`);
  // Update each page to point to parent
  // (Already references will be resolved by reader; parent ref below)
  const catalogRef = addObj(`<<\n/Type /Catalog\n/Pages ${pagesRef} 0 R\n>>`);

  // Build PDF bytes
  const header = "%PDF-1.4\n";
  const lines: string[] = [header];
  const byteOffsets: number[] = [];
  let currentOffset = header.length;

  for (const obj of objects) {
    byteOffsets.push(currentOffset);
    lines.push(obj + "\n");
    currentOffset += obj.length + 1;
  }

  // xref
  const xrefOffset = currentOffset;
  lines.push(`xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`);
  for (const off of byteOffsets) {
    lines.push(String(off).padStart(10, "0") + " 00000 n \n");
  }
  lines.push(`trailer\n<<\n/Size ${objects.length + 1}\n/Root ${catalogRef} 0 R\n>>\n`);
  lines.push(`startxref\n${xrefOffset}\n%%EOF`);

  return new TextEncoder().encode(lines.join(""));
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
    const docMap = new Map(allDocs.map((d: any) => [d.doc_type, d]));

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
        .select("id, document_id, status, plaintext, version_number")
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
        .select("id, document_id, status, plaintext, version_number")
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

    for (let i = 0; i < ladder.length; i++) {
      const docType = ladder[i];
      const doc = docMap.get(docType);
      if (!doc) continue;

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

      const orderPrefix = String(i + 1).padStart(2, "0");
      const label = toLabel(docType);
      const statusSuffix = approved ? "APPROVED" : "DRAFT";
      const fileName = `${orderPrefix}_${docType}_${statusSuffix}.md`;

      sections.push({ label: `${label} (${statusSuffix})`, text: plaintext });
      metaDocs.push({
        order_index: i + 1,
        doc_type: docType,
        label,
        doc_id: doc.id,
        version_id: versionId,
        approved,
        file_name: fileName,
        plaintext,
      });
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
