import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

// ─── Production-type Blueprint Prompts ───
function getBlueprintPrompt(productionType: string, project: any, conceptDocs: any[], calibration?: any) {
  const conceptContext = conceptDocs.map(d => `[${d.doc_type}]\n${d.content?.substring(0, 3000)}`).join("\n\n");

  let corpusBlock = "";
  if (calibration) {
    const mp = calibration.median_page_count;
    const ms = calibration.median_scene_count;
    const pageLow = mp ? Math.round(mp * 0.85) : null;
    const pageHigh = mp ? Math.round(mp * 1.15) : null;
    const sceneLow = ms ? Math.round(ms * 0.85) : null;
    const sceneHigh = ms ? Math.round(ms * 1.15) : null;
    corpusBlock = `
CORPUS CALIBRATION (from ${calibration.sample_size || 'N/A'} analyzed scripts):
- Target page range: ${pageLow}–${pageHigh} pages (corpus median: ${mp})
- Target scene count: ${sceneLow}–${sceneHigh} scenes (corpus median: ${ms})
- Median midpoint position: ${calibration.median_midpoint_position || 'N/A'}
- Median dialogue ratio: ${calibration.median_dialogue_ratio ? Math.round(calibration.median_dialogue_ratio * 100) + '%' : 'N/A'}
- Median cast size: ${calibration.median_cast_size || 'N/A'}

Structure this blueprint to support ~${mp || 'standard'} pages and ~${ms || 'standard'} scenes based on corpus median. Deviate only with creative justification.

IMPORTANT: Do NOT imitate or copy any specific screenplay from the corpus. Use only numeric/structural targets derived from aggregate statistics.
`;
  }

  const base = `You are IFFY, an elite script development AI for the entertainment industry.

PROJECT CONTEXT:
Title: ${project.title}
Production Type: ${productionType}
Format: ${project.format}
Genres: ${(project.genres || []).join(", ")}
Budget Range: ${project.budget_range}
Lane: ${project.assigned_lane || "unassigned"}
Tone: ${project.tone}
Comparable Titles: ${project.comparable_titles || "none"}
Logline: ${project.reasoning || ""}
${corpusBlock}
CONCEPT LOCK DOCUMENTS:
${conceptContext || "No concept lock documents available."}

`;

  const pt = productionType.toLowerCase();
  if (pt.includes("tv") || pt.includes("series")) {
    return base + `Generate a TV SERIES BLUEPRINT with:
1. Series Overview (premise, world, central question)
2. Season Arc (beginning → midpoint → season climax)
3. Episode Grid (episode titles + one-line summaries for 6-10 episodes)
4. Pilot Beat Breakdown (10-15 key beats)
5. Season Cliffhanger concept
6. Multi-Season Trajectory (2-3 season arcs)
7. Character Arc Summary (protagonist + 2-3 key characters)
8. Thematic Spine (core theme + how it evolves)

Return as JSON with keys: series_overview, season_arc, episode_grid (array), pilot_beats (array), season_cliffhanger, multi_season_trajectory, character_arcs (array), thematic_spine.`;
  }

  if (pt.includes("vertical")) {
    return base + `Generate a VERTICAL DRAMA BLUEPRINT with:
1. Episode Hook Cadence (how each 2-5 min ep opens)
2. Emotional Spike Mapping (emotional peaks per episode)
3. Cliffhanger Density (cliffhanger strategy per episode)
4. Retention Mechanics (what keeps viewers swiping to next ep)
5. Season Arc (compressed for short-form)
6. Character Arc Summary
7. Thematic Spine

Return as JSON with keys: hook_cadence (array), emotional_spikes (array), cliffhanger_density, retention_mechanics, season_arc, character_arcs (array), thematic_spine.`;
  }

  if (pt.includes("documentary")) {
    return base + `Generate a DOCUMENTARY BLUEPRINT with:
1. POV Clarity (whose story, what angle)
2. Narrative Spine (central question + journey)
3. Access Dependencies (what access is needed)
4. Act-Style Escalation (3-4 act structure adapted for doc)
5. Key Sequences (5-8 essential scenes/interviews)
6. Archive/Visual Strategy
7. Thematic Spine

Return as JSON with keys: pov_clarity, narrative_spine, access_dependencies (array), act_escalation (array), key_sequences (array), visual_strategy, thematic_spine.`;
  }

  // Film / default
  return base + `Generate a FILM SCRIPT BLUEPRINT with:
1. Three-Act Breakdown (Act 1 setup, Act 2 confrontation, Act 3 resolution)
2. Inciting Incident (specific moment + page target)
3. Midpoint Pivot (what changes everything)
4. Lowest Point (protagonist's darkest moment)
5. Climax (final confrontation)
6. Resolution (new equilibrium)
7. Character Arc Summary (protagonist + antagonist + 1-2 key supporting)
8. Thematic Spine (core theme + how screenplay embodies it)

VALIDATION REQUIREMENTS — the blueprint MUST pass:
- Protagonist Agency Test: protagonist drives action, not reactive
- Escalation Test: stakes increase act over act
- Engine Sustainability Test: central conflict sustains full runtime
- Budget Feasibility: locations/set pieces aligned with ${project.budget_range}
- Lane Alignment: tone/scope matches ${project.assigned_lane || "assigned"} lane

Return as JSON with keys: three_act_breakdown (object with act_1, act_2, act_3), inciting_incident, midpoint_pivot, lowest_point, climax, resolution, character_arcs (array of {name, arc}), thematic_spine, validation (object with protagonist_agency, escalation, engine_sustainability, budget_feasibility, lane_alignment — each a string verdict).`;
}

// ─── Scene Architecture Prompt ───
async function getCorpusCalibration(db: ReturnType<typeof createClient>, productionType: string, genre?: string) {
  try {
    const pt = productionType.toLowerCase();
    // Try genre-specific baseline first
    if (genre) {
      const g = genre.toLowerCase();
      const { data: baselines } = await db
        .from("corpus_insights")
        .select("pattern, production_type, lane")
        .eq("insight_type", "baseline_profile");
      if (baselines?.length) {
        const match = baselines.find((d: any) => {
          const cpt = (d.production_type || "").toLowerCase();
          return (cpt === pt || pt.includes(cpt) || cpt.includes(pt)) &&
            (d.lane || "").toLowerCase() === g;
        });
        if (match?.pattern) return match.pattern;
      }
    }
    // Fall back to production type calibration
    const { data } = await db
      .from("corpus_insights")
      .select("pattern, production_type")
      .eq("insight_type", "calibration");
    if (!data?.length) return null;
    const match = data.find((d: any) => {
      const cpt = (d.production_type || "").toLowerCase();
      return cpt === pt || pt.includes(cpt) || cpt.includes(pt);
    }) || data[0];
    return match?.pattern || null;
  } catch {
    return null;
  }
}

async function getLaneNorm(db: ReturnType<typeof createClient>, lane: string) {
  try {
    if (!lane) return null;
    const { data } = await db
      .from("corpus_insights")
      .select("pattern")
      .eq("insight_type", "lane_norm")
      .eq("lane", lane.toLowerCase());
    return data?.[0]?.pattern || null;
  } catch {
    return null;
  }
}

async function getCorpusPlaybooks(db: ReturnType<typeof createClient>, userId: string) {
  try {
    const { data } = await db
      .from("corpus_insights")
      .select("pattern")
      .eq("user_id", userId)
      .eq("insight_type", "playbook");
    return (data || []).map((d: any) => d.pattern);
  } catch {
    return [];
  }
}

async function getGoldBaseline(db: ReturnType<typeof createClient>, productionType: string) {
  try {
    const { data } = await db
      .from("corpus_insights")
      .select("pattern, production_type")
      .eq("insight_type", "gold_baseline");
    if (!data?.length) return null;
    const pt = productionType.toLowerCase();
    const match = data.find((d: any) => {
      const cpt = (d.production_type || "").toLowerCase();
      return cpt === pt || pt.includes(cpt) || cpt.includes(pt);
    });
    return match?.pattern || data.find((d: any) => d.production_type === "all")?.pattern || null;
  } catch {
    return null;
  }
}

function getArchitecturePrompt(productionType: string, blueprint: any, project: any, calibration?: any) {
  const pt = productionType.toLowerCase();
  let pageTarget = pt.includes("short") ? "15-25" : pt.includes("vertical") ? "3-5 per episode" : pt.includes("tv") ? "45-60 per episode" : "90-120";
  let sceneTarget = "";

  if (calibration) {
    const mp = calibration.median_page_count;
    const ms = calibration.median_scene_count;
    if (mp) pageTarget = `${Math.round(mp * 0.85)}-${Math.round(mp * 1.15)}`;
    if (ms) sceneTarget = `\nTarget scene count: ~${Math.round(ms)} scenes (corpus median ± 15%)`;
  }

  return `You are IFFY, generating Scene Architecture for a ${productionType} script.

BLUEPRINT:
${JSON.stringify(blueprint, null, 2)}

PROJECT: ${project.title} | Budget: ${project.budget_range} | Lane: ${project.assigned_lane || "unassigned"}
${calibration ? `\nCORPUS CALIBRATION (from ${calibration.sample_size || 'N/A'} analyzed scripts):
- Median page count: ${calibration.median_page_count || 'N/A'}
- Median scene count: ${calibration.median_scene_count || 'N/A'}
- Median dialogue ratio: ${calibration.median_dialogue_ratio ? Math.round(calibration.median_dialogue_ratio * 100) + '%' : 'N/A'}
- Median midpoint position: ${calibration.median_midpoint_position || 'N/A'}
Use these as structural targets. Deviate only with creative justification.
IMPORTANT: Do NOT imitate or copy any specific screenplay from the corpus. Use only numeric/structural targets.` : ''}

Generate scene-by-scene architecture for the FULL script (~${pageTarget} pages).${sceneTarget} For each scene provide:
- scene_number (integer)
- beat_summary (what happens, 1-2 sentences)
- pov_character (whose scene)
- objective (what the POV character wants)
- obstacle (what prevents it)
- conflict_type (emotional | physical | ideological | procedural)
- turn_summary (how the scene shifts/changes direction)
- escalation_notes (how this raises stakes from previous scene)
- location (specific location)
- cast_size (number of characters present)
- production_weight (LOW | MEDIUM | HIGH based on complexity/cost)

NO DIALOGUE. Structure only.

Run these checks and include results:
- redundant_scenes: list any scene numbers that could be merged/cut
- escalation_gaps: any stretches where tension plateaus
- agency_issues: scenes where protagonist is purely reactive

Return as JSON: { scenes: [...], structural_check: { redundant_scenes, escalation_gaps, agency_issues } }`;
}

// ─── Batched Draft Prompt ───
function getDraftPrompt(scenes: any[], batchStart: number, batchEnd: number, project: any, blueprint: any) {
  const batchScenes = scenes.filter(s => s.scene_number >= batchStart && s.scene_number <= batchEnd);
  return `You are IFFY, writing script pages for "${project.title}".

BLUEPRINT CONTEXT:
${JSON.stringify(blueprint, null, 2).substring(0, 2000)}

SCENES TO DRAFT (scenes ${batchStart}-${batchEnd}):
${JSON.stringify(batchScenes, null, 2)}

Write these scenes in proper screenplay format. Rules:
- Each scene: slug line (INT./EXT. LOCATION - DAY/NIGHT), action lines, dialogue
- Dialogue must have SUBTEXT — never on-the-nose
- Each character must have a distinct VOICE
- Action lines: visual, present tense, lean
- Budget awareness: respect production weight flags
- Lane: ${project.assigned_lane || "general"} — match tone expectations

Return the screenplay pages as plain text in standard format.`;
}

// ─── Quality Scoring Prompt ───
function getScoringPrompt(scriptText: string, project: any, calibration?: any, laneNorm?: any, goldBaseline?: any) {
  let corpusBlock = "";
  if (calibration) {
    corpusBlock = `

CORPUS BASELINES (from ${calibration.sample_size || 'N/A'} analyzed scripts):
- Page count: median ${calibration.median_page_count || 'N/A'}, range ${calibration.p25_page_count || 'N/A'}–${calibration.p75_page_count || 'N/A'}
- Scene count: median ${calibration.median_scene_count || 'N/A'}, range ${calibration.p25_scene_count || 'N/A'}–${calibration.p75_scene_count || 'N/A'}
- Dialogue ratio: median ${calibration.median_dialogue_ratio ? Math.round(calibration.median_dialogue_ratio * 100) + '%' : 'N/A'}, range ${calibration.p25_dialogue_ratio ? Math.round(calibration.p25_dialogue_ratio * 100) + '%' : 'N/A'}–${calibration.p75_dialogue_ratio ? Math.round(calibration.p75_dialogue_ratio * 100) + '%' : 'N/A'}
- Cast size: median ${calibration.median_cast_size || 'N/A'}, range ${calibration.p25_cast_size || 'N/A'}–${calibration.p75_cast_size || 'N/A'}
- Location count: median ${calibration.median_location_count || 'N/A'}, range ${calibration.p25_location_count || 'N/A'}–${calibration.p75_location_count || 'N/A'}
- VFX rate in corpus: ${calibration.vfx_rate ? Math.round(calibration.vfx_rate * 100) + '%' : 'N/A'}

PENALIZE scores when the script significantly deviates from these baselines without creative justification:
- If locations >> ${calibration.p75_location_count || 'N/A'}, penalize budget score and flag feasibility risk
- If cast >> ${calibration.p75_cast_size || 'N/A'}, penalize budget score
- If dialogue ratio outside ${calibration.p25_dialogue_ratio ? Math.round(calibration.p25_dialogue_ratio * 100) : 'N/A'}–${calibration.p75_dialogue_ratio ? Math.round(calibration.p75_dialogue_ratio * 100) : 'N/A'}%, note in dialogue score`;
  }

  if (goldBaseline) {
    corpusBlock += `

GOLD BENCHMARK (from ${goldBaseline.sample_size || 'N/A'} top-quality scripts):
- Gold page count: ${goldBaseline.median_page_count || 'N/A'}
- Gold scene count: ${goldBaseline.median_scene_count || 'N/A'}
- Gold dialogue ratio: ${goldBaseline.median_dialogue_ratio ? Math.round(goldBaseline.median_dialogue_ratio * 100) + '%' : 'N/A'}
- Gold quality score: ${goldBaseline.median_quality_score || 'N/A'}
Compare against gold standards and note gaps to best-in-class.
IMPORTANT: Do NOT imitate or copy any specific screenplay from the corpus. Use only numeric/structural targets.`;
   }

  let laneBlock = "";
  if (laneNorm) {
    laneBlock = `

LANE NORMS (${laneNorm.lane_name || 'target'} lane, from ${laneNorm.sample_size || 'N/A'} scripts):
- Typical dialogue ratio: ${laneNorm.median_dialogue_ratio ? Math.round(laneNorm.median_dialogue_ratio * 100) + '%' : 'N/A'}
- Typical cast size: ${laneNorm.median_cast_size || 'N/A'}
- Typical pacing density: ${laneNorm.style_profile?.pacing_density ? laneNorm.style_profile.pacing_density.toFixed(2) + ' scenes/page' : 'N/A'}
Use these to score lane_alignment — flag mismatches.`;
  }

  return `You are IFFY's Quality Scoring Engine. Analyze this script draft for "${project.title}" (${project.format}, ${project.assigned_lane || "unassigned"} lane, ${project.budget_range} budget).
${corpusBlock}${laneBlock}

SCRIPT TEXT (excerpt):
${scriptText.substring(0, 12000)}

Score each dimension 0-100 and provide specific evidence:

1. STRUCTURAL SCORE: Tension escalation, stakes clarity, midpoint presence, scene necessity ratio
2. DIALOGUE SCORE: On-the-nose detection, subtext presence, voice differentiation per character, exposition density
3. SCENE ECONOMY SCORE: Repetition detection, redundant exposition, compressible scenes
4. BUDGET SCORE: Location creep, cast bloat, VFX creep, production weight imbalance vs ${project.budget_range}
5. LANE ALIGNMENT SCORE: Tone drift, market lane mismatch vs ${project.assigned_lane}, audience alignment

Return as JSON:
{
  structural_score: number,
  structural_notes: string,
  dialogue_score: number,
  dialogue_notes: string,
  economy_score: number,
  economy_notes: string,
  budget_score: number,
  budget_notes: string,
  lane_alignment_score: number,
  lane_alignment_notes: string
}`;
}

// ─── Rewrite Pass Prompt ───
function getRewritePrompt(pass: string, scriptText: string, scores: any, project: any) {
  const passInstructions: Record<string, string> = {
    "structural": `PASS 1 — STRUCTURAL TIGHTENING
Focus: Cut redundant scenes, sharpen act breaks, ensure every scene has a turn, fix escalation gaps.
Previous structural score: ${scores?.structural_score || "N/A"}
Notes: ${scores?.structural_notes || "None"}`,
    "character": `PASS 2 — CHARACTER DEPTH LAYERING
Focus: Add subtext to flat exchanges, deepen internal conflict, ensure each character has a unique want/wound/mask.
Previous dialogue score: ${scores?.dialogue_score || "N/A"}`,
    "dialogue": `PASS 3 — DIALOGUE SHARPENING
Focus: Remove on-the-nose dialogue, add subtext, differentiate character voices, reduce exposition dumps.
Previous dialogue score: ${scores?.dialogue_score || "N/A"}
Notes: ${scores?.dialogue_notes || "None"}`,
    "market": `PASS 4 — MARKET ALIGNMENT ADJUSTMENT
Focus: Ensure tone matches ${project.assigned_lane || "target"} lane expectations, audience alignment, commercial viability.
Previous lane alignment score: ${scores?.lane_alignment_score || "N/A"}`,
    "production": `PASS 5 — PRODUCTION REALISM CORRECTION
Focus: Reduce location bloat, consolidate sets, flag VFX-heavy scenes for simplification, ensure budget band ${project.budget_range} feasibility.
Previous budget score: ${scores?.budget_score || "N/A"}
Notes: ${scores?.budget_notes || "None"}`,
  };

  return `You are IFFY's Rewrite Engine working on "${project.title}".

${passInstructions[pass] || passInstructions["structural"]}

CURRENT SCRIPT (excerpt):
${scriptText.substring(0, 12000)}

Rewrite the script applying ONLY this pass's focus. Maintain what works. Return the full rewritten script text.`;
}

// ─── Self-Improvement Prompt ───
function getImprovementPrompt(scriptText: string, scores: any, project: any, goal: string, intensity: string, playbooks: any[], userPrefs: any, projectPrefs: any) {
  const intensityGuide = intensity === 'light' ? 'Make minimal, polished changes only. Do not restructure.' :
    intensity === 'bold' ? 'Be aggressive. Restructure if needed. Cut/merge/add scenes freely.' :
    'Make meaningful improvements while preserving overall structure.';

  const playbookOps = playbooks.map(p => `- ${p.name}: ${(p.operations || []).join('; ')}`).join('\n');
  const avoidPatterns = projectPrefs?.anti_patterns ? `\nAVOID these patterns (user rejected before): ${JSON.stringify(projectPrefs.anti_patterns)}` : '';
  const stylePrefs = userPrefs?.dialogue_style ? `\nUser prefers: ${userPrefs.dialogue_style} dialogue style, ${userPrefs.pacing || 'balanced'} pacing.` : '';

  return `You are IFFY's Self-Improving Script Engine for "${project.title}" (${project.format}, ${project.assigned_lane || "unassigned"} lane, ${project.budget_range}).

IMPROVEMENT GOAL: ${goal}
INTENSITY: ${intensity} — ${intensityGuide}

CURRENT SCORES:
- Structural: ${scores?.structural_score || "N/A"}
- Dialogue: ${scores?.dialogue_score || "N/A"}
- Economy: ${scores?.economy_score || "N/A"}
- Budget: ${scores?.budget_score || "N/A"}
- Lane Alignment: ${scores?.lane_alignment_score || "N/A"}

PLAYBOOK OPERATIONS TO APPLY:
${playbookOps || "No specific playbooks — use best judgment for the goal."}
${avoidPatterns}${stylePrefs}

IMPORTANT: Do NOT imitate or copy any specific screenplay from the corpus. Use only numeric/structural targets derived from aggregate statistics.

CURRENT SCRIPT (excerpt):
${scriptText.substring(0, 12000)}

INSTRUCTIONS:
1. Apply the improvement goal using the playbook operations
2. Return TWO things in your response:
   a) The FULL rewritten script text
   b) A structured summary

Format your response as:
---SCRIPT_START---
[full rewritten script text]
---SCRIPT_END---
---CHANGES_START---
[JSON object with keys: changes_summary (string, bullet list), scene_ops (array of {op: "CUT"|"MERGE"|"ADD"|"REWRITE"|"MOVE", target: string, reason: string})]
---CHANGES_END---`;
}

// ─── Page Count + Runtime Metrics Calculator ───
function computeDraftMetrics(text: string, productionType: string, episodeCount?: number) {
  const lines = text.split('\n');
  const nonEmptyLines = lines.filter(l => l.trim() !== '');
  const lineCount = nonEmptyLines.length;
  const wordCount = text.split(/\s+/).filter(w => w.length > 0).length;
  const pageCountEst = lineCount >= 200 ? Math.ceil(lineCount / 55) : Math.ceil(wordCount / 250);
  const pt = (productionType || '').toLowerCase();
  let baseMinutes = pageCountEst;
  if (pt.includes('vertical')) baseMinutes = Math.round(pageCountEst * 0.75);
  else if (pt.includes('documentary')) baseMinutes = Math.round(pageCountEst * 0.9);
  if (pt.includes('tv') || pt.includes('series')) {
    baseMinutes = pageCountEst <= 40 ? Math.max(20, Math.min(baseMinutes, 45)) : Math.max(40, Math.min(baseMinutes, 75));
  }
  const runtimeMinEst = baseMinutes;
  const runtimeMinLow = Math.round(runtimeMinEst * 0.9);
  const runtimeMinHigh = Math.round(runtimeMinEst * 1.1);
  const runtimePerEpisodeEst = episodeCount && episodeCount > 0 ? Math.round(runtimeMinEst / episodeCount) : null;
  return { wordCount, lineCount, pageCountEst, runtimeMinEst, runtimeMinLow, runtimeMinHigh, runtimePerEpisodeEst };
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

    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) throw new Error("LOVABLE_API_KEY not configured");

    const body = await req.json();
    const { action, projectId, scriptId } = body;
    if (!projectId) throw new Error("projectId required");

    // Verify project access
    const { data: project, error: projErr } = await supabase
      .from("projects")
      .select("*")
      .eq("id", projectId)
      .single();
    if (projErr || !project) throw new Error("Project not found");
    if (project.user_id !== user.id) {
      const { data: collab } = await supabase
        .from("project_collaborators")
        .select("id")
        .eq("project_id", projectId)
        .eq("user_id", user.id)
        .eq("status", "accepted")
        .limit(1);
      if (!collab?.length) throw new Error("No access to this project");
    }

    // Get concept lock docs
    const { data: conceptDocs } = await supabase
      .from("concept_lock_documents")
      .select("doc_type, content")
      .eq("project_id", projectId)
      .order("version", { ascending: false });

    async function callAI(prompt: string, useJson = true) {
      const messages: any[] = [{ role: "user", content: prompt }];
      const aiBody: any = {
        model: "google/gemini-2.5-flash",
        messages,
      };
      if (useJson) {
        aiBody.response_format = { type: "json_object" };
      }
      const resp = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
        method: "POST",
        headers: { Authorization: `Bearer ${LOVABLE_API_KEY}`, "Content-Type": "application/json" },
        body: JSON.stringify(aiBody),
      });
      if (!resp.ok) {
        const t = await resp.text();
        if (resp.status === 429) throw new Error("Rate limited — please try again shortly.");
        if (resp.status === 402) throw new Error("AI credits exhausted — please top up.");
        throw new Error(`AI error ${resp.status}: ${t}`);
      }
      const data = await resp.json();
      const content = data.choices?.[0]?.message?.content || "";
      if (useJson) {
        try { return JSON.parse(content); } catch { return { raw: content }; }
      }
      return content;
    }

    // ═══════════════════════════════════════════
    // ACTION: BLUEPRINT
    // ═══════════════════════════════════════════
    if (action === "blueprint") {
      const productionType = project.format === "tv-series" ? "TV Series" :
        project.format === "vertical-drama" ? "Vertical Drama" :
        project.format === "documentary" || project.format === "documentary-series" ? "Documentary" :
        project.format === "commercial" || project.format === "branded-content" ? "Commercial / Advert" :
        project.format === "short-film" ? "Short Film" : "Narrative Feature";

      const blueprintCalibration = await getCorpusCalibration(supabase, project.format, (project.genres || [])[0]);
      const prompt = getBlueprintPrompt(productionType, project, conceptDocs || [], blueprintCalibration);
      const blueprint = await callAI(prompt);

      // Create or update script record
      let sid = scriptId;
      if (!sid) {
        const { data: existing } = await supabase
          .from("scripts")
          .select("id")
          .eq("project_id", projectId)
          .eq("status", "BLUEPRINT")
          .limit(1);
        if (existing?.length) {
          sid = existing[0].id;
        }
      }

      if (sid) {
        await supabase.from("scripts").update({
          status: "BLUEPRINT", draft_number: 0, owner_id: user.id,
        }).eq("id", sid);
      } else {
        const maxV = await supabase.from("scripts").select("version").eq("project_id", projectId).order("version", { ascending: false }).limit(1);
        const nextVersion = ((maxV.data?.[0]?.version) || 0) + 1;
        const { data: newScript } = await supabase.from("scripts").insert({
          project_id: projectId, created_by: user.id, owner_id: user.id,
          version: nextVersion, status: "BLUEPRINT", draft_number: 0,
          version_label: `Engine Draft v${nextVersion}`,
        }).select().single();
        sid = newScript?.id;
      }

      // Store blueprint as version snapshot
      if (sid) {
        await supabase.from("script_versions").insert({
          script_id: sid, draft_number: 0, blueprint_json: blueprint,
          notes: "Blueprint generated",
        });
      }

      return new Response(JSON.stringify({ scriptId: sid, blueprint }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // ═══════════════════════════════════════════
    // ACTION: ARCHITECTURE
    // ═══════════════════════════════════════════
    if (action === "architecture") {
      if (!scriptId) throw new Error("scriptId required for architecture");

      // Get latest blueprint
      const { data: versions } = await supabase
        .from("script_versions")
        .select("blueprint_json")
        .eq("script_id", scriptId)
        .not("blueprint_json", "is", null)
        .order("created_at", { ascending: false })
        .limit(1);

      const blueprint = versions?.[0]?.blueprint_json;
      if (!blueprint) throw new Error("Blueprint not found — generate blueprint first");

      const productionType = project.format;
      const genres = project.genres || [];
      const calibration = await getCorpusCalibration(supabase, productionType, genres[0]);
      const prompt = getArchitecturePrompt(productionType, blueprint, project, calibration);
      const architecture = await callAI(prompt);

      // Clear existing scenes and insert new
      await supabase.from("script_scenes").delete().eq("script_id", scriptId);

      const scenes = architecture.scenes || [];
      if (scenes.length > 0) {
        const rows = scenes.map((s: any) => ({
          script_id: scriptId,
          scene_number: s.scene_number || 0,
          beat_summary: s.beat_summary || "",
          pov_character: s.pov_character || "",
          objective: s.objective || "",
          obstacle: s.obstacle || "",
          conflict_type: s.conflict_type || "emotional",
          turn_summary: s.turn_summary || "",
          escalation_notes: s.escalation_notes || "",
          location: s.location || "",
          cast_size: s.cast_size || 1,
          production_weight: s.production_weight || "MEDIUM",
        }));
        await supabase.from("script_scenes").insert(rows);
      }

      await supabase.from("scripts").update({ status: "ARCHITECTURE" }).eq("id", scriptId);

      return new Response(JSON.stringify({ scenes: scenes.length, structural_check: architecture.structural_check }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // ═══════════════════════════════════════════
    // ACTION: DRAFT (batched)
    // ═══════════════════════════════════════════
    if (action === "draft") {
      if (!scriptId) throw new Error("scriptId required for drafting");
      const batchStart = body.batchStart || 1;
      const batchSize = 15;
      const batchEnd = body.batchEnd || (batchStart + batchSize - 1);

      const { data: scenes } = await supabase
        .from("script_scenes")
        .select("*")
        .eq("script_id", scriptId)
        .order("scene_number", { ascending: true });

      if (!scenes?.length) throw new Error("No scene architecture — generate architecture first");

      const { data: bpVersions } = await supabase
        .from("script_versions")
        .select("blueprint_json")
        .eq("script_id", scriptId)
        .not("blueprint_json", "is", null)
        .order("created_at", { ascending: false })
        .limit(1);
      const blueprint = bpVersions?.[0]?.blueprint_json || {};

      const prompt = getDraftPrompt(scenes, batchStart, batchEnd, project, blueprint);
      console.log(`[draft] Generating batch ${batchStart}-${batchEnd} for script ${scriptId}`);
      const draftText = await callAI(prompt, false);
      console.log(`[draft] AI returned ${typeof draftText === 'string' ? draftText.length : 0} chars`);

      // Store batch in storage with proper naming
      const { data: scriptRow } = await supabase.from("scripts").select("draft_number, version").eq("id", scriptId).single();
      const currentDraft = scriptRow?.draft_number || 0;
      const scriptVersion = scriptRow?.version || 1;
      const batchIndex = Math.ceil(batchStart / batchSize);
      const safeTitle = (project.title || "Untitled").replace(/[^a-zA-Z0-9 _-]/g, "").replace(/\s+/g, "_");
      const path = `scripts/${projectId}/v${scriptVersion}/${safeTitle}_Draft_${currentDraft + 1}_Batch_${batchIndex}.txt`;

      const encoder = new TextEncoder();
      const draftTextStr = typeof draftText === 'string' ? draftText : JSON.stringify(draftText);
      const encoded = encoder.encode(draftTextStr);

      const { error: uploadError } = await supabase.storage.from("scripts").upload(path, encoded, {
        contentType: "text/plain", upsert: true,
      });
      if (uploadError) {
        console.error(`[draft] Storage upload FAILED:`, uploadError);
        throw new Error(`Failed to save draft to storage: ${uploadError.message}`);
      }
      console.log(`[draft] Storage upload OK: ${path}`);

      // Check if this is the final batch (by scene count)
      const maxScene = Math.max(...scenes.map((s: any) => s.scene_number));
      const allScenesComplete = batchEnd >= maxScene;

      // Compute page count + runtime metrics
      const metrics = computeDraftMetrics(draftTextStr, project.format);
      console.log(`[draft] Metrics: ${metrics.pageCountEst} pages, ~${metrics.runtimeMinEst} min`);

      // Enforce corpus minimum page count — draft cannot complete below p25
      let corpusMinPages = 0;
      try {
        const draftCalibration = await getCorpusCalibration(supabase, project.format, (project.genres || [])[0]);
        if (draftCalibration?.p25_page_count) {
          corpusMinPages = Math.round(draftCalibration.p25_page_count);
        }
      } catch { /* non-critical */ }

      const belowMinimum = corpusMinPages > 0 && metrics.pageCountEst < corpusMinPages;
      const isComplete = allScenesComplete && !belowMinimum;

      if (belowMinimum && allScenesComplete) {
        console.log(`[draft] Draft incomplete: ${metrics.pageCountEst} pages below corpus minimum ${corpusMinPages}. Continuing.`);
      }

      const newDraftNum = isComplete ? currentDraft + 1 : currentDraft;
      const newStatus = isComplete ? `DRAFT_${newDraftNum}` : "DRAFTING";

      // Always update scripts with latest batch info + metrics
      await supabase.from("scripts").update({
        status: newStatus,
        draft_number: newDraftNum,
        latest_draft_number: newDraftNum || currentDraft,
        latest_batch_index: batchIndex,
        latest_batch_storage_path: path,
        latest_page_count_est: metrics.pageCountEst,
        latest_runtime_min_est: metrics.runtimeMinEst,
        latest_runtime_min_low: metrics.runtimeMinLow,
        latest_runtime_min_high: metrics.runtimeMinHigh,
      }).eq("id", scriptId);

      // Always create script_versions row per batch with metrics
      const { data: svRow, error: svError } = await supabase.from("script_versions").insert({
        script_id: scriptId,
        draft_number: isComplete ? newDraftNum : currentDraft,
        batch_index: batchIndex,
        is_partial: !isComplete,
        full_text_storage_path: path,
        notes: isComplete ? `Draft ${newDraftNum} complete` : `Batch ${batchStart}-${batchEnd} drafted`,
        word_count: metrics.wordCount,
        line_count: metrics.lineCount,
        page_count_est: metrics.pageCountEst,
        runtime_min_est: metrics.runtimeMinEst,
        runtime_min_low: metrics.runtimeMinLow,
        runtime_min_high: metrics.runtimeMinHigh,
        runtime_per_episode_est: metrics.runtimePerEpisodeEst,
      }).select("id").single();

      if (svError) {
        console.error(`[draft] script_versions insert FAILED:`, svError);
      } else {
        console.log(`[draft] script_versions created: ${svRow?.id}`);
      }

      // When draft is complete, concatenate ALL batches and import into project documents for coverage
      let documentId: string | null = null;
      if (isComplete) {
        console.log(`[draft] Draft complete — assembling full text from all batches`);

        // List all batch files for this draft and concatenate them
        const batchDir = `scripts/${projectId}/v${scriptVersion}/`;
        const { data: batchFiles, error: listErr } = await supabase.storage
          .from("scripts")
          .list(batchDir, { sortBy: { column: "name", order: "asc" } });

        let fullText = "";
        if (listErr) {
          console.error(`[draft] Failed to list batch files:`, listErr);
          fullText = draftTextStr; // fallback to current batch only
        } else {
          const draftBatchFiles = (batchFiles || [])
            .filter((f: any) => f.name.includes(`Draft_${newDraftNum}_Batch_`))
            .sort((a: any, b: any) => a.name.localeCompare(b.name));

          console.log(`[draft] Found ${draftBatchFiles.length} batch files to assemble`);

          for (const file of draftBatchFiles) {
            const { data: fileData, error: dlErr } = await supabase.storage
              .from("scripts")
              .download(`${batchDir}${file.name}`);
            if (dlErr) {
              console.error(`[draft] Failed to download ${file.name}:`, dlErr);
              continue;
            }
            const text = await fileData.text();
            fullText += (fullText ? "\n\n" : "") + text;
          }

          if (!fullText) {
            console.error(`[draft] Assembly produced empty text, using current batch`);
            fullText = draftTextStr;
          }
        }

        console.log(`[draft] Assembled full text: ${fullText.length} chars`);

        // Save assembled full draft to storage
        const assembledPath = `scripts/${projectId}/v${scriptVersion}/${safeTitle}_Draft_${newDraftNum}.txt`;
        const assembledEncoded = new TextEncoder().encode(fullText);
        const { error: assembleUpErr } = await supabase.storage
          .from("scripts")
          .upload(assembledPath, assembledEncoded, { contentType: "text/plain", upsert: true });

        if (assembleUpErr) {
          console.error(`[draft] Assembled draft upload failed:`, assembleUpErr);
        } else {
          console.log(`[draft] Assembled draft saved: ${assembledPath}`);
        }

        // Import into project-documents bucket for coverage
        const docFileName = `${safeTitle} - Draft ${newDraftNum}.txt`;
        const docPath = `${user.id}/${Date.now()}-engine-${docFileName.replace(/\s+/g, '_')}`;

        const { error: docUploadErr } = await supabase.storage
          .from("project-documents")
          .upload(docPath, assembledEncoded, { contentType: "text/plain", upsert: true });

        if (docUploadErr) {
          console.error(`[draft] project-documents upload failed:`, docUploadErr);
        } else {
          console.log(`[draft] Copied to project-documents: ${docPath}`);

          // Create project_documents row with extracted text for coverage
          const { data: docRow, error: docInsertErr } = await supabase
            .from("project_documents")
            .insert({
              project_id: projectId,
              user_id: user.id,
              file_name: docFileName,
              file_path: docPath,
              extraction_status: "completed",
              extracted_text: fullText,
            })
            .select("id")
            .single();

          if (docInsertErr) {
            console.error(`[draft] project_documents insert failed:`, docInsertErr);
          } else {
            documentId = docRow?.id || null;
            console.log(`[draft] project_documents created: ${documentId}`);
          }

          // Archive existing current scripts, then create new project_scripts row
          await supabase
            .from("project_scripts")
            .update({ status: "archived" })
            .eq("project_id", projectId)
            .eq("status", "current");

          const { error: psErr } = await supabase.from("project_scripts").insert({
            project_id: projectId,
            user_id: user.id,
            version_label: `${project.title || "Untitled"} - Draft ${newDraftNum} (Engine)`,
            status: "current",
            file_path: docPath,
            notes: `Engine-generated draft ${newDraftNum}`,
          });
          if (psErr) {
            console.error(`[draft] project_scripts insert failed:`, psErr);
          } else {
            console.log(`[draft] project_scripts created as current`);
          }
        }
      }

      // If all scenes drafted but below minimum, provide continuation hint
      const needsContinuation = allScenesComplete && belowMinimum;
      return new Response(JSON.stringify({
        batchStart, batchEnd, isComplete, storagePath: path,
        scriptVersionId: svRow?.id || null,
        documentId,
        draftNumber: isComplete ? newDraftNum : currentDraft,
        batchIndex,
        nextBatch: isComplete ? null : { batchStart: batchEnd + 1, batchEnd: Math.min(batchEnd + batchSize, maxScene) },
        batchTextPreview: draftTextStr,
        metrics,
        belowCorpusMinimum: belowMinimum,
        corpusMinPages,
        needsContinuation,
        continuationMessage: needsContinuation ? `Draft at ${metrics.pageCountEst} pages — below corpus minimum of ${corpusMinPages}. Additional drafting recommended.` : null,
      }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // ═══════════════════════════════════════════
    // ACTION: SCORE
    // ═══════════════════════════════════════════
    if (action === "score") {
      if (!scriptId) throw new Error("scriptId required for scoring");

      // Get latest draft text — multi-fallback
      let scriptText = "";

      // 1) Try script_versions full_text_storage_path
      const { data: latestVersion } = await supabase
        .from("script_versions")
        .select("full_text_storage_path")
        .eq("script_id", scriptId)
        .not("full_text_storage_path", "is", null)
        .order("created_at", { ascending: false })
        .limit(5);

      for (const sv of (latestVersion || [])) {
        if (!sv.full_text_storage_path) continue;
        const { data: fileData } = await supabase.storage
          .from("scripts")
          .download(sv.full_text_storage_path);
        if (fileData) { scriptText = await fileData.text(); break; }
      }

      // 2) Try scripts.latest_batch_storage_path
      if (!scriptText) {
        const { data: scriptRow } = await supabase.from("scripts").select("latest_batch_storage_path, text_content").eq("id", scriptId).single();
        if (scriptRow?.latest_batch_storage_path) {
          const { data: fd } = await supabase.storage.from("scripts").download(scriptRow.latest_batch_storage_path);
          if (fd) scriptText = await fd.text();
        }
        if (!scriptText) scriptText = scriptRow?.text_content || "";
      }

      // 3) Scan storage for batch/rewrite files
      if (!scriptText) {
        const batchDir = `${projectId}/scripts/${scriptId}`;
        const { data: allFiles } = await supabase.storage.from("scripts").list(batchDir);
        if (allFiles?.length) {
          const sorted = allFiles
            .filter(f => f.name.includes("_Batch_") || f.name.includes("_Rewrite_") || f.name.includes("Draft_"))
            .sort((a, b) => (b.created_at || "").localeCompare(a.created_at || ""));
          const parts: string[] = [];
          for (const f of sorted.slice(0, 20)) {
            const { data: fd } = await supabase.storage.from("scripts").download(`${batchDir}/${f.name}`);
            if (fd) parts.push(await fd.text());
          }
          scriptText = parts.join("\n\n");
        }
        console.log(`[score] storage scan fallback found ${scriptText.length} chars`);
      }

      if (!scriptText) throw new Error("No script text found to score");

      // Fetch corpus calibration + lane norms + gold baseline for scoring
      const scoreCalibration = await getCorpusCalibration(supabase, project.format, (project.genres || [])[0]);
      const scoreLaneNorm = await getLaneNorm(supabase, project.assigned_lane || "");
      const scoreGoldBaseline = await getGoldBaseline(supabase, project.format);
      const prompt = getScoringPrompt(scriptText, project, scoreCalibration, scoreLaneNorm, scoreGoldBaseline);
      const scores = await callAI(prompt);

      // Update script record
      await supabase.from("scripts").update({
        structural_score: scores.structural_score,
        dialogue_score: scores.dialogue_score,
        economy_score: scores.economy_score,
        budget_score: scores.budget_score,
        lane_alignment_score: scores.lane_alignment_score,
      }).eq("id", scriptId);

      // Update latest version too
      if (latestVersion?.[0]) {
        await supabase.from("script_versions").update({
          structural_score: scores.structural_score,
          dialogue_score: scores.dialogue_score,
          economy_score: scores.economy_score,
          budget_score: scores.budget_score,
          lane_alignment_score: scores.lane_alignment_score,
        }).eq("id", latestVersion[0].id);
      }

      return new Response(JSON.stringify(scores), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // ═══════════════════════════════════════════
    // ACTION: REWRITE
    // ═══════════════════════════════════════════
    if (action === "rewrite") {
      if (!scriptId) throw new Error("scriptId required for rewrite");
      const pass = body.pass || "structural";

      const { data: latestVersion } = await supabase
        .from("script_versions")
        .select("*")
        .eq("script_id", scriptId)
        .not("full_text_storage_path", "is", null)
        .order("created_at", { ascending: false })
        .limit(1);

      let scriptText = "";
      if (latestVersion?.[0]?.full_text_storage_path) {
        const { data: fileData } = await supabase.storage
          .from("scripts")
          .download(latestVersion[0].full_text_storage_path);
        if (fileData) scriptText = await fileData.text();
      }
      if (!scriptText) {
        const { data: script } = await supabase.from("scripts").select("text_content").eq("id", scriptId).single();
        scriptText = script?.text_content || "";
      }
      if (!scriptText) throw new Error("No script text found to rewrite");

      const scores = latestVersion?.[0] || {};
      const prompt = getRewritePrompt(pass, scriptText, scores, project);
      const rewrittenText = await callAI(prompt, false);

      // Store rewrite with proper naming
      const { data: script } = await supabase.from("scripts").select("draft_number, version").eq("id", scriptId).single();
      const newDraft = (script?.draft_number || 0) + 1;
      const safeTitle = (project.title || "Untitled").replace(/[^a-zA-Z0-9 _-]/g, "").replace(/\s+/g, "_");
      const path = `scripts/${projectId}/v${script?.version || 1}/${safeTitle}_Draft_${newDraft}_Rewrite_${pass}.txt`;
      const encoder = new TextEncoder();
      const rewrittenStr = typeof rewrittenText === 'string' ? rewrittenText : JSON.stringify(rewrittenText);
      const encoded = encoder.encode(rewrittenStr);

      // Compute metrics for rewrite
      const rewriteMetrics = computeDraftMetrics(rewrittenStr, project.format);

      await supabase.from("scripts").update({
        status: `DRAFT_${newDraft}`, draft_number: newDraft,
        latest_draft_number: newDraft,
        latest_batch_storage_path: path,
        latest_page_count_est: rewriteMetrics.pageCountEst,
        latest_runtime_min_est: rewriteMetrics.runtimeMinEst,
        latest_runtime_min_low: rewriteMetrics.runtimeMinLow,
        latest_runtime_min_high: rewriteMetrics.runtimeMinHigh,
      }).eq("id", scriptId);

      await supabase.from("script_versions").insert({
        script_id: scriptId, draft_number: newDraft,
        full_text_storage_path: path, rewrite_pass: pass,
        notes: `Rewrite pass: ${pass}`,
        word_count: rewriteMetrics.wordCount,
        line_count: rewriteMetrics.lineCount,
        page_count_est: rewriteMetrics.pageCountEst,
        runtime_min_est: rewriteMetrics.runtimeMinEst,
        runtime_min_low: rewriteMetrics.runtimeMinLow,
        runtime_min_high: rewriteMetrics.runtimeMinHigh,
        runtime_per_episode_est: rewriteMetrics.runtimePerEpisodeEst,
      });

      // Import rewrite into project documents + scripts for coverage
      const docFileName = `${safeTitle} - Draft ${newDraft} (${pass} rewrite).txt`;
      const docPath = `${user.id}/${Date.now()}-engine-${docFileName.replace(/\s+/g, '_')}`;

      const { error: docUploadErr } = await supabase.storage
        .from("project-documents")
        .upload(docPath, encoded, { contentType: "text/plain", upsert: true });

      if (!docUploadErr) {
        await supabase.from("project_documents").insert({
          project_id: projectId, user_id: user.id,
          file_name: docFileName, file_path: docPath,
          extraction_status: "completed", extracted_text: rewrittenStr,
        });

        await supabase.from("project_scripts")
          .update({ status: "archived" })
          .eq("project_id", projectId)
          .eq("status", "current");

        await supabase.from("project_scripts").insert({
          project_id: projectId, user_id: user.id,
          version_label: `${project.title || "Untitled"} - Draft ${newDraft} (${pass} rewrite, Engine)`,
          status: "current", file_path: docPath,
          notes: `Engine rewrite pass: ${pass}`,
        });
      }

      return new Response(JSON.stringify({ draftNumber: newDraft, pass, storagePath: path }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // ═══════════════════════════════════════════
    // ACTION: IMPROVE (Self-improving one-button mode)
    // ═══════════════════════════════════════════
    if (action === "improve") {
      if (!scriptId) throw new Error("scriptId required for improve");
      const goal = body.goal || "make_commercial";
      const intensity = body.intensity || "balanced";

      // 1) Fetch current script text (same multi-fallback)
      let scriptText = "";
      const { data: latVer } = await supabase.from("script_versions")
        .select("id, full_text_storage_path, structural_score, dialogue_score, economy_score, budget_score, lane_alignment_score")
        .eq("script_id", scriptId)
        .not("full_text_storage_path", "is", null)
        .order("created_at", { ascending: false }).limit(5);

      let beforeVersionId: string | null = null;
      for (const sv of (latVer || [])) {
        if (!sv.full_text_storage_path) continue;
        const { data: fd } = await supabase.storage.from("scripts").download(sv.full_text_storage_path);
        if (fd) { scriptText = await fd.text(); beforeVersionId = sv.id; break; }
      }
      if (!scriptText) {
        const { data: sr } = await supabase.from("scripts").select("latest_batch_storage_path, text_content").eq("id", scriptId).single();
        if (sr?.latest_batch_storage_path) {
          const { data: fd } = await supabase.storage.from("scripts").download(sr.latest_batch_storage_path);
          if (fd) scriptText = await fd.text();
        }
        if (!scriptText) scriptText = sr?.text_content || "";
      }
      if (!scriptText) throw new Error("No script text found to improve");

      // 2) Get before scores
      const { data: scriptRow } = await supabase.from("scripts")
        .select("structural_score, dialogue_score, economy_score, budget_score, lane_alignment_score, draft_number, version")
        .eq("id", scriptId).single();
      const beforeScores = {
        structural_score: scriptRow?.structural_score,
        dialogue_score: scriptRow?.dialogue_score,
        economy_score: scriptRow?.economy_score,
        budget_score: scriptRow?.budget_score,
        lane_alignment_score: scriptRow?.lane_alignment_score,
      };

      // 3) Select matching playbooks — auto-trigger from deviation metrics + goal matching
      const pt = (project.format || 'film').toLowerCase();
      const corpusPlaybooks = await getCorpusPlaybooks(supabase, user.id);
      const improveCalibrationData = await getCorpusCalibration(supabase, project.format, (project.genres || [])[0]);

      // Compute deviation metrics for trigger evaluation
      const deviationMetrics: Record<string, number | boolean> = {};
      if (improveCalibrationData && scriptRow) {
        const latestPageEst = (scriptRow as any).latest_page_count_est;
        if (latestPageEst && improveCalibrationData.median_page_count) {
          deviationMetrics.length_deviation = Math.round(((latestPageEst - improveCalibrationData.median_page_count) / improveCalibrationData.median_page_count) * 100);
        }
        if (improveCalibrationData.median_dialogue_ratio && beforeScores.dialogue_score != null) {
          deviationMetrics.dialogue_score = beforeScores.dialogue_score;
        }
        if (improveCalibrationData.median_midpoint_position) {
          deviationMetrics.has_midpoint_data = true;
        }
        if (improveCalibrationData.median_scene_count) {
          deviationMetrics.scene_median = improveCalibrationData.median_scene_count;
        }
        if (improveCalibrationData.p25_page_count) {
          deviationMetrics.p25_pages = improveCalibrationData.p25_page_count;
        }
        if (improveCalibrationData.p75_page_count) {
          deviationMetrics.p75_pages = improveCalibrationData.p75_page_count;
        }
        // Score-based deviations
        if (beforeScores.structural_score != null) deviationMetrics.structural_score = beforeScores.structural_score;
        if (beforeScores.economy_score != null) deviationMetrics.economy_score = beforeScores.economy_score;
        if (beforeScores.budget_score != null) deviationMetrics.budget_score = beforeScores.budget_score;
        if (beforeScores.lane_alignment_score != null) deviationMetrics.lane_alignment_score = beforeScores.lane_alignment_score;
      }

      // Evaluate trigger_conditions for each playbook
      function evaluateTrigger(conditions: string[], metrics: Record<string, number | boolean>): boolean {
        if (!conditions?.length) return false; // no triggers = don't auto-select
        return conditions.some(cond => {
          const c = cond.toLowerCase();
          // Pattern: "length_deviation < -15" or "dialogue_ratio > p75"
          if (c.includes('length_deviation') && metrics.length_deviation != null) {
            if (c.includes('< -') || c.includes('lt')) {
              const threshold = parseInt(c.replace(/[^-\d]/g, '')) || -15;
              return (metrics.length_deviation as number) < threshold;
            }
            if (c.includes('>') || c.includes('gt')) {
              const threshold = parseInt(c.replace(/[^\d]/g, '')) || 15;
              return (metrics.length_deviation as number) > threshold;
            }
          }
          if (c.includes('structural') && c.includes('low') && metrics.structural_score != null) {
            return (metrics.structural_score as number) < 65;
          }
          if (c.includes('dialogue') && (c.includes('low') || c.includes('weak')) && metrics.dialogue_score != null) {
            return (metrics.dialogue_score as number) < 65;
          }
          if (c.includes('economy') && c.includes('low') && metrics.economy_score != null) {
            return (metrics.economy_score as number) < 65;
          }
          if (c.includes('budget') && (c.includes('high') || c.includes('over')) && metrics.budget_score != null) {
            return (metrics.budget_score as number) < 60;
          }
          if (c.includes('scene_count') && c.includes('p25')) return true; // conservative trigger
          if (c.includes('hook') || c.includes('pacing')) return (metrics.structural_score as number || 100) < 70;
          return false;
        });
      }

      let selectedPlaybooks: any[] = [];
      let triggeredPlaybooks: any[] = [];
      if (corpusPlaybooks.length > 0) {
        // First: auto-triggered playbooks (deviation-reactive)
        triggeredPlaybooks = corpusPlaybooks
          .filter((p: any) => {
            const types = (p.applicable_production_types || []).map((t: string) => t.toLowerCase());
            return types.length === 0 || types.includes(pt) || types.includes('film');
          })
          .filter((p: any) => evaluateTrigger(p.trigger_conditions || [], deviationMetrics))
          .slice(0, 2);

        // Second: goal-matched playbooks
        const goalMatched = corpusPlaybooks
          .filter((p: any) => {
            const types = (p.applicable_production_types || []).map((t: string) => t.toLowerCase());
            return types.length === 0 || types.includes(pt) || types.includes('film');
          })
          .filter((p: any) => {
            const targets = p.target_scores || [];
            const goalScoreMap: Record<string, string[]> = {
              make_commercial: ['lane_alignment', 'structural'],
              emotional_impact: ['structural', 'dialogue'],
              tighten_pacing: ['economy', 'structural'],
              character_arcs: ['structural', 'dialogue'],
              sharper_dialogue: ['dialogue'],
              lower_budget: ['budget'],
              more_original: ['lane_alignment'],
            };
            const goalTargets = goalScoreMap[goal] || [];
            return targets.length === 0 || goalTargets.some((g: string) => targets.includes(g));
          })
          .filter((p: any) => !triggeredPlaybooks.some((t: any) => t.name === p.name))
          .slice(0, 2);

        // Combine: triggered first (priority), then goal-matched
        selectedPlaybooks = [...triggeredPlaybooks, ...goalMatched].slice(0, 4);
      }
      
      // Fallback to legacy rewrite_playbooks if no corpus playbooks matched
      if (selectedPlaybooks.length === 0) {
        const { data: playbooks } = await supabase.from("rewrite_playbooks")
          .select("*")
          .or(`production_type.eq.${pt},production_type.eq.film`);
        const goalPlaybookMap: Record<string, string[]> = {
          make_commercial: ['Make It More Commercial', 'Increase Hook Intensity'],
          emotional_impact: ['Boost Protagonist Agency', 'Sharpen Dialogue Voice'],
          tighten_pacing: ['Tighten Act 2 Sag', 'Increase Hook Intensity'],
          character_arcs: ['Boost Protagonist Agency', 'Sharpen Dialogue Voice'],
          sharper_dialogue: ['Reduce On-The-Nose Dialogue', 'Sharpen Dialogue Voice'],
          lower_budget: ['Lower Budget Footprint'],
          more_original: ['Make It More Commercial', 'Boost Protagonist Agency'],
        };
        const targetNames = goalPlaybookMap[goal] || goalPlaybookMap['make_commercial'];
        selectedPlaybooks = (playbooks || []).filter((p: any) => targetNames.some(n => p.name.includes(n))).slice(0, 3);
      }

      // 4) Get user + project preferences
      const { data: userPrefRow } = await supabase.from("user_preferences").select("prefs").eq("owner_id", user.id).single();
      const { data: projPrefRow } = await supabase.from("project_preferences").select("prefs").eq("owner_id", user.id).eq("project_id", projectId).single();
      const userPrefs = (userPrefRow?.prefs || {}) as any;
      const projectPrefs = (projPrefRow?.prefs || {}) as any;

      // ── Inflation Guard: snapshot pre-rewrite viability ──
      const { data: preProject } = await supabase.from("projects")
        .select("viability_score, viability_breakdown")
        .eq("id", projectId).single();
      const preViability = preProject?.viability_score ?? null;
      const preBreakdown = preProject?.viability_breakdown ?? null;

      // 5) Create improvement run record
      const { data: runRow } = await supabase.from("improvement_runs").insert({
        owner_id: user.id, project_id: projectId, script_id: scriptId,
        before_version_id: beforeVersionId, goal, intensity,
        playbooks_used: selectedPlaybooks.map((p: any) => ({ id: p.id, name: p.name })),
        before_scores: beforeScores, status: 'running',
        pre_rewrite_viability: preViability,
        pre_rewrite_breakdown: preBreakdown,
      }).select("id").single();
      const runId = runRow?.id;

      // 6) Generate improved script via AI
      const prompt = getImprovementPrompt(scriptText, beforeScores, project, goal, intensity, selectedPlaybooks, userPrefs, projectPrefs);
      const aiResult = await callAI(prompt, false);
      const resultStr = typeof aiResult === 'string' ? aiResult : JSON.stringify(aiResult);

      let improvedText = resultStr;
      let changesSummary = "";
      let sceneOps: any[] = [];
      const scriptMatch = resultStr.match(/---SCRIPT_START---([\s\S]*?)---SCRIPT_END---/);
      const changesMatch = resultStr.match(/---CHANGES_START---([\s\S]*?)---CHANGES_END---/);
      if (scriptMatch) improvedText = scriptMatch[1].trim();
      if (changesMatch) {
        try {
          const parsed = JSON.parse(changesMatch[1].trim());
          changesSummary = parsed.changes_summary || "";
          sceneOps = parsed.scene_ops || [];
        } catch { changesSummary = changesMatch[1].trim(); }
      }

      // 7) Store improved draft
      const newDraft = (scriptRow?.draft_number || 0) + 1;
      const safeTitle = (project.title || "Untitled").replace(/[^a-zA-Z0-9 _-]/g, "").replace(/\s+/g, "_");
      const path = `scripts/${projectId}/v${scriptRow?.version || 1}/${safeTitle}_Draft_${newDraft}_Improve_${goal}.txt`;
      const encoded = new TextEncoder().encode(improvedText);
      await supabase.storage.from("scripts").upload(path, encoded, { contentType: "text/plain", upsert: true });

      const metrics = computeDraftMetrics(improvedText, project.format);

      await supabase.from("scripts").update({
        status: `DRAFT_${newDraft}`, draft_number: newDraft,
        latest_draft_number: newDraft, latest_batch_storage_path: path,
        latest_page_count_est: metrics.pageCountEst,
        latest_runtime_min_est: metrics.runtimeMinEst,
        latest_runtime_min_low: metrics.runtimeMinLow,
        latest_runtime_min_high: metrics.runtimeMinHigh,
      }).eq("id", scriptId);

      const { data: svRow } = await supabase.from("script_versions").insert({
        script_id: scriptId, draft_number: newDraft,
        full_text_storage_path: path, rewrite_pass: `improve:${goal}`,
        notes: `Self-improvement: ${goal} (${intensity})`,
        word_count: metrics.wordCount, line_count: metrics.lineCount,
        page_count_est: metrics.pageCountEst,
        runtime_min_est: metrics.runtimeMinEst, runtime_min_low: metrics.runtimeMinLow,
        runtime_min_high: metrics.runtimeMinHigh, runtime_per_episode_est: metrics.runtimePerEpisodeEst,
      }).select("id").single();

      // 8) Re-score with corpus calibration + gold baseline
      const improveCalibration = await getCorpusCalibration(supabase, project.format, (project.genres || [])[0]);
      const improveLaneNorm = await getLaneNorm(supabase, project.assigned_lane || "");
      const improveGoldBaseline = await getGoldBaseline(supabase, project.format);
      const scorePrompt = getScoringPrompt(improvedText, project, improveCalibration, improveLaneNorm, improveGoldBaseline);
      const afterScores = await callAI(scorePrompt);

      await supabase.from("scripts").update({
        structural_score: afterScores.structural_score,
        dialogue_score: afterScores.dialogue_score,
        economy_score: afterScores.economy_score,
        budget_score: afterScores.budget_score,
        lane_alignment_score: afterScores.lane_alignment_score,
      }).eq("id", scriptId);

      if (svRow?.id) {
        await supabase.from("script_versions").update({
          structural_score: afterScores.structural_score,
          dialogue_score: afterScores.dialogue_score,
          economy_score: afterScores.economy_score,
          budget_score: afterScores.budget_score,
          lane_alignment_score: afterScores.lane_alignment_score,
        }).eq("id", svRow.id);
      }

      // 9) Compute deltas + regression check
      const deltas: Record<string, number> = {};
      let regression = false;
      for (const k of ['structural_score', 'dialogue_score', 'economy_score', 'budget_score', 'lane_alignment_score']) {
        const before = (beforeScores as any)[k] || 0;
        const after = afterScores[k] || 0;
        deltas[k] = Math.round((after - before) * 10) / 10;
        if ((k === 'structural_score' || k === 'lane_alignment_score') && deltas[k] < -0.7) {
          regression = true;
        }
      }

      // ── Inflation Guard: snapshot post-rewrite viability ──
      const { data: postProject } = await supabase.from("projects")
        .select("viability_score, viability_breakdown")
        .eq("id", projectId).single();
      const postViability = postProject?.viability_score ?? preViability;
      const postBreakdown = postProject?.viability_breakdown ?? null;
      const viabilityDelta = (postViability ?? 0) - (preViability ?? 0);
      const inflationFlag = viabilityDelta >= 20;
      const inflationReason = viabilityDelta >= 30
        ? "Extreme viability jump after rewrite (>=30) — review required"
        : viabilityDelta >= 20
        ? "Large viability jump after rewrite (>=20)"
        : null;

      // 10) Update improvement run
      await supabase.from("improvement_runs").update({
        after_version_id: svRow?.id,
        after_scores: afterScores,
        score_deltas: deltas,
        regression_detected: regression,
        rolled_back: false,
        changes_summary: changesSummary,
        scene_ops: sceneOps,
        status: regression ? 'regression' : 'completed',
        post_rewrite_viability: postViability,
        post_rewrite_breakdown: postBreakdown,
        viability_delta: viabilityDelta,
        inflation_flag: inflationFlag,
        inflation_reason: inflationReason,
      }).eq("id", runId);

      // 11) Record outcome signal
      await supabase.from("outcome_signals").insert({
        owner_id: user.id, project_id: projectId, script_version_id: svRow?.id,
        signal_type: 'COVERAGE_DELTA',
        payload: { goal, intensity, deltas, regression, before: beforeScores, after: afterScores },
      });

      return new Response(JSON.stringify({
        draftNumber: newDraft, storagePath: path, runId,
        beforeScores, afterScores, deltas, regression,
        changesSummary, sceneOps, metrics,
        triggeredPlaybooks: triggeredPlaybooks.map((p: any) => ({ name: p.name, trigger_conditions: p.trigger_conditions })),
        deviationMetrics,
      }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // ═══════════════════════════════════════════
    // ACTION: ROLLBACK
    // ═══════════════════════════════════════════
    if (action === "rollback") {
      if (!scriptId) throw new Error("scriptId required");
      const runId = body.runId;
      if (!runId) throw new Error("runId required for rollback");

      const { data: run } = await supabase.from("improvement_runs")
        .select("before_version_id, before_scores")
        .eq("id", runId).single();

      if (!run?.before_version_id) throw new Error("No previous version to rollback to");

      const { data: beforeVer } = await supabase.from("script_versions")
        .select("draft_number, full_text_storage_path")
        .eq("id", run.before_version_id).single();

      if (beforeVer) {
        const bs = (run.before_scores || {}) as any;
        await supabase.from("scripts").update({
          status: `DRAFT_${beforeVer.draft_number}`,
          draft_number: beforeVer.draft_number,
          latest_draft_number: beforeVer.draft_number,
          latest_batch_storage_path: beforeVer.full_text_storage_path,
          structural_score: bs.structural_score,
          dialogue_score: bs.dialogue_score,
          economy_score: bs.economy_score,
          budget_score: bs.budget_score,
          lane_alignment_score: bs.lane_alignment_score,
        }).eq("id", scriptId);
      }

      await supabase.from("improvement_runs").update({
        rolled_back: true, status: 'rolled_back',
      }).eq("id", runId);

      // Record anti-pattern in project preferences
      const { data: runFull } = await supabase.from("improvement_runs")
        .select("goal, scene_ops").eq("id", runId).single();
      if (runFull) {
        const { data: existingPrefs } = await supabase.from("project_preferences")
          .select("prefs").eq("owner_id", user.id).eq("project_id", projectId).single();
        const currentPrefs = (existingPrefs?.prefs || {}) as any;
        const antiPatterns = currentPrefs.anti_patterns || [];
        antiPatterns.push({ goal: runFull.goal, ops: runFull.scene_ops, reason: 'regression_rollback' });
        await supabase.from("project_preferences").upsert({
          owner_id: user.id, project_id: projectId,
          prefs: { ...currentPrefs, anti_patterns: antiPatterns },
        }, { onConflict: 'owner_id,project_id' });
      }

      return new Response(JSON.stringify({ rolledBack: true }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // ═══════════════════════════════════════════
    // ACTION: LOCK
    // ═══════════════════════════════════════════
    if (action === "lock") {
      if (!scriptId) throw new Error("scriptId required for lock");

      await supabase.from("scripts").update({
        status: "LOCKED", is_current: true,
      }).eq("id", scriptId);

      // Unmark other scripts as not current
      await supabase.from("scripts").update({ is_current: false })
        .eq("project_id", projectId)
        .neq("id", scriptId);

      return new Response(JSON.stringify({ locked: true }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // ═══════════════════════════════════════════
    // ACTION: FETCH-DRAFT (read draft text from storage)
    // ═══════════════════════════════════════════
    if (action === "fetch-draft") {
      const storagePath = body.storagePath;
      if (!storagePath) throw new Error("storagePath required");

      // Try the requested path first
      let { data: fileData, error: dlErr } = await supabase.storage
        .from("scripts")
        .download(storagePath);

      // Fallback: if file not found, try the latest script_version with a valid path
      if (dlErr || !fileData) {
        console.log(`[fetch-draft] Primary path failed (${storagePath}), trying fallback`);
        const { data: svRows } = await supabase.from("script_versions")
          .select("full_text_storage_path")
          .eq("script_id", scriptId || body.scriptId || "")
          .not("full_text_storage_path", "is", null)
          .order("created_at", { ascending: false })
          .limit(5);

        for (const sv of (svRows || [])) {
          if (!sv.full_text_storage_path) continue;
          const fallback = await supabase.storage.from("scripts").download(sv.full_text_storage_path);
          if (fallback.data) {
            fileData = fallback.data;
            console.log(`[fetch-draft] Fallback succeeded: ${sv.full_text_storage_path}`);
            break;
          }
        }
      }

      if (!fileData) throw new Error("Could not download draft — file not found in storage");

      const text = await fileData.text();
      return new Response(JSON.stringify({ text, storagePath }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // ═══════════════════════════════════════════
    // ACTION: IMPORT-TO-DOCS (retroactively import completed draft)
    // ═══════════════════════════════════════════
    if (action === "import-to-docs") {
      if (!scriptId) throw new Error("scriptId required");

      const { data: scriptRow } = await supabase.from("scripts")
        .select("draft_number, version, status, latest_batch_storage_path")
        .eq("id", scriptId).single();

      if (!scriptRow) throw new Error("Script not found");

      const scriptVersion = scriptRow.version || 1;
      const draftNum = scriptRow.draft_number || 1;
      const safeTitle = (project.title || "Untitled").replace(/[^a-zA-Z0-9 _-]/g, "").replace(/\s+/g, "_");

      // Strategy: try latest_batch_storage_path first, then assembled file, then batch files for each draft number
      let fullText = "";

      // 1) Try downloading from latest_batch_storage_path directly
      if (scriptRow.latest_batch_storage_path) {
        const { data: latestFile } = await supabase.storage.from("scripts").download(scriptRow.latest_batch_storage_path);
        if (latestFile) {
          fullText = await latestFile.text();
          console.log(`[import-to-docs] Got text from latest_batch_storage_path: ${fullText.length} chars`);
        }
      }

      // 2) Try script_versions with full_text_storage_path (most recent first)
      if (!fullText) {
        const { data: svRows } = await supabase.from("script_versions")
          .select("full_text_storage_path")
          .eq("script_id", scriptId)
          .not("full_text_storage_path", "is", null)
          .order("created_at", { ascending: false })
          .limit(5);

        for (const sv of (svRows || [])) {
          if (!sv.full_text_storage_path) continue;
          const { data: svFile } = await supabase.storage.from("scripts").download(sv.full_text_storage_path);
          if (svFile) {
            fullText = await svFile.text();
            console.log(`[import-to-docs] Got text from script_version path: ${fullText.length} chars`);
            break;
          }
        }
      }

      // 3) List ALL files in the scripts directory and concatenate batch files (any draft number)
      if (!fullText) {
        const batchDir = `scripts/${projectId}/v${scriptVersion}/`;
        const { data: allFiles } = await supabase.storage.from("scripts")
          .list(batchDir, { sortBy: { column: "name", order: "asc" } });

        const allBatches = (allFiles || [])
          .filter((f: any) => f.name.includes(`_Batch_`) || f.name.includes(`_Rewrite_`))
          .sort((a: any, b: any) => a.name.localeCompare(b.name));

        console.log(`[import-to-docs] Found ${allBatches.length} files in ${batchDir}`);

        for (const file of allBatches) {
          const { data: fileData } = await supabase.storage.from("scripts").download(`${batchDir}${file.name}`);
          if (fileData) {
            const text = await fileData.text();
            fullText += (fullText ? "\n\n" : "") + text;
          }
        }
        console.log(`[import-to-docs] Assembled from files: ${fullText.length} chars`);
      }

      if (!fullText) throw new Error("No draft text found to import");

      const docFileName = `${safeTitle} - Draft ${draftNum}.txt`;
      const docPath = `${user.id}/${Date.now()}-engine-${docFileName.replace(/\s+/g, '_')}`;
      const assembledEncoded = new TextEncoder().encode(fullText);

      const { error: docUploadErr } = await supabase.storage
        .from("project-documents")
        .upload(docPath, assembledEncoded, { contentType: "text/plain", upsert: true });

      if (docUploadErr) throw new Error(`Upload failed: ${docUploadErr.message}`);

      const { data: docRow, error: docInsertErr } = await supabase.from("project_documents").insert({
        project_id: projectId, user_id: user.id,
        file_name: docFileName, file_path: docPath,
        extraction_status: "completed", extracted_text: fullText,
      }).select("id").single();

      if (docInsertErr) throw new Error(`Document record failed: ${docInsertErr.message}`);

      await supabase.from("project_scripts")
        .update({ status: "archived" })
        .eq("project_id", projectId).eq("status", "current");

      await supabase.from("project_scripts").insert({
        project_id: projectId, user_id: user.id,
        version_label: `${project.title || "Untitled"} - Draft ${draftNum} (Engine)`,
        status: "current", file_path: docPath,
        notes: `Imported from Script Engine draft ${draftNum}`,
      });

      return new Response(JSON.stringify({ documentId: docRow?.id, fileName: docFileName }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    throw new Error(`Unknown action: ${action}`);
  } catch (e: any) {
    console.error("script-engine error:", e);
    return new Response(JSON.stringify({ error: e.message }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
