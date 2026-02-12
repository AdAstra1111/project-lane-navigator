import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) throw new Error("Not authenticated");

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    // Get user from JWT
    const anonClient = createClient(supabaseUrl, Deno.env.get("SUPABASE_ANON_KEY")!);
    const { data: { user }, error: userError } = await anonClient.auth.getUser(
      authHeader.replace("Bearer ", "")
    );
    if (userError || !user) throw new Error("Invalid auth token");

    const { pitchIdeaId, title, budgetBand, lane } = await req.json();
    if (!pitchIdeaId) throw new Error("pitchIdeaId required");

    // STEP 1: Validate — fetch pitch idea and verify lock status
    const { data: idea, error: ideaErr } = await supabase
      .from("pitch_ideas")
      .select("*")
      .eq("id", pitchIdeaId)
      .eq("user_id", user.id)
      .single();

    if (ideaErr || !idea) throw new Error("Pitch idea not found or access denied");
    if (idea.concept_lock_status !== "locked") throw new Error("Idea must be locked before promotion");
    if (idea.promoted_to_project_id) throw new Error("Idea already promoted to a project");

    // Fetch latest stress test to validate scores
    const { data: expansions } = await supabase
      .from("concept_expansions")
      .select("id")
      .eq("pitch_idea_id", pitchIdeaId)
      .order("version", { ascending: false })
      .limit(1);

    const latestExpansionId = expansions?.[0]?.id;

    let stressTestPassed = false;
    if (latestExpansionId) {
      const { data: tests } = await supabase
        .from("concept_stress_tests")
        .select("*")
        .eq("expansion_id", latestExpansionId)
        .order("created_at", { ascending: false })
        .limit(1);
      if (tests?.[0]?.passed) stressTestPassed = true;
    }

    if (!stressTestPassed) throw new Error("Stress test must pass before promotion");

    // Map production_type to project format
    const formatMap: Record<string, string> = {
      "Narrative Feature": "film",
      "TV Series": "tv-series",
      "Documentary Feature": "documentary",
      "Documentary Series": "documentary-series",
      "Short Film": "short-film",
      "Digital Series": "digital-series",
      "Commercial / Advert": "commercial",
      "Branded Content": "branded-content",
      "Music Video": "music-video",
      "Vertical Drama": "vertical-drama",
      "Proof of Concept": "proof-of-concept",
      "Hybrid": "hybrid",
    };

    const projectFormat = formatMap[idea.production_type] || "film";

    // STEP 2: Create project
    const { data: project, error: projErr } = await supabase
      .from("projects")
      .insert({
        user_id: user.id,
        title: title || idea.title,
        format: projectFormat,
        genres: [idea.genre].filter(Boolean),
        budget_range: budgetBand || idea.budget_band || "",
        target_audience: idea.platform_target || "",
        tone: idea.risk_level || "",
        comparable_titles: (idea.comps || []).join(", "),
        assigned_lane: lane || idea.recommended_lane || null,
        confidence: idea.lane_confidence || null,
        reasoning: idea.logline || null,
        pipeline_stage: "development",
        primary_territory: idea.region || "",
        source_pitch_idea_id: idea.id,
        concept_lock_version: idea.concept_lock_version || 1,
      })
      .select()
      .single();

    if (projErr) throw new Error(`Failed to create project: ${projErr.message}`);

    const projectId = project.id;

    // STEP 3: Copy expansion documents as concept_lock_documents
    if (latestExpansionId) {
      const { data: expansion } = await supabase
        .from("concept_expansions")
        .select("*")
        .eq("id", latestExpansionId)
        .single();

      if (expansion) {
        const docs = [
          { doc_type: "treatment", title: `Treatment — ${idea.title}`, content: expansion.treatment },
          { doc_type: "character_bible", title: `Character Bible — ${idea.title}`, content: expansion.character_bible },
          { doc_type: "world_bible", title: `World Bible — ${idea.title}`, content: expansion.world_bible },
          { doc_type: "tone_doc", title: `Tone Document — ${idea.title}`, content: expansion.tone_doc },
          { doc_type: "arc_map", title: `Arc Map — ${idea.title}`, content: expansion.arc_map },
        ].filter((d) => d.content);

        for (const doc of docs) {
          await supabase.from("concept_lock_documents").insert({
            project_id: projectId,
            pitch_idea_id: idea.id,
            user_id: user.id,
            doc_type: doc.doc_type,
            title: doc.title,
            content: doc.content,
            version: idea.concept_lock_version || 1,
          });
        }
      }
    }

    // STEP 4: Insert audit/activity log
    await supabase.from("project_activity_log").insert({
      project_id: projectId,
      user_id: user.id,
      action: "create",
      section: "concept-lock",
      entity_type: "pitch_ideas",
      entity_id: idea.id,
      summary: `Project promoted from Concept Lock v${idea.concept_lock_version || 1} — "${idea.title}"`,
      metadata: {
        source_pitch_idea_id: idea.id,
        concept_lock_version: idea.concept_lock_version || 1,
        stress_test_passed: true,
      },
    });

    // STEP 5: Update pitch idea with promoted project reference
    await supabase
      .from("pitch_ideas")
      .update({ promoted_to_project_id: projectId, status: "in-development" })
      .eq("id", pitchIdeaId);

    return new Response(JSON.stringify({ projectId }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e: any) {
    return new Response(JSON.stringify({ error: e.message }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
