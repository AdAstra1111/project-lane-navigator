/**
 * trailer-cinematic-engine — Cinematic Intelligence Layer v2
 * 
 * Actions:
 *   create_trailer_script_v2
 *   create_rhythm_grid_v2
 *   create_shot_design_v2
 *   run_cinematic_judge_v2
 *   repair_trailer_script_v2
 *   start_clip_generation_from_shot_specs
 *   create_full_cinematic_trailer_plan  (orchestrator: runs 1-4 sequentially)
 */
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { callLLM, MODELS, parseJsonSafe, composeSystem } from "../_shared/llm.ts";
import { compileTrailerContext } from "../_shared/trailerContext.ts";

// ─── Helpers ───

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

/** Deterministic seed: use provided or generate */
function resolveSeed(seed?: string): string {
  return seed || `cs-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

/** Mulberry32 PRNG for deterministic randomness */
function mulberry32(seed: string): () => number {
  let h = 0;
  for (let i = 0; i < seed.length; i++) {
    h = Math.imul(h ^ seed.charCodeAt(i), 2654435761);
  }
  return () => {
    h |= 0; h = h + 0x6D2B79F5 | 0;
    let t = Math.imul(h ^ h >>> 15, 1 | h);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}

// ─── Phase definitions ───
const PHASES_ORDERED = ["hook", "setup", "escalation", "twist", "crescendo", "button"] as const;

// ─── Gate checks ───

interface GateResult { passed: boolean; failures: string[]; }

function runScriptGates(beats: any[]): GateResult {
  const failures: string[] = [];

  // Gate 1: All beats must have source_refs_json with at least 1 entry
  const missingRefs = beats.filter((b: any) => !b.source_refs_json || (Array.isArray(b.source_refs_json) && b.source_refs_json.length === 0));
  if (missingRefs.length > 0) {
    failures.push(`${missingRefs.length} beat(s) missing source citations (source_refs_json empty): indices ${missingRefs.map((b: any) => b.beat_index).join(", ")}`);
  }

  // Gate 2: movement_intensity_target non-decreasing across phases (allow small dips only if withholding_note present)
  const byPhase: Record<string, any[]> = {};
  for (const b of beats) {
    const p = b.phase;
    if (!byPhase[p]) byPhase[p] = [];
    byPhase[p].push(b);
  }
  let prevMaxIntensity = 0;
  for (const phase of PHASES_ORDERED) {
    const phaseBeats = byPhase[phase] || [];
    for (const b of phaseBeats) {
      const intensity = b.movement_intensity_target || 5;
      if (intensity < prevMaxIntensity - 1) {
        if (!b.withholding_note || b.withholding_note.trim().length === 0) {
          failures.push(`Beat #${b.beat_index} (${phase}): movement_intensity_target=${intensity} drops from ${prevMaxIntensity} without withholding_note`);
        }
      }
      prevMaxIntensity = Math.max(prevMaxIntensity, intensity);
    }
  }

  // Gate 3: At least 2 silence windows across beats
  const silenceCount = beats.filter((b: any) => (b.silence_before_ms > 0) || (b.silence_after_ms > 0)).length;
  if (silenceCount < 2) {
    failures.push(`Only ${silenceCount} beat(s) have silence windows; minimum 2 required`);
  }

  // Gate 4: Crescendo must include micro-montage intent
  const crescendoBeats = beats.filter((b: any) => b.phase === "crescendo");
  const hasMicroMontage = crescendoBeats.some((b: any) => 
    (b.shot_density_target || 0) >= 2.0 && (b.movement_intensity_target || 0) >= 7
  );
  if (crescendoBeats.length > 0 && !hasMicroMontage) {
    failures.push("Crescendo phase lacks micro-montage intent (need shot_density_target>=2.0 AND movement_intensity_target>=7)");
  }

  return { passed: failures.length === 0, failures };
}

function runJudgeGates(scores: Record<string, number>): { passed: boolean; blockers: string[]; repairActions: any[] } {
  const blockers: string[] = [];
  const repairActions: any[] = [];

  if ((scores.canon_adherence || 0) < 0.9) {
    blockers.push(`canon_adherence=${scores.canon_adherence} < 0.9`);
    repairActions.push({ type: "improve_citations", target: "script_beats", reason: "Canon adherence below threshold" });
  }
  if ((scores.movement_escalation || 0) < 0.75) {
    blockers.push(`movement_escalation=${scores.movement_escalation} < 0.75`);
    repairActions.push({ type: "fix_movement_curve", target: "script_beats", reason: "Movement escalation too flat" });
  }
  if ((scores.contrast_density || 0) < 0.75) {
    blockers.push(`contrast_density=${scores.contrast_density} < 0.75`);
    repairActions.push({ type: "increase_contrast", target: "script_beats", reason: "Contrast density below threshold" });
  }

  return { passed: blockers.length === 0, blockers, repairActions };
}

// ─── Idempotency check ───

async function checkIdempotency(db: any, projectId: string, trailerType: string, idempotencyKey?: string): Promise<string | null> {
  if (!idempotencyKey) return null;
  const { data } = await db.from("trailer_script_runs")
    .select("id, status")
    .eq("project_id", projectId)
    .eq("trailer_type", trailerType)
    .eq("seed", idempotencyKey)
    .in("status", ["queued", "running", "complete"])
    .limit(1)
    .single();
  return data?.id || null;
}

// ─── fetchCanonPack replaced by shared compileTrailerContext ───

// ─── ACTION 1: Create Trailer Script v2 ───

async function handleCreateTrailerScript(db: any, body: any, userId: string, apiKey: string) {
  const { projectId, canonPackId, trailerType = "main", genreKey = "drama", platformKey = "theatrical", seed: inputSeed, idempotencyKey } = body;

  if (!canonPackId) return json({ error: "canonPackId required" }, 400);

  // Idempotency check
  const existingId = await checkIdempotency(db, projectId, trailerType, idempotencyKey);
  if (existingId) return json({ ok: true, scriptRunId: existingId, idempotent: true });

  const resolvedSeed = resolveSeed(inputSeed || idempotencyKey);

  // ── Use shared canon pack context builder ──
  const packCtx = await compileTrailerContext(db, projectId, canonPackId);
  const canonText = packCtx.mergedText;

  // Insert run row with audit columns
  const { data: run, error: runErr } = await db.from("trailer_script_runs").insert({
    project_id: projectId,
    canon_pack_id: canonPackId,
    trailer_type: trailerType,
    genre_key: genreKey,
    platform_key: platformKey,
    seed: resolvedSeed,
    status: "running",
    created_by: userId,
    canon_context_hash: packCtx.contextHash,
    canon_context_meta_json: packCtx.contextMeta,
  }).select().single();
  if (runErr) return json({ error: runErr.message }, 500);

  try {
    const system = composeSystem({
      baseSystem: `You are a cinematic trailer scriptwriter with deep expertise in ${genreKey} trailers for ${platformKey} release.
You write trailer scripts as structured beat sequences. Each beat belongs to a PHASE: hook, setup, escalation, twist, crescendo, button.

CRITICAL RULES:
- Every beat MUST cite at least one source from the canon (source_refs_json). Use document type + excerpt.
- quoted_dialogue MUST be actual dialogue from the source material, never invented.
- movement_intensity_target must generally increase across phases (1-10 scale). Small dips are allowed ONLY if you provide a withholding_note explaining the creative intent.
- At least 2 beats must have silence_before_ms or silence_after_ms > 0.
- The crescendo phase MUST include at least one beat with shot_density_target >= 2.0 AND movement_intensity_target >= 7 (micro-montage intent).
- text_card beats should be used sparingly (1-3 max) for maximum impact.

Return STRICT JSON array of beats matching this schema exactly:
[{
  "beat_index": 0,
  "phase": "hook",
  "title": "short title",
  "emotional_intent": "what the audience should feel",
  "quoted_dialogue": "exact quote from source or null",
  "text_card": "on-screen text or null",
  "withholding_note": "why we pull back here or null",
  "trailer_moment_flag": false,
  "silence_before_ms": 0,
  "silence_after_ms": 0,
  "movement_intensity_target": 5,
  "shot_density_target": 1.0,
  "contrast_delta_score": 0.5,
  "source_refs_json": [{"doc_type": "script", "excerpt": "quoted text", "location": "scene/page ref"}],
  "generator_hint_json": {"visual_prompt": "detailed prompt for AI video gen", "camera_move": "push_in", "shot_type": "close"}
}]

Target: 12-18 beats for a main trailer, 6-10 for teaser, 8-12 for character trailer.
Seed for determinism: ${resolvedSeed}`,
    });

    const userPrompt = `Genre: ${genreKey}\nPlatform: ${platformKey}\nTrailer Type: ${trailerType}\nSeed: ${resolvedSeed}\n\n--- CANON PACK ---\n${canonText.slice(0, 16000)}`;

    const result = await callLLM({
      apiKey,
      model: MODELS.PRO,
      system,
      user: userPrompt,
      temperature: 0.4,
      maxTokens: 16000,
    });

    const beats = await parseJsonSafe(result.content, apiKey);
    const beatArray = Array.isArray(beats) ? beats : (beats.beats || []);

    // Run gates
    const gateResult = runScriptGates(beatArray);

    // Compute scores
    const silenceCount = beatArray.filter((b: any) => b.silence_before_ms > 0 || b.silence_after_ms > 0).length;
    const avgMovement = beatArray.reduce((s: number, b: any) => s + (b.movement_intensity_target || 5), 0) / Math.max(beatArray.length, 1);
    const structureScore = gateResult.passed ? 0.9 : 0.5;
    const cinematicScore = Math.min(1, (avgMovement / 10 + silenceCount / beatArray.length) / 2);

    // Insert beats
    const beatRows = beatArray.map((b: any, i: number) => ({
      script_run_id: run.id,
      beat_index: b.beat_index ?? i,
      phase: b.phase || "setup",
      title: b.title || null,
      emotional_intent: b.emotional_intent || "unspecified",
      quoted_dialogue: b.quoted_dialogue || null,
      text_card: b.text_card || null,
      withholding_note: b.withholding_note || null,
      trailer_moment_flag: b.trailer_moment_flag || false,
      silence_before_ms: b.silence_before_ms || 0,
      silence_after_ms: b.silence_after_ms || 0,
      movement_intensity_target: b.movement_intensity_target || 5,
      shot_density_target: b.shot_density_target || null,
      contrast_delta_score: b.contrast_delta_score || null,
      source_refs_json: b.source_refs_json || [],
      generator_hint_json: b.generator_hint_json || null,
    }));

    const { error: beatsErr } = await db.from("trailer_script_beats").insert(beatRows);
    if (beatsErr) throw new Error(`Insert beats failed: ${beatsErr.message}`);

    // Update run status
    const status = gateResult.passed ? "complete" : "needs_repair";
    await db.from("trailer_script_runs").update({
      status,
      structure_score: structureScore,
      cinematic_score: cinematicScore,
      warnings: gateResult.failures,
    }).eq("id", run.id);

    return json({
      ok: true,
      scriptRunId: run.id,
      status,
      beatCount: beatArray.length,
      structureScore,
      cinematicScore,
      gatesPassed: gateResult.passed,
      warnings: gateResult.failures,
      seed: resolvedSeed,
    });

  } catch (err: any) {
    await db.from("trailer_script_runs").update({ status: "error", warnings: [err.message] }).eq("id", run.id);
    if (err.message === "RATE_LIMIT") return json({ error: "Rate limit exceeded" }, 429);
    if (err.message === "PAYMENT_REQUIRED") return json({ error: "AI credits exhausted" }, 402);
    return json({ error: err.message }, 500);
  }
}

// ─── ACTION 2: Create Rhythm Grid v2 ───

async function handleCreateRhythmGrid(db: any, body: any, userId: string, apiKey: string) {
  const { projectId, scriptRunId, seed: inputSeed } = body;
  if (!scriptRunId) return json({ error: "scriptRunId required" }, 400);

  // Fetch script run + beats
  const { data: scriptRun } = await db.from("trailer_script_runs")
    .select("*").eq("id", scriptRunId).eq("project_id", projectId).single();
  if (!scriptRun) return json({ error: "Script run not found" }, 404);

  const { data: beats } = await db.from("trailer_script_beats")
    .select("*").eq("script_run_id", scriptRunId).order("beat_index");
  if (!beats?.length) return json({ error: "No beats found for script run" }, 400);

  const resolvedSeed = resolveSeed(inputSeed);
  const rng = mulberry32(resolvedSeed);

  // Determine BPM based on genre
  const genreBpm: Record<string, number> = {
    action: 140, thriller: 120, horror: 90, drama: 100, comedy: 110,
    scifi: 130, romance: 95, documentary: 85, animation: 115,
  };
  const baseBpm = genreBpm[scriptRun.genre_key] || 110;
  const bpm = baseBpm + Math.floor(rng() * 20 - 10);

  // Insert rhythm run
  const { data: run, error: runErr } = await db.from("trailer_rhythm_runs").insert({
    project_id: projectId,
    script_run_id: scriptRunId,
    seed: resolvedSeed,
    status: "running",
    bpm,
    phase_timings_json: {},
    beat_grid_json: [],
    shot_duration_curve_json: [],
    created_by: userId,
  }).select().single();
  if (runErr) return json({ error: runErr.message }, 500);

  try {
    const beatSummary = beats.map((b: any) => `#${b.beat_index} ${b.phase}: intensity=${b.movement_intensity_target}, density=${b.shot_density_target || "auto"}, silence_before=${b.silence_before_ms}ms, silence_after=${b.silence_after_ms}ms`).join("\n");

    const system = `You are a music editor and rhythm designer for cinematic trailers.
Given a BPM of ${bpm} and a list of trailer beats with their intensity/density targets, design a precise rhythm grid.

Return STRICT JSON:
{
  "phase_timings": {"hook":{"start_ms":0,"end_ms":3000},"setup":{"start_ms":3000,"end_ms":12000},...},
  "beat_grid": [{"beat_index":0,"start_ms":0,"end_ms":3000,"on_beat":true,"cut_type":"hard"},...],
  "shot_duration_curve": [{"t_ms":0,"target_shot_ms":2000},{"t_ms":30000,"target_shot_ms":800},...],
  "density_curve": [{"t_ms":0,"shots_per_sec":0.5},{"t_ms":60000,"shots_per_sec":3.0},...],
  "drop_timestamp_ms": 45000,
  "silence_windows": [{"start_ms":25000,"end_ms":26500,"reason":"emotional breath before twist"},...],
  "warnings": []
}

Rules:
- Each cut should align to a beat of the BPM grid (${Math.round(60000 / bpm)}ms per beat)
- Shot durations should decrease from ~2-3s in hook/setup to ~0.3-0.5s in crescendo
- The "drop" is the most impactful moment — place it at the crescendo start
- Silence windows must match the beat's silence_before/after_ms values
- density_curve tracks average shots per second, increasing toward crescendo`;

    const result = await callLLM({
      apiKey,
      model: MODELS.BALANCED,
      system,
      user: `BPM: ${bpm}\nBeats:\n${beatSummary}`,
      temperature: 0.3,
      maxTokens: 8000,
    });

    const parsed = await parseJsonSafe(result.content, apiKey);

    await db.from("trailer_rhythm_runs").update({
      status: "complete",
      phase_timings_json: parsed.phase_timings || {},
      beat_grid_json: parsed.beat_grid || [],
      shot_duration_curve_json: parsed.shot_duration_curve || [],
      density_curve_json: parsed.density_curve || null,
      drop_timestamp_ms: parsed.drop_timestamp_ms || null,
      silence_windows_json: parsed.silence_windows || null,
      warnings: parsed.warnings || [],
    }).eq("id", run.id);

    return json({
      ok: true,
      rhythmRunId: run.id,
      status: "complete",
      bpm,
      dropMs: parsed.drop_timestamp_ms,
      warnings: parsed.warnings || [],
      seed: resolvedSeed,
    });

  } catch (err: any) {
    await db.from("trailer_rhythm_runs").update({ status: "error", warnings: [err.message] }).eq("id", run.id);
    if (err.message === "RATE_LIMIT") return json({ error: "Rate limit exceeded" }, 429);
    if (err.message === "PAYMENT_REQUIRED") return json({ error: "AI credits exhausted" }, 402);
    return json({ error: err.message }, 500);
  }
}

// ─── ACTION 3: Create Shot Design v2 ───

async function handleCreateShotDesign(db: any, body: any, userId: string, apiKey: string) {
  const { projectId, scriptRunId, rhythmRunId, seed: inputSeed } = body;
  if (!scriptRunId) return json({ error: "scriptRunId required" }, 400);

  const { data: beats } = await db.from("trailer_script_beats")
    .select("*").eq("script_run_id", scriptRunId).order("beat_index");
  if (!beats?.length) return json({ error: "No beats found" }, 400);

  let rhythmContext = "";
  if (rhythmRunId) {
    const { data: rhythm } = await db.from("trailer_rhythm_runs")
      .select("bpm, shot_duration_curve_json, density_curve_json")
      .eq("id", rhythmRunId).single();
    if (rhythm) {
      rhythmContext = `\nBPM: ${rhythm.bpm}\nShot Duration Curve: ${JSON.stringify(rhythm.shot_duration_curve_json || [])}\nDensity Curve: ${JSON.stringify(rhythm.density_curve_json || [])}`;
    }
  }

  const resolvedSeed = resolveSeed(inputSeed);

  const { data: run, error: runErr } = await db.from("trailer_shot_design_runs").insert({
    project_id: projectId,
    script_run_id: scriptRunId,
    rhythm_run_id: rhythmRunId || null,
    seed: resolvedSeed,
    status: "running",
    created_by: userId,
  }).select().single();
  if (runErr) return json({ error: runErr.message }, 500);

  try {
    const beatList = beats.map((b: any) => `#${b.beat_index} ${b.phase}: "${b.emotional_intent}" intensity=${b.movement_intensity_target} density=${b.shot_density_target || "auto"} hint=${JSON.stringify(b.generator_hint_json || {})}`).join("\n");

    const system = `You are a cinematographer designing shot specs for a cinematic trailer.
For each beat, design 1-3 shots with precise camera grammar.

Valid shot_type: wide, medium, close, insert, aerial, macro
Valid camera_move: static, push_in, pull_out, track, arc, handheld, whip_pan, crane, tilt, dolly_zoom

Return STRICT JSON:
{
  "global_movement_curve": [{"beat_index":0,"avg_intensity":3},{"beat_index":5,"avg_intensity":8},...],
  "lens_bias": {"wide_pct":0.3,"medium_pct":0.35,"close_pct":0.25,"insert_pct":0.1},
  "shots": [
    {
      "beat_index": 0,
      "shot_index": 0,
      "shot_type": "wide",
      "lens_mm": 24,
      "camera_move": "crane",
      "movement_intensity": 4,
      "depth_strategy": "deep",
      "foreground_element": "silhouette figure",
      "lighting_note": "backlit, golden hour",
      "transition_in": "fade_from_black",
      "transition_out": "hard_cut",
      "target_duration_ms": 2500,
      "prompt_hint": {"visual_prompt":"sweeping crane shot over...", "style":"cinematic", "mood":"anticipation"}
    }
  ],
  "warnings": []
}

Rules:
- Vary shot types: no 3+ consecutive same shot_type
- Camera moves must escalate with movement_intensity_target
- Crescendo beats should use fast moves (whip_pan, handheld) with short durations
- Hook should be visually striking — use aerial or crane
- Emotional beats favor close-ups with shallow depth
- Include lens_mm (16-200 range) appropriate for shot_type${rhythmContext}`;

    const result = await callLLM({
      apiKey,
      model: MODELS.BALANCED,
      system,
      user: `Beats:\n${beatList}\nSeed: ${resolvedSeed}`,
      temperature: 0.35,
      maxTokens: 12000,
    });

    const parsed = await parseJsonSafe(result.content, apiKey);

    // Insert shot specs
    const shotRows = (parsed.shots || []).map((s: any) => {
      const matchBeat = beats.find((b: any) => b.beat_index === s.beat_index);
      return {
        shot_design_run_id: run.id,
        beat_id: matchBeat?.id,
        shot_index: s.shot_index || 0,
        shot_type: s.shot_type || "medium",
        lens_mm: s.lens_mm || null,
        camera_move: s.camera_move || "static",
        movement_intensity: s.movement_intensity || 5,
        depth_strategy: s.depth_strategy || null,
        foreground_element: s.foreground_element || null,
        lighting_note: s.lighting_note || null,
        transition_in: s.transition_in || null,
        transition_out: s.transition_out || null,
        target_duration_ms: s.target_duration_ms || null,
        prompt_hint_json: s.prompt_hint || {},
      };
    }).filter((r: any) => r.beat_id);

    if (shotRows.length > 0) {
      const { error: shotErr } = await db.from("trailer_shot_specs").insert(shotRows);
      if (shotErr) throw new Error(`Insert shot specs failed: ${shotErr.message}`);
    }

    await db.from("trailer_shot_design_runs").update({
      status: "complete",
      global_movement_curve_json: parsed.global_movement_curve || null,
      lens_bias_json: parsed.lens_bias || null,
      warnings: parsed.warnings || [],
    }).eq("id", run.id);

    return json({
      ok: true,
      shotDesignRunId: run.id,
      status: "complete",
      shotCount: shotRows.length,
      warnings: parsed.warnings || [],
      seed: resolvedSeed,
    });

  } catch (err: any) {
    await db.from("trailer_shot_design_runs").update({ status: "error", warnings: [err.message] }).eq("id", run.id);
    if (err.message === "RATE_LIMIT") return json({ error: "Rate limit exceeded" }, 429);
    if (err.message === "PAYMENT_REQUIRED") return json({ error: "AI credits exhausted" }, 402);
    return json({ error: err.message }, 500);
  }
}

// ─── ACTION 4: Run Cinematic Judge v2 ───

async function handleRunJudge(db: any, body: any, userId: string, apiKey: string) {
  const { projectId, scriptRunId, rhythmRunId, shotDesignRunId } = body;
  if (!scriptRunId) return json({ error: "scriptRunId required" }, 400);

  const { data: beats } = await db.from("trailer_script_beats")
    .select("*").eq("script_run_id", scriptRunId).order("beat_index");

  let rhythmData: any = null;
  if (rhythmRunId) {
    const { data } = await db.from("trailer_rhythm_runs").select("*").eq("id", rhythmRunId).single();
    rhythmData = data;
  }

  let shotData: any = null;
  let shotSpecs: any[] = [];
  if (shotDesignRunId) {
    const { data } = await db.from("trailer_shot_design_runs").select("*").eq("id", shotDesignRunId).single();
    shotData = data;
    const { data: specs } = await db.from("trailer_shot_specs").select("*").eq("shot_design_run_id", shotDesignRunId);
    shotSpecs = specs || [];
  }

  const { data: run, error: runErr } = await db.from("trailer_judge_v2_runs").insert({
    project_id: projectId,
    script_run_id: scriptRunId,
    rhythm_run_id: rhythmRunId || null,
    shot_design_run_id: shotDesignRunId || null,
    status: "running",
    created_by: userId,
  }).select().single();
  if (runErr) return json({ error: runErr.message }, 500);

  try {
    const beatSummary = (beats || []).map((b: any) =>
      `#${b.beat_index} ${b.phase}: intent="${b.emotional_intent}" movement=${b.movement_intensity_target} density=${b.shot_density_target || "?"} refs=${(b.source_refs_json || []).length} silence_before=${b.silence_before_ms} silence_after=${b.silence_after_ms}`
    ).join("\n");

    const system = `You are a cinematic trailer judge. Score this trailer plan on these dimensions (0.0-1.0):

1. canon_adherence: Do all beats cite real source material? Are quotes accurate?
2. movement_escalation: Does movement intensity properly build across phases?
3. contrast_density: Are there enough tonal shifts (loud/quiet, fast/slow)?
4. silence_usage: Are silence windows placed for maximum emotional impact?
5. shot_grammar: Do shot types and camera moves create visual variety?
6. phase_balance: Are phases well-proportioned (not too long/short)?
7. crescendo_impact: Does the crescendo deliver micro-montage energy?
8. emotional_arc: Does the trailer build to an emotional peak?

Return STRICT JSON:
{
  "scores": {
    "canon_adherence": 0.9,
    "movement_escalation": 0.85,
    "contrast_density": 0.8,
    "silence_usage": 0.75,
    "shot_grammar": 0.8,
    "phase_balance": 0.85,
    "crescendo_impact": 0.9,
    "emotional_arc": 0.85,
    "overall": 0.84
  },
  "flags": ["string descriptions of issues"],
  "repair_actions": [
    {"type": "improve_citations|fix_movement_curve|increase_contrast|add_silence|fix_crescendo|rebalance_phases", "target": "script_beats|rhythm|shots", "reason": "why", "beat_indices": [0,3]}
  ]
}`;

    const userPrompt = `BEATS:\n${beatSummary}\n\n${rhythmData ? `RHYTHM: BPM=${rhythmData.bpm}, drop_ms=${rhythmData.drop_timestamp_ms}` : ""}\n\n${shotSpecs.length > 0 ? `SHOTS: ${shotSpecs.length} specs across ${new Set(shotSpecs.map((s: any) => s.shot_type)).size} types` : ""}`;

    const result = await callLLM({
      apiKey,
      model: MODELS.BALANCED,
      system,
      user: userPrompt,
      temperature: 0.2,
      maxTokens: 4000,
    });

    const parsed = await parseJsonSafe(result.content, apiKey);
    const scores = parsed.scores || {};
    const flags = parsed.flags || [];
    const repairActions = parsed.repair_actions || [];

    // Run hard gates on scores
    const judgeGates = runJudgeGates(scores);

    // Determine final status
    let scriptStatus = "complete";
    if (!judgeGates.passed) {
      scriptStatus = "needs_repair";
      // Update script run status
      await db.from("trailer_script_runs").update({ status: "needs_repair" }).eq("id", scriptRunId);
    }

    // Merge repair actions
    const allRepairActions = [...repairActions, ...judgeGates.repairActions];

    await db.from("trailer_judge_v2_runs").update({
      status: "complete",
      scores_json: scores,
      flags,
      repair_actions_json: allRepairActions.length > 0 ? allRepairActions : null,
    }).eq("id", run.id);

    // Write learning signals
    const signalRows = Object.entries(scores).map(([key, value]) => ({
      project_id: projectId,
      script_run_id: scriptRunId,
      signal_type: "judge_score" as const,
      signal_key: `judge_v2.${key}`,
      signal_value_num: value as number,
      weight: key === "overall" ? 2.0 : 1.0,
      source: "judge_v2",
      created_by: userId,
    }));

    if (signalRows.length > 0) {
      await db.from("trailer_learning_signals").insert(signalRows);
    }

    return json({
      ok: true,
      judgeRunId: run.id,
      status: "complete",
      scores,
      flags,
      gatesPassed: judgeGates.passed,
      blockers: judgeGates.blockers,
      repairActions: allRepairActions,
      scriptStatus,
    });

  } catch (err: any) {
    await db.from("trailer_judge_v2_runs").update({ status: "error", flags: [err.message] }).eq("id", run.id);
    if (err.message === "RATE_LIMIT") return json({ error: "Rate limit exceeded" }, 429);
    if (err.message === "PAYMENT_REQUIRED") return json({ error: "AI credits exhausted" }, 402);
    return json({ error: err.message }, 500);
  }
}

// ─── ACTION 5: Repair Trailer Script v2 ───

async function handleRepairScript(db: any, body: any, userId: string, apiKey: string) {
  const { projectId, scriptRunId, judgeRunId } = body;
  if (!scriptRunId) return json({ error: "scriptRunId required" }, 400);

  // Fetch repair actions from judge
  let repairActions: any[] = [];
  if (judgeRunId) {
    const { data: judge } = await db.from("trailer_judge_v2_runs")
      .select("repair_actions_json").eq("id", judgeRunId).single();
    repairActions = judge?.repair_actions_json || [];
  }

  if (repairActions.length === 0) return json({ error: "No repair actions found" }, 400);

  // Fetch current beats
  const { data: beats } = await db.from("trailer_script_beats")
    .select("*").eq("script_run_id", scriptRunId).order("beat_index");
  if (!beats?.length) return json({ error: "No beats found" }, 400);

  // Load canon context via shared module
  let canonText = "";
  const canonPackId = body.canonPackId;
  if (canonPackId) {
    const packCtx = await compileTrailerContext(db, projectId, canonPackId);
    canonText = packCtx.mergedText;
  } else {
    // Fallback: try to get canon_pack_id from the script run
    const { data: sr } = await db.from("trailer_script_runs").select("canon_pack_id").eq("id", scriptRunId).single();
    if (sr?.canon_pack_id) {
      const packCtx = await compileTrailerContext(db, projectId, sr.canon_pack_id);
      canonText = packCtx.mergedText;
    }
  }

  try {
    const beatJson = JSON.stringify(beats.map((b: any) => ({
      id: b.id,
      beat_index: b.beat_index,
      phase: b.phase,
      emotional_intent: b.emotional_intent,
      movement_intensity_target: b.movement_intensity_target,
      shot_density_target: b.shot_density_target,
      silence_before_ms: b.silence_before_ms,
      silence_after_ms: b.silence_after_ms,
      source_refs_json: b.source_refs_json,
      withholding_note: b.withholding_note,
      contrast_delta_score: b.contrast_delta_score,
    })));

    const system = `You are repairing a cinematic trailer script based on judge feedback.

REPAIR ACTIONS REQUIRED:
${JSON.stringify(repairActions, null, 2)}

RULES:
- Fix ONLY the issues identified in repair_actions
- Maintain the overall structure and phase order
- When adding citations, use real content from the canon pack
- Movement intensity must be non-decreasing across phases (allow dips only with withholding_note)
- If adding silence, place it at emotionally impactful transitions

Return STRICT JSON — array of ONLY the modified beats (same schema as input, include the beat id):
[{"id": "uuid", "beat_index": 0, "movement_intensity_target": 6, "source_refs_json": [...], ...}]

CANON PACK (for citation repair):
${canonText.slice(0, 8000)}`;

    const result = await callLLM({
      apiKey,
      model: MODELS.PRO,
      system,
      user: `Current beats:\n${beatJson}`,
      temperature: 0.3,
      maxTokens: 10000,
    });

    const repaired = await parseJsonSafe(result.content, apiKey);
    const repairedArray = Array.isArray(repaired) ? repaired : (repaired.beats || []);

    let updatedCount = 0;
    for (const rb of repairedArray) {
      if (!rb.id) continue;
      const updateFields: any = {};
      if (rb.movement_intensity_target !== undefined) updateFields.movement_intensity_target = rb.movement_intensity_target;
      if (rb.shot_density_target !== undefined) updateFields.shot_density_target = rb.shot_density_target;
      if (rb.silence_before_ms !== undefined) updateFields.silence_before_ms = rb.silence_before_ms;
      if (rb.silence_after_ms !== undefined) updateFields.silence_after_ms = rb.silence_after_ms;
      if (rb.source_refs_json !== undefined) updateFields.source_refs_json = rb.source_refs_json;
      if (rb.withholding_note !== undefined) updateFields.withholding_note = rb.withholding_note;
      if (rb.contrast_delta_score !== undefined) updateFields.contrast_delta_score = rb.contrast_delta_score;
      if (rb.emotional_intent !== undefined) updateFields.emotional_intent = rb.emotional_intent;

      if (Object.keys(updateFields).length > 0) {
        await db.from("trailer_script_beats").update(updateFields).eq("id", rb.id);
        updatedCount++;
      }
    }

    // Re-run gates on updated beats
    const { data: updatedBeats } = await db.from("trailer_script_beats")
      .select("*").eq("script_run_id", scriptRunId).order("beat_index");
    const gateResult = runScriptGates(updatedBeats || []);

    const newStatus = gateResult.passed ? "complete" : "needs_repair";
    await db.from("trailer_script_runs").update({
      status: newStatus,
      warnings: gateResult.failures,
    }).eq("id", scriptRunId);

    return json({
      ok: true,
      scriptRunId,
      updatedBeats: updatedCount,
      status: newStatus,
      gatesPassed: gateResult.passed,
      warnings: gateResult.failures,
    });

  } catch (err: any) {
    if (err.message === "RATE_LIMIT") return json({ error: "Rate limit exceeded" }, 429);
    if (err.message === "PAYMENT_REQUIRED") return json({ error: "AI credits exhausted" }, 402);
    return json({ error: err.message }, 500);
  }
}

// ─── Clip Generation Helpers ───

const HERO_PHASES = new Set(["hook", "twist", "crescendo"]);

async function sha256Short(input: string): Promise<string> {
  const encoded = new TextEncoder().encode(input);
  const hash = await crypto.subtle.digest("SHA-256", encoded);
  return Array.from(new Uint8Array(hash)).map(b => b.toString(16).padStart(2, "0")).join("").slice(0, 40);
}

function routeProvider(phase: string, hintJson?: any): { provider: string; candidates: number } {
  // Explicit provider hint takes priority
  if (hintJson?.provider) {
    return { provider: hintJson.provider, candidates: hintJson.candidates || 2 };
  }
  if (HERO_PHASES.has(phase)) {
    return { provider: "runway", candidates: 2 };
  }
  return { provider: "veo", candidates: 1 };
}

function clampDuration(ms: number | null | undefined, phase: string): number {
  const val = ms || 3000;
  const max = phase === "button" ? 8000 : 6000;
  return Math.max(1200, Math.min(max, val));
}

function buildClipPrompt(beat: any, spec: any): string {
  const lines: string[] = [];

  // Shot grammar — cinematic language
  const shotDesc = `${spec.camera_move || "static"} ${spec.shot_type || "medium"} shot`;
  const lensDesc = spec.lens_mm ? `, ${spec.lens_mm}mm lens` : "";
  const depthDesc = spec.depth_strategy ? `, ${spec.depth_strategy} depth of field` : "";
  const fgDesc = spec.foreground_element ? `, foreground: ${spec.foreground_element}` : "";
  lines.push(`CAMERA: ${shotDesc}${lensDesc}${depthDesc}${fgDesc}`);

  // Lighting & mood
  if (spec.lighting_note) lines.push(`LIGHTING: ${spec.lighting_note}`);
  lines.push(`MOOD: ${beat.emotional_intent || "unspecified"}`);

  // Movement intensity
  const intensity = spec.movement_intensity || beat.movement_intensity_target || 5;
  if (intensity >= 7) {
    lines.push("ENERGY: kinetic, fast cuts, high movement");
  } else if (intensity >= 4) {
    lines.push("ENERGY: measured, deliberate camera movement");
  } else {
    lines.push("ENERGY: slow, contemplative, minimal movement");
  }

  // Withholding / silence context
  if (beat.withholding_note) lines.push(`RESTRAINT: ${beat.withholding_note}`);

  // Visual prompt from hint
  const hint = spec.prompt_hint_json || beat.generator_hint_json || {};
  if (hint.visual_prompt) lines.push(`VISUAL: ${hint.visual_prompt}`);
  if (hint.style) lines.push(`STYLE: ${hint.style}`);

  // Citation summary (not full text — just labels for grounding)
  const refs = beat.source_refs_json || [];
  if (refs.length > 0) {
    const refLabels = refs.slice(0, 3).map((r: any) =>
      `${r.doc_type || "source"}${r.location ? ` @ ${r.location}` : ""}`
    ).join("; ");
    lines.push(`GROUNDED IN: ${refLabels}`);
  }

  // Transitions
  if (spec.transition_in && spec.transition_in !== "hard_cut") lines.push(`TRANSITION IN: ${spec.transition_in}`);

  // Negative constraints
  lines.push("NEGATIVES: no text overlays, no watermarks, no logos, no UI elements, no new characters beyond those established in the source material");

  return lines.join("\n");
}

// ─── ACTION 6: Start Clip Generation from Shot Specs ───

async function handleStartClipGeneration(db: any, body: any, userId: string) {
  const { projectId, scriptRunId, shotDesignRunId, rhythmRunId, manualOverride } = body;
  if (!scriptRunId || !shotDesignRunId) return json({ error: "scriptRunId and shotDesignRunId required" }, 400);

  // ── Gate 1: script must be complete ──
  const { data: scriptRun } = await db.from("trailer_script_runs")
    .select("status, trailer_type, seed, canon_pack_id").eq("id", scriptRunId).eq("project_id", projectId).single();
  if (!scriptRun || scriptRun.status !== "complete") {
    return json({ error: `Script run status is '${scriptRun?.status || "not found"}', must be 'complete' to generate clips` }, 400);
  }

  // ── Gate 2: judge must have passed (or manualOverride) ──
  const { data: judgeRuns } = await db.from("trailer_judge_v2_runs")
    .select("scores_json, repair_actions_json")
    .eq("script_run_id", scriptRunId)
    .eq("status", "complete")
    .order("created_at", { ascending: false })
    .limit(1);

  if (!judgeRuns?.length) {
    return json({ error: "No completed judge run found. Run cinematic judge first." }, 400);
  }

  const judgeScores = judgeRuns[0].scores_json || {};
  const judgeGates = runJudgeGates(judgeScores);
  if (!judgeGates.passed && !manualOverride) {
    return json({
      error: "Judge gates failed. Repair script or set manualOverride=true.",
      blockers: judgeGates.blockers,
    }, 400);
  }

  // ── Gate 3: citations check ──
  const { data: allBeats } = await db.from("trailer_script_beats")
    .select("*").eq("script_run_id", scriptRunId).order("beat_index");
  const missingCitations = (allBeats || []).filter((b: any) => !b.source_refs_json || b.source_refs_json.length === 0);
  if (missingCitations.length > 0) {
    return json({
      error: `${missingCitations.length} beat(s) missing citations. Repair first.`,
      missingBeats: missingCitations.map((b: any) => b.beat_index),
    }, 400);
  }

  // ── Fetch shot specs with beat join ──
  const { data: shotSpecs } = await db.from("trailer_shot_specs")
    .select("*")
    .eq("shot_design_run_id", shotDesignRunId);

  if (!shotSpecs?.length) {
    return json({ error: "No shot specs found for this shot design run" }, 400);
  }

  // Build beat lookup
  const beatMap = new Map((allBeats || []).map((b: any) => [b.id, b]));

  // ── Create v2 blueprint shim (required: trailer_clip_runs/jobs have NOT NULL blueprint_id) ──
  const edlItems = (allBeats || []).map((b: any) => ({
    beat_index: b.beat_index,
    phase: b.phase,
    emotional_intent: b.emotional_intent,
    text_card: b.text_card || null,
    movement_intensity_target: b.movement_intensity_target,
    shot_density_target: b.shot_density_target,
  }));

  const { data: blueprint, error: bpErr } = await db.from("trailer_blueprints").insert({
    project_id: projectId,
    arc_type: scriptRun.trailer_type || "main",
    status: "v2_shim",
    edl: edlItems,
    rhythm_analysis: { source: "cinematic_engine_v2", script_run_id: scriptRunId, rhythm_run_id: rhythmRunId || null },
    audio_plan: {},
    text_card_plan: {},
    options: { v2: true, shot_design_run_id: shotDesignRunId, script_run_id: scriptRunId },
    created_by: userId,
  }).select().single();
  if (bpErr) return json({ error: `Blueprint shim creation failed: ${bpErr.message}` }, 500);

  // ── Create clip run ──
  const runSeed = scriptRun.seed || resolveSeed();
  const { data: clipRun, error: crErr } = await db.from("trailer_clip_runs").insert({
    project_id: projectId,
    blueprint_id: blueprint.id,
    created_by: userId,
    status: "running",
    total_jobs: 0,
    done_jobs: 0,
    failed_jobs: 0,
  }).select().single();
  if (crErr) return json({ error: `Clip run creation failed: ${crErr.message}` }, 500);

  // ── Build and enqueue jobs ──
  const jobsToInsert: any[] = [];
  const providerCounts: Record<string, number> = {};

  for (const spec of shotSpecs) {
    const beat = beatMap.get(spec.beat_id);
    if (!beat) continue;

    const phase = beat.phase || "setup";
    const { provider, candidates } = routeProvider(phase, spec.prompt_hint_json);
    const lengthMs = clampDuration(spec.target_duration_ms, phase);
    const prompt = buildClipPrompt(beat, spec);

    for (let ci = 0; ci < candidates; ci++) {
      const idemInput = `${projectId}|${blueprint.id}|${beat.beat_index}|${provider}|text_to_video|${ci}|${lengthMs}|${runSeed}|${spec.shot_index}`;
      const idempotencyKey = await sha256Short(idemInput);

      jobsToInsert.push({
        project_id: projectId,
        blueprint_id: blueprint.id,
        clip_run_id: clipRun.id,
        beat_index: beat.beat_index,
        provider,
        mode: "text_to_video",
        candidate_index: ci,
        length_ms: lengthMs,
        aspect_ratio: "16:9",
        fps: 24,
        seed: runSeed,
        prompt,
        init_image_paths: [],
        params_json: {
          shot_type: spec.shot_type,
          lens_mm: spec.lens_mm,
          camera_move: spec.camera_move,
          movement_intensity: spec.movement_intensity,
          depth_strategy: spec.depth_strategy,
          foreground_element: spec.foreground_element,
          lighting_note: spec.lighting_note,
          transition_in: spec.transition_in,
          transition_out: spec.transition_out,
          phase,
          script_run_id: scriptRunId,
          shot_design_run_id: shotDesignRunId,
          shot_spec_id: spec.id,
        },
        status: "queued",
        attempt: 0,
        idempotency_key: idempotencyKey,
      });

      providerCounts[provider] = (providerCounts[provider] || 0) + 1;
    }
  }

  // Batch upsert with idempotency
  if (jobsToInsert.length > 0) {
    const { error: insertErr } = await db.from("trailer_clip_jobs").upsert(jobsToInsert, {
      onConflict: "idempotency_key",
      ignoreDuplicates: true,
    });
    if (insertErr) {
      // Fallback: insert one by one
      for (const job of jobsToInsert) {
        await db.from("trailer_clip_jobs").upsert(job, {
          onConflict: "idempotency_key",
          ignoreDuplicates: true,
        });
      }
    }
  }

  // Update clip run totals
  await db.from("trailer_clip_runs").update({
    total_jobs: jobsToInsert.length,
  }).eq("id", clipRun.id);

  // Write learning signal
  await db.from("trailer_learning_signals").insert({
    project_id: projectId,
    script_run_id: scriptRunId,
    signal_type: "user_action",
    signal_key: "clip_generation_started",
    signal_value_num: jobsToInsert.length,
    source: "cinematic_engine",
    created_by: userId,
  });

  return json({
    ok: true,
    clipRunId: clipRun.id,
    blueprintId: blueprint.id,
    totalJobs: jobsToInsert.length,
    byProvider: providerCounts,
    firstJobIds: jobsToInsert.slice(0, 5).map(j => j.idempotency_key),
    progress: {
      status: "running",
      total: jobsToInsert.length,
      done: 0,
      failed: 0,
      queued: jobsToInsert.length,
    },
    gatesPassed: true,
    manualOverride: !!manualOverride,
  });
}

// ─── ACTION 7: Full Cinematic Trailer Plan (orchestrator) ───

async function handleFullPlan(db: any, body: any, userId: string, apiKey: string) {
  const { projectId, canonPackId, trailerType = "main", genreKey = "drama", platformKey = "theatrical", seed: inputSeed, idempotencyKey } = body;

  if (!canonPackId) return json({ error: "canonPackId required" }, 400);

  const resolvedSeed = resolveSeed(inputSeed || idempotencyKey);
  const results: any = { seed: resolvedSeed, steps: [] };

  // Step 1: Create trailer script
  const scriptResult = await handleCreateTrailerScript(db, {
    ...body, seed: resolvedSeed, idempotencyKey: idempotencyKey || resolvedSeed,
  }, userId, apiKey);
  const scriptJson = await scriptResult.clone().json();
  results.steps.push({ action: "create_trailer_script_v2", ...scriptJson });

  if (!scriptJson.ok || !scriptJson.scriptRunId) {
    return json({ ok: false, error: "Script creation failed", ...results });
  }

  // If script needs repair, try one repair cycle
  if (scriptJson.status === "needs_repair") {
    // Run judge to get repair actions
    const judgeResult1 = await handleRunJudge(db, {
      projectId, scriptRunId: scriptJson.scriptRunId,
    }, userId, apiKey);
    const judgeJson1 = await judgeResult1.clone().json();
    results.steps.push({ action: "pre_repair_judge", ...judgeJson1 });

    if (judgeJson1.repairActions?.length > 0) {
      const repairResult = await handleRepairScript(db, {
        projectId, scriptRunId: scriptJson.scriptRunId,
        judgeRunId: judgeJson1.judgeRunId, canonPackId,
      }, userId, apiKey);
      const repairJson = await repairResult.clone().json();
      results.steps.push({ action: "repair_trailer_script_v2", ...repairJson });
    }
  }

  // Step 2: Create rhythm grid
  const rhythmResult = await handleCreateRhythmGrid(db, {
    projectId, scriptRunId: scriptJson.scriptRunId, seed: `${resolvedSeed}-rhythm`,
  }, userId, apiKey);
  const rhythmJson = await rhythmResult.clone().json();
  results.steps.push({ action: "create_rhythm_grid_v2", ...rhythmJson });

  // Step 3: Create shot design
  const shotResult = await handleCreateShotDesign(db, {
    projectId, scriptRunId: scriptJson.scriptRunId,
    rhythmRunId: rhythmJson.rhythmRunId, seed: `${resolvedSeed}-shots`,
  }, userId, apiKey);
  const shotJson = await shotResult.clone().json();
  results.steps.push({ action: "create_shot_design_v2", ...shotJson });

  // Step 4: Run cinematic judge
  const judgeResult = await handleRunJudge(db, {
    projectId, scriptRunId: scriptJson.scriptRunId,
    rhythmRunId: rhythmJson.rhythmRunId,
    shotDesignRunId: shotJson.shotDesignRunId,
  }, userId, apiKey);
  const judgeJson = await judgeResult.clone().json();
  results.steps.push({ action: "run_cinematic_judge_v2", ...judgeJson });

  return json({
    ok: true,
    ...results,
    scriptRunId: scriptJson.scriptRunId,
    rhythmRunId: rhythmJson.rhythmRunId,
    shotDesignRunId: shotJson.shotDesignRunId,
    judgeRunId: judgeJson.judgeRunId,
    finalStatus: judgeJson.scriptStatus || "complete",
    scores: judgeJson.scores,
    gatesPassed: judgeJson.gatesPassed,
  });
}

// ─── Main Handler ───

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
      case "create_trailer_script_v2":
        return await handleCreateTrailerScript(db, body, userId, apiKey);
      case "create_rhythm_grid_v2":
        return await handleCreateRhythmGrid(db, body, userId, apiKey);
      case "create_shot_design_v2":
        return await handleCreateShotDesign(db, body, userId, apiKey);
      case "run_cinematic_judge_v2":
        return await handleRunJudge(db, body, userId, apiKey);
      case "repair_trailer_script_v2":
        return await handleRepairScript(db, body, userId, apiKey);
      case "start_clip_generation_from_shot_specs":
        return await handleStartClipGeneration(db, body, userId);
      case "create_full_cinematic_trailer_plan":
        return await handleFullPlan(db, body, userId, apiKey);
      default:
        return json({ error: `Unknown action: ${action}` }, 400);
    }
  } catch (err: any) {
    console.error("trailer-cinematic-engine error:", err);
    if (err.message === "RATE_LIMIT") return json({ error: "Rate limit exceeded" }, 429);
    if (err.message === "PAYMENT_REQUIRED") return json({ error: "AI credits exhausted" }, 402);
    return json({ error: err.message || "Internal error" }, 500);
  }
});
