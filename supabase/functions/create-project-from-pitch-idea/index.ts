import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } }
    );

    const token = authHeader.replace("Bearer ", "");
    const { data: claimsData, error: claimsError } = await supabase.auth.getClaims(token);
    if (claimsError || !claimsData?.claims) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const userId = claimsData.claims.sub as string;

    const body = await req.json();
    const { pitchIdeaId, action, existingProjectId, overrides } = body;

    if (!pitchIdeaId) {
      return new Response(JSON.stringify({ error: "pitchIdeaId required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // 1) Fetch pitch idea
    const { data: idea, error: ideaErr } = await supabase
      .from("pitch_ideas")
      .select("*")
      .eq("id", pitchIdeaId)
      .single();

    if (ideaErr || !idea) {
      return new Response(JSON.stringify({ error: "Pitch idea not found" }), {
        status: 404,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    let projectId: string;

    // 2) Create or use existing project
    if (action === "ADD_TO_EXISTING" && existingProjectId) {
      // Verify access
      const { data: proj, error: projErr } = await supabase
        .from("projects")
        .select("id")
        .eq("id", existingProjectId)
        .single();
      if (projErr || !proj) {
        return new Response(JSON.stringify({ error: "Project not found or no access" }), {
          status: 404,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      projectId = existingProjectId;
    } else {
      // Create new project with auto-filled fields
      const title = idea.title || (idea.logline ? idea.logline.split(/[.!?]/)[0].trim().slice(0, 60) : "Untitled");
      const logline = idea.logline || (idea.one_page_pitch ? idea.one_page_pitch.slice(0, 300) : "");
      const productionType = overrides?.productionType || idea.production_type || "feature_film";
      const budgetRange = overrides?.budgetRange || idea.budget_band || "";

      const { data: newProj, error: createErr } = await supabase
        .from("projects")
        .insert({
          user_id: userId,
          title,
          format: productionType,
          genres: idea.genre ? [idea.genre] : [],
          budget_range: budgetRange,
          target_audience: "",
          tone: "",
          comparable_titles: (idea.comps || []).join(", "),
          assigned_lane: idea.recommended_lane || null,
          confidence: idea.lane_confidence || null,
          pipeline_stage: "Development",
          document_urls: [],
        })
        .select("id")
        .single();

      if (createErr || !newProj) {
        return new Response(JSON.stringify({ error: "Failed to create project: " + (createErr?.message || "Unknown") }), {
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      projectId = newProj.id;
    }

    // 3) Build idea text for document version
    const sections = [
      `# ${idea.title || "Untitled"}`,
      "",
      `**Logline:** ${idea.logline || ""}`,
      `**Genre:** ${idea.genre || "N/A"} | **Budget:** ${idea.budget_band || "N/A"} | **Lane:** ${idea.recommended_lane || "N/A"} (${idea.lane_confidence || 0}%)`,
      "",
    ];
    if (idea.one_page_pitch) {
      sections.push("## One-Page Pitch", idea.one_page_pitch, "");
    }
    if (idea.comps?.length) {
      sections.push("## Comparables", (idea.comps as string[]).join(", "), "");
    }
    if (idea.why_us) {
      sections.push("## Why Us", idea.why_us, "");
    }
    // Packaging suggestions
    const pkgSuggestions = idea.packaging_suggestions as any[] || [];
    if (pkgSuggestions.length) {
      sections.push("## Packaging Suggestions");
      pkgSuggestions.forEach((p: any) => {
        sections.push(`- ${p.role || ""} — ${p.archetype || ""}${p.names?.length ? ` (${p.names.join(", ")})` : ""}: ${p.rationale || ""}`);
      });
      sections.push("");
    }
    // Risks
    const risks = idea.risks_mitigations as any[] || [];
    if (risks.length) {
      sections.push("## Risks & Mitigations");
      risks.forEach((r: any) => {
        sections.push(`- [${r.severity || "medium"}] ${r.risk || ""} — ${r.mitigation || ""}`);
      });
      sections.push("");
    }
    const ideaText = sections.join("\n");

    // 4) Create project_documents row
    const { data: doc, error: docErr } = await supabase
      .from("project_documents")
      .insert({
        project_id: projectId,
        user_id: userId,
        title: `Pitch Idea — ${idea.title || "Untitled"}`,
        doc_type: "idea",
        source: "generated",
        file_name: `pitch-idea-${idea.title?.toLowerCase().replace(/\s+/g, "-").slice(0, 30) || "untitled"}`,
        plaintext: ideaText,
      })
      .select("id")
      .single();

    if (docErr || !doc) {
      return new Response(JSON.stringify({ error: "Failed to create document: " + (docErr?.message || "Unknown") }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // 5) Create version 1
    const { data: ver, error: verErr } = await supabase
      .from("project_document_versions")
      .insert({
        document_id: doc.id,
        version_number: 1,
        label: "Imported from Pitch Idea",
        plaintext: ideaText,
        created_by: userId,
        change_summary: "Initial idea imported from Pitch Idea generator.",
      })
      .select("id")
      .single();

    if (verErr || !ver) {
      return new Response(JSON.stringify({ error: "Failed to create version: " + (verErr?.message || "Unknown") }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // 6) Update pitch idea with promoted project id
    await supabase
      .from("pitch_ideas")
      .update({ project_id: projectId, status: "in-development" } as any)
      .eq("id", pitchIdeaId);

    return new Response(
      JSON.stringify({
        projectId,
        documentId: doc.id,
        versionId: ver.id,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (e: any) {
    return new Response(JSON.stringify({ error: e.message || "Internal error" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
