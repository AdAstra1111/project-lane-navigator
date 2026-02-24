/**
 * trailer-continuity-engine — Continuity Intelligence v1
 *
 * Actions:
 *   tag_clips_continuity_v1      — infer continuity tags per clip from metadata
 *   run_continuity_judge_v1      — score adjacency transitions
 *   build_continuity_fix_plan_v1 — generate non-destructive fix plan
 *   apply_continuity_fix_plan_v1 — apply fix plan to cut (dry-run or live)
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

// ─── Default continuity settings ───
const DEFAULT_SETTINGS = {
  direction_weight: 0.25,
  eyeline_weight: 0.20,
  lighting_weight: 0.15,
  palette_weight: 0.10,
  energy_weight: 0.20,
  pacing_weight: 0.10,
  min_transition_score: 0.60,
  allow_intentional_breaks: true,
  break_allowed_phases: ["twist", "crescendo"],
};

// ═══════════════════════════════════════════════════════
// ACTION: tag_clips_continuity_v1
// ═══════════════════════════════════════════════════════

async function handleTagClips(db: any, body: any, userId: string, apiKey: string) {
  const { projectId, clipRunId, blueprintId, limit = 60 } = body;
  if (!clipRunId && !blueprintId) return json({ error: "clipRunId or blueprintId required" }, 400);

  // Load clips needing tags
  let query = db.from("trailer_clips")
    .select("id, beat_index, gen_params, provider, duration_ms, rating, media_type")
    .eq("project_id", projectId)
    .is("continuity_tags_json", null)
    .order("beat_index")
    .limit(limit);

  if (blueprintId) query = query.eq("blueprint_id", blueprintId);

  const { data: clips, error: clipErr } = await query;
  if (clipErr) throw new Error(clipErr.message);
  if (!clips || clips.length === 0) return json({ tagged: 0, message: "No untagged clips found" });

  // Load shot specs if available
  const shotSpecIds = clips.map((c: any) => c.gen_params?.shot_spec_id).filter(Boolean);
  let shotSpecMap: Record<string, any> = {};
  if (shotSpecIds.length > 0) {
    const { data: specs } = await db.from("trailer_shot_specs")
      .select("id, camera_move, lens_mm, movement_intensity, depth_strategy, transition_in, transition_out, shot_type, phase")
      .in("id", [...new Set(shotSpecIds)]);
    if (specs) {
      for (const s of specs) shotSpecMap[s.id] = s;
    }
  }

  // Batch clips for LLM (groups of 10)
  const batchSize = 10;
  let taggedCount = 0;

  for (let i = 0; i < clips.length; i += batchSize) {
    const batch = clips.slice(i, i + batchSize);
    const clipDescriptions = batch.map((clip: any) => {
      const spec = shotSpecMap[clip.gen_params?.shot_spec_id] || {};
      return {
        clip_id: clip.id,
        beat_index: clip.beat_index,
        camera_move: spec.camera_move || clip.gen_params?.camera_move || "unknown",
        shot_type: spec.shot_type || clip.gen_params?.shot_type || "unknown",
        lens_mm: spec.lens_mm || null,
        movement_intensity: spec.movement_intensity || clip.gen_params?.movement_intensity || 5,
        depth_strategy: spec.depth_strategy || null,
        transition_in: spec.transition_in || null,
        transition_out: spec.transition_out || null,
        phase: spec.phase || clip.gen_params?.phase || "unknown",
        generation_profile: clip.gen_params?.generation_profile || "standard",
        motion_score: clip.gen_params?.motion_score || null,
        clarity_score: clip.gen_params?.clarity_score || null,
        provider: clip.provider,
        duration_ms: clip.duration_ms,
        visual_prompt: clip.gen_params?.visual_prompt?.slice(0, 200) || "",
      };
    });

    const system = `You are a continuity analysis engine for film trailer editing.
Given clip metadata (camera moves, shot types, phases, generation parameters), infer cinematographic continuity tags.

Output STRICT JSON array with one object per clip. Each object:
{
  "clip_id": "<uuid>",
  "screen_direction": "left_to_right|right_to_left|static|unknown",
  "subject_facing": "left|right|front|back|unknown",
  "camera_energy": <0-10>,
  "motion_level": <0-10>,
  "cut_friendly": <true|false>,
  "dominant_lighting": "low_key|high_key|mixed|unknown",
  "key_direction": "left|right|top|back|unknown",
  "palette_temp": "cool|warm|neutral|unknown",
  "contrast_level": <0-10>,
  "shot_scale": "wide|medium|close|macro|unknown",
  "movement_type": "push_in|pull_out|track|arc|handheld|whip_pan|crane|static|unknown",
  "stability": <0-10>,
  "notes": ["string"]
}

Rules:
- If camera_move is "track" or "arc", infer screen_direction from the prompt if directional cues exist; else "unknown".
- High movement_intensity + whip_pan = high camera_energy (8+).
- Horror/thriller phases = tend toward "low_key". Comedy = "high_key".
- shot_type "close-up"/"ECU" = shot_scale "close". "wide"/"establishing" = "wide".
- push_in = push_in, pull_back = pull_out, handheld/documentary = handheld.
- cut_friendly = true if transition_out is "cut" or null; false for complex transitions.
- Never hallucinate story facts. Tags describe cinematography only.
- Return ONLY the JSON array, no commentary.`;

    const result = await callLLM({
      apiKey,
      model: MODELS.FAST,
      system,
      user: JSON.stringify(clipDescriptions),
      temperature: 0.1,
      maxTokens: 4000,
    });

    const tags = await parseJsonSafe(result.content, apiKey);
    const tagsArray = Array.isArray(tags) ? tags : [tags];

    for (const tag of tagsArray) {
      if (!tag.clip_id) continue;
      const { clip_id, ...tagData } = tag;
      await db.from("trailer_clips").update({
        continuity_tags_json: tagData,
        continuity_scored_at: new Date().toISOString(),
        continuity_version: "v1",
      }).eq("id", clip_id).eq("project_id", projectId);
      taggedCount++;
    }
  }

  return json({ tagged: taggedCount, total: clips.length });
}

// ═══════════════════════════════════════════════════════
// ACTION: run_continuity_judge_v1
// ═══════════════════════════════════════════════════════

async function handleRunJudge(db: any, body: any, userId: string, apiKey: string) {
  const { projectId, trailerCutId, continuitySettings } = body;
  if (!trailerCutId) return json({ error: "trailerCutId required" }, 400);

  const settings = { ...DEFAULT_SETTINGS, ...continuitySettings };

  // Create run
  const { data: run, error: runErr } = await db.from("trailer_continuity_runs").insert({
    project_id: projectId,
    trailer_cut_id: trailerCutId,
    status: "running",
    method: "llm_v1",
    settings_json: settings,
    created_by: userId,
  }).select("id").single();
  if (runErr) throw new Error(runErr.message);
  const runId = run.id;

  try {
    // Load cut timeline
    const { data: cut, error: cutErr } = await db.from("trailer_cuts")
      .select("id, timeline, blueprint_id")
      .eq("id", trailerCutId)
      .eq("project_id", projectId)
      .single();
    if (cutErr || !cut) throw new Error("Cut not found");

    const timeline = cut.timeline || [];
    if (timeline.length < 2) {
      await db.from("trailer_continuity_runs").update({
        status: "complete",
        summary_json: { avg_transition_score: 1.0, worst_transitions: [], recommended_actions: [], message: "Less than 2 beats" },
      }).eq("id", runId);
      return json({ runId, avgScore: 1.0, transitionCount: 0 });
    }

    // Load clips with continuity tags
    const clipIds = timeline.map((t: any) => t.clip_id).filter(Boolean);
    let clipMap: Record<string, any> = {};
    if (clipIds.length > 0) {
      const { data: clips } = await db.from("trailer_clips")
        .select("id, beat_index, continuity_tags_json, gen_params")
        .in("id", clipIds);
      if (clips) {
        for (const c of clips) clipMap[c.id] = c;
      }
    }

    // Score adjacent pairs
    const scores: any[] = [];
    const pairs: any[] = [];

    for (let i = 0; i < timeline.length - 1; i++) {
      const from = timeline[i];
      const to = timeline[i + 1];
      const fromClip = clipMap[from.clip_id] || null;
      const toClip = clipMap[to.clip_id] || null;
      const fromTags = fromClip?.continuity_tags_json || {};
      const toTags = toClip?.continuity_tags_json || {};

      pairs.push({
        from_beat: from.beat_index ?? i,
        to_beat: to.beat_index ?? i + 1,
        from_clip_id: from.clip_id,
        to_clip_id: to.clip_id,
        from_tags: fromTags,
        to_tags: toTags,
        from_role: from.role || "unknown",
        to_role: to.role || "unknown",
      });
    }

    // LLM-assisted scoring in batches of 15
    const pairBatchSize = 15;
    for (let i = 0; i < pairs.length; i += pairBatchSize) {
      const batch = pairs.slice(i, i + pairBatchSize);

      const system = `You are a continuity judge for film trailer editing.
For each adjacent beat pair, compute subscores (0.0-1.0) and identify issues.

Output STRICT JSON array:
[{
  "pair_index": <int>,
  "subscores": {
    "directional": <0-1>,
    "eyeline": <0-1>,
    "lighting": <0-1>,
    "palette": <0-1>,
    "energy": <0-1>,
    "pacing": <0-1>
  },
  "issues": [{"type": "<eyeline_break|direction_reversal|lighting_jump|palette_whiplash|energy_drop|pacing_mismatch>", "detail": "<string>"}],
  "suggestion": {"action": "swap_clip|adjust_trim|insert_breath|reorder|none", "reason": "<string>"} | null
}]

Scoring rules:
- directional: penalize hard L→R then R→L reversal (0.3) unless both unknown (0.8) or intentional break phase
- eyeline: penalize same-facing in dialogue beats (0.4); montage = more lenient (0.7)
- lighting: penalize high_key→low_key jump (0.3); gradual shift OK (0.7)
- palette: penalize warm→cool whiplash (0.4); neutral transitions lenient (0.8)
- energy: prefer rising energy toward twist/crescendo; penalize >3 point energy drop (0.3)
- pacing: penalize wide→macro without transition (0.4); medium→close = fine (0.9)
- If tags are mostly unknown, default subscores to 0.7 (unknown = neutral)
- Return ONLY JSON array.`;

      const result = await callLLM({
        apiKey,
        model: MODELS.FAST,
        system,
        user: JSON.stringify(batch.map((p: any, idx: number) => ({ pair_index: idx, ...p }))),
        temperature: 0.1,
        maxTokens: 4000,
      });

      const parsed = await parseJsonSafe(result.content, apiKey);
      const results = Array.isArray(parsed) ? parsed : [parsed];

      for (const r of results) {
        const pairIdx = r.pair_index ?? 0;
        const pair = batch[pairIdx];
        if (!pair) continue;

        const sub = r.subscores || {};
        const weighted =
          (sub.directional || 0.7) * settings.direction_weight +
          (sub.eyeline || 0.7) * settings.eyeline_weight +
          (sub.lighting || 0.7) * settings.lighting_weight +
          (sub.palette || 0.7) * settings.palette_weight +
          (sub.energy || 0.7) * settings.energy_weight +
          (sub.pacing || 0.7) * settings.pacing_weight;

        const scoreRow = {
          continuity_run_id: runId,
          project_id: projectId,
          trailer_cut_id: trailerCutId,
          from_beat_index: pair.from_beat,
          to_beat_index: pair.to_beat,
          from_clip_id: pair.from_clip_id || null,
          to_clip_id: pair.to_clip_id || null,
          score: Math.round(weighted * 1000) / 1000,
          subscores_json: sub,
          issues_json: r.issues || [],
          suggestion_json: r.suggestion || null,
          created_by: userId,
        };

        scores.push(scoreRow);
      }
    }

    // Insert all scores
    if (scores.length > 0) {
      await db.from("trailer_continuity_scores").insert(scores);
    }

    // Build summary
    const avgScore = scores.length > 0
      ? Math.round((scores.reduce((s: number, r: any) => s + r.score, 0) / scores.length) * 1000) / 1000
      : 1.0;

    const worst = [...scores]
      .sort((a: any, b: any) => a.score - b.score)
      .slice(0, 5)
      .map((s: any) => ({
        from_beat: s.from_beat_index,
        to_beat: s.to_beat_index,
        score: s.score,
        issues: s.issues_json,
      }));

    const allSuggestions = scores
      .filter((s: any) => s.suggestion_json?.action && s.suggestion_json.action !== "none")
      .map((s: any) => s.suggestion_json);

    const summary = {
      avg_transition_score: avgScore,
      transition_count: scores.length,
      worst_transitions: worst,
      recommended_actions: allSuggestions.slice(0, 10),
    };

    await db.from("trailer_continuity_runs").update({
      status: "complete",
      summary_json: summary,
    }).eq("id", runId);

    // Log event
    await db.from("trailer_continuity_events").insert({
      project_id: projectId,
      continuity_run_id: runId,
      event_type: "judge_complete",
      payload: { avg_score: avgScore, transition_count: scores.length },
      created_by: userId,
    });

    return json({ runId, avgScore, transitionCount: scores.length, worstTransitions: worst, summary });

  } catch (err: any) {
    await db.from("trailer_continuity_runs").update({
      status: "failed",
      error: err.message,
    }).eq("id", runId);
    throw err;
  }
}

// ═══════════════════════════════════════════════════════
// ACTION: build_continuity_fix_plan_v1
// ═══════════════════════════════════════════════════════

async function handleBuildFixPlan(db: any, body: any, userId: string, apiKey: string) {
  const { projectId, trailerCutId, continuityRunId } = body;
  if (!trailerCutId || !continuityRunId) return json({ error: "trailerCutId and continuityRunId required" }, 400);

  // Load scores
  const { data: scores } = await db.from("trailer_continuity_scores")
    .select("*")
    .eq("continuity_run_id", continuityRunId)
    .order("from_beat_index");

  if (!scores || scores.length === 0) return json({ error: "No continuity scores found for this run" }, 400);

  // Load cut timeline
  const { data: cut } = await db.from("trailer_cuts")
    .select("id, timeline, blueprint_id")
    .eq("id", trailerCutId)
    .eq("project_id", projectId)
    .single();
  if (!cut) return json({ error: "Cut not found" }, 404);

  // Load alternative clips for potential swaps
  const blueprintId = cut.blueprint_id;
  const beatIndicesWithIssues = scores
    .filter((s: any) => s.score < 0.6)
    .flatMap((s: any) => [s.from_beat_index, s.to_beat_index]);
  const uniqueBeats = [...new Set(beatIndicesWithIssues)];

  let altClipMap: Record<number, any[]> = {};
  if (blueprintId && uniqueBeats.length > 0) {
    const { data: altClips } = await db.from("trailer_clips")
      .select("id, beat_index, continuity_tags_json, gen_params, rating")
      .eq("project_id", projectId)
      .eq("blueprint_id", blueprintId)
      .in("beat_index", uniqueBeats)
      .order("rating", { ascending: false, nullsFirst: false });
    if (altClips) {
      for (const c of altClips) {
        if (!altClipMap[c.beat_index]) altClipMap[c.beat_index] = [];
        altClipMap[c.beat_index].push(c);
      }
    }
  }

  // Build context for LLM
  const problemTransitions = scores
    .filter((s: any) => s.score < 0.65)
    .map((s: any) => ({
      from_beat: s.from_beat_index,
      to_beat: s.to_beat_index,
      score: s.score,
      issues: s.issues_json,
      suggestion: s.suggestion_json,
      alt_clips_from: (altClipMap[s.from_beat_index] || []).slice(0, 3).map((c: any) => ({
        id: c.id, tags: c.continuity_tags_json, rating: c.rating,
      })),
      alt_clips_to: (altClipMap[s.to_beat_index] || []).slice(0, 3).map((c: any) => ({
        id: c.id, tags: c.continuity_tags_json, rating: c.rating,
      })),
    }));

  if (problemTransitions.length === 0) {
    return json({ actions: [], confidence: 1.0, message: "No transitions below threshold" });
  }

  const system = `You are a continuity fix planner for film trailers.
Given problematic transitions with scores and available alternate clips, produce a fix plan.

Output STRICT JSON:
{
  "actions": [
    { "type": "swap_clip", "beat_index": <int>, "from_clip_id": "<uuid>", "to_clip_id": "<uuid>", "reason": "<string>" },
    { "type": "adjust_trim", "beat_index": <int>, "trim_in_delta_ms": <int>, "reason": "<string>" },
    { "type": "insert_breath", "between_beats": [<int>,<int>], "silence_ms": <int>, "reason": "<string>" },
    { "type": "reorder_beats", "from_index": <int>, "to_index": <int>, "reason": "<string>" }
  ],
  "confidence": <0.0-1.0>
}

Rules:
- Only swap within the same beat (choose the best alternate candidate clip).
- Prefer candidates with higher rating AND better continuity match.
- adjust_trim: keep within ±300ms.
- insert_breath: 150-400ms silence, only between beats where energy needs resetting.
- reorder_beats: suggest only if absolutely necessary (lighting/palette progression).
- Maximum 8 actions total.
- Return ONLY JSON.`;

  const result = await callLLM({
    apiKey,
    model: MODELS.FAST,
    system,
    user: JSON.stringify({ problem_transitions: problemTransitions, timeline_length: cut.timeline?.length || 0 }),
    temperature: 0.2,
    maxTokens: 3000,
  });

  const plan = await parseJsonSafe(result.content, apiKey);

  // Log event
  await db.from("trailer_continuity_events").insert({
    project_id: projectId,
    continuity_run_id: continuityRunId,
    event_type: "fix_plan_generated",
    payload: { action_count: plan.actions?.length || 0, confidence: plan.confidence },
    created_by: userId,
  });

  return json(plan);
}

// ═══════════════════════════════════════════════════════
// ACTION: apply_continuity_fix_plan_v1
// ═══════════════════════════════════════════════════════

async function handleApplyFixPlan(db: any, body: any, userId: string) {
  const { projectId, trailerCutId, continuityRunId, plan, dryRun = true } = body;
  if (!trailerCutId || !plan) return json({ error: "trailerCutId and plan required" }, 400);

  const actions = plan.actions || [];
  if (actions.length === 0) return json({ applied: 0, diff: [] });

  // Load cut
  const { data: cut } = await db.from("trailer_cuts")
    .select("id, timeline")
    .eq("id", trailerCutId)
    .eq("project_id", projectId)
    .single();
  if (!cut) return json({ error: "Cut not found" }, 404);

  const timeline = [...(cut.timeline || [])];
  const diff: any[] = [];

  for (const action of actions) {
    switch (action.type) {
      case "swap_clip": {
        const entry = timeline.find((t: any) => (t.beat_index ?? -1) === action.beat_index);
        if (entry && entry.clip_id !== action.to_clip_id) {
          // Check manual lock
          if (entry.locked) {
            diff.push({ ...action, skipped: true, reason: "beat locked" });
            continue;
          }
          diff.push({
            type: "swap_clip",
            beat_index: action.beat_index,
            old_clip_id: entry.clip_id,
            new_clip_id: action.to_clip_id,
            reason: action.reason,
          });
          if (!dryRun) {
            entry.clip_id = action.to_clip_id;
          }
        }
        break;
      }
      case "adjust_trim": {
        const entry = timeline.find((t: any) => (t.beat_index ?? -1) === action.beat_index);
        if (entry) {
          if (entry.locked) {
            diff.push({ ...action, skipped: true, reason: "beat locked" });
            continue;
          }
          const oldTrimIn = entry.trim_in_ms || 0;
          const newTrimIn = oldTrimIn + (action.trim_in_delta_ms || 0);
          diff.push({
            type: "adjust_trim",
            beat_index: action.beat_index,
            old_trim_in: oldTrimIn,
            new_trim_in: Math.max(0, newTrimIn),
            reason: action.reason,
          });
          if (!dryRun) {
            entry.trim_in_ms = Math.max(0, newTrimIn);
          }
        }
        break;
      }
      case "insert_breath": {
        diff.push({
          type: "insert_breath",
          between_beats: action.between_beats,
          silence_ms: action.silence_ms,
          reason: action.reason,
          note: "Breath insertion is a suggestion — implement via silence window in audio plan",
        });
        break;
      }
      case "reorder_beats": {
        diff.push({
          type: "reorder_beats",
          from_index: action.from_index,
          to_index: action.to_index,
          reason: action.reason,
          note: "Reorder suggestions require manual confirmation",
          skipped: dryRun,
        });
        break;
      }
    }
  }

  if (!dryRun) {
    // Save updated timeline
    await db.from("trailer_cuts").update({ timeline }).eq("id", trailerCutId);

    // Log event
    if (continuityRunId) {
      await db.from("trailer_continuity_events").insert({
        project_id: projectId,
        continuity_run_id: continuityRunId,
        event_type: "continuity_fix_applied",
        payload: { actions_applied: diff.filter((d: any) => !d.skipped).length, diff },
        created_by: userId,
      });
    }
  }

  return json({
    applied: dryRun ? 0 : diff.filter((d: any) => !d.skipped).length,
    dryRun,
    diff,
  });
}

// ═══════════════════════════════════════════════════════
// MAIN HANDLER
// ═══════════════════════════════════════════════════════

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
    if (!projectId) return json({ error: "projectId required" }, 400);

    const db = adminClient();
    const hasAccess = await verifyAccess(db, userId, projectId);
    if (!hasAccess) return json({ error: "Forbidden" }, 403);

    const apiKey = Deno.env.get("LOVABLE_API_KEY") || "";

    switch (action) {
      case "tag_clips_continuity_v1":
        return await handleTagClips(db, body, userId, apiKey);
      case "run_continuity_judge_v1":
        return await handleRunJudge(db, body, userId, apiKey);
      case "build_continuity_fix_plan_v1":
        return await handleBuildFixPlan(db, body, userId, apiKey);
      case "apply_continuity_fix_plan_v1":
        return await handleApplyFixPlan(db, body, userId);
      default:
        return json({ error: `Unknown action: ${action}` }, 400);
    }
  } catch (err: any) {
    console.error("trailer-continuity-engine error:", err);
    if (err.message === "RATE_LIMIT") return json({ error: "Rate limit exceeded" }, 429);
    if (err.message === "PAYMENT_REQUIRED") return json({ error: "AI credits exhausted" }, 402);
    return json({ error: err.message || "Internal error" }, 500);
  }
});
