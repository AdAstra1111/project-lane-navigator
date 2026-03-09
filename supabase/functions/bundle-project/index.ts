import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// ── Stage ladder order: determines section order in the bundle ──
// Add new doc types here as IFFY gains new stages.
const BUNDLE_STAGE_ORDER: string[] = [
  "idea",
  "concept_brief",
  "vertical_market_sheet",
  "market_sheet",
  "format_rules",
  "character_bible",
  "season_arc",
  "episode_grid",
  "vertical_episode_beats",
  "season_script",
  // Feature film ladder
  "logline",
  "treatment",
  "feature_outline",
  "screenplay_draft",
  // Supporting docs (appended after primary deliverables)
  "nec",
  "canon",
  "market_positioning",
  "project_overview",
  "creative_brief",
];

// ── Human-readable section titles for each doc type ──
const SECTION_TITLES: Record<string, string> = {
  idea: "Project Idea",
  concept_brief: "Concept Brief",
  vertical_market_sheet: "Vertical Market Sheet",
  market_sheet: "Market Sheet",
  format_rules: "Format Rules",
  character_bible: "Character Bible",
  season_arc: "Season Arc",
  episode_grid: "Episode Grid",
  vertical_episode_beats: "Episode Beats",
  season_script: "Season Script",
  logline: "Logline",
  treatment: "Treatment",
  feature_outline: "Feature Outline",
  screenplay_draft: "Screenplay",
  nec: "Narrative & Emotional Core",
  canon: "Project Canon",
  market_positioning: "Market Positioning",
  project_overview: "Project Overview",
  creative_brief: "Creative Brief",
};

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    const body = await req.json();
    const { projectId, includeAllCurrent = false } = body;

    if (!projectId) {
      return new Response(JSON.stringify({ success: false, error: "projectId required" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // ── Fetch project metadata ──
    const { data: project, error: projErr } = await supabase
      .from("projects")
      .select("id, title, format, packaging_mode, created_at")
      .eq("id", projectId)
      .single();

    if (projErr || !project) {
      return new Response(JSON.stringify({ success: false, error: "Project not found" }), {
        status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // ── Fetch all project documents ──
    const { data: docs, error: docsErr } = await supabase
      .from("project_documents")
      .select("id, doc_type, title")
      .eq("project_id", projectId)
      .not("doc_type", "eq", "project_bundle"); // never include previous bundles

    if (docsErr) throw docsErr;
    if (!docs || docs.length === 0) {
      return new Response(JSON.stringify({ success: false, error: "No documents found for this project" }), {
        status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // ── Fetch current versions for each doc ──
    const docIds = docs.map((d: any) => d.id);
    const { data: versions, error: verErr } = await supabase
      .from("project_document_versions")
      .select("id, document_id, version_number, plaintext, approval_status, is_current, meta_json")
      .in("document_id", docIds)
      .eq("is_current", true);

    if (verErr) throw verErr;

    // Build a map: document_id → version
    const versionMap = new Map<string, any>();
    for (const v of (versions || [])) {
      versionMap.set(v.document_id, v);
    }

    // ── Filter docs: only include those with content ──
    // includeAllCurrent=true: all current versions regardless of approval status
    // Default (false): only approved + current versions
    const eligibleDocs = docs.filter((doc: any) => {
      const v = versionMap.get(doc.id);
      if (!v || !v.plaintext || v.plaintext.trim().length < 50) return false;
      if (includeAllCurrent) return true;
      return v.approval_status === "approved";
    });

    if (eligibleDocs.length === 0) {
      return new Response(JSON.stringify({
        success: false,
        error: includeAllCurrent
          ? "No documents with content found"
          : "No approved documents found. Try with includeAllCurrent=true to bundle all current versions.",
      }), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // ── Sort docs by stage ladder order ──
    const sortedDocs = [...eligibleDocs].sort((a: any, b: any) => {
      const ai = BUNDLE_STAGE_ORDER.indexOf(a.doc_type);
      const bi = BUNDLE_STAGE_ORDER.indexOf(b.doc_type);
      const aIdx = ai === -1 ? 999 : ai;
      const bIdx = bi === -1 ? 999 : bi;
      return aIdx - bIdx;
    });

    // ── Assemble the bundle ──
    const now = new Date();
    const dateStr = now.toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" });
    const formatLabel = (project.format || project.packaging_mode || "").replace(/_/g, " ").toUpperCase();

    const titleBlock = [
      "═".repeat(60),
      "",
      project.title?.toUpperCase() || "UNTITLED PROJECT",
      formatLabel ? `Format: ${formatLabel}` : "",
      "",
      "PROJECT DEVELOPMENT BIBLE",
      `Generated: ${dateStr}`,
      "",
      "═".repeat(60),
      "",
    ].filter(Boolean).join("\n");

    const tocLines: string[] = ["TABLE OF CONTENTS", "─".repeat(40)];
    const sections: string[] = [];

    for (let i = 0; i < sortedDocs.length; i++) {
      const doc = sortedDocs[i];
      const v = versionMap.get(doc.id)!;
      const sectionNum = i + 1;
      const title = SECTION_TITLES[doc.doc_type] || doc.title || doc.doc_type.replace(/_/g, " ");
      const ciScore = v.meta_json?.ci ?? null;
      const ciLabel = ciScore !== null ? ` [CI:${ciScore}]` : "";

      // TOC entry
      tocLines.push(`${sectionNum}. ${title}${ciLabel}`);

      // Section body
      const separator = "═".repeat(60);
      const sectionHeader = [
        "",
        separator,
        "",
        `SECTION ${sectionNum}: ${title.toUpperCase()}`,
        ciScore !== null ? `Creative Integrity Score: ${ciScore}/100` : "",
        `Version ${v.version_number} · ${v.approval_status === "approved" ? "APPROVED" : "CURRENT"}`,
        "",
        "─".repeat(60),
        "",
      ].filter(Boolean).join("\n");

      sections.push(sectionHeader + v.plaintext.trim());
    }

    tocLines.push("");
    const toc = tocLines.join("\n");
    const bundleText = [titleBlock, toc, ...sections].join("\n\n");

    // ── Resolve the user who owns this project (for user_id FK) ──
    const { data: projectUser } = await supabase
      .from("projects")
      .select("user_id")
      .eq("id", projectId)
      .single();
    const userId = projectUser?.user_id ?? null;

    // ── Store the bundle as a project_document ──
    // Upsert: find existing bundle doc or create one
    let bundleDocId: string;
    const { data: existingBundleDoc } = await supabase
      .from("project_documents")
      .select("id")
      .eq("project_id", projectId)
      .eq("doc_type", "project_bundle")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (existingBundleDoc) {
      bundleDocId = existingBundleDoc.id;
    } else {
      const { data: newDoc, error: newDocErr } = await supabase
        .from("project_documents")
        .insert({
          project_id: projectId,
          user_id: userId,
          doc_type: "project_bundle",
          title: `${project.title} — Project Bible`,
          doc_role: "derived_output",
          plaintext: bundleText,
          char_count: bundleText.length,
          file_name: "project-bundle",
          file_path: "",
        })
        .select("id")
        .single();
      if (newDocErr) throw newDocErr;
      bundleDocId = newDoc.id;
    }

    // Supersede previous bundle versions
    await supabase
      .from("project_document_versions")
      .update({ is_current: false, status: "superseded" })
      .eq("document_id", bundleDocId);

    // Get next version number
    const { count: existingVersionCount } = await supabase
      .from("project_document_versions")
      .select("id", { count: "exact", head: true })
      .eq("document_id", bundleDocId);

    const nextVersion = (existingVersionCount ?? 0) + 1;

    // Insert new bundle version
    const { data: newVersion, error: newVerErr } = await supabase
      .from("project_document_versions")
      .insert({
        document_id: bundleDocId,
        version_number: nextVersion,
        plaintext: bundleText,
        status: "draft",
        is_current: true,
        approval_status: "draft",
        created_by: userId,
        meta_json: {
          doc_count: sortedDocs.length,
          included_doc_types: sortedDocs.map((d: any) => d.doc_type),
          generated_at: now.toISOString(),
          mode: includeAllCurrent ? "all_current" : "approved_only",
        },
      })
      .select("id")
      .single();

    if (newVerErr) throw newVerErr;

    // Sync to parent doc
    await supabase
      .from("project_documents")
      .update({ plaintext: bundleText, char_count: bundleText.length })
      .eq("id", bundleDocId);

    console.log(`[bundle-project] Generated v${nextVersion} for project ${projectId}: ${sortedDocs.length} docs, ${bundleText.length} chars`);

    return new Response(JSON.stringify({
      success: true,
      bundleDocId,
      bundleVersionId: newVersion.id,
      versionNumber: nextVersion,
      charCount: bundleText.length,
      docCount: sortedDocs.length,
      includedDocTypes: sortedDocs.map((d: any) => d.doc_type),
      bundleText,
    }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

  } catch (err: any) {
    console.error("[bundle-project] error:", err?.message);
    return new Response(JSON.stringify({ success: false, error: err?.message || "Unknown error" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
