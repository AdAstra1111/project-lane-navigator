import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

// Production-type specific budget templates
function getBudgetTemplate(productionType: string) {
  const base = {
    "Narrative Feature": {
      assumptions: { schedule_weeks: 6, shoot_days: 25, union_level: "SAG-AFTRA Modified Low", vfx_level: "light", cast_level: "mid-range" },
      lines: [
        { section: "Above the Line", category: "Writer", line_item: "Screenwriter", basis: "flat", qty: 1, rate: 0, rationale: "Based on WGA minimums for budget band" },
        { section: "Above the Line", category: "Director", line_item: "Director Fee", basis: "flat", qty: 1, rate: 0, rationale: "DGA scale or negotiated fee" },
        { section: "Above the Line", category: "Producer", line_item: "Producer Fee", basis: "flat", qty: 1, rate: 0, rationale: "PGA guidelines for budget level" },
        { section: "Above the Line", category: "Cast", line_item: "Lead Cast", basis: "flat", qty: 1, rate: 0, rationale: "Based on cast level and market value" },
        { section: "Below the Line", category: "Camera", line_item: "Camera Department", basis: "per week", qty: 6, rate: 0, rationale: "DP + operators + assistants for shoot duration" },
        { section: "Below the Line", category: "Art", line_item: "Art Department", basis: "per week", qty: 8, rate: 0, rationale: "Includes prep and wrap weeks" },
        { section: "Below the Line", category: "Sound", line_item: "Sound Department", basis: "per week", qty: 6, rate: 0, rationale: "Production sound mixer + boom" },
        { section: "Below the Line", category: "Locations", line_item: "Location Fees & Permits", basis: "flat", qty: 1, rate: 0, rationale: "Based on location count estimate" },
        { section: "Below the Line", category: "Transport", line_item: "Transport & Vehicles", basis: "per week", qty: 6, rate: 0, rationale: "Unit base, talent transport" },
        { section: "Post", category: "Edit", line_item: "Editor + Facility", basis: "per week", qty: 12, rate: 0, rationale: "Offline + online editorial" },
        { section: "Post", category: "Sound", line_item: "Sound Post & Mix", basis: "flat", qty: 1, rate: 0, rationale: "Dialogue edit, Foley, mix" },
        { section: "Post", category: "Grade", line_item: "Colour Grade", basis: "per day", qty: 5, rate: 0, rationale: "DI conform and grade" },
        { section: "Post", category: "Music", line_item: "Score & Music Rights", basis: "flat", qty: 1, rate: 0, rationale: "Composer fee or library" },
        { section: "Insurance/Legal", category: "Insurance", line_item: "Production Insurance", basis: "flat", qty: 1, rate: 0, rationale: "E&O, general liability, cast" },
        { section: "Contingency", category: "Contingency", line_item: "Contingency (10%)", basis: "percentage", qty: 1, rate: 0, rationale: "Standard 10% contingency" },
      ],
    },
    "TV Series": {
      assumptions: { schedule_weeks: 10, shoot_days: 40, union_level: "SAG-AFTRA TV", vfx_level: "moderate", cast_level: "series-regular" },
      lines: [
        { section: "Above the Line", category: "Writer", line_item: "Showrunner / Head Writer", basis: "per episode", qty: 1, rate: 0, rationale: "Per-episode fee for series" },
        { section: "Above the Line", category: "Director", line_item: "Directors (per block)", basis: "per episode", qty: 1, rate: 0, rationale: "Rotating directors per block" },
        { section: "Above the Line", category: "Producer", line_item: "Executive Producers", basis: "flat", qty: 1, rate: 0, rationale: "EP fees across series" },
        { section: "Above the Line", category: "Cast", line_item: "Series Regulars", basis: "per episode", qty: 1, rate: 0, rationale: "Per-episode cast fees" },
        { section: "Below the Line", category: "Crew", line_item: "Below the Line Crew", basis: "per week", qty: 10, rate: 0, rationale: "Full crew for shoot duration" },
        { section: "Below the Line", category: "Art", line_item: "Art & Construction", basis: "per week", qty: 14, rate: 0, rationale: "Standing sets + swing sets" },
        { section: "Post", category: "Edit", line_item: "Post Production", basis: "per episode", qty: 1, rate: 0, rationale: "Per-episode post workflow" },
        { section: "Post", category: "VFX", line_item: "VFX", basis: "per episode", qty: 1, rate: 0, rationale: "VFX shots per episode estimate" },
        { section: "Insurance/Legal", category: "Insurance", line_item: "Production Insurance", basis: "flat", qty: 1, rate: 0, rationale: "Series insurance package" },
        { section: "Contingency", category: "Contingency", line_item: "Contingency (10%)", basis: "percentage", qty: 1, rate: 0, rationale: "Standard contingency" },
      ],
    },
    "Documentary Feature": {
      assumptions: { schedule_weeks: 12, shoot_days: 30, union_level: "non-union", vfx_level: "none", cast_level: "contributors" },
      lines: [
        { section: "Above the Line", category: "Director", line_item: "Director / Producer", basis: "flat", qty: 1, rate: 0, rationale: "Director-producer combined fee" },
        { section: "Below the Line", category: "Camera", line_item: "DP + Camera Package", basis: "per day", qty: 30, rate: 0, rationale: "Shooting days across locations" },
        { section: "Below the Line", category: "Sound", line_item: "Sound Recordist", basis: "per day", qty: 30, rate: 0, rationale: "Location sound recording" },
        { section: "Below the Line", category: "Travel", line_item: "Travel & Access", basis: "flat", qty: 1, rate: 0, rationale: "Travel to subjects/locations" },
        { section: "Below the Line", category: "Archive", line_item: "Archive & Licensing", basis: "flat", qty: 1, rate: 0, rationale: "Archive footage licensing fees" },
        { section: "Post", category: "Edit", line_item: "Editor + Facility", basis: "per week", qty: 16, rate: 0, rationale: "Extended doc edit period" },
        { section: "Post", category: "Music", line_item: "Score / Music", basis: "flat", qty: 1, rate: 0, rationale: "Original score or library" },
        { section: "Contingency", category: "Contingency", line_item: "Contingency (10%)", basis: "percentage", qty: 1, rate: 0, rationale: "Standard contingency" },
      ],
    },
    "Commercial / Advert": {
      assumptions: { schedule_weeks: 2, shoot_days: 2, union_level: "SAG-AFTRA Commercial", vfx_level: "moderate", cast_level: "talent" },
      lines: [
        { section: "Creative/Agency", category: "Creative", line_item: "Creative Development", basis: "flat", qty: 1, rate: 0, rationale: "If not agency-provided" },
        { section: "Production", category: "Crew", line_item: "Production Crew", basis: "per day", qty: 2, rate: 0, rationale: "Full crew for shoot days" },
        { section: "Production", category: "Equipment", line_item: "Camera & Lighting Package", basis: "per day", qty: 2, rate: 0, rationale: "High-end commercial package" },
        { section: "Talent", category: "Talent", line_item: "Presenter / Talent", basis: "flat", qty: 1, rate: 0, rationale: "Talent fee + usage" },
        { section: "Post", category: "Edit", line_item: "Edit / Grade / Mix", basis: "flat", qty: 1, rate: 0, rationale: "Offline, online, grade, audio mix" },
        { section: "Post", category: "VFX", line_item: "VFX / Motion Graphics", basis: "flat", qty: 1, rate: 0, rationale: "Post-production VFX" },
        { section: "Usage/Rights", category: "Usage", line_item: "Usage & Buyout Fees", basis: "flat", qty: 1, rate: 0, rationale: "Media usage rights and buyouts" },
        { section: "Contingency", category: "Contingency", line_item: "Contingency (10%)", basis: "percentage", qty: 1, rate: 0, rationale: "Standard contingency" },
      ],
    },
    "Branded Content": {
      assumptions: { schedule_weeks: 3, shoot_days: 3, union_level: "non-union", vfx_level: "light", cast_level: "influencer" },
      lines: [
        { section: "Creative/Agency", category: "Creative", line_item: "Creative / Strategy", basis: "flat", qty: 1, rate: 0, rationale: "Brand alignment creative" },
        { section: "Production", category: "Crew", line_item: "Production Crew", basis: "per day", qty: 3, rate: 0, rationale: "Lean crew setup" },
        { section: "Talent", category: "Talent", line_item: "Influencer / Presenter", basis: "flat", qty: 1, rate: 0, rationale: "Talent or influencer fee" },
        { section: "Post", category: "Edit", line_item: "Post Production", basis: "flat", qty: 1, rate: 0, rationale: "Edit and deliverables creation" },
        { section: "Usage/Rights", category: "Usage", line_item: "Usage Rights", basis: "flat", qty: 1, rate: 0, rationale: "Platform usage rights" },
        { section: "Contingency", category: "Contingency", line_item: "Contingency (10%)", basis: "percentage", qty: 1, rate: 0, rationale: "Standard contingency" },
      ],
    },
    "Vertical Drama": {
      assumptions: { schedule_weeks: 4, shoot_days: 20, union_level: "non-union", vfx_level: "none", cast_level: "emerging" },
      lines: [
        { section: "Writing Room", category: "Writer", line_item: "Writing Room", basis: "per week", qty: 4, rate: 0, rationale: "Fast-turnaround writers room" },
        { section: "Production", category: "Crew", line_item: "Repeatable Set Crew", basis: "per day", qty: 20, rate: 0, rationale: "Lean crew, repeatable locations" },
        { section: "Production", category: "Locations", line_item: "Standing Set / Locations", basis: "flat", qty: 1, rate: 0, rationale: "Repeatable set build or rental" },
        { section: "Post", category: "Edit", line_item: "Fast Turnaround Post", basis: "per episode", qty: 1, rate: 0, rationale: "Quick edit cycle per ep" },
        { section: "Music/SFX", category: "Music", line_item: "Music / SFX Library", basis: "flat", qty: 1, rate: 0, rationale: "Library music and SFX" },
        { section: "Contingency", category: "Contingency", line_item: "Contingency (10%)", basis: "percentage", qty: 1, rate: 0, rationale: "Standard contingency" },
      ],
    },
  };

  // Fallback: use Narrative Feature template for unknown types
  const key = Object.keys(base).find(k => productionType.toLowerCase().includes(k.toLowerCase().split(" ")[0]));
  return base[key as keyof typeof base] || base["Narrative Feature"];
}

// Production-type specific packaging archetypes
function getPackagingDefaults(productionType: string, archetypes: any[]) {
  const items: Array<{ item_type: string; name: string; archetype: string }> = [];

  // Parse archetypes from pitch idea
  if (archetypes && Array.isArray(archetypes)) {
    for (const arch of archetypes) {
      if (typeof arch === 'object' && arch !== null) {
        items.push({ item_type: arch.type || "CAST", name: arch.name || "", archetype: arch.archetype || String(arch) });
      } else if (typeof arch === 'string') {
        items.push({ item_type: "CAST", name: "", archetype: arch });
      }
    }
  }

  // Add production-type defaults if no archetypes
  if (items.length === 0) {
    const pt = productionType.toLowerCase();
    if (pt.includes("commercial") || pt.includes("advert")) {
      items.push(
        { item_type: "DIRECTOR", name: "", archetype: "Commercial director with brand storytelling experience" },
        { item_type: "BRAND", name: "", archetype: "Brand partner alignment" },
        { item_type: "CAST", name: "", archetype: "On-screen talent / presenter" },
      );
    } else if (pt.includes("vertical")) {
      items.push(
        { item_type: "CAST", name: "", archetype: "Short-form talent / emerging actor" },
        { item_type: "DIRECTOR", name: "", archetype: "Fast-paced digital content director" },
        { item_type: "WRITER", name: "", archetype: "Hook-driven episodic writer" },
      );
    } else if (pt.includes("documentary")) {
      items.push(
        { item_type: "DIRECTOR", name: "", archetype: "Documentary filmmaker with subject access" },
        { item_type: "PRODUCER", name: "", archetype: "Documentary producer with festival track record" },
      );
    } else if (pt.includes("branded")) {
      items.push(
        { item_type: "DIRECTOR", name: "", archetype: "Branded content / narrative ad director" },
        { item_type: "BRAND", name: "", archetype: "Brand sponsor alignment" },
      );
    } else {
      // Film / TV / default
      items.push(
        { item_type: "DIRECTOR", name: "", archetype: "Director with genre alignment" },
        { item_type: "CAST", name: "", archetype: "Lead cast — market value anchor" },
        { item_type: "PRODUCER", name: "", archetype: "Line producer with territory experience" },
        { item_type: "SALES", name: "", archetype: "Sales agent with genre/budget fit" },
      );
    }
  }

  return items;
}

// Stage gate definitions
function getStageGateDefaults(productionType: string) {
  const pt = productionType.toLowerCase();
  const isCommercial = pt.includes("commercial") || pt.includes("advert") || pt.includes("branded");

  return [
    {
      gate_name: "Development", status: "IN_PROGRESS", sort_order: 0,
      required_artifacts: ["Concept Lock docs (treatment + bibles)", "Comparable titles", "Lane recommendation", "Initial budget scaffold"],
    },
    {
      gate_name: "Packaging", status: "NOT_STARTED", sort_order: 1,
      required_artifacts: ["At least 1 key attachment in discussion or attached", "Updated budget top-sheet"],
    },
    {
      gate_name: "Financing", status: "NOT_STARTED", sort_order: 2,
      required_artifacts: isCommercial
        ? ["Client brief confirmed", "Budget approved", "Production timeline locked"]
        : ["Finance plan draft", "Target buyers / platform fit statement", "Sales / territory approach"],
    },
    {
      gate_name: "Greenlight", status: "NOT_STARTED", sort_order: 3,
      required_artifacts: ["Package readiness threshold met", "Risk list + mitigations"],
    },
    {
      gate_name: "Pre-Production", status: "NOT_STARTED", sort_order: 4,
      required_artifacts: ["HOD hires confirmed", "Schedule locked", "Locations secured"],
    },
    {
      gate_name: "Production", status: "NOT_STARTED", sort_order: 5,
      required_artifacts: ["Daily reports logging", "Cost tracking active"],
    },
    {
      gate_name: "Post-Production", status: "NOT_STARTED", sort_order: 6,
      required_artifacts: ["Assembly cut delivered", "VFX shots tracked", "Sound post scheduled"],
    },
    {
      gate_name: "Delivery", status: "NOT_STARTED", sort_order: 7,
      required_artifacts: ["Deliverables checklist complete", "QC passed", "Materials shipped"],
    },
    {
      gate_name: "Recoup", status: "NOT_STARTED", sort_order: 8,
      required_artifacts: ["Revenue tracking active", "Recoupment waterfall agreed"],
    },
  ];
}

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

async function ensureToplineNarrative(supabase: any, projectId: string, userId: string) {
  // Idempotent: check if topline doc already exists
  const { data: existing } = await supabase
    .from("project_documents")
    .select("id")
    .eq("project_id", projectId)
    .eq("doc_type", "topline_narrative")
    .limit(1);

  if (existing && existing.length > 0) return { documentId: existing[0].id, created: false };

  // Create project_documents row (file_name + file_path are required NOT NULL)
  const { data: doc, error: docErr } = await supabase
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

  if (docErr) {
    console.error("Failed to create topline doc:", docErr.message);
    return null;
  }

  // Create initial version — matching dev-engine-v2 insert shape
  const { data: version, error: verErr } = await supabase
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

  if (verErr) {
    console.error("Failed to create topline version:", verErr.message);
    return null;
  }

  // Set latest_version_id
  await supabase
    .from("project_documents")
    .update({ latest_version_id: version.id })
    .eq("id", doc.id);

  return { documentId: doc.id, versionId: version.id, created: true };
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) throw new Error("Not authenticated");

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    const anonClient = createClient(supabaseUrl, Deno.env.get("SUPABASE_ANON_KEY")!);
    const { data: { user }, error: userError } = await anonClient.auth.getUser(
      authHeader.replace("Bearer ", "")
    );
    if (userError || !user) throw new Error("Invalid auth token");

    const { pitchIdeaId, title, budgetBand, lane } = await req.json();
    if (!pitchIdeaId) throw new Error("pitchIdeaId required");

    // STEP 1: Validate
    const { data: idea, error: ideaErr } = await supabase
      .from("pitch_ideas")
      .select("*")
      .eq("id", pitchIdeaId)
      .eq("user_id", user.id)
      .single();

    if (ideaErr || !idea) throw new Error("Pitch idea not found or access denied");
    if (idea.concept_lock_status !== "locked") throw new Error("Idea must be locked before promotion");
    if (idea.promoted_to_project_id) throw new Error("Idea already promoted to a project");

    // Validate stress test
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

    const formatMap: Record<string, string> = {
      "Narrative Feature": "film", "TV Series": "tv-series", "Documentary Feature": "documentary",
      "Documentary Series": "documentary-series", "Short Film": "short-film", "Digital Series": "digital-series",
      "Commercial / Advert": "commercial", "Branded Content": "branded-content", "Music Video": "music-video",
      "Vertical Drama": "vertical-drama", "Proof of Concept": "proof-of-concept", "Hybrid": "hybrid",
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

    // STEP 3: Copy expansion documents
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
            project_id: projectId, pitch_idea_id: idea.id, user_id: user.id,
            doc_type: doc.doc_type, title: doc.title, content: doc.content,
            version: idea.concept_lock_version || 1,
          });
        }
      }
    }

    // STEP 4: Audit log
    await supabase.from("project_activity_log").insert({
      project_id: projectId, user_id: user.id, action: "create", section: "concept-lock",
      entity_type: "pitch_ideas", entity_id: idea.id,
      summary: `Project promoted from Concept Lock v${idea.concept_lock_version || 1} — "${idea.title}"`,
      metadata: { source_pitch_idea_id: idea.id, concept_lock_version: idea.concept_lock_version || 1, stress_test_passed: true },
    });

    // STEP 5: Update pitch idea
    await supabase.from("pitch_ideas")
      .update({ promoted_to_project_id: projectId, status: "in-development" })
      .eq("id", pitchIdeaId);

    // STEP 6: Auto-initialise Budget Scaffold
    const template = getBudgetTemplate(idea.production_type);
    const finalBudgetBand = budgetBand || idea.budget_band || "";

    await supabase.from("budget_assumptions").insert({
      user_id: user.id, project_id: projectId, budget_band: finalBudgetBand,
      estimated_total: 0, currency: "GBP",
      schedule_weeks: template.assumptions.schedule_weeks,
      shoot_days: template.assumptions.shoot_days,
      union_level: template.assumptions.union_level,
      vfx_level: template.assumptions.vfx_level,
      cast_level: template.assumptions.cast_level,
    });

    // Create budget version in existing project_budgets table
    const { data: budget } = await supabase.from("project_budgets").insert({
      user_id: user.id, project_id: projectId, version_label: "Scaffold v1",
      status: "draft", total_amount: 0, currency: "GBP",
      lane_template: lane || idea.recommended_lane || "", source: "concept-lock-promotion",
      notes: `Auto-generated from Concept Lock v${idea.concept_lock_version || 1}`,
    }).select().single();

    if (budget) {
      const budgetLines = template.lines.map((line: any, idx: number) => ({
        user_id: user.id, project_id: projectId, budget_id: budget.id,
        category: line.section, line_name: `${line.category}: ${line.line_item}`,
        amount: 0, sort_order: idx, notes: line.rationale,
      }));
      await supabase.from("project_budget_lines").insert(budgetLines);
    }

    // STEP 7: Auto-initialise Packaging Pipeline
    const packagingDefaults = getPackagingDefaults(idea.production_type, idea.packaging_suggestions || []);
    const packagingRows = packagingDefaults.map((item, idx) => ({
      user_id: user.id, project_id: projectId,
      item_type: item.item_type, name: item.name, archetype: item.archetype,
      status: "TARGET", priority: idx + 1,
    }));
    if (packagingRows.length > 0) {
      await supabase.from("packaging_items").insert(packagingRows);
    }

    // STEP 8: Auto-initialise Stage Gates
    const gateDefaults = getStageGateDefaults(idea.production_type);
    const gateRows = gateDefaults.map(g => ({
      user_id: user.id, project_id: projectId,
      gate_name: g.gate_name, status: g.status, sort_order: g.sort_order,
      required_artifacts: g.required_artifacts, score: 0,
    }));
    await supabase.from("stage_gates").insert(gateRows);

    // STEP 9: Auto-create Topline Narrative document
    await ensureToplineNarrative(supabase, projectId, user.id);

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
