/**
 * trailer-blueprint-engine — Generates editorial trailer blueprints with EDL,
 * rhythm analysis, audio plan, and text card plan from visual units / storyboard panels.
 */
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { callLLM, MODELS, parseJsonSafe } from "../_shared/llm.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function parseUserId(token: string): string {
  const payload = JSON.parse(atob(token.split(".")[1]));
  if (!payload.sub || (payload.exp && payload.exp < Date.now() / 1000)) throw new Error("expired");
  return payload.sub;
}

function adminClient() {
  return createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
}

async function verifyAccess(db: any, userId: string, projectId: string): Promise<boolean> {
  const { data } = await db.rpc("has_project_access", { _user_id: userId, _project_id: projectId });
  return !!data;
}

// ─── Arc Templates ───
const ARC_TEMPLATES: Record<string, any> = {
  teaser: {
    name: "Teaser",
    target_duration_s: 30,
    beats: [
      { role: "hook", duration_range: [2, 4], description: "Striking visual or question" },
      { role: "world", duration_range: [3, 5], description: "Establish world/setting" },
      { role: "intrigue", duration_range: [3, 5], description: "Hint at conflict" },
      { role: "reveal", duration_range: [2, 4], description: "Character or twist reveal" },
      { role: "title_card", duration_range: [3, 5], description: "Title + release info" },
    ],
  },
  main: {
    name: "Main Trailer",
    target_duration_s: 90,
    beats: [
      { role: "cold_open", duration_range: [3, 5], description: "Provocative opening image or line" },
      { role: "world_establish", duration_range: [5, 8], description: "Set the world, genre, tone" },
      { role: "protagonist_intro", duration_range: [4, 7], description: "Meet the lead" },
      { role: "inciting_incident", duration_range: [4, 6], description: "The thing that changes everything" },
      { role: "rising_action_1", duration_range: [5, 8], description: "Stakes escalate" },
      { role: "rising_action_2", duration_range: [5, 8], description: "Complications, obstacles" },
      { role: "montage_peak", duration_range: [8, 15], description: "Fast-cut montage of spectacle" },
      { role: "emotional_beat", duration_range: [4, 6], description: "Quiet moment / emotional core" },
      { role: "climax_tease", duration_range: [5, 8], description: "Biggest visual spectacle hint" },
      { role: "stinger", duration_range: [2, 4], description: "Final surprise or button" },
      { role: "title_card", duration_range: [4, 6], description: "Title + date + credits" },
    ],
  },
  character: {
    name: "Character Trailer",
    target_duration_s: 60,
    beats: [
      { role: "character_intro", duration_range: [3, 5], description: "Who is this person?" },
      { role: "ordinary_world", duration_range: [4, 7], description: "Their world before" },
      { role: "call_to_action", duration_range: [3, 5], description: "What drives them" },
      { role: "struggle", duration_range: [5, 8], description: "Their obstacles" },
      { role: "transformation", duration_range: [4, 7], description: "How they change" },
      { role: "declaration", duration_range: [3, 5], description: "Defining moment/line" },
      { role: "title_card", duration_range: [3, 5], description: "Title card" },
    ],
  },
  tone: {
    name: "Tone Piece",
    target_duration_s: 45,
    beats: [
      { role: "atmosphere", duration_range: [5, 8], description: "Pure mood/texture" },
      { role: "world_detail", duration_range: [4, 7], description: "Specific visual details" },
      { role: "tension_build", duration_range: [5, 8], description: "Slow build of unease/wonder" },
      { role: "rupture", duration_range: [3, 5], description: "Something breaks the mood" },
      { role: "aftermath", duration_range: [4, 6], description: "New state / question mark" },
      { role: "title_card", duration_range: [3, 5], description: "Title card" },
    ],
  },
};

// ─── Generator Hint (two-provider routing: Veo + Runway) ───

function buildGeneratorHint(params: {
  role: string;
  durationS: number;
  clipSpec: any;
}) {
  const { role, durationS, clipSpec } = params;

  // Hero beats => Runway. Default => Veo (Google).
  const heroRoles = [
    "hook", "cold_open", "climax_tease", "stinger", "montage_peak",
    "rupture", "inciting_incident", "transformation", "declaration",
  ];
  const isHero = heroRoles.includes(role);

  const preferredProvider = isHero ? "runway" : "veo";

  // Spend more candidates on hero beats
  const candidates =
    (role === "montage_peak" || role === "climax_tease") ? 3 :
    (role === "hook" || role === "cold_open" || role === "stinger") ? 2 :
    (role === "inciting_incident" || role === "rupture") ? 2 : 1;

  return {
    preferred_provider: preferredProvider,
    preferred_mode: "text_to_video" as const,
    candidates,
    length_ms: Math.round(durationS * 1000),
    aspect_ratio: "16:9",
    fps: 24,
    style_lock: true,
    init_images: {
      source: "storyboard_best_frame",
      frame_paths: [] as string[],
    },
  };
}

// ─── Actions ───

async function handleCreateBlueprint(db: any, body: any, userId: string, apiKey: string) {
  const { projectId, storyboardRunId, arcType = "main", options = {} } = body;

  const template = ARC_TEMPLATES[arcType];
  if (!template) return json({ error: `Unknown arc type: ${arcType}. Use: ${Object.keys(ARC_TEMPLATES).join(", ")}` }, 400);

  // Get project info
  const { data: project } = await db.from("projects").select("title, genre, format, logline").eq("id", projectId).single();

  // Get visual units / panels for context
  let panelContext = "";
  if (storyboardRunId) {
    const { data: panels } = await db.from("storyboard_panels")
      .select("unit_key, panel_index, panel_payload")
      .eq("run_id", storyboardRunId)
      .order("unit_key").order("panel_index");
    if (panels?.length) {
      panelContext = panels.map((p: any) => {
        const pp = p.panel_payload || {};
        return `[${p.unit_key} #${p.panel_index}] ${pp.shot_type || ""} ${pp.camera || ""} — ${pp.action || ""} (${pp.mood || ""})`;
      }).join("\n");
    }
  }

  // Get canonical units for broader context
  const { data: units } = await db.from("visual_units")
    .select("unit_key, canonical_payload")
    .eq("project_id", projectId)
    .order("unit_key");

  const unitContext = (units || []).map((u: any) => {
    const p = u.canonical_payload || {};
    return `${u.unit_key}: ${p.logline || ""} | trailer_value=${p.trailer_value || 0} | tone=${(p.tone || []).join(",")} | setpieces=${(p.setpieces || []).join(",")}`;
  }).join("\n");

  // Insert blueprint row
  const { data: bp, error: bpErr } = await db.from("trailer_blueprints").insert({
    project_id: projectId,
    storyboard_run_id: storyboardRunId || null,
    arc_type: arcType,
    status: "generating",
    options,
    created_by: userId,
  }).select().single();
  if (bpErr) return json({ error: bpErr.message }, 500);

  try {
    const systemPrompt = `You are an award-winning trailer editor. Given a project's visual units and storyboard panels, create an editorial blueprint for a ${template.name} (target ${template.target_duration_s}s).

The arc template has these beat slots:
${template.beats.map((b: any, i: number) => `${i}. ${b.role} (${b.duration_range[0]}-${b.duration_range[1]}s): ${b.description}`).join("\n")}

Return STRICT JSON only:
{
  "edl": [
    {
      "beat_index": 0,
      "role": "hook",
      "unit_key": "string or null",
      "panel_ref": "unit_key #panel_index or null",
      "duration_s": 3.5,
      "clip_spec": {
        "shot_type": "CU",
        "camera_move": "slow push in",
        "action_description": "what happens in this beat",
        "visual_prompt": "image/video generation prompt for this specific beat",
        "audio_cue": "music swell / silence / sfx description",
        "text_overlay": "optional on-screen text or null"
      }
    }
  ],
  "rhythm_analysis": {
    "avg_beat_duration_s": 4.2,
    "fastest_beat_s": 1.5,
    "slowest_beat_s": 8,
    "cut_density": "medium",
    "location_variety_score": 0.8,
    "shot_size_variety_score": 0.7,
    "warnings": ["string"]
  },
  "audio_plan": {
    "music_cues": [
      { "beat_range": [0, 3], "description": "atmospheric drone", "genre": "ambient", "energy": "low" }
    ],
    "sfx_cues": [
      { "beat_index": 5, "description": "impact hit", "timing": "on cut" }
    ],
    "vo_lines": [
      { "beat_index": 2, "line": "optional voiceover text", "character": "narrator or character name" }
    ]
  },
  "text_card_plan": [
    { "beat_index": 10, "text": "COMING SOON", "style": "fade_in", "duration_s": 3 }
  ]
}

Rules:
- Assign unit_keys to beats where they match best (by trailer_value, tone, content)
- Vary shot sizes: no more than 2 consecutive same shot_type
- Vary locations: flag if same location appears 3+ consecutive beats
- Match rhythm to arc: slow open, build pace, peak at montage, slow for emotional, punch for stinger
- Include at least one text card and one title card
- audio_cue in clip_spec is per-beat, audio_plan is the global music/sfx design
- Duration must sum to approximately ${template.target_duration_s}s (±15%)`;

    const userPrompt = `Project: ${project?.title || "Untitled"}\nGenre: ${project?.genre || "Drama"}\nFormat: ${project?.format || "Feature"}\nLogline: ${project?.logline || ""}\n\n--- Visual Units ---\n${unitContext.slice(0, 6000)}\n\n--- Storyboard Panels ---\n${panelContext.slice(0, 6000)}`;

    const result = await callLLM({
      apiKey,
      model: MODELS.PRO,
      system: systemPrompt,
      user: userPrompt,
      temperature: 0.4,
      maxTokens: 12000,
    });

    const parsed = await parseJsonSafe(result.content, apiKey);

    // Inject deterministic generator_hint into each EDL beat
    const enrichedEdl = (parsed.edl || []).map((beat: any) => ({
      ...beat,
      generator_hint: buildGeneratorHint({
        role: beat.role || "",
        durationS: beat.duration_s || 3,
        clipSpec: beat.clip_spec || {},
      }),
    }));

    await db.from("trailer_blueprints").update({
      status: "complete",
      edl: enrichedEdl,
      rhythm_analysis: parsed.rhythm_analysis || {},
      audio_plan: parsed.audio_plan || {},
      text_card_plan: parsed.text_card_plan || [],
    }).eq("id", bp.id);

    return json({ ok: true, blueprintId: bp.id, beatCount: (parsed.edl || []).length });
  } catch (err: any) {
    await db.from("trailer_blueprints").update({ status: "failed", error: err.message }).eq("id", bp.id);
    if (err.message === "RATE_LIMIT") return json({ error: "Rate limit exceeded" }, 429);
    if (err.message === "PAYMENT_REQUIRED") return json({ error: "AI credits exhausted" }, 402);
    return json({ error: err.message }, 500);
  }
}

async function handleListBlueprints(db: any, body: any) {
  const { projectId, limit = 20 } = body;
  const { data } = await db.from("trailer_blueprints").select("*")
    .eq("project_id", projectId).order("created_at", { ascending: false }).limit(limit);
  return json({ blueprints: data || [] });
}

async function handleGetBlueprint(db: any, body: any) {
  const { projectId, blueprintId } = body;
  if (!blueprintId) return json({ error: "blueprintId required" }, 400);
  const { data } = await db.from("trailer_blueprints").select("*")
    .eq("id", blueprintId).eq("project_id", projectId).single();
  if (!data) return json({ error: "Blueprint not found" }, 404);
  return json({ blueprint: data });
}

async function handleGetArcTemplates(_db: any, _body: any) {
  return json({ templates: ARC_TEMPLATES });
}

// ─── Main handler ───
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const authHeader = req.headers.get("Authorization") || "";
    if (!authHeader.startsWith("Bearer ")) return json({ error: "Unauthorized" }, 401);
    const token = authHeader.replace("Bearer ", "");
    let userId: string;
    try { userId = parseUserId(token); } catch { return json({ error: "Invalid token" }, 401); }

    const body = await req.json();
    const action = body.action;
    const projectId = body.projectId || body.project_id;
    if (!projectId && action !== "get_arc_templates") return json({ error: "projectId required" }, 400);

    const db = adminClient();

    if (projectId) {
      const hasAccess = await verifyAccess(db, userId, projectId);
      if (!hasAccess) return json({ error: "Forbidden" }, 403);
    }

    const apiKey = Deno.env.get("LOVABLE_API_KEY") || "";

    switch (action) {
      case "create_blueprint": return await handleCreateBlueprint(db, body, userId, apiKey);
      case "list_blueprints": return await handleListBlueprints(db, body);
      case "get_blueprint": return await handleGetBlueprint(db, body);
      case "get_arc_templates": return await handleGetArcTemplates(db, body);
      default: return json({ error: `Unknown action: ${action}` }, 400);
    }
  } catch (err: any) {
    console.error("trailer-blueprint-engine error:", err);
    return json({ error: err.message || "Internal error" }, 500);
  }
});
