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
import { callLLM, MODELS, composeSystem, callLLMWithJsonRetry, parseAiJson, callLLMChunked } from "../_shared/llm.ts";
import { compileTrailerContext } from "../_shared/trailerContext.ts";
import { enforceCinematicQuality } from "../_shared/cinematic-kernel.ts";
import { adaptTrailerOutput, adaptTrailerOutputWithMode } from "../_shared/cinematic-adapters.ts";
import { buildTrailerRepairInstruction } from "../_shared/cinematic-repair.ts";
import { selectCikModel, buildModelRouterTelemetry } from "../_shared/cik/modelRouter.ts";

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

// ─── Audio Plan Builder ───

function buildAudioPlan(rhythmRun: any, styleOptions: Record<string, any> = {}): any {
  const hitPoints = rhythmRun.hit_points_json || [];
  const silenceWindows = rhythmRun.silence_windows_json || [];
  const phaseTimings = rhythmRun.phase_timings_json || {};
  const bpm = rhythmRun.bpm || 110;
  const dropMs = rhythmRun.drop_timestamp_ms || null;

  // Build track structure from phase timings
  const trackStructure: any[] = [];
  const phaseToSection: Record<string, string> = {
    hook: "intro", setup: "intro", escalation: "build",
    twist: "build", crescendo: "drop", button: "aftermath",
  };
  const sectionMap: Record<string, { start_ms: number; end_ms: number }> = {};
  for (const [phase, timing] of Object.entries(phaseTimings) as [string, any][]) {
    const section = phaseToSection[phase] || "build";
    if (!sectionMap[section]) {
      sectionMap[section] = { start_ms: timing.start_ms || 0, end_ms: timing.end_ms || 0 };
    } else {
      sectionMap[section].start_ms = Math.min(sectionMap[section].start_ms, timing.start_ms || 0);
      sectionMap[section].end_ms = Math.max(sectionMap[section].end_ms, timing.end_ms || 0);
    }
  }
  for (const [section, range] of Object.entries(sectionMap)) {
    trackStructure.push({ section, start_ms: range.start_ms, end_ms: range.end_ms });
  }
  trackStructure.sort((a, b) => a.start_ms - b.start_ms);

  // Build SFX cues from hit points
  const sfxCues: any[] = [];
  for (const hp of hitPoints) {
    if (hp.type === "bass_drop" || (hp.phase === "crescendo" && hp.strength >= 8)) {
      // Add riser before drop
      const riserStart = Math.max(0, (hp.t_ms || 0) - 3000);
      sfxCues.push({ type: "riser", target_hit: hp.type, start_ms: riserStart, end_ms: hp.t_ms || 0 });
      sfxCues.push({ type: "impact", target_hit: hp.type, timestamp_ms: hp.t_ms || 0 });
    } else if (hp.type === "sting" || hp.type === "impact") {
      sfxCues.push({ type: "sting", target_hit: hp.type, timestamp_ms: hp.t_ms || 0 });
    } else if (hp.type === "button_stinger") {
      sfxCues.push({ type: "button_decay", target_hit: hp.type, timestamp_ms: hp.t_ms || 0 });
    }
  }

  // Enforce drop style silence
  const dropStyle = styleOptions.dropStyle || "hard_drop";
  if (dropMs) {
    const existingSilence = silenceWindows.find((sw: any) =>
      sw.end_ms >= dropMs - 500 && sw.start_ms <= dropMs
    );
    if (!existingSilence) {
      let silenceDur = 1000;
      if (dropStyle === "delayed_drop") silenceDur = 2000;
      if (dropStyle === "false_drop") silenceDur = 1200;
      silenceWindows.push({
        beat_index: null,
        start_ms: dropMs - silenceDur,
        end_ms: dropMs,
        reason: "pre_drop_silence",
      });
    }
  }

  // Enforce minimum silence windows
  const minSilence = styleOptions.minSilenceWindows ?? 2;
  if (silenceWindows.length < minSilence) {
    // Add silence in low-movement beats from beat_hit_intents
    const intents = rhythmRun.beat_hit_intents_json || [];
    const candidates = intents
      .filter((i: any) => i.primary_hit === "none" && !silenceWindows.some((sw: any) => sw.beat_index === i.beat_index))
      .sort((a: any, b: any) => (a.beat_index || 0) - (b.beat_index || 0));

    for (const c of candidates) {
      if (silenceWindows.length >= minSilence) break;
      const beatGrid = rhythmRun.beat_grid_json || [];
      const beatEntry = beatGrid.find((bg: any) => bg.beat_index === c.beat_index);
      if (beatEntry) {
        silenceWindows.push({
          beat_index: c.beat_index,
          start_ms: beatEntry.start_ms || 0,
          end_ms: (beatEntry.start_ms || 0) + 800,
          reason: "enforced_minimum",
        });
      }
    }
  }

  return {
    bpm,
    track_structure: trackStructure,
    hit_markers: hitPoints,
    silence_windows: silenceWindows,
    sfx_cues: sfxCues,
    drop_ms: dropMs,
    drop_style: dropStyle,
    generated_at: new Date().toISOString(),
  };
}

// ─── Look Bible Loader ───

async function loadLookBible(db: any, projectId: string, scopeRefId?: string): Promise<any | null> {
  // Priority 1: scope-specific look bible
  if (scopeRefId) {
    const { data } = await db.from("trailer_look_bibles")
      .select("*")
      .eq("project_id", projectId)
      .eq("scope_ref_id", scopeRefId)
      .order("updated_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (data) return data;
  }
  // Priority 2: project-level look bible
  const { data } = await db.from("trailer_look_bibles")
    .select("*")
    .eq("project_id", projectId)
    .eq("scope", "project")
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  return data || null;
}

function buildLookBibleSection(lb: any): string {
  if (!lb) return "";
  const locked = lb.is_locked;
  const prefix = locked ? "LOOK BIBLE (HARD CONSTRAINTS — must obey exactly)" : "LOOK BIBLE (style guidance — follow closely)";
  const lines: string[] = [
    "------------------------------------------------------------",
    prefix,
    "------------------------------------------------------------",
  ];
  if (lb.palette) lines.push(`PALETTE: ${lb.palette}`);
  if (lb.lighting_style) lines.push(`LIGHTING: ${lb.lighting_style}`);
  if (lb.contrast) lines.push(`CONTRAST: ${lb.contrast}`);
  if (lb.camera_language) lines.push(`CAMERA LANGUAGE: ${lb.camera_language}`);
  if (lb.grain) lines.push(`GRAIN/TEXTURE: ${lb.grain}`);
  if (lb.color_grade) lines.push(`COLOR GRADE: ${lb.color_grade}`);
  if (lb.reference_assets_notes) lines.push(`REFERENCE NOTES: ${lb.reference_assets_notes}`);
  if (lb.custom_directives) lines.push(`CUSTOM DIRECTIVES: ${lb.custom_directives}`);
  if (lb.avoid_list && lb.avoid_list.length > 0) {
    lines.push(`NEGATIVES (AVOID): ${lb.avoid_list.join(", ")}`);
    if (locked) {
      lines.push(`HARD NEGATIVE LIST — if any generated visual contains these elements, it MUST be rejected: ${lb.avoid_list.join(", ")}`);
    }
  }
  return "\n" + lines.join("\n") + "\n";
}

// ─── Style Options → Prompt Section Builder ───

function buildStyleOptionsSection(so: Record<string, any>, trailerType: string): string {
  if (!so || Object.keys(so).length === 0) return "";

  const lines: string[] = ["------------------------------------------------------------", "STYLE OPTIONS (obey these creative directives)", "------------------------------------------------------------"];

  // Beat count by trailer type
  const beatRanges: Record<string, string> = {
    teaser: "6–9 beats, 30–60s implied pacing",
    main: "8–14 beats, 90–120s",
    character: "8–12 beats, 60–90s",
    tone: "6–10 beats, 45–75s",
    sales: "10–16 beats, 120–180s",
  };
  lines.push(`BEAT RANGE: ${beatRanges[trailerType] || beatRanges.main}`);

  if (so.tonePreset) {
    const toneGuides: Record<string, string> = {
      a24: "Restrained early movement, implication over spectacle, slow build, textural visuals, patient silence.",
      prestige_dark: "Dark atmosphere, chiaroscuro lighting, deliberate pacing, weighted dialogue fragments.",
      blockbuster: "Higher contrast, clearer setup, big crescendo, spectacle beats, punchy text cards.",
      comedy_pop: "Brighter tone, faster hook, energetic pacing, punchy button with comedic timing.",
      horror_dread: "More negative space, extended silence windows, slow push-ins, dread over shock.",
      romance_warm: "Warm colour palette, gentle movement, intimate close-ups, emotional restraint then release.",
      thriller_taut: "Taut pacing, withholding information, sharp cuts, tension-forward movement.",
    };
    lines.push(`TONE PRESET: ${so.tonePreset} — ${toneGuides[so.tonePreset] || so.tonePreset}`);
  }

  if (so.pacingProfile) {
    const pacingGuides: Record<string, string> = {
      slow_burn_spike: "Low intensity early (1-4), then rapid spike at twist/crescendo (7-10).",
      steady_escalation: "Gradual increase across all phases, no sudden jumps.",
      fast_dense: "Higher shot_density_target across ALL phases (min 1.5). Rapid cuts throughout.",
      silence_heavy: "At least 3 beats with silence windows. Use silence as a compositional tool.",
      dialogue_forward: "Prioritise quoted_dialogue fragments. At least 4 beats should include dialogue.",
      music_forward: "Minimal dialogue, rely on visual rhythm and music cues. Fewer text cards.",
    };
    lines.push(`PACING: ${so.pacingProfile} — ${pacingGuides[so.pacingProfile] || so.pacingProfile}`);
  }

  if (so.revealStrategy) {
    const revealGuides: Record<string, string> = {
      withhold_twist: "Do NOT reveal the twist. Use withholding_note on twist beats. Imply, never show.",
      hint_twist: "Hint at the twist obliquely. Allow audience to infer but not confirm.",
      show_twist_spoiler: "Reveal the twist clearly. Allow later-story beats for maximum hook.",
      no_third_act: "Explicitly forbid any beats referencing third-act resolution or climax.",
    };
    lines.push(`REVEAL: ${so.revealStrategy} — ${revealGuides[so.revealStrategy] || so.revealStrategy}`);
  }

  if (so.movementOverall != null) {
    const mv = Number(so.movementOverall);
    lines.push(`MOVEMENT BASELINE: ${mv}/10 — Use ${mv} as the central gravity for movement_intensity_target. Early phases can be ${Math.max(1, mv - 3)}-${mv}, crescendo should reach ${Math.min(10, mv + 2)}-10.`);
  }

  if (so.cameraStyle) {
    const camGuides: Record<string, string> = {
      measured: "Controlled, deliberate camera moves. Cranes, slow dollies, composed arcs.",
      kinetic: "Energetic camera work. Tracking shots, push-ins, dynamic movement.",
      handheld: "Handheld throughout. Micro-shake, intimate energy, documentary feel.",
      floating: "Steadicam/gimbal floating. Dreamlike, weightless camera movement.",
      whip_heavy: "Frequent whip pans and fast transitions. High-energy editorial style.",
    };
    lines.push(`CAMERA STYLE: ${so.cameraStyle} — ${camGuides[so.cameraStyle] || so.cameraStyle}`);
  }

  if (so.lensBias) {
    const lensGuides: Record<string, string> = {
      wide: "Favour wide lenses (16-35mm). Spatial depth, environment-forward.",
      normal: "Favour normal lenses (40-50mm). Natural perspective.",
      portrait: "Favour portrait lenses (85-135mm). Compressed, intimate, shallow DOF.",
      mixed: "Mix lens lengths. Vary by phase: wide for setup, portrait for emotion, wide for crescendo.",
    };
    lines.push(`LENS BIAS: ${so.lensBias} — ${lensGuides[so.lensBias] || so.lensBias}`);
  }

  if (so.microMontageIntensity) {
    const mmGuides: Record<string, string> = {
      low: "Crescendo shot_density_target ~2.0. Controlled montage.",
      medium: "Crescendo shot_density_target ~2.5. Standard micro-montage energy.",
      high: "Crescendo shot_density_target ~3.0. Rapid-fire micro-shots, maximum kinetic energy.",
    };
    lines.push(`MICRO-MONTAGE: ${so.microMontageIntensity} — ${mmGuides[so.microMontageIntensity] || so.microMontageIntensity}`);
  }

  if (so.dropStyle) {
    const dropGuides: Record<string, string> = {
      hard_drop: "Sharp silence_before_ms (800-1500ms) immediately before crescendo. Clean hard cut to intensity.",
      delayed_drop: "Extended silence_before_ms (1500-3000ms) before crescendo. Build anticipation longer.",
      false_drop: "Place a silence window mid-escalation (false drop), then resume before the real crescendo drop.",
    };
    lines.push(`DROP STYLE: ${so.dropStyle} — ${dropGuides[so.dropStyle] || so.dropStyle}`);
  }

  if (so.minSilenceWindows != null) {
    lines.push(`MIN SILENCE WINDOWS: ${so.minSilenceWindows} beats must have silence_before_ms>0 or silence_after_ms>0.`);
  }

  if (so.sfxEmphasis) {
    lines.push(`SFX EMPHASIS: ${so.sfxEmphasis} — ${so.sfxEmphasis === "high" ? "Design beats with strong SFX moments (impacts, risers, stingers)." : so.sfxEmphasis === "low" ? "Minimal SFX reliance, music and silence forward." : "Balanced SFX integration."}`);
  }

  return "\n" + lines.join("\n") + "\n";
}

// ─── Inspiration / Reference / Avoid Notes Section Builder ───

function buildInspirationSection(inspirationRefs: any[], referenceNotes: string, avoidNotes: string): string {
  const sections: string[] = [];

  if (inspirationRefs && inspirationRefs.length > 0) {
    sections.push("------------------------------------------------------------");
    sections.push("INSPIRATIONS (STYLE ONLY — DO NOT COPY)");
    sections.push("------------------------------------------------------------");
    sections.push("For each inspiration trailer, use only high-level style cues (pacing, tone, typography, sound strategy). Do NOT reference them verbatim. Do NOT copy lines. Do NOT mention the inspiration titles in output.");
    for (const insp of inspirationRefs.slice(0, 5)) {
      const parts = [insp.title || "Untitled"];
      if (insp.url) parts.push(insp.url);
      if (insp.notes) parts.push(insp.notes);
      sections.push(`- ${parts.join(" — ")}`);
    }
  }

  if (referenceNotes && referenceNotes.trim().length > 0) {
    sections.push("------------------------------------------------------------");
    sections.push("REFERENCE NOTES (EMULATE)");
    sections.push("------------------------------------------------------------");
    sections.push(referenceNotes.trim().slice(0, 2000));
  }

  if (avoidNotes && avoidNotes.trim().length > 0) {
    sections.push("------------------------------------------------------------");
    sections.push("AVOID LIST");
    sections.push("------------------------------------------------------------");
    sections.push(avoidNotes.trim().slice(0, 2000));
  }

  return sections.length > 0 ? "\n" + sections.join("\n") + "\n" : "";
}

// ─── Gate checks ───

interface GateOpts {
  minSilenceWindows?: number;
  microMontageIntensity?: string; // 'low'|'medium'|'high'
  strictCanonMode?: string;
  canonText?: string;
  trailerType?: string;
}

interface GateResult { passed: boolean; failures: string[]; }

function runScriptGates(beats: any[], scriptRun?: any, opts?: GateOpts): GateResult {
  const failures: string[] = [];
  const minSilence = opts?.minSilenceWindows ?? 2;
  const micro = opts?.microMontageIntensity ?? 'medium';
  const strict = (opts?.strictCanonMode ?? 'strict') === 'strict';
  const canonText = opts?.canonText || '';
  const tType = opts?.trailerType || scriptRun?.trailer_type || 'main';

  // Gate 0: canon_context_hash must exist on the script run
  if (scriptRun && !scriptRun.canon_context_hash) {
    failures.push("Script run has no canon_context_hash — was it generated without a canon pack?");
  }

  // Gate 1: All beats must have source_refs_json with at least 1 entry
  const missingRefs = beats.filter((b: any) => !b.source_refs_json || (Array.isArray(b.source_refs_json) && b.source_refs_json.length === 0));
  if (missingRefs.length > 0) {
    failures.push(`${missingRefs.length} beat(s) missing source citations (source_refs_json empty): indices ${missingRefs.map((b: any) => b.beat_index).join(", ")}`);
  }

  // Gate 2: movement_intensity_target non-decreasing across phases
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

  // Gate 3: Silence windows — use dynamic minSilenceWindows
  const silenceCount = beats.filter((b: any) => (b.silence_before_ms > 0) || (b.silence_after_ms > 0)).length;
  if (silenceCount < minSilence) {
    failures.push(`Only ${silenceCount} beat(s) have silence windows; minimum ${minSilence} required`);
  }

  // Gate 4: Crescendo micro-montage — dynamic thresholds
  const crescendoBeats = beats.filter((b: any) => b.phase === "crescendo");
  let reqDensity = 2.0, reqMovement = 7;
  if (micro === 'medium') { reqDensity = 2.4; reqMovement = 7; }
  if (micro === 'high') { reqDensity = 2.8; reqMovement = 8; }
  const hasMicroMontage = crescendoBeats.some((b: any) =>
    (b.shot_density_target || 0) >= reqDensity && (b.movement_intensity_target || 0) >= reqMovement
  );
  if (crescendoBeats.length > 0 && !hasMicroMontage) {
    failures.push(`Crescendo phase lacks micro-montage intent (need shot_density_target>=${reqDensity} AND movement_intensity_target>=${reqMovement} for ${micro} intensity)`);
  }

  // Gate 5: Beat count range by trailer type
  const beatRanges: Record<string, [number, number]> = {
    teaser: [6, 9], main: [8, 14], character: [8, 12], tone: [6, 10], sales: [10, 16],
  };
  const [minBeats, maxBeats] = beatRanges[tType] || [8, 14];
  if (beats.length < minBeats || beats.length > maxBeats) {
    failures.push(`Beat count ${beats.length} outside ${tType} range [${minBeats}–${maxBeats}]`);
  }

  // Gate 6: Canon grounding checks (quoted_dialogue + citation excerpts)
  if (canonText.length > 0) {
    const canonLower = canonText.toLowerCase();
    for (const b of beats) {
      // Dialogue check
      if (b.quoted_dialogue && typeof b.quoted_dialogue === 'string') {
        const dNorm = b.quoted_dialogue.toLowerCase().trim();
        if (dNorm.length > 0 && !canonLower.includes(dNorm)) {
          if (strict) {
            failures.push(`Beat #${b.beat_index}: quoted_dialogue not found in canon (strict mode)`);
          }
          // balanced mode: nullify handled outside gates
        }
      }
      // Citation excerpt check
      if (strict && Array.isArray(b.source_refs_json)) {
        for (const ref of b.source_refs_json) {
          if (ref.excerpt && typeof ref.excerpt === 'string') {
            const excNorm = ref.excerpt.toLowerCase().trim();
            if (excNorm.length > 10 && !canonLower.includes(excNorm)) {
              failures.push(`Beat #${b.beat_index}: citation excerpt not found in canon (strict mode)`);
              break; // one per beat is enough
            }
          }
        }
      }
    }
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
    .select("id, status, created_at")
    .eq("project_id", projectId)
    .eq("trailer_type", trailerType)
    .eq("seed", idempotencyKey)
    .in("status", ["queued", "running", "complete"])
    .order("created_at", { ascending: false })
    .limit(5);

  if (!data?.length) return null;

  // If we already have a completed run for this seed, reuse it.
  const completed = data.find((r: any) => r.status === "complete");
  if (completed?.id) return completed.id;

  // Keep active dedupe only for fresh queued/running runs (prevents stale lockups).
  const now = Date.now();
  const STALE_MS = 10 * 60 * 1000;
  const freshActive = data.find((r: any) => {
    if (!(r.status === "queued" || r.status === "running")) return false;
    const createdAtMs = Date.parse(r.created_at || "");
    return Number.isFinite(createdAtMs) && (now - createdAtMs) < STALE_MS;
  });

  if (freshActive?.id) return freshActive.id;

  // Mark stale active runs as error so retries can create a clean run.
  const staleIds = data
    .filter((r: any) => r.status === "queued" || r.status === "running")
    .map((r: any) => r.id);

  if (staleIds.length > 0) {
    await db.from("trailer_script_runs")
      .update({ status: "error", warnings: ["Stale run auto-closed; please retry generation."] })
      .in("id", staleIds);
  }

  return null;
}

async function waitForScriptReadiness(
  db: any,
  projectId: string,
  scriptRunId: string,
  opts?: { timeoutMs?: number; pollMs?: number },
): Promise<{ ready: boolean; status: string; beatCount: number; reason?: string }> {
  const timeoutMs = opts?.timeoutMs ?? 45_000;
  const pollMs = opts?.pollMs ?? 1_500;
  const startedAt = Date.now();

  while ((Date.now() - startedAt) < timeoutMs) {
    const [{ data: run }, { data: beats }] = await Promise.all([
      db.from("trailer_script_runs")
        .select("status")
        .eq("id", scriptRunId)
        .eq("project_id", projectId)
        .maybeSingle(),
      db.from("trailer_script_beats")
        .select("id")
        .eq("script_run_id", scriptRunId)
        .limit(1),
    ]);

    const status = run?.status || "running";
    const beatCount = beats?.length || 0;

    if (status === "error") {
      return { ready: false, status, beatCount, reason: "script_error" };
    }
    if (beatCount > 0) {
      return { ready: true, status, beatCount };
    }

    await new Promise((resolve) => setTimeout(resolve, pollMs));
  }

  return { ready: false, status: "running", beatCount: 0, reason: "timeout" };
}

// ─── fetchCanonPack replaced by shared compileTrailerContext ───

// ─── ACTION 1: Create Trailer Script v2 ───

async function handleCreateTrailerScript(db: any, body: any, userId: string, apiKey: string) {
  const {
    projectId, canonPackId, trailerType = "main", genreKey = "drama", platformKey = "theatrical",
    seed: inputSeed, idempotencyKey, styleOptions = {},
    inspirationRefs = [], referenceNotes = "", avoidNotes = "",
    strictCanonMode = "strict", targetLengthMs = null, stylePresetKey = null,
  } = body;

  if (!canonPackId) return json({ error: "canonPackId required" }, 400);

  // Idempotency check
  const existingId = await checkIdempotency(db, projectId, trailerType, idempotencyKey);
  if (existingId) {
    const [existingRunResp, existingBeatsResp] = await Promise.all([
      db.from("trailer_script_runs").select("status").eq("id", existingId).maybeSingle(),
      db.from("trailer_script_beats").select("id").eq("script_run_id", existingId).limit(1),
    ]);
    const existingStatus = existingRunResp?.data?.status || "running";
    const existingBeatCount = existingBeatsResp?.data?.length || 0;
    return json({
      ok: true,
      scriptRunId: existingId,
      idempotent: true,
      status: existingStatus,
      beatCount: existingBeatCount,
    });
  }

  const resolvedSeed = resolveSeed(inputSeed || idempotencyKey);

  // Read project lane once for CIK lane-aware checks
  let projectLane: string | undefined;
  try {
    const { data: projRow } = await db.from("projects").select("assigned_lane").eq("id", projectId).single();
    projectLane = projRow?.assigned_lane || undefined;
  } catch { /* no lane available — defaults apply */ }
  const normalizedProjectLane = projectLane?.trim().toLowerCase().replace(/-/g, "_");

  // ── Use shared canon pack context builder ──
  const packCtx = await compileTrailerContext(db, projectId, canonPackId);
  const canonText = packCtx.mergedText;

  // ── Derive style constraints from options ──
  const so = styleOptions as Record<string, any>;
  const styleSection = buildStyleOptionsSection(so, trailerType);
  const inspirationSection = buildInspirationSection(inspirationRefs, referenceNotes, avoidNotes);
  const targetLengthDirective = targetLengthMs ? `\nTARGET LENGTH OVERRIDE: ~${Math.round(targetLengthMs / 1000)} seconds.\n` : "";

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
    style_options_json: so,
    inspiration_refs_json: inspirationRefs,
    reference_notes: referenceNotes || null,
    avoid_notes: avoidNotes || null,
    strict_canon_mode: strictCanonMode,
    target_length_ms: targetLengthMs,
    style_preset_key: stylePresetKey,
  }).select().single();
  if (runErr) return json({ error: runErr.message }, 500);

  try {
    // ── IFFY Trailer Script Master Prompt ──
    const systemMsg = `You are IFFY's Cinematic Trailer Architect.
You output STRICT JSON only. No markdown. No commentary. No explanation.`;

    const userPrompt = `You are IFFY's Cinematic Trailer Architect.

Your task is to create a STRUCTURED, EDITORIAL TRAILER SCRIPT that will directly power AI video generation (Veo + Runway) and rhythmic assembly.

You are not writing a synopsis.
You are not inventing scenes.
You are designing a trailer experience.

You MUST strictly obey the CANON TEXT.
You may ONLY use material present in the canon.
You may reorder emphasis but NEVER invent new characters, locations, events, or dialogue.

If uncertain:
→ Use abstraction or implication.
→ Do NOT fabricate.

------------------------------------------------------------
CONTEXT
------------------------------------------------------------

TRAILER TYPE: ${trailerType}
GENRE: ${genreKey}
PLATFORM TARGET: ${platformKey}
TARGET LENGTH: 90–120 seconds
SEED: ${resolvedSeed}

CANON TEXT:
${canonText.slice(0, 16000)}
${styleSection}${inspirationSection}${targetLengthDirective}
------------------------------------------------------------
OBJECTIVE
------------------------------------------------------------

Design a theatrical, studio-grade trailer blueprint that:
• Escalates emotionally and kinetically
• Balances silence and impact
• Uses contrast strategically
• Supports AI-driven cinematic shot generation
• Preserves narrative mystery

This output will feed:
→ Shot Design Engine
→ Clip Generator
→ Rhythm Grid
→ Audio Engine

So structure matters.

------------------------------------------------------------
TRAILER PHASE ARCHITECTURE
------------------------------------------------------------

1. HOOK
2. SETUP
3. ESCALATION
4. TWIST
5. CRESCENDO
6. BUTTON

Total beats: 8–14 maximum.
Each phase: 1–3 beats.

------------------------------------------------------------
FOR EACH BEAT RETURN STRICT JSON OBJECT:
------------------------------------------------------------

{
  "beat_index": number,
  "phase": "hook|setup|escalation|twist|crescendo|button",
  "title": "editorial label (short)",
  "emotional_intent": "what audience should feel",
  "quoted_dialogue": "short exact fragment from canon OR null",
  "text_card": "marketing text card OR null",
  "withholding_note": "what information we are deliberately not revealing",
  "trailer_moment_flag": boolean,
  "movement_intensity_target": number (1–10),
  "shot_density_target": number (0.5–3.0),
  "contrast_delta_score": number (0.0–1.0),
  "silence_before_ms": number,
  "silence_after_ms": number,
  "source_refs_json": [
    {
      "doc_type": "script|outline|treatment|etc",
      "location": "scene/page/section if known",
      "excerpt": "short exact excerpt from canon"
    }
  ],
  "generator_hint_json": {
    "visual_prompt": "concise cinematic description grounded in canon",
    "shot_type": "wide|medium|close|insert|montage",
    "camera_move": "push_in|track|arc|handheld|static|whip_pan|crane|tilt|pull_out",
    "lens_mm": number or null,
    "movement_style": "restrained|measured|kinetic|micro-montage",
    "preferred_provider": "runway|veo"
  }
}

------------------------------------------------------------
PHASE RULES
------------------------------------------------------------

HOOK
• Immediate disruption, tension, or intrigue.
• No exposition dump.
• movement_intensity_target 4–6.
• Often restrained with silence.

SETUP
• Establish tone and stakes.
• movement_intensity_target 3–5.
• Allow breathing room.

ESCALATION
• Raise stakes and energy.
• movement_intensity_target 5–7.
• Increase visual dynamism.

TWIST
• Reframe expectation.
• Use silence_before_ms strategically.
• movement_intensity_target 6–8.

CRESCENDO
• Micro-montage intensity.
• Rapid tonal contrast.
• shot_density_target >= 2.0.
• movement_intensity_target >= 7.
• Designed for kinetic AI video.

BUTTON
• Final emotional sting.
• Often contrastive or restrained.
• movement_intensity_target 4–6.

------------------------------------------------------------
ESCALATION RULES
------------------------------------------------------------

• Movement intensity must generally build across phases.
• At least 2 beats must use silence windows.
• Crescendo must include montage energy.
• Contrast (quiet vs loud, slow vs fast) must exist.
• Do NOT reveal full narrative resolution unless trailer_type="spoiler".

------------------------------------------------------------
CINEMATIC GUIDELINES
------------------------------------------------------------

• Think in shots, not scenes.
• Design beats that can be visualised clearly.
• Avoid vague description.
• Avoid summary language.
• Avoid generic marketing phrases.
• Prioritise tension, contrast, implication.

------------------------------------------------------------
HARD CONSTRAINTS
------------------------------------------------------------

1. Every beat MUST contain at least 1 valid citation.
2. quoted_dialogue MUST exist verbatim in canon.
3. No fabricated imagery outside canon.
4. No invented characters or events.
5. If uncertain → imply, do not invent.

------------------------------------------------------------
QUALITY TARGET
------------------------------------------------------------

This must feel like:
• A24 prestige trailer
• Netflix flagship series launch
• Warner Bros theatrical main trailer

It must NOT feel like:
• AI summary
• Generic outline
• Script recap
• Scene breakdown

------------------------------------------------------------
RETURN STRICT JSON:
------------------------------------------------------------

{
  "beats": [ ... ],
  "structure_score": number (0–100),
  "cinematic_score": number (0–100),
  "warnings": [ "any structural or canon risks detected" ]
}

------------------------------------------------------------
INTERNAL CIK METADATA (REQUIRED)
------------------------------------------------------------

You MUST include a top-level "cik" object in your JSON response.
It contains internal quality-scoring metadata and will be stripped before storage.

"cik": {
  "units": [
    {
      "id": "beat_0",
      "intent": "intrigue|threat|wonder|chaos|emotion|release",
      "energy": 0.0-1.0,
      "tension": 0.0-1.0,
      "density": 0.0-1.0,
      "tonal_polarity": -1.0 to 1.0
    }
  ]
}

Rules for cik.units:
- Array length MUST equal the number of beats returned.
- Each unit id MUST be "beat_0", "beat_1", etc., matching beat order.
- intent: choose the single dominant intent for each beat.
- energy/tension/density: 0.0 to 1.0 floats reflecting beat intensity.
- tonal_polarity: -1.0 (dark/threatening) to 1.0 (hopeful/uplifting).
- Do NOT omit any field. Do NOT change the main output schema.

CIK QUALITY MINIMUMS (MUST SATISFY):
- PEAK: At least one of the final 2 units must have energy >= 0.90 AND tension >= 0.80.
- CONTRAST: At least one adjacent pair of units must have an energy increase >= 0.20.

Return only valid JSON.
No commentary.
No explanation.
No markdown.`;

    const parsedRaw = await callLLMWithJsonRetry({
      apiKey,
      model: MODELS.PRO,
      system: systemMsg,
      user: userPrompt,
      temperature: 0.4,
      maxTokens: 14000,
    }, {
      handler: "create_trailer_script_v2",
      validate: (d): d is any => Array.isArray(d) || (d && Array.isArray(d.beats)),
    });

    // ── CIK quality gate (1 bounded repair attempt) ──
    const rawBeats = parsedRaw?.beats || (Array.isArray(parsedRaw) ? parsedRaw : []);
    const trailerExpectedUnitCount = rawBeats.length > 0 ? rawBeats.length : undefined;
    const cikRouter0 = selectCikModel({ attemptIndex: 0, lane: normalizedProjectLane || "unknown" });
    const cikRouter1 = selectCikModel({ attemptIndex: 1, lane: normalizedProjectLane || "unknown", attempt0HardFailures: [] }); // placeholder; actual failures not known yet

    let parsed: any;
    let qualitySoftFailWarning: string | null = null;
    try {
      parsed = await enforceCinematicQuality({
        handler: "trailer-cinematic-engine",
        phase: "create_trailer_script_v2",
        model: MODELS.PRO,
        rawOutput: parsedRaw,
        adapter: (raw: any) => adaptTrailerOutputWithMode(raw, trailerExpectedUnitCount),
        buildRepairInstruction: buildTrailerRepairInstruction,
        expected_unit_count: trailerExpectedUnitCount,
        lane: normalizedProjectLane,
        modelRouter: { attempt0: cikRouter0, attempt1: cikRouter1 },
        regenerateOnce: async (repairInstruction: string) => {
          return await callLLMWithJsonRetry({
            apiKey,
            model: MODELS.PRO,
            system: systemMsg + "\n\n" + repairInstruction,
            user: userPrompt,
            temperature: 0.4,
            maxTokens: 14000,
          }, {
            handler: "create_trailer_script_v2_repair",
            validate: (d): d is any => Array.isArray(d) || (d && Array.isArray(d.beats)),
          });
        },
      });
    } catch (qualityErr: any) {
      if (qualityErr?.type === "AI_CINEMATIC_QUALITY_FAIL") {
        // Soft-fail for script generation: keep beats so downstream rhythm/shot stages can still run.
        parsed = parsedRaw;
        qualitySoftFailWarning = typeof qualityErr?.message === "string"
          ? qualityErr.message
          : "CIK quality gate failed; script marked needs_repair for iterative refinement.";
      } else {
        throw qualityErr;
      }
    }

    const beatArray: any[] = Array.isArray(parsed) ? parsed : (parsed.beats || []);

    // Validate beat count
    if (beatArray.length < 8 || beatArray.length > 14) {
      const warn = `Beat count ${beatArray.length} outside 8-14 range`;
      // Non-fatal: clamp or warn
      console.warn(warn);
    }

    // Validate source_refs_json — hard fail if any beat has zero citations
    const missingCitations = beatArray.filter((b: any) =>
      !b.source_refs_json || !Array.isArray(b.source_refs_json) || b.source_refs_json.length === 0
    );
    if (missingCitations.length > 0) {
      await db.from("trailer_script_runs").update({
        status: "error",
        warnings: [`${missingCitations.length} beat(s) missing source citations: indices ${missingCitations.map((b: any) => b.beat_index).join(", ")}`],
      }).eq("id", run.id);
      return json({
        error: `Canon citation requirement failed: ${missingCitations.length} beat(s) have empty source_refs_json`,
        beatIndices: missingCitations.map((b: any) => b.beat_index),
      }, 400);
    }

    // Validate quoted_dialogue — mode-dependent
    for (const b of beatArray) {
      if (b.quoted_dialogue && typeof b.quoted_dialogue === "string") {
        const dialogueNorm = b.quoted_dialogue.toLowerCase().trim();
        if (dialogueNorm.length > 0 && !canonText.toLowerCase().includes(dialogueNorm)) {
          if (strictCanonMode === "strict") {
            // In strict mode, fail hard
            await db.from("trailer_script_runs").update({
              status: "error",
              warnings: [`Beat #${b.beat_index}: quoted_dialogue not found in canon (strict mode)`],
            }).eq("id", run.id);
            return json({
              error: `Strict canon violation: Beat #${b.beat_index} quoted_dialogue not found in canon`,
              beatIndex: b.beat_index,
            }, 400);
          }
          // Balanced mode: nullify and warn
          b.quoted_dialogue = null;
          if (!parsed.warnings) parsed.warnings = [];
          parsed.warnings.push(`Beat #${b.beat_index}: quoted_dialogue not found in canon, nullified`);
        }
      }
    }

    // Balanced mode: check citation excerpts and warn (strict fails in gates)
    if (strictCanonMode === "balanced") {
      const canonLower = canonText.toLowerCase();
      for (const b of beatArray) {
        if (Array.isArray(b.source_refs_json)) {
          for (const ref of b.source_refs_json) {
            if (ref.excerpt && typeof ref.excerpt === "string") {
              const excNorm = ref.excerpt.toLowerCase().trim();
              if (excNorm.length > 10 && !canonLower.includes(excNorm)) {
                if (!parsed.warnings) parsed.warnings = [];
                parsed.warnings.push(`Beat #${b.beat_index}: citation excerpt not found in canon (may be paraphrase)`);
              }
            }
          }
        }
      }
    }

    // Run gates with dynamic options
    const gateOpts: GateOpts = {
      minSilenceWindows: so.minSilenceWindows ?? 2,
      microMontageIntensity: so.microMontageIntensity ?? "medium",
      strictCanonMode,
      canonText: strictCanonMode === "strict" ? canonText : "",
      trailerType,
    };
    const gateResult = runScriptGates(beatArray, run, gateOpts);

    // Use LLM-provided scores (0-100) or compute fallback
    const structureScore = (parsed.structure_score != null ? parsed.structure_score / 100 : (gateResult.passed ? 0.9 : 0.5));
    const cinematicScore = (parsed.cinematic_score != null ? parsed.cinematic_score / 100 : 0.7);

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

    // Merge all warnings
    const allWarnings = [...(gateResult.failures || []), ...(parsed.warnings || [])];
    if (qualitySoftFailWarning) allWarnings.push(qualitySoftFailWarning);

    // Target length soft validation
    if (targetLengthMs) {
      const secs = targetLengthMs / 1000;
      const softLimits: Record<string, [number, number]> = {
        teaser: [15, 70], main: [80, 140], character: [50, 110], tone: [40, 90], sales: [90, 200],
      };
      const [lo, hi] = softLimits[trailerType] || [30, 180];
      if (secs < lo || secs > hi) {
        allWarnings.push(`Target length ${secs}s outside typical range for ${trailerType} (${lo}–${hi}s)`);
      }
    }

    // Update run status + persist gates
    const status = gateResult.passed ? "complete" : "needs_repair";
    await db.from("trailer_script_runs").update({
      status,
      structure_score: structureScore,
      cinematic_score: cinematicScore,
      warnings: allWarnings,
      gates_json: gateResult,
    }).eq("id", run.id);

    // Auto-export as project document (fire-and-forget, don't block return)
    if (status === "complete") {
      try {
        await handleExportTrailerScriptDocument(db, { projectId, scriptRunId: run.id }, userId);
      } catch (exportErr: any) {
        console.warn("Auto-export trailer script document failed:", exportErr.message);
      }
    }

    return json({
      ok: true,
      scriptRunId: run.id,
      status,
      beatCount: beatArray.length,
      structureScore,
      cinematicScore,
      gatesPassed: gateResult.passed,
      warnings: allWarnings,
      seed: resolvedSeed,
      saved: {
        styleOptions: so,
        strictCanonMode,
        targetLengthMs,
        inspirationRefsCount: inspirationRefs.length,
      },
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

  // Determine BPM based on genre + project bias
  const genreBpm: Record<string, number> = {
    action: 140, thriller: 120, horror: 90, drama: 100, comedy: 110,
    scifi: 130, romance: 95, documentary: 85, animation: 115,
  };
  const baseBpm = genreBpm[scriptRun.genre_key] || 110;
  let bpm = baseBpm + Math.floor(rng() * 20 - 10);

  // Apply learned pacing bias
  let projectBias: any = null;
  try {
    const { data: proj } = await db.from("projects").select("trailer_bias_json").eq("id", projectId).single();
    projectBias = proj?.trailer_bias_json || null;
  } catch { /* no bias column yet */ }
  if (projectBias?.pacing_bias === "faster") bpm = Math.round(bpm * 1.10);
  else if (projectBias?.pacing_bias === "slower") bpm = Math.round(bpm * 0.90);

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
Given a BPM of ${bpm} and a list of trailer beats with their intensity/density targets, design a precise rhythm grid with editorial hit points and silence constraints.

Return STRICT JSON:
{
  "phase_timings": {"hook":{"start_ms":0,"end_ms":3000},"setup":{"start_ms":3000,"end_ms":12000},...},
  "beat_grid": [{"beat_index":0,"start_ms":0,"end_ms":3000,"on_beat":true,"cut_type":"hard"},...],
  "shot_duration_curve": [{"t_ms":0,"target_shot_ms":2000},{"t_ms":30000,"target_shot_ms":800},...],
  "density_curve": [{"t_ms":0,"shots_per_sec":0.5},{"t_ms":60000,"shots_per_sec":3.0},...],
  "drop_timestamp_ms": 45000,
  "silence_windows": [{"start_ms":25000,"end_ms":26500,"reason":"anticipation|reveal|breath|impact"},...],
  "hit_points": [
    {
      "t_ms": number,
      "type": "sting|impact|riser_end|bass_drop|button_stinger|hard_cut",
      "strength": 1-10,
      "beat_index": number_or_null,
      "phase": "hook|setup|escalation|twist|crescendo|button",
      "note": "what the audio should do here"
    }
  ],
  "beat_hit_intents": [
    {
      "beat_index": number,
      "primary_hit": "none|sting|impact|riser|drop|button",
      "secondary_hits": ["whoosh","slam","reverse","sub_drop"],
      "silence_before_ms": number,
      "silence_after_ms": number
    }
  ],
  "warnings": []
}

Rules:
- Each cut should align to a beat of the BPM grid (${Math.round(60000 / bpm)}ms per beat)
- Shot durations should decrease from ~2-3s in hook/setup to ~0.3-0.5s in crescendo
- The "drop" is the most impactful moment — place it at the crescendo start
- Silence windows must match the beat's silence_before/after_ms values
- density_curve tracks average shots per second, increasing toward crescendo

HIT POINT RULES (mandatory):
- MUST include at least 1 hit in hook phase (type: sting or impact, strength >= 6)
- MUST include at least 1 hit at twist phase (type: impact or hard_cut, strength >= 7)
- MUST include at least 1 bass_drop or major hit (strength >= 8) at crescendo start
- MUST include at least 1 button_stinger near the end (final 10% of timeline)
- Hit points define where audio SFX must land — they are sync markers
- beat_hit_intents must be provided for EVERY beat, matching silence_before/after from script

SILENCE CONSTRAINT RULES:
- silence_windows must include ALL beat-level silence_before_ms and silence_after_ms from the input
- Do NOT contradict script beat silence windows — they are authoritative
- Add additional silence windows only for dramatic effect (anticipation, reveal)`;

    const parsed = await callLLMWithJsonRetry({
      apiKey,
      model: MODELS.BALANCED,
      system,
      user: `BPM: ${bpm}\nBeats:\n${beatSummary}`,
      temperature: 0.3,
      maxTokens: 10000,
    }, {
      handler: "create_rhythm_grid_v2",
      validate: (d): d is any => d && Array.isArray(d.hit_points),
    });

    // Validate required hit points
    const hitPoints = parsed.hit_points || [];
    const hitWarnings: string[] = [];
    
    const hasHookHit = hitPoints.some((h: any) => h.phase === "hook" && ["sting", "impact"].includes(h.type));
    const hasTwistHit = hitPoints.some((h: any) => h.phase === "twist" && ["impact", "hard_cut"].includes(h.type));
    const hasCrescendoHit = hitPoints.some((h: any) => h.phase === "crescendo" && h.strength >= 8);
    const hasButtonStinger = hitPoints.some((h: any) => h.type === "button_stinger");

    if (!hasHookHit) hitWarnings.push("Missing hook sting/impact hit — audio sync may be weak at open");
    if (!hasTwistHit) hitWarnings.push("Missing twist impact hit — twist moment won't land");
    if (!hasCrescendoHit) hitWarnings.push("Missing high-strength crescendo hit — drop won't feel impactful");
    if (!hasButtonStinger) hitWarnings.push("Missing button stinger — ending may lack finality");

    const allWarnings = [...(parsed.warnings || []), ...hitWarnings];

    // Build audio plan from rhythm data
    const tempRun = {
      bpm,
      hit_points_json: hitPoints,
      silence_windows_json: parsed.silence_windows || [],
      phase_timings_json: parsed.phase_timings || {},
      drop_timestamp_ms: parsed.drop_timestamp_ms || null,
      beat_hit_intents_json: parsed.beat_hit_intents || [],
      beat_grid_json: parsed.beat_grid || [],
    };
    const styleOpts = scriptRun.style_options_json || {};
    const audioPlan = buildAudioPlan(tempRun, styleOpts);

    await db.from("trailer_rhythm_runs").update({
      status: "complete",
      phase_timings_json: parsed.phase_timings || {},
      beat_grid_json: parsed.beat_grid || [],
      shot_duration_curve_json: parsed.shot_duration_curve || [],
      density_curve_json: parsed.density_curve || null,
      drop_timestamp_ms: parsed.drop_timestamp_ms || null,
      silence_windows_json: audioPlan.silence_windows,
      hit_points_json: hitPoints,
      beat_hit_intents_json: parsed.beat_hit_intents || [],
      audio_plan_json: audioPlan,
      warnings: allWarnings,
    }).eq("id", run.id);

    return json({
      ok: true,
      rhythmRunId: run.id,
      status: "complete",
      bpm,
      dropMs: parsed.drop_timestamp_ms,
      hitPointCount: hitPoints.length,
      hitCoverage: {
        hook: hasHookHit,
        twist: hasTwistHit,
        crescendo: hasCrescendoHit,
        button: hasButtonStinger,
      },
      warnings: allWarnings,
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

const VALID_CAMERA_MOVES = new Set(["push_in","pull_out","track","arc","handheld","whip_pan","crane","tilt","dolly_zoom","static"]);
const VALID_SHOT_TYPES = new Set(["wide","medium","close","insert","montage","aerial","macro"]);
const VALID_TRANSITIONS = new Set(["hard_cut","match_cut","whip_pan","smash_cut","l_cut","j_cut","dissolve","dip_to_black","strobe_cut"]);
const VALID_DEPTH = new Set(["shallow","deep","mixed"]);

function buildShotDesignStyleDirectives(so: Record<string, any>, trailerType: string, platformKey: string, targetLengthMs?: number): string {
  const lines: string[] = [
    "------------------------------------------------------------",
    "STYLE DIRECTIVES (obey these)",
    "------------------------------------------------------------",
    `TRAILER TYPE: ${trailerType}`,
    `PLATFORM: ${platformKey}`,
  ];
  if (targetLengthMs) lines.push(`TARGET LENGTH: ~${Math.round(targetLengthMs / 1000)}s`);
  if (so.tonePreset) lines.push(`TONE: ${so.tonePreset}`);
  if (so.pacingProfile) lines.push(`PACING: ${so.pacingProfile}`);
  if (so.revealStrategy) lines.push(`REVEAL: ${so.revealStrategy}`);
  if (so.movementOverall != null) lines.push(`MOVEMENT BASELINE: ${so.movementOverall}/10`);
  if (so.cameraStyle) {
    const camMap: Record<string, string> = {
      measured: "Controlled, deliberate moves. Cranes, slow dollies, composed arcs.",
      kinetic: "Energetic tracking, push-ins, dynamic movement.",
      handheld: "Handheld micro-shake throughout, intimate documentary energy.",
      floating: "Steadicam/gimbal floating, dreamlike weightless movement.",
      whip_heavy: "Frequent whip pans and fast transitions, high-energy editorial.",
    };
    lines.push(`CAMERA STYLE: ${so.cameraStyle} — ${camMap[so.cameraStyle] || so.cameraStyle}`);
  }
  if (so.lensBias) {
    const lensMap: Record<string, string> = {
      wide: "Favour 16–35mm. Spatial depth, environment-forward.",
      normal: "Favour 40–50mm. Natural perspective.",
      portrait: "Favour 65–135mm. Compressed, intimate, shallow DOF.",
      mixed: "Vary by phase: wide for setup, portrait for emotion, wide+inserts for crescendo.",
    };
    lines.push(`LENS BIAS: ${so.lensBias} — ${lensMap[so.lensBias] || so.lensBias}`);
  }
  if (so.microMontageIntensity) {
    const mmMap: Record<string, string> = { low: "Crescendo: 3 shots, density ~2.0", medium: "Crescendo: 4-5 shots, density ~2.5", high: "Crescendo: 5-7 shots, density ~3.0, rapid-fire" };
    lines.push(`MICRO-MONTAGE: ${so.microMontageIntensity} — ${mmMap[so.microMontageIntensity] || so.microMontageIntensity}`);
  }
  if (so.dropStyle) {
    const dropMap: Record<string, string> = { hard_drop: "Sharp silence before crescendo, clean hard cut.", delayed_drop: "Extended silence (1500-3000ms) before crescendo.", false_drop: "False drop mid-escalation, then real crescendo drop." };
    lines.push(`DROP STYLE: ${so.dropStyle} — ${dropMap[so.dropStyle] || so.dropStyle}`);
  }
  if (so.sfxEmphasis) lines.push(`SFX EMPHASIS: ${so.sfxEmphasis}`);
  return lines.join("\n");
}

function buildFallbackShotSpecs(beats: any[], seed: string): any[] {
  const rand = mulberry32(`${seed}-shot-fallback`);
  const movesByPhase: Record<string, string[]> = {
    hook: ["push_in", "track", "arc"],
    setup: ["track", "push_in", "tilt"],
    escalation: ["handheld", "track", "push_in", "arc"],
    twist: ["pull_out", "dolly_zoom", "smash_cut" as any],
    crescendo: ["whip_pan", "handheld", "track", "arc", "push_in"],
    button: ["pull_out", "crane", "dissolve" as any],
  };
  const transitions = ["hard_cut", "match_cut", "whip_pan", "smash_cut", "l_cut", "j_cut", "dissolve", "dip_to_black", "strobe_cut"];
  const shotTypes = ["wide", "medium", "close", "insert"];
  const motifs = ["impact", "eyes", "hands", "silhouette", "door", "running", "fire", "water"];

  const specs: any[] = [];
  for (const b of beats) {
    const hint = b.generator_hint_json || {};
    const hasSilence = (b.silence_before_ms > 0) || (b.silence_after_ms > 0);
    const hasWithholding = !!(b.withholding_note && String(b.withholding_note).trim().length > 0);
    const baseMove = movesByPhase[b.phase]?.[0] || "push_in";
    const movePool = movesByPhase[b.phase] || ["push_in", "track", "arc"];

    let targetShots = 1;
    if (b.phase === "crescendo") targetShots = 6;
    else if ((b.shot_density_target || 1) >= 1.8) targetShots = 2;

    for (let i = 0; i < targetShots; i++) {
      const moveCandidate = hint.camera_move || movePool[(i + Math.floor(rand() * 10)) % movePool.length] || baseMove;
      const cameraMove = moveCandidate === "smash_cut" || moveCandidate === "dissolve"
        ? (hasSilence || hasWithholding ? "static" : "push_in")
        : moveCandidate;
      const movementTarget = Number(b.movement_intensity_target || 5);
      const movementIntensity = b.phase === "crescendo"
        ? Math.min(10, Math.max(8, movementTarget + (i % 2)))
        : Math.min(10, Math.max(1, movementTarget + (i === 0 ? 0 : 1)));

      const inTrans = b.phase === "crescendo"
        ? ["whip_pan", "smash_cut", "strobe_cut"][i % 3]
        : transitions[(b.beat_index + i) % transitions.length];
      const outTrans = b.phase === "button"
        ? (i === targetShots - 1 ? "dissolve" : "hard_cut")
        : transitions[(b.beat_index + i + 1) % transitions.length];

      const shot: any = {
        beat_index: b.beat_index,
        shot_index: i,
        shot_type: b.phase === "crescendo" ? shotTypes[(i + 1) % shotTypes.length] : (hint.shot_type || shotTypes[i % shotTypes.length]),
        lens_mm: hint.lens_mm ?? [24, 35, 50, 85][(b.beat_index + i) % 4],
        camera_move: cameraMove,
        movement_intensity: movementIntensity,
        depth_strategy: hint.depth_strategy || (i % 2 === 0 ? "deep" : "shallow"),
        foreground_element: hint.foreground_element || null,
        lighting_note: hint.lighting_note || `${b.phase} cinematic lighting`,
        subject_action: hint.subject_action || b.emotional_intent || "ambient motion",
        reveal_mechanic: hint.reveal_mechanic || "progressive reveal through motion",
        transition_in: inTrans,
        transition_out: outTrans,
        target_duration_ms: b.phase === "crescendo" ? 900 : (b.phase === "button" ? 2600 : 1800),
        prompt_hint_json: {
          visual_prompt: hint.visual_prompt || `${b.phase} beat: ${b.emotional_intent || "cinematic action"}`,
          style: hint.style || null,
          preferred_provider: hint.preferred_provider || "veo",
        },
      };

      if (b.phase === "crescendo") {
        shot.prompt_hint_json.montage_group_id = `mg-${b.beat_index}`;
        shot.prompt_hint_json.cut_on_action = true;
        shot.prompt_hint_json.motif_tag = motifs[(i + b.beat_index) % motifs.length];
      }

      specs.push(shot);
    }
  }
  return specs;
}

async function handleCreateShotDesign(db: any, body: any, userId: string, apiKey: string) {
  const { projectId, scriptRunId, rhythmRunId, seed: inputSeed } = body;
  if (!scriptRunId) return json({ error: "scriptRunId required" }, 400);

  // Load script run for style options
  const { data: scriptRun } = await db.from("trailer_script_runs")
    .select("*").eq("id", scriptRunId).eq("project_id", projectId).single();
  if (!scriptRun) return json({ error: "Script run not found" }, 404);

  const { data: beats } = await db.from("trailer_script_beats")
    .select("*").eq("script_run_id", scriptRunId).order("beat_index");
  if (!beats?.length) return json({ error: "No beats found" }, 400);

  const styleOptions = (scriptRun.style_options_json || {}) as Record<string, any>;

  // Load Look Bible
  const lookBible = await loadLookBible(db, projectId, scriptRunId);
  const lookBibleSection = buildLookBibleSection(lookBible);

  let rhythmContext = "";
  if (rhythmRunId) {
    const { data: rhythm } = await db.from("trailer_rhythm_runs")
      .select("bpm, shot_duration_curve_json, density_curve_json, drop_timestamp_ms")
      .eq("id", rhythmRunId).single();
    if (rhythm) {
      rhythmContext = `\nRHYTHM GRID:\nBPM: ${rhythm.bpm}\nDrop at: ${rhythm.drop_timestamp_ms || "auto"}ms\nShot Duration Curve: ${JSON.stringify(rhythm.shot_duration_curve_json || [])}\nDensity Curve: ${JSON.stringify(rhythm.density_curve_json || [])}`;
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
    // Build beat summary with citations
    const beatSummary = beats.map((b: any) => {
      const refs = (b.source_refs_json || []).slice(0, 2).map((r: any) => `${r.doc_type}:"${(r.excerpt || "").slice(0, 60)}"`).join("; ");
      return `#${b.beat_index} ${b.phase}: intent="${b.emotional_intent}" movement=${b.movement_intensity_target} density=${b.shot_density_target || "auto"} silence_before=${b.silence_before_ms}ms silence_after=${b.silence_after_ms}ms withholding=${b.withholding_note || "none"} hint=${JSON.stringify(b.generator_hint_json || {})} citations=[${refs}]`;
    }).join("\n");

    const styleDirectives = buildShotDesignStyleDirectives(styleOptions, scriptRun.trailer_type || "main", scriptRun.platform_key || "theatrical", scriptRun.target_length_ms);

    const system = composeSystem(`You are a world-class cinematographer designing shot specs for a cinematic trailer.

${styleDirectives}
${lookBibleSection}

------------------------------------------------------------
MOTION RULES (mandatory — every shot must obey)
------------------------------------------------------------
- Each beat MUST contain at least one NON-STATIC moving camera shot unless the beat has silence windows AND is explicitly designed as stillness.
- Moving camera must be motivated and specific. No vague "cinematic movement".
- Valid camera_move: push_in, pull_out, track, arc, handheld, whip_pan, crane, tilt, dolly_zoom, static.
- For every moving shot (non-static), include at least ONE of:
  (a) parallax foreground occlusion (object passes close to lens) — describe in foreground_element
  (b) reveal (camera move reveals new information in frame) — describe in reveal_mechanic
  (c) rack focus / depth shift — describe in depth_strategy + reveal_mechanic
  (d) subject crosses frame with camera tracking — describe in subject_action
- Crescendo beats MUST use micro-montage: 3–7 short shots per crescendo beat, with high motion and varied shot types.
- Static shots are ONLY allowed when beat has silence windows or explicit restraint/withholding.

------------------------------------------------------------
CRESCENDO MICRO-MONTAGE RULES (mandatory for crescendo phase)
------------------------------------------------------------
- Each crescendo beat MUST produce 6–10 rapid micro-shots.
- Every crescendo shot MUST include in prompt_hint_json:
  - "montage_group_id": a shared group identifier (format: "mg-<beat_index>") — ALL shots in the same crescendo beat share this ID.
  - "cut_on_action": boolean — true if this shot's edit point is motivated by in-frame action (a door closing, an impact, a turn, etc.).
  - "motif_tag": a short string labelling the visual motif (e.g. "eyes", "door", "running", "impact", "hands", "fire", "water", "silhouette"). Repeat motif_tags across shots to create rhythmic visual repetition.
- Montage design principles:
  - Alternate shot types rapidly: close → wide → insert → close → medium etc.
  - Use match-action cuts: one shot's exit action matches the next shot's entry.
  - Include at least 2 different motif_tags per crescendo beat for visual variety.
  - At least 50% of crescendo shots should have cut_on_action=true.
  - Use whip_pan, smash_cut, or strobe_cut transitions between montage shots.
  - Duration per shot: 700–1200ms (hard constraint).
  - Movement intensity should be 8–10 for all crescendo montage shots.

------------------------------------------------------------
TRANSITION GRAMMAR (mandatory)
------------------------------------------------------------
- Every shot spec must define transition_in and transition_out.
- Valid transitions: hard_cut, match_cut, whip_pan, smash_cut, l_cut, j_cut, dissolve, dip_to_black, strobe_cut.
- Use variety across the whole plan — NOT all hard_cut.
- Twist beats should include at least one dip_to_black or smash_cut moment.
- Crescendo should use whip_pan, smash_cut, or strobe_cut more often.
- Button should use hard_cut + lingering hold or dissolve.

------------------------------------------------------------
LENS + DEPTH RULES
------------------------------------------------------------
- depth_strategy must be one of: shallow, deep, mixed.
- Every beat must include at least one spec with a clear depth strategy.
- Lens choices:
  wide (16–35mm): spatial reveals, environment
  normal (40–50mm): natural perspective
  portrait (65–135mm): emotion, compression, shallow DOF
- Vary lens by phase unless lens bias overrides.

------------------------------------------------------------
CITATION-ANCHORED VISUALIZATION
------------------------------------------------------------
- For each beat, the shot design must reference the beat's citations.
- Do NOT introduce new named entities, characters, locations, or events.
- If a beat is abstract/atmospheric, describe it as atmospheric and canon-consistent.

------------------------------------------------------------
OUTPUT SCHEMA (STRICT JSON only)
------------------------------------------------------------
Return:
{
  "global_movement_curve": { "hook": 0-10, "setup": 0-10, "escalation": 0-10, "twist": 0-10, "crescendo": 0-10, "button": 0-10 },
  "lens_bias": "wide|normal|portrait|mixed",
  "warnings": [ ... ],
  "shot_specs": [
    {
      "beat_index": number,
      "shot_index": number,
      "shot_type": "wide|medium|close|insert|montage",
      "lens_mm": number|null,
      "camera_move": "push_in|pull_out|track|arc|handheld|whip_pan|crane|tilt|dolly_zoom|static",
      "movement_intensity": 1-10,
      "depth_strategy": "shallow|deep|mixed",
      "foreground_element": "parallax/occlusion element or null",
      "lighting_note": "lighting/mood direction",
      "subject_action": "what moves in frame — REQUIRED unless static",
      "reveal_mechanic": "how the shot reveals info — REQUIRED for moving shots",
      "transition_in": "hard_cut|match_cut|whip_pan|smash_cut|l_cut|j_cut|dissolve|dip_to_black|strobe_cut",
      "transition_out": same enum,
      "target_duration_ms": number,
      "prompt_hint_json": {
        "visual_prompt": "cinematic visual grounded in canon",
        "style": "optional style phrase",
        "preferred_provider": "runway|veo",
        "montage_group_id": "mg-<beat_index> (REQUIRED for crescendo shots)",
        "cut_on_action": true/false (REQUIRED for crescendo shots),
        "motif_tag": "eyes|door|running|impact|etc (REQUIRED for crescendo shots)"
      }
    }
  ]
}

DURATION RULES:
- Crescendo shots: 700–1200ms each (HARD CONSTRAINT)
- Other shots: 1200–6000ms (button may be up to 8000ms)

Do NOT include copyrighted references. Do NOT invent new characters/locations. Use citations implicitly.
No commentary. No explanation. No markdown. Only valid JSON.${rhythmContext}`);

    let parsed: any;
    try {
      parsed = await callLLMWithJsonRetry({
        apiKey,
        model: MODELS.PRO,
        system,
        user: `BEATS:\n${beatSummary}\nSeed: ${resolvedSeed}`,
        temperature: 0.35,
        maxTokens: 14000,
      }, {
        handler: "create_shot_design_v2",
        validate: (d): d is any => {
          if (!d) return false;
          // Case 1: raw array — LLM returned [...] instead of { shot_specs: [...] }
          if (Array.isArray(d) && d.length > 0) return true;
          if (typeof d !== "object") return false;
          // Case 2: proper wrapper with shot_specs or shots
          if (Array.isArray(d.shot_specs) && d.shot_specs.length > 0) return true;
          if (Array.isArray(d.shots) && d.shots.length > 0) return true;
          // Case 3: any array property containing objects
          for (const key of Object.keys(d)) {
            if (Array.isArray(d[key]) && d[key].length > 0 && typeof d[key][0] === "object") {
              d.shot_specs = d[key];
              return true;
            }
          }
          return false;
        },
      });
    } catch (err: any) {
      const isAiJsonParseError = err?.type === "AI_JSON_PARSE_ERROR" || String(err?.message || "").includes("AI_JSON_PARSE_ERROR");
      if (!isAiJsonParseError) throw err;

      console.error(JSON.stringify({
        type: "SHOT_DESIGN_CHUNKED_FALLBACK",
        handler: "create_shot_design_v2",
        model: MODELS.PRO,
        beatCount: beats.length,
        reason: err?.message || "unknown",
      }));

      try {
        const chunkedShotSpecs = await callLLMChunked<any, any>({
          llmOpts: {
            apiKey,
            model: MODELS.PRO,
            system: `${system}\n\nFALLBACK MODE: You are processing a subset of beats. Return ONLY valid JSON with this shape: {"shot_specs":[...]}.\nNever return a beats wrapper. No markdown. No prose.`,
            temperature: 0.2,
            maxTokens: 7000,
          },
          items: beats,
          batchSize: 4,
          maxBatches: 8,
          handler: "create_shot_design_v2_chunked",
          buildUserPrompt: (batch, batchIndex, totalBatches) => {
            const batchSummary = batch.map((b: any) => {
              const refs = (b.source_refs_json || []).slice(0, 2).map((r: any) => `${r.doc_type}:"${(r.excerpt || "").slice(0, 60)}"`).join("; ");
              return `#${b.beat_index} ${b.phase}: intent="${b.emotional_intent}" movement=${b.movement_intensity_target} density=${b.shot_density_target || "auto"} silence_before=${b.silence_before_ms}ms silence_after=${b.silence_after_ms}ms withholding=${b.withholding_note || "none"} hint=${JSON.stringify(b.generator_hint_json || {})} citations=[${refs}]`;
            }).join("\n");

            return `BATCH ${batchIndex + 1}/${totalBatches}\nGenerate shot_specs ONLY for these beats:\n${batchSummary}\nSeed: ${resolvedSeed}-batch-${batchIndex + 1}`;
          },
          validate: (d): d is any => {
            if (!d) return false;
            if (Array.isArray(d) && d.length > 0) return true;
            if (typeof d !== "object") return false;
            if (Array.isArray(d.shot_specs) && d.shot_specs.length > 0) return true;
            if (Array.isArray(d.shots) && d.shots.length > 0) return true;
            for (const key of Object.keys(d)) {
              if (Array.isArray(d[key]) && d[key].length > 0 && typeof d[key][0] === "object") return true;
            }
            return false;
          },
          extractItems: (result: any) => {
            if (Array.isArray(result)) return result;
            if (Array.isArray(result.shot_specs)) return result.shot_specs;
            if (Array.isArray(result.shots)) return result.shots;
            for (const key of Object.keys(result || {})) {
              if (Array.isArray(result[key]) && result[key].length > 0 && typeof result[key][0] === "object") return result[key];
            }
            return [];
          },
          getKey: (item: any) => `${item?.beat_index ?? "x"}:${item?.shot_index ?? "x"}:${(item?.prompt_hint_json?.visual_prompt || item?.subject_action || "").slice(0, 80)}`,
          dedupe: "first",
        });

        parsed = { shot_specs: chunkedShotSpecs };
      } catch (chunkErr: any) {
        console.error(JSON.stringify({
          type: "SHOT_DESIGN_DETERMINISTIC_FALLBACK",
          handler: "create_shot_design_v2",
          model: MODELS.PRO,
          beatCount: beats.length,
          reason: chunkErr?.message || "chunked_failed",
        }));
        parsed = { shot_specs: buildFallbackShotSpecs(beats, resolvedSeed) };
      }
    }

    // Normalize: if LLM returned a raw array, wrap & transform it
    if (Array.isArray(parsed)) {
      const first = parsed[0];
      if (first && ("beat_index" in first || "shot_index" in first) && ("camera_move" in first || "shot_type" in first)) {
        // Already shot_specs format
        parsed = { shot_specs: parsed };
      } else if (first && typeof first === "object") {
        // Beat-level objects — extract shot specs from each beat
        const extractedSpecs: any[] = [];
        for (let i = 0; i < parsed.length; i++) {
          const beatObj = parsed[i];
          const beatIndex = (typeof beatObj.beat_index === "number") ? beatObj.beat_index
            : (typeof beatObj.id === "number") ? beatObj.id : i;
          const hint = beatObj.hint || {};
          if (Array.isArray(beatObj.shots) && beatObj.shots.length > 0) {
            for (const s of beatObj.shots) {
              extractedSpecs.push({ ...s, beat_index: beatIndex });
            }
          } else {
            extractedSpecs.push({
              beat_index: beatIndex,
              shot_index: 0,
              shot_type: hint.shot_type || beatObj.shot_type || "medium",
              lens_mm: hint.lens_mm || null,
              camera_move: hint.camera_move || beatObj.camera_move || "push_in",
              movement_intensity: beatObj.movement ?? beatObj.movement_intensity ?? 5,
              depth_strategy: hint.depth_strategy || "mixed",
              foreground_element: hint.foreground_element || null,
              lighting_note: hint.lighting_note || beatObj.lighting_note || null,
              subject_action: hint.subject_action || beatObj.subject_action || "ambient motion",
              reveal_mechanic: hint.reveal_mechanic || beatObj.reveal_mechanic || "progressive reveal",
              transition_in: hint.transition_in || "hard_cut",
              transition_out: hint.transition_out || "hard_cut",
              target_duration_ms: hint.target_duration_ms || beatObj.target_duration_ms || null,
              prompt_hint_json: {
                visual_prompt: hint.visual_prompt || beatObj.visual_prompt || beatObj.intent || "",
                style: hint.style || beatObj.movement_style || null,
                preferred_provider: hint.preferred_provider || "veo",
              },
            });
          }
        }
        parsed = { shot_specs: extractedSpecs };
      } else {
        parsed = { shot_specs: parsed };
      }
    }

    const shotSpecs = parsed.shot_specs || parsed.shots || [];

    // ── Validation ──
    const valErrors: string[] = [];

    if (shotSpecs.length === 0) {
      valErrors.push("No shot specs returned");
    }

    // Group specs by beat_index
    const specsByBeat: Record<number, any[]> = {};
    for (const s of shotSpecs) {
      const bi = s.beat_index;
      if (!specsByBeat[bi]) specsByBeat[bi] = [];
      specsByBeat[bi].push(s);
    }

    const crescendoShotsPerBeat: Record<number, number> = {};

    for (const b of beats) {
      const bi = b.beat_index;
      let bSpecs = specsByBeat[bi] || [];

      if (bSpecs.length === 0) {
        const synthesized = buildFallbackShotSpecs([b], `${resolvedSeed}-missing-${bi}`);
        if (synthesized.length > 0) {
          bSpecs = synthesized;
          specsByBeat[bi] = synthesized;
          shotSpecs.push(...synthesized);
          console.error(JSON.stringify({ type: "SHOT_DESIGN_BEAT_SYNTHESIZED", beat_index: bi }));
        } else {
          valErrors.push(`Beat #${bi} (${b.phase}): no shot specs`);
          continue;
        }
      }

      // Crescendo: at least 3 shots — auto-repair if insufficient
      if (b.phase === "crescendo") {
        if (bSpecs.length < 3 && bSpecs.length > 0) {
          const baseDur = 900;
          const moves = ["whip_pan", "handheld", "track", "push_in", "arc"];
          const types = ["close", "insert", "medium", "wide"];
          const motifs = ["impact", "eyes", "hands", "silhouette", "door", "running"];
          const transitions = ["smash_cut", "whip_pan", "strobe_cut"];
          const base = bSpecs[0];
          const basePrompt = base.prompt_hint_json?.visual_prompt || base.subject_action || b.emotional_intent || "";
          while (bSpecs.length < 6) {
            const idx = bSpecs.length;
            bSpecs.push({
              beat_index: bi,
              shot_index: idx,
              shot_type: types[idx % types.length],
              lens_mm: [24, 35, 50, 85, 100][idx % 5],
              camera_move: moves[idx % moves.length],
              movement_intensity: 8 + (idx % 3),
              depth_strategy: idx % 2 === 0 ? "shallow" : "deep",
              foreground_element: null,
              lighting_note: base.lighting_note || "high contrast",
              subject_action: base.subject_action || "rapid action",
              reveal_mechanic: "match-action cut reveals new angle",
              transition_in: transitions[idx % transitions.length],
              transition_out: transitions[(idx + 1) % transitions.length],
              target_duration_ms: baseDur,
              prompt_hint_json: {
                visual_prompt: `${basePrompt} — rapid montage angle ${idx + 1}`,
                style: base.prompt_hint_json?.style || null,
                preferred_provider: base.prompt_hint_json?.preferred_provider || "veo",
                montage_group_id: `mg-${bi}`,
                cut_on_action: true,
                motif_tag: motifs[idx % motifs.length],
              },
            });
          }
          // Update specsByBeat reference & shotSpecs array
          specsByBeat[bi] = bSpecs;
          // Replace in main array
          const newSpecs: any[] = [];
          for (const b2 of beats) {
            newSpecs.push(...(specsByBeat[b2.beat_index] || []));
          }
          shotSpecs.length = 0;
          shotSpecs.push(...newSpecs);
          console.error(JSON.stringify({ type: "CRESCENDO_AUTO_REPAIR", beat_index: bi, expanded_to: bSpecs.length }));
        }
        crescendoShotsPerBeat[bi] = bSpecs.length;
      }

      // Non-crescendo non-silence beats: forbid all-static
      const hasSilence = (b.silence_before_ms > 0) || (b.silence_after_ms > 0);
      const hasWithholding = b.withholding_note && b.withholding_note.trim().length > 0;
      if (b.phase !== "crescendo" && !hasSilence && !hasWithholding) {
        const allStatic = bSpecs.every((s: any) => s.camera_move === "static");
        if (allStatic) {
          valErrors.push(`Beat #${bi} (${b.phase}): all shots static without silence/withholding`);
        }
      }

      // Per-spec validation
      for (const s of bSpecs) {
        if (s.camera_move && !VALID_CAMERA_MOVES.has(s.camera_move)) {
          valErrors.push(`Beat #${bi} shot #${s.shot_index}: invalid camera_move "${s.camera_move}"`);
        }
        if (s.shot_type && !VALID_SHOT_TYPES.has(s.shot_type)) {
          // soft: remap
          s.shot_type = "medium";
        }
        if (s.transition_in && !VALID_TRANSITIONS.has(s.transition_in)) {
          s.transition_in = "hard_cut";
        }
        if (s.transition_out && !VALID_TRANSITIONS.has(s.transition_out)) {
          s.transition_out = "hard_cut";
        }
        if (s.depth_strategy && !VALID_DEPTH.has(s.depth_strategy)) {
          s.depth_strategy = "mixed";
        }
        const mi = s.movement_intensity;
        if (mi != null && (mi < 1 || mi > 10)) {
          valErrors.push(`Beat #${bi} shot #${s.shot_index}: movement_intensity ${mi} out of range 1-10`);
        }
        // subject_action required for moving shots
        if (s.camera_move && s.camera_move !== "static" && !s.subject_action) {
          s.subject_action = "ambient motion";
        }
        // reveal_mechanic required for moving shots
        if (s.camera_move && s.camera_move !== "static" && !s.reveal_mechanic) {
          s.reveal_mechanic = "progressive reveal through camera movement";
        }
        // Duration validation
        const dur = s.target_duration_ms;
        if (dur != null) {
          if (b.phase === "crescendo" && (dur < 700 || dur > 1400)) {
            // clamp
            s.target_duration_ms = Math.max(700, Math.min(1400, dur));
          } else if (b.phase !== "crescendo") {
            const maxDur = b.phase === "button" ? 8000 : 6000;
            if (dur < 1200 || dur > maxDur) {
              s.target_duration_ms = Math.max(1200, Math.min(maxDur, dur));
            }
          }
        }
      }
    }

    if (valErrors.length > 0) {
      await db.from("trailer_shot_design_runs").update({ status: "error", warnings: valErrors }).eq("id", run.id);
      return json({ ok: false, error: "Shot design validation failed", failures: valErrors }, 400);
    }

    // ── Validate crescendo montage metadata ──
    const montageWarnings: string[] = [];
    for (const b of beats) {
      if (b.phase !== "crescendo") continue;
      const bSpecs = specsByBeat[b.beat_index] || [];
      const withMontageGroup = bSpecs.filter((s: any) => s.prompt_hint_json?.montage_group_id);
      if (bSpecs.length > 0 && withMontageGroup.length === 0) {
        // Auto-inject montage metadata for crescendo specs
        for (const s of bSpecs) {
          if (!s.prompt_hint_json) s.prompt_hint_json = {};
          s.prompt_hint_json.montage_group_id = `mg-${b.beat_index}`;
          if (s.prompt_hint_json.cut_on_action === undefined) s.prompt_hint_json.cut_on_action = true;
          if (!s.prompt_hint_json.motif_tag) s.prompt_hint_json.motif_tag = "impact";
        }
        montageWarnings.push(`Beat #${b.beat_index}: auto-injected montage metadata (LLM didn't provide it)`);
      }
      // Validate motif variety
      const motifs = new Set(bSpecs.map((s: any) => s.prompt_hint_json?.motif_tag).filter(Boolean));
      if (motifs.size < 2 && bSpecs.length >= 3) {
        montageWarnings.push(`Beat #${b.beat_index}: only ${motifs.size} motif_tag(s) — need ≥2 for visual variety`);
      }
      // Validate cut_on_action ratio
      const cutOnAction = bSpecs.filter((s: any) => s.prompt_hint_json?.cut_on_action).length;
      if (bSpecs.length >= 3 && cutOnAction / bSpecs.length < 0.5) {
        montageWarnings.push(`Beat #${b.beat_index}: only ${cutOnAction}/${bSpecs.length} shots have cut_on_action — need ≥50%`);
      }
      // Enforce 700-1200ms duration range for crescendo
      for (const s of bSpecs) {
        if (s.target_duration_ms) {
          s.target_duration_ms = Math.max(700, Math.min(1200, s.target_duration_ms));
        }
      }
    }

    // ── Insert shot specs ──
    const shotRows = shotSpecs.map((s: any) => {
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
        transition_in: s.transition_in || "hard_cut",
        transition_out: s.transition_out || "hard_cut",
        target_duration_ms: s.target_duration_ms || null,
        prompt_hint_json: {
          ...(s.prompt_hint_json || {}),
          subject_action: s.subject_action || null,
          reveal_mechanic: s.reveal_mechanic || null,
        },
      };
    }).filter((r: any) => r.beat_id);

    if (shotRows.length > 0) {
      const { error: shotErr } = await db.from("trailer_shot_specs").insert(shotRows);
      if (shotErr) throw new Error(`Insert shot specs failed: ${shotErr.message}`);
    }

    // Run shot design gates
    const shotGateFailures: string[] = [];
    // Gate: Non-static movement check
    for (const b of beats) {
      const bSpecs = specsByBeat[b.beat_index] || [];
      const hasSilence = (b.silence_before_ms > 0) || (b.silence_after_ms > 0);
      const hasWithholding = b.withholding_note && b.withholding_note.trim().length > 0;
      if (!hasSilence && !hasWithholding && b.phase !== "button") {
        const allStatic = bSpecs.every((s: any) => s.camera_move === "static");
        if (allStatic && bSpecs.length > 0) {
          shotGateFailures.push(`Beat #${b.beat_index} (${b.phase}): all shots static — needs camera movement`);
        }
      }
    }
    // Gate: Transition variety — at least 3 distinct transition types
    const allTransitions = new Set<string>();
    for (const s of shotSpecs) {
      if (s.transition_in) allTransitions.add(s.transition_in);
      if (s.transition_out) allTransitions.add(s.transition_out);
    }
    if (allTransitions.size < 3) {
      shotGateFailures.push(`Only ${allTransitions.size} transition types used — need ≥3 for variety`);
    }
    // Gate: Crescendo density — at least 3 shots per crescendo beat
    for (const [bi, count] of Object.entries(crescendoShotsPerBeat)) {
      if ((count as number) < 3) {
        shotGateFailures.push(`Crescendo beat #${bi}: only ${count} shots, need ≥3 for micro-montage`);
      }
    }
    const shotGateResult = { passed: shotGateFailures.length === 0, failures: shotGateFailures };

    // Merge montage warnings into gate failures
    const allShotWarnings = [...(parsed.warnings || []), ...shotGateFailures, ...montageWarnings];
    const allShotGateFailures = [...shotGateFailures, ...montageWarnings.filter(w => w.includes("need ≥"))];
    const finalShotGateResult = { passed: allShotGateFailures.length === 0, failures: allShotGateFailures };

    await db.from("trailer_shot_design_runs").update({
      status: "complete",
      global_movement_curve_json: parsed.global_movement_curve || null,
      lens_bias_json: parsed.lens_bias || null,
      warnings: allShotWarnings,
      gates_json: finalShotGateResult,
    }).eq("id", run.id);

    return json({
      ok: true,
      shotDesignRunId: run.id,
      status: "complete",
      shotCount: shotRows.length,
      beatsCount: beats.length,
      crescendoShotsPerBeat,
      montageGroups: beats.filter((b: any) => b.phase === "crescendo").map((b: any) => ({
        beat_index: b.beat_index,
        group_id: `mg-${b.beat_index}`,
        shot_count: (specsByBeat[b.beat_index] || []).length,
        motifs: [...new Set((specsByBeat[b.beat_index] || []).map((s: any) => s.prompt_hint_json?.motif_tag).filter(Boolean))],
      })),
      warnings: allShotWarnings,
      gates: finalShotGateResult,
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

  // Fetch script run for canon context
  const { data: scriptRun } = await db.from("trailer_script_runs")
    .select("canon_pack_id, canon_context_hash").eq("id", scriptRunId).single();

  const { data: beats } = await db.from("trailer_script_beats")
    .select("*").eq("script_run_id", scriptRunId).order("beat_index");

  // Load canon anchors for judge to verify citations against
  let canonSummary = "";
  if (scriptRun?.canon_pack_id) {
    try {
      const packCtx = await compileTrailerContext(db, projectId, scriptRun.canon_pack_id);
      // Give judge a condensed version to verify citations
      canonSummary = packCtx.mergedText.slice(0, 6000);
    } catch { /* non-fatal for judge */ }
  }

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

  // Load Look Bible for style cohesion judging
  const lookBible = await loadLookBible(db, projectId, scriptRunId);
  const lookBibleSection = buildLookBibleSection(lookBible);

  try {
    const beatSummary = (beats || []).map((b: any) =>
      `#${b.beat_index} ${b.phase}: intent="${b.emotional_intent}" movement=${b.movement_intensity_target} density=${b.shot_density_target || "?"} refs=${(b.source_refs_json || []).length} silence_before=${b.silence_before_ms} silence_after=${b.silence_after_ms}${b.quoted_dialogue ? ` dialogue="${b.quoted_dialogue.slice(0, 60)}"` : ""}${(b.source_refs_json || []).length > 0 ? ` citations=[${(b.source_refs_json || []).map((r: any) => `${r.doc_type}:"${(r.excerpt || "").slice(0, 40)}"`).join(", ")}]` : ""}`
    ).join("\n");

    const system = `You are a cinematic trailer judge. Score this trailer plan on these dimensions (0.0-1.0):

1. canon_adherence: Do all beats cite real source material? Are quotes accurate? Cross-reference citations against the provided CANON TEXT.
2. movement_escalation: Does movement intensity properly build across phases?
3. contrast_density: Are there enough tonal shifts (loud/quiet, fast/slow)?
4. silence_usage: Are silence windows placed for maximum emotional impact?
5. shot_grammar: Do shot types and camera moves create visual variety?
6. phase_balance: Are phases well-proportioned (not too long/short)?
7. crescendo_impact: Does the crescendo deliver micro-montage energy?
8. emotional_arc: Does the trailer build to an emotional peak?
9. style_cohesion: Do all visual descriptions maintain a consistent look? If a LOOK BIBLE is provided, score whether shots align with its palette, lighting, contrast, camera language, and avoid list. Flag any shot that contradicts the Look Bible.
${lookBibleSection}

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
    "style_cohesion": 0.9,
    "overall": 0.84
  },
  "flags": ["string descriptions of issues"],
  "repair_actions": [
    {"type": "improve_citations|fix_movement_curve|increase_contrast|add_silence|fix_crescendo|rebalance_phases|fix_style_cohesion", "target": "script_beats|rhythm|shots", "reason": "why", "beat_indices": [0,3]}
  ]
}`;

    const canonSection = canonSummary ? `\n\nCANON TEXT (verify citations against this):\n${canonSummary}` : "";
    const userPrompt = `BEATS:\n${beatSummary}\n\n${rhythmData ? `RHYTHM: BPM=${rhythmData.bpm}, drop_ms=${rhythmData.drop_timestamp_ms}` : ""}\n\n${shotSpecs.length > 0 ? `SHOTS: ${shotSpecs.length} specs across ${new Set(shotSpecs.map((s: any) => s.shot_type)).size} types` : ""}${canonSection}`;

    const parsed = await callLLMWithJsonRetry({
      apiKey,
      model: MODELS.BALANCED,
      system,
      user: userPrompt,
      temperature: 0.2,
      maxTokens: 4000,
    }, {
      handler: "run_cinematic_judge_v2",
      validate: (d): d is any => d && typeof d.scores === "object",
    });
    const scores = parsed.scores || {};
    const flags = parsed.flags || [];
    const repairActions = parsed.repair_actions || [];

    // Run hard gates on scores
    const judgeGates = runJudgeGates(scores);

    // ── Rhythm sync enforcement flags ──
    if (rhythmData) {
      const rHits = rhythmData.hit_points_json || [];
      const rSilence = rhythmData.silence_windows_json || [];
      const dropMs = rhythmData.drop_timestamp_ms;

      // Check crescendo drop has visual impact
      if (dropMs && shotSpecs.length > 0) {
        const dropSpecs = shotSpecs.filter((s: any) => {
          const beatEntry = (beats || []).find((b: any) => b.beat_index === s.beat_index);
          return beatEntry?.phase === "crescendo";
        });
        const hasHighMovement = dropSpecs.some((s: any) => (s.movement_intensity || 0) >= 8);
        if (!hasHighMovement && dropSpecs.length > 0) {
          flags.push("Crescendo lacks visual impact at drop — no clip with movement_intensity >= 8 overlaps drop marker");
          repairActions.push({ type: "fix_crescendo", target: "shots", reason: "Crescendo drop needs high-movement visual" });
        }
      }

      // Check silence windows count
      const requiredSilence = (rhythmData as any).style_options_json?.minSilenceWindows ?? 2;
      if (rSilence.length < requiredSilence) {
        flags.push(`Insufficient tension breathing space — only ${rSilence.length} silence windows, need ≥${requiredSilence}`);
        repairActions.push({ type: "add_silence", target: "script_beats", reason: "Not enough silence windows for dramatic tension" });
      }
    }

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

    const repaired = await callLLMWithJsonRetry({
      apiKey,
      model: MODELS.PRO,
      system,
      user: `Current beats:\n${beatJson}`,
      temperature: 0.3,
      maxTokens: 10000,
    }, {
      handler: "repair_trailer_script_v2",
      validate: (d): d is any => Array.isArray(d) || (d && Array.isArray(d.beats)),
    });
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

    // Re-run gates on updated beats with style options from script run
    const { data: updatedBeats } = await db.from("trailer_script_beats")
      .select("*").eq("script_run_id", scriptRunId).order("beat_index");
    const { data: srcRun } = await db.from("trailer_script_runs")
      .select("style_options_json, strict_canon_mode, trailer_type").eq("id", scriptRunId).single();
    const repairSo = (srcRun?.style_options_json || {}) as Record<string, any>;
    const repairGateOpts: GateOpts = {
      minSilenceWindows: repairSo.minSilenceWindows ?? 2,
      microMontageIntensity: repairSo.microMontageIntensity ?? "medium",
      strictCanonMode: srcRun?.strict_canon_mode ?? "strict",
      trailerType: srcRun?.trailer_type ?? "main",
    };
    const gateResult = runScriptGates(updatedBeats || [], srcRun, repairGateOpts);

    const newStatus = gateResult.passed ? "complete" : "needs_repair";
    await db.from("trailer_script_runs").update({
      status: newStatus,
      warnings: gateResult.failures,
      gates_json: gateResult,
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

function routeProvider(phase: string, hintJson?: any, beatHint?: any): { provider: string; candidates: number; source: string } {
  // Priority a) shot spec hint
  if (hintJson?.preferred_provider) {
    return { provider: hintJson.preferred_provider, candidates: hintJson.candidates || 2, source: "shot_spec_hint" };
  }
  // Priority b) beat generator hint
  if (beatHint?.preferred_provider) {
    return { provider: beatHint.preferred_provider, candidates: beatHint.candidates || 2, source: "beat_hint" };
  }
  // Priority c) phase rule
  if (HERO_PHASES.has(phase)) {
    return { provider: "runway", candidates: 2, source: "phase_rule" };
  }
  return { provider: "veo", candidates: 1, source: "phase_rule" };
}

function clampDuration(ms: number | null | undefined, phase: string): number {
  // Phase-specific defaults when no target_duration_ms
  const phaseDefaults: Record<string, number> = {
    hook: 3000, setup: 3500, escalation: 2500,
    twist: 2500, crescendo: 900, button: 1800,
  };
  const val = ms || phaseDefaults[phase] || 3000;
  // Crescendo micro-shots can go shorter
  const min = phase === "crescendo" ? 700 : 1200;
  const max = phase === "button" ? 8000 : 6000;
  return Math.max(min, Math.min(max, val));
}

// Camera move to cinematic language mapping
const CAMERA_MOVE_MAP: Record<string, string> = {
  push_in: "slow push-in / dolly-in toward subject",
  pull_out: "pull-out / dolly-out revealing space",
  track: "lateral tracking shot, motivated camera move",
  arc: "arc around subject, parallax foreground",
  handheld: "handheld kinetic micro-shake, intimate energy",
  whip_pan: "whip pan transition, sudden kinetic burst",
  crane: "crane shot, elevated sweeping movement",
  tilt: "tilt up/down, vertical reveal",
  dolly_zoom: "dolly zoom / Hitchcock vertigo effect",
  static: "locked-off static frame, composed stillness",
};

function lensDescription(mm: number | null): string {
  if (!mm) return "";
  if (mm <= 24) return `${mm}mm wide-angle — expansive energy, spatial depth`;
  if (mm <= 35) return `${mm}mm wide — grounded natural perspective`;
  if (mm <= 50) return `${mm}mm normal — intimate natural eye`;
  if (mm <= 85) return `${mm}mm portrait — compressed close-up, shallow depth of field`;
  return `${mm}mm telephoto — extreme compression, voyeuristic isolation`;
}

function buildClipPrompt(beat: any, spec: any, canonAnchors?: string): string {
  const lines: string[] = [];

  // Explicit cinematic shot language
  lines.push("CINEMATIC SHOT — moving camera, motivated composition.");

  // Camera grammar
  const moveDesc = CAMERA_MOVE_MAP[spec.camera_move] || spec.camera_move || "static";
  const shotType = spec.shot_type || "medium";
  lines.push(`CAMERA: ${shotType} shot, ${moveDesc}`);

  // Lens
  const lens = lensDescription(spec.lens_mm);
  if (lens) lines.push(`LENS: ${lens}`);

  // Depth + foreground
  if (spec.depth_strategy) {
    const depthLabel = spec.depth_strategy === "shallow" ? "shallow depth of field, bokeh background"
      : spec.depth_strategy === "deep" ? "deep focus, everything sharp"
      : `${spec.depth_strategy} depth of field`;
    lines.push(`DEPTH: ${depthLabel}`);
  }
  if (spec.foreground_element) lines.push(`FOREGROUND: parallax foreground element — ${spec.foreground_element}`);

  // Lighting & mood
  if (spec.lighting_note) lines.push(`LIGHTING: ${spec.lighting_note}`);
  lines.push(`MOOD: ${beat.emotional_intent || "unspecified"}`);

  // Movement intensity
  const intensity = spec.movement_intensity || beat.movement_intensity_target || 5;
  if (intensity >= 8) {
    lines.push("ENERGY: rapid kinetic movement, micro-montage velocity, handheld urgency");
  } else if (intensity >= 6) {
    lines.push("ENERGY: kinetic, purposeful camera movement, building tension");
  } else if (intensity >= 4) {
    lines.push("ENERGY: measured, deliberate motivated camera move");
  } else {
    lines.push("ENERGY: slow, contemplative, minimal movement, breathing space");
  }

  // Withholding / silence context
  if (beat.withholding_note) lines.push(`RESTRAINT: ${beat.withholding_note}`);

  // Quoted dialogue fragment (brief only)
  if (beat.quoted_dialogue) {
    const frag = beat.quoted_dialogue.length > 80 ? beat.quoted_dialogue.slice(0, 80) + "…" : beat.quoted_dialogue;
    lines.push(`DIALOGUE MOMENT: "${frag}"`);
  }

  // Visual prompt from hint
  const hint = spec.prompt_hint_json || beat.generator_hint_json || {};
  if (hint.visual_prompt) lines.push(`VISUAL: ${hint.visual_prompt}`);
  if (hint.style) lines.push(`STYLE: ${hint.style}`);

  // Canon anchors (short, grounding context)
  if (canonAnchors && canonAnchors.length > 0) {
    lines.push(`CANON CONTEXT: ${canonAnchors}`);
  }

  // Citation labels for grounding
  const refs = beat.source_refs_json || [];
  if (refs.length > 0) {
    const refLabels = refs.slice(0, 3).map((r: any) =>
      `${r.doc_type || "source"}${r.location ? ` @ ${r.location}` : ""}`
    ).join("; ");
    lines.push(`GROUNDED IN: ${refLabels}`);
  }

  // Transitions
  if (spec.transition_in && spec.transition_in !== "hard_cut") lines.push(`TRANSITION IN: ${spec.transition_in}`);

  // Negative constraints (CRITICAL)
  lines.push("NEGATIVES: Do NOT introduce new characters, locations, props, or plot events not in the provided canon. If uncertain, use abstract/atmospheric imagery rather than inventing specifics. No text overlays, no watermarks, no logos, no UI elements.");

  return lines.join("\n");
}

/** Extract a short canon anchor excerpt relevant to a beat's citations */
function extractCanonAnchors(beat: any, packItems: any[], maxChars = 1200): string {
  const refs = beat.source_refs_json || [];
  if (refs.length === 0 || packItems.length === 0) return "";

  // Match citations to pack items by doc_type
  const anchors: string[] = [];
  let totalChars = 0;

  for (const ref of refs.slice(0, 3)) {
    if (totalChars >= maxChars) break;
    // Use the excerpt from the citation itself
    if (ref.excerpt) {
      const excerpt = ref.excerpt.slice(0, Math.min(400, maxChars - totalChars));
      anchors.push(`[${ref.doc_type || "source"}]: "${excerpt}"`);
      totalChars += excerpt.length + 20;
    }
  }

  return anchors.join(" | ");
}

// ─── ACTION 6: Start Clip Generation from Shot Specs ───

async function handleStartClipGeneration(db: any, body: any, userId: string) {
  const { projectId, scriptRunId, shotDesignRunId, rhythmRunId, manualOverride } = body;
  if (!scriptRunId || !shotDesignRunId) return json({ error: "scriptRunId and shotDesignRunId required" }, 400);

  // ── Gate 1: script must be complete + have canon hash ──
  const { data: scriptRun } = await db.from("trailer_script_runs")
    .select("status, trailer_type, seed, canon_pack_id, canon_context_hash, canon_context_meta_json")
    .eq("id", scriptRunId).eq("project_id", projectId).single();
  if (!scriptRun || scriptRun.status !== "complete") {
    return json({ error: `Script run status is '${scriptRun?.status || "not found"}', must be 'complete' to generate clips` }, 400);
  }
  if (!scriptRun.canon_context_hash) {
    return json({ error: "Script run has no canon_context_hash — regenerate with a canon pack" }, 400);
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

  // ── Fetch shot specs ──
  const { data: shotSpecs } = await db.from("trailer_shot_specs")
    .select("*")
    .eq("shot_design_run_id", shotDesignRunId);

  if (!shotSpecs?.length) {
    return json({ error: "No shot specs found for this shot design run" }, 400);
  }

  // Build beat lookup + pack items for canon anchors
  const beatMap = new Map((allBeats || []).map((b: any) => [b.id, b]));
  const packItems = scriptRun.canon_context_meta_json?.used || [];

  // ── Create v2 blueprint shim (required: trailer_clip_runs/jobs have NOT NULL blueprint_id) ──
  const edlItems = (allBeats || []).map((b: any) => ({
    beat_index: b.beat_index,
    phase: b.phase,
    emotional_intent: b.emotional_intent,
    text_card: b.text_card || null,
    movement_intensity_target: b.movement_intensity_target,
    shot_density_target: b.shot_density_target,
    target_duration_ms: null,
  }));

  const { data: blueprint, error: bpErr } = await db.from("trailer_blueprints").insert({
    project_id: projectId,
    arc_type: scriptRun.trailer_type || "main",
    status: "v2_shim",
    edl: edlItems,
    rhythm_analysis: { source: "cinematic_engine_v2", script_run_id: scriptRunId, rhythm_run_id: rhythmRunId || null },
    audio_plan: {},
    text_card_plan: {},
    options: { v2: true, shot_design_run_id: shotDesignRunId, script_run_id: scriptRunId, canon_context_hash: scriptRun.canon_context_hash },
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
  const phaseCounts: Record<string, number> = {};
  const previewJobs: any[] = [];

  for (const spec of shotSpecs) {
    const beat = beatMap.get(spec.beat_id);
    if (!beat) continue;

    const phase = beat.phase || "setup";
    const { provider, candidates, source: providerSource } = routeProvider(phase, spec.prompt_hint_json, beat.generator_hint_json);
    const lengthMs = clampDuration(spec.target_duration_ms, phase);
    const canonAnchors = extractCanonAnchors(beat, packItems);
    const prompt = buildClipPrompt(beat, spec, canonAnchors);

    for (let ci = 0; ci < candidates; ci++) {
      // Deterministic per-candidate seed
      const candidateSeed = `${runSeed}-b${beat.beat_index}-s${spec.shot_index}-c${ci}`;
      // Idempotency includes scriptRunId for v2
      const idemInput = `${projectId}|${blueprint.id}|${scriptRunId}|${beat.beat_index}|${spec.shot_index}|${provider}|text_to_video|${ci}|${lengthMs}|${candidateSeed}`;
      const idempotencyKey = await sha256Short(idemInput);

      const job = {
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
        seed: candidateSeed,
        prompt,
        init_image_paths: [],
        params_json: {
          script_run_id: scriptRunId,
          shot_design_run_id: shotDesignRunId,
          rhythm_run_id: rhythmRunId || null,
          beat_phase: phase,
          beat_index: beat.beat_index,
          shot_index: spec.shot_index,
          shot_type: spec.shot_type,
          lens_mm: spec.lens_mm,
          camera_move: spec.camera_move,
          movement_intensity: spec.movement_intensity,
          depth_strategy: spec.depth_strategy,
          foreground_element: spec.foreground_element,
          target_duration_ms: lengthMs,
          canon_context_hash: scriptRun.canon_context_hash,
          preferred_provider_source: providerSource,
          shot_spec_id: spec.id,
        },
        status: "queued",
        attempt: 0,
        idempotency_key: idempotencyKey,
      };

      jobsToInsert.push(job);
      providerCounts[provider] = (providerCounts[provider] || 0) + 1;
      phaseCounts[phase] = (phaseCounts[phase] || 0) + 1;

      if (previewJobs.length < 8) {
        previewJobs.push({
          beat_index: beat.beat_index,
          shot_index: spec.shot_index,
          provider,
          candidate_index: ci,
          length_ms: lengthMs,
          phase,
          camera_move: spec.camera_move,
        });
      }
    }
  }

  // Batch upsert with idempotency
  let jobsExisting = 0;
  if (jobsToInsert.length > 0) {
    const { error: insertErr, count } = await db.from("trailer_clip_jobs").upsert(jobsToInsert, {
      onConflict: "idempotency_key",
      ignoreDuplicates: true,
      count: "exact",
    });
    if (insertErr) {
      // Fallback: insert one by one
      for (const job of jobsToInsert) {
        const { error: singleErr } = await db.from("trailer_clip_jobs").upsert(job, {
          onConflict: "idempotency_key",
          ignoreDuplicates: true,
        });
        if (singleErr) jobsExisting++;
      }
    } else {
      jobsExisting = jobsToInsert.length - (count || jobsToInsert.length);
    }
  }

  const jobsCreated = jobsToInsert.length - jobsExisting;

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
    jobsCreated,
    jobsExisting,
    byProvider: providerCounts,
    byPhase: phaseCounts,
    firstQueuedJobsPreview: previewJobs,
    progress: {
      status: "running",
      total: jobsToInsert.length,
      done: 0,
      failed: 0,
      queued: jobsCreated,
    },
    gatesPassed: true,
    manualOverride: !!manualOverride,
    canonContextHash: scriptRun.canon_context_hash,
  });
}

// ─── ACTION 8: Export Trailer Script as Project Document ───

async function handleExportTrailerScriptDocument(db: any, body: any, userId: string) {
  const { projectId, scriptRunId, forceNewVersion = false } = body;
  if (!scriptRunId) return json({ error: "scriptRunId required" }, 400);

  // Load script run
  const { data: scriptRun } = await db.from("trailer_script_runs")
    .select("*").eq("id", scriptRunId).eq("project_id", projectId).single();
  if (!scriptRun) return json({ error: "Script run not found" }, 404);

  // Load beats
  const { data: beats } = await db.from("trailer_script_beats")
    .select("*").eq("script_run_id", scriptRunId).order("beat_index");
  if (!beats?.length) return json({ error: "No beats found" }, 400);

  // Load project title
  const { data: project } = await db.from("projects")
    .select("title, format").eq("id", projectId).single();
  const projectTitle = project?.title || "Untitled";

  // Build formatted plaintext
  const trailerType = scriptRun.trailer_type || "main";
  const platformKey = scriptRun.platform_key || "theatrical";
  const docTitle = `${projectTitle} — Trailer Script (${trailerType}, ${platformKey})`;

  const lines: string[] = [
    `# ${docTitle}`,
    "",
    `**Trailer Type:** ${trailerType}`,
    `**Platform:** ${platformKey}`,
    `**Genre:** ${scriptRun.genre_key || "drama"}`,
    `**Seed:** ${scriptRun.seed || "—"}`,
    `**Canon Context Hash:** ${scriptRun.canon_context_hash || "—"}`,
    `**Generated:** ${new Date(scriptRun.created_at).toISOString().slice(0, 10)}`,
    "",
    "---",
    "",
    "## Beat Breakdown",
    "",
  ];

  for (const beat of beats) {
    lines.push(`### Beat ${beat.beat_index}: ${beat.title || beat.phase}`);
    lines.push(`**Phase:** ${beat.phase} | **Movement:** ${beat.movement_intensity_target}/10 | **Density:** ${beat.shot_density_target || "—"}`);
    lines.push(`**Intent:** ${beat.emotional_intent || "—"}`);
    if (beat.quoted_dialogue) lines.push(`**Dialogue:** _"${beat.quoted_dialogue}"_`);
    if (beat.text_card) lines.push(`**Text Card:** ${beat.text_card}`);
    if (beat.withholding_note) lines.push(`**Withholding:** ${beat.withholding_note}`);
    if (beat.silence_before_ms > 0 || beat.silence_after_ms > 0) {
      lines.push(`**Silence:** before ${beat.silence_before_ms}ms / after ${beat.silence_after_ms}ms`);
    }
    if (beat.trailer_moment_flag) lines.push(`⭐ **Trailer Moment**`);

    // Citations
    const refs = beat.source_refs_json || [];
    if (refs.length > 0) {
      lines.push("**Citations:**");
      for (const ref of refs) {
        lines.push(`- [${ref.doc_type || "source"}] ${ref.location || ""}: ${ref.excerpt || "—"}`);
      }
    }

    // Generator hint
    const hint = beat.generator_hint_json;
    if (hint) {
      lines.push(`**Shot:** ${hint.shot_type || "—"} | **Camera:** ${hint.camera_move || "—"} | **Lens:** ${hint.lens_mm || "—"}mm`);
      if (hint.visual_prompt) lines.push(`**Visual:** ${hint.visual_prompt}`);
    }
    lines.push("");
  }

  // Warnings / scores
  if (scriptRun.warnings?.length > 0) {
    lines.push("---", "", "## Warnings", "");
    for (const w of scriptRun.warnings) lines.push(`- ${w}`);
    lines.push("");
  }

  lines.push("---", "");
  lines.push(`**Structure Score:** ${scriptRun.structure_score ?? "—"} | **Cinematic Score:** ${scriptRun.cinematic_score ?? "—"}`);

  const plaintext = lines.join("\n");

  // Structured content JSON
  const contentJson = {
    script_run_id: scriptRunId,
    beat_ids: beats.map((b: any) => b.id),
    canon_context_hash: scriptRun.canon_context_hash,
    style_options: scriptRun.style_options_json,
    trailer_type: trailerType,
    platform_key: platformKey,
    generated_at: scriptRun.created_at,
  };

  // Find or create project_document
  const { data: existingDocs } = await db.from("project_documents")
    .select("id")
    .eq("project_id", projectId)
    .eq("doc_type", "trailer_script")
    .limit(1);

  let documentId: string;

  if (existingDocs?.length > 0 && !forceNewVersion) {
    documentId = existingDocs[0].id;
  } else if (existingDocs?.length > 0) {
    documentId = existingDocs[0].id;
  } else {
    const { data: newDoc, error: docErr } = await db.from("project_documents").insert({
      project_id: projectId,
      doc_type: "trailer_script",
      title: docTitle,
      user_id: userId,
    }).select("id").single();
    if (docErr) return json({ error: `Create document failed: ${docErr.message}` }, 500);
    documentId = newDoc.id;
  }

  // Compute next version number
  const { data: maxVer } = await db.from("project_document_versions")
    .select("version_number")
    .eq("document_id", documentId)
    .order("version_number", { ascending: false })
    .limit(1);
  const nextVersion = (maxVer?.[0]?.version_number || 0) + 1;

  // Insert version
  const { data: newVersion, error: verErr } = await db.from("project_document_versions").insert({
    document_id: documentId,
    version_number: nextVersion,
    plaintext,
    content: contentJson,
    status: "draft",
    generator_id: "trailer_cinematic_engine_export_v1",
    depends_on: { script_run_id: scriptRunId },
    created_by: userId,
  }).select("id").single();

  if (verErr) return json({ error: `Create version failed: ${verErr.message}` }, 500);

  // Set as current version
  try {
    await db.rpc("set_current_version", {
      p_document_id: documentId,
      p_new_version_id: newVersion.id,
    });
  } catch (e: any) {
    console.warn("set_current_version failed, falling back:", e.message);
    await db.from("project_document_versions")
      .update({ is_current: true }).eq("id", newVersion.id);
  }

  // Update document latest pointers
  await db.from("project_documents").update({
    latest_version_id: newVersion.id,
    title: docTitle,
    updated_at: new Date().toISOString(),
  }).eq("id", documentId);

  return json({
    ok: true,
    documentId,
    versionId: newVersion.id,
    chars: plaintext.length,
    beatCount: beats.length,
  });
}

// ─── ACTION 9: Create Script Variants A/B/C ───

async function handleCreateScriptVariants(db: any, body: any, userId: string, apiKey: string) {
  const {
    projectId, canonPackId, trailerType = "main", genreKey = "drama", platformKey = "theatrical",
    seedBase, styleOptions = {}, variants = ["A", "B", "C"],
    inspirationRefs, referenceNotes, avoidNotes, strictCanonMode, targetLengthMs,
  } = body;

  if (!canonPackId) return json({ error: "canonPackId required" }, 400);

  const baseSeed = seedBase || `var-${Date.now().toString(36)}`;
  

  // Run all variants in parallel to avoid timeout
  const variantPromises = variants.slice(0, 3).map(async (label: string) => {
    const variantSeed = `${baseSeed}-${label}`.slice(0, 24);
    try {
      const resp = await handleCreateTrailerScript(db, {
        projectId, canonPackId, trailerType, genreKey, platformKey,
        seed: variantSeed, styleOptions,
        inspirationRefs, referenceNotes, avoidNotes, strictCanonMode, targetLengthMs,
      }, userId, apiKey);
      const data = await resp.clone().json();

      if (data.scriptRunId) {
        await db.from("trailer_script_runs")
          .update({ variant_label: label })
          .eq("id", data.scriptRunId);
      }

      return {
        label,
        scriptRunId: data.scriptRunId || null,
        seed: variantSeed,
        status: data.status || "error",
        structure_score: data.structureScore ?? null,
        cinematic_score: data.cinematicScore ?? null,
        beatCount: data.beatCount ?? 0,
        warningsCount: data.warnings?.length ?? 0,
        gatesPassed: data.gatesPassed ?? false,
        error: data.error || null,
      };
    } catch (err: any) {
      return {
        label,
        scriptRunId: null,
        seed: variantSeed,
        status: "error",
        error: err.message,
      };
    }
  });

  const results = await Promise.all(variantPromises);

  return json({ ok: true, variants: results });
}

// ─── ACTION 10: Select Script Run ───

async function handleSelectScriptRun(db: any, body: any, userId: string) {
  const { projectId, scriptRunId } = body;
  if (!scriptRunId) return json({ error: "scriptRunId required" }, 400);

  // Load the run to get trailer_type + platform_key
  const { data: run } = await db.from("trailer_script_runs")
    .select("id, trailer_type, platform_key")
    .eq("id", scriptRunId).eq("project_id", projectId).single();
  if (!run) return json({ error: "Script run not found" }, 404);

  // Unset others for same project+type+platform
  await db.from("trailer_script_runs")
    .update({ is_selected: false })
    .eq("project_id", projectId)
    .eq("trailer_type", run.trailer_type)
    .eq("platform_key", run.platform_key)
    .eq("is_selected", true);

  // Set chosen
  await db.from("trailer_script_runs")
    .update({ is_selected: true })
    .eq("id", scriptRunId);

  return json({ ok: true, scriptRunId, selected: true });
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

// ─── ACTION 11: Regenerate Crescendo Montage Only ───

async function handleRegenerateCrescendoMontage(db: any, body: any, userId: string, apiKey: string) {
  const { projectId, scriptRunId, shotDesignRunId, seed: inputSeed } = body;
  if (!scriptRunId || !shotDesignRunId) return json({ error: "scriptRunId and shotDesignRunId required" }, 400);

  const { data: scriptRun } = await db.from("trailer_script_runs")
    .select("*").eq("id", scriptRunId).eq("project_id", projectId).single();
  if (!scriptRun) return json({ error: "Script run not found" }, 404);

  const { data: beats } = await db.from("trailer_script_beats")
    .select("*").eq("script_run_id", scriptRunId).order("beat_index");
  const crescendoBeats = (beats || []).filter((b: any) => b.phase === "crescendo");
  if (crescendoBeats.length === 0) return json({ error: "No crescendo beats found" }, 400);

  const styleOptions = (scriptRun.style_options_json || {}) as Record<string, any>;
  const lookBible = await loadLookBible(db, projectId, scriptRunId);
  const lookBibleSection = buildLookBibleSection(lookBible);
  const resolvedSeed = resolveSeed(inputSeed);

  // Delete existing crescendo shot specs for this design run
  const crescendoBeatIds = crescendoBeats.map((b: any) => b.id);
  await db.from("trailer_shot_specs")
    .delete()
    .eq("shot_design_run_id", shotDesignRunId)
    .in("beat_id", crescendoBeatIds);

  const beatSummary = crescendoBeats.map((b: any) => {
    const refs = (b.source_refs_json || []).slice(0, 2).map((r: any) => `${r.doc_type}:"${(r.excerpt || "").slice(0, 60)}"`).join("; ");
    return `#${b.beat_index} crescendo: intent="${b.emotional_intent}" movement=${b.movement_intensity_target} density=${b.shot_density_target || "3.0"} citations=[${refs}]`;
  }).join("\n");

  try {
    const system = composeSystem(`You are a world-class trailer editor designing ONLY the crescendo micro-montage shots.

${lookBibleSection}

CRESCENDO MICRO-MONTAGE — EDITORIAL RULES:
- Each crescendo beat MUST have 6–10 rapid micro-shots.
- Duration per shot: 700–1200ms (HARD).
- Alternate shot types: close → wide → insert → close → medium.
- Use match-action cuts: exit action of one shot = entry of next.
- Use motif_tag for rhythmic repetition (e.g. "eyes", "door", "running", "impact").
- At least 2 distinct motif_tags per beat.
- At least 50% of shots must have cut_on_action=true.
- Transitions: whip_pan, smash_cut, strobe_cut preferred.
- Movement intensity: 8–10 for ALL shots.
- camera_move: NO static. Use push_in, track, whip_pan, handheld, arc.

Return STRICT JSON:
{
  "shot_specs": [
    {
      "beat_index": number,
      "shot_index": number,
      "shot_type": "wide|medium|close|insert|montage",
      "lens_mm": number,
      "camera_move": "push_in|track|arc|handheld|whip_pan|crane|tilt",
      "movement_intensity": 8-10,
      "depth_strategy": "shallow|deep|mixed",
      "foreground_element": "...",
      "lighting_note": "...",
      "subject_action": "REQUIRED — what moves in frame",
      "reveal_mechanic": "REQUIRED — how the shot reveals info",
      "transition_in": "whip_pan|smash_cut|strobe_cut|match_cut|hard_cut",
      "transition_out": same,
      "target_duration_ms": 700-1200,
      "prompt_hint_json": {
        "visual_prompt": "...",
        "montage_group_id": "mg-<beat_index>",
        "cut_on_action": true/false,
        "motif_tag": "eyes|door|running|impact|hands|fire|etc"
      }
    }
  ]
}
Only valid JSON. No commentary.`);

    let shotSpecs: any[] = [];
    try {
      const parsed = await callLLMWithJsonRetry({
        apiKey,
        model: MODELS.PRO,
        system,
        user: `CRESCENDO BEATS:\n${beatSummary}\nSeed: ${resolvedSeed}`,
        temperature: 0.4,
        maxTokens: 8000,
      }, {
        handler: "regenerate_crescendo_montage_v1",
        validate: (d): d is any => {
          if (Array.isArray(d)) return true; // raw array
          if (d && Array.isArray(d.shot_specs)) return true;
          if (d && Array.isArray(d.shots)) return true;
          return false;
        },
      });
      shotSpecs = Array.isArray(parsed) ? parsed : (parsed.shot_specs || parsed.shots || []);
    } catch (llmErr) {
      console.error("Crescendo montage LLM failed, synthesizing fallback:", llmErr);
      // Deterministic fallback: generate 6 micro-montage shots per crescendo beat
      const moves = ["push_in", "whip_pan", "handheld", "track", "arc", "crane"];
      const types = ["close", "insert", "medium", "close", "insert", "wide"];
      const motifs = ["impact", "eyes", "hands", "silhouette", "fire", "running"];
      for (const cb of crescendoBeats) {
        for (let si = 0; si < 6; si++) {
          shotSpecs.push({
            beat_index: cb.beat_index,
            shot_index: si,
            shot_type: types[si % types.length],
            lens_mm: [24, 35, 50, 85, 100, 135][si % 6],
            camera_move: moves[si % moves.length],
            movement_intensity: 9,
            depth_strategy: si % 2 === 0 ? "shallow" : "deep",
            foreground_element: null,
            lighting_note: null,
            subject_action: "rapid movement",
            reveal_mechanic: "smash reveal",
            transition_in: si === 0 ? "hard_cut" : "smash_cut",
            transition_out: "smash_cut",
            target_duration_ms: 800 + (si * 50),
            prompt_hint_json: {
              visual_prompt: `Crescendo micro-montage shot ${si + 1}`,
              montage_group_id: `mg-${cb.beat_index}`,
              cut_on_action: true,
              motif_tag: motifs[si % motifs.length],
            },
          });
        }
      }
    }

    // Insert new crescendo specs
    const shotRows = shotSpecs.map((s: any) => {
      const matchBeat = crescendoBeats.find((b: any) => b.beat_index === s.beat_index);
      if (!matchBeat) return null;
      // Enforce duration range
      if (s.target_duration_ms) s.target_duration_ms = Math.max(700, Math.min(1200, s.target_duration_ms));
      // Ensure montage metadata
      if (!s.prompt_hint_json) s.prompt_hint_json = {};
      if (!s.prompt_hint_json.montage_group_id) s.prompt_hint_json.montage_group_id = `mg-${s.beat_index}`;
      if (s.prompt_hint_json.cut_on_action === undefined) s.prompt_hint_json.cut_on_action = true;
      if (!s.prompt_hint_json.motif_tag) s.prompt_hint_json.motif_tag = "impact";

      return {
        shot_design_run_id: shotDesignRunId,
        beat_id: matchBeat.id,
        shot_index: s.shot_index || 0,
        shot_type: s.shot_type || "close",
        lens_mm: s.lens_mm || null,
        camera_move: s.camera_move || "handheld",
        movement_intensity: Math.max(8, s.movement_intensity || 9),
        depth_strategy: s.depth_strategy || "shallow",
        foreground_element: s.foreground_element || null,
        lighting_note: s.lighting_note || null,
        transition_in: s.transition_in || "smash_cut",
        transition_out: s.transition_out || "smash_cut",
        target_duration_ms: s.target_duration_ms || 900,
        prompt_hint_json: {
          ...s.prompt_hint_json,
          subject_action: s.subject_action || null,
          reveal_mechanic: s.reveal_mechanic || null,
        },
      };
    }).filter(Boolean);

    if (shotRows.length > 0) {
      await db.from("trailer_shot_specs").insert(shotRows);
    }

    return json({
      ok: true,
      shotDesignRunId,
      regeneratedSpecs: shotRows.length,
      crescendoBeats: crescendoBeats.length,
      montageGroups: crescendoBeats.map((b: any) => {
        const bSpecs = shotSpecs.filter((s: any) => s.beat_index === b.beat_index);
        return {
          beat_index: b.beat_index,
          group_id: `mg-${b.beat_index}`,
          shot_count: bSpecs.length,
          motifs: [...new Set(bSpecs.map((s: any) => s.prompt_hint_json?.motif_tag).filter(Boolean))],
        };
      }),
    });
  } catch (err: any) {
    if (err.message === "RATE_LIMIT") return json({ error: "Rate limit exceeded" }, 429);
    if (err.message === "PAYMENT_REQUIRED") return json({ error: "AI credits exhausted" }, 402);
    return json({ error: err.message }, 500);
  }
}

// ─── Orchestrator: run_trailer_pipeline_v1 ───

async function handleRunTrailerPipeline(db: any, body: any, userId: string, apiKey: string) {
  const projectId = body.projectId || body.project_id;
  const canonPackId = body.canonPackId;
  const trailerType = body.trailerType || "main";
  const genreKey = body.genreKey || "drama";
  const platformKey = body.platformKey || "theatrical";
  const seed = body.seed;
  const idempotencyKey = body.idempotencyKey || `${projectId}-${canonPackId}-${trailerType}-${platformKey}-${seed || "auto"}`;
  const styleOptions = body.styleOptions || {};
  const inspirationRefs = body.inspirationRefs;
  const referenceNotes = body.referenceNotes;
  const avoidNotes = body.avoidNotes;
  const strictCanonMode = body.strictCanonMode;
  const targetLengthMs = body.targetLengthMs;
  const stylePresetKey = body.stylePresetKey;

  if (!canonPackId) return json({ error: "canonPackId required" }, 400);

  const steps: { step: string; status: string; id?: string; error?: string }[] = [];
  let scriptRunId: string | undefined;
  let rhythmRunId: string | undefined;
  let shotDesignRunId: string | undefined;
  let judgeRunId: string | undefined;

  try {
    // Step 1: Script — check for existing complete run with same idempotencyKey
    const { data: existingScript } = await db.from("trailer_script_runs")
      .select("id, status")
      .eq("project_id", projectId)
      .eq("idempotency_key", idempotencyKey)
      .eq("status", "complete")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (existingScript) {
      scriptRunId = existingScript.id;
      steps.push({ step: "script", status: "skipped", id: scriptRunId });
    } else {
      const scriptResult = await handleCreateTrailerScript(db, {
        projectId, canonPackId, trailerType, genreKey, platformKey,
        seed, idempotencyKey, styleOptions, inspirationRefs,
        referenceNotes, avoidNotes, strictCanonMode, targetLengthMs, stylePresetKey,
      }, userId, apiKey);
      const scriptBody = await scriptResult.json();
      if (!scriptBody.scriptRunId) {
        steps.push({ step: "script", status: "failed", error: scriptBody.error || "Script generation failed" });
        return json({ ok: false, steps, error: "Script generation failed" });
      }
      scriptRunId = scriptBody.scriptRunId;
      steps.push({ step: "script", status: "complete", id: scriptRunId });
    }

    const scriptReady = await waitForScriptReadiness(db, projectId, scriptRunId, {
      timeoutMs: 45_000,
      pollMs: 1_500,
    });

    if (!scriptReady.ready) {
      const reason = scriptReady.reason === "script_error"
        ? "Script generation ended in error before beats were available"
        : "Script beats are still being generated; retry in a few seconds";
      steps.push({ step: "script_readiness", status: "pending", error: reason });
      return json({ ok: false, steps, scriptRunId, error: reason }, 409);
    }

    // Step 2: Skip mid-pipeline repair pass to avoid gateway timeout.
    // create_trailer_script_v2 already performs CIK quality + repair attempt when needed.
    // Keep only final judge after rhythm + shot design.
    steps.push({ step: "initial_judge", status: "deferred" });

    // Step 3: Rhythm grid — check existing
    const { data: existingRhythm } = await db.from("trailer_rhythm_runs")
      .select("id, status")
      .eq("script_run_id", scriptRunId)
      .eq("status", "complete")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (existingRhythm) {
      rhythmRunId = existingRhythm.id;
      steps.push({ step: "rhythm", status: "skipped", id: rhythmRunId });
    } else {
      const rhythmResult = await handleCreateRhythmGrid(db, {
        projectId, scriptRunId, seed: seed ? `${seed}-rhythm` : undefined,
      }, userId, apiKey);
      const rhythmBody = await rhythmResult.json();
      if (!rhythmBody.rhythmRunId) {
        steps.push({ step: "rhythm", status: "failed", error: rhythmBody.error || "Rhythm grid failed" });
        return json({ ok: false, steps, scriptRunId, error: "Rhythm grid failed" });
      }
      rhythmRunId = rhythmBody.rhythmRunId;
      steps.push({ step: "rhythm", status: "complete", id: rhythmRunId });
    }

    // Step 4: Shot design — check existing
    const { data: existingShotDesign } = await db.from("trailer_shot_design_runs")
      .select("id, status")
      .eq("script_run_id", scriptRunId)
      .eq("status", "complete")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (existingShotDesign) {
      shotDesignRunId = existingShotDesign.id;
      steps.push({ step: "shot_design", status: "skipped", id: shotDesignRunId });
    } else {
      // Attempt shot design with one retry on parse/validation failure
      let shotBody: any;
      for (let shotAttempt = 0; shotAttempt < 2; shotAttempt++) {
        const shotResult = await handleCreateShotDesign(db, {
          projectId, scriptRunId, rhythmRunId,
          seed: seed ? `${seed}-shots${shotAttempt > 0 ? `-r${shotAttempt}` : ""}` : (shotAttempt > 0 ? `retry-${shotAttempt}` : undefined),
        }, userId, apiKey);
        shotBody = await shotResult.json();
        if (shotBody.shotDesignRunId && shotBody.ok !== false) break;
        if (shotAttempt === 0) {
          steps.push({ step: "shot_design_attempt_1", status: "failed", error: shotBody.error || "Parse error, retrying..." });
        }
      }
      if (!shotBody?.shotDesignRunId || shotBody?.ok === false) {
        steps.push({ step: "shot_design", status: "failed", error: shotBody?.error || "Shot design failed" });
        return json({ ok: false, steps, scriptRunId, rhythmRunId, error: "Shot design failed" });
      }
      shotDesignRunId = shotBody.shotDesignRunId;
      steps.push({ step: "shot_design", status: "complete", id: shotDesignRunId });
    }

    // Step 5: Final judge
    const judgeResult = await handleRunJudge(db, {
      projectId, scriptRunId, rhythmRunId, shotDesignRunId,
    }, userId, apiKey);
    const judgeBody = await judgeResult.json();
    judgeRunId = judgeBody.judgeRunId;
    steps.push({ step: "final_judge", status: judgeBody.gatesPassed ? "passed" : "flagged", id: judgeRunId });

    // Auto-export as document
    try {
      await handleExportTrailerScriptDocument(db, { projectId, scriptRunId }, userId);
    } catch (_e) { /* non-critical */ }

    return json({
      ok: true,
      scriptRunId,
      rhythmRunId,
      shotDesignRunId,
      judgeRunId,
      gatesPassed: judgeBody.gatesPassed,
      scores: judgeBody.scores,
      steps,
      status: judgeBody.gatesPassed ? "complete" : "needs_review",
    });
  } catch (err: any) {
    return json({
      ok: false,
      scriptRunId,
      rhythmRunId,
      shotDesignRunId,
      judgeRunId,
      steps,
      error: err.message,
    }, 500);
  }
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
      case "export_trailer_script_document_v1":
        return await handleExportTrailerScriptDocument(db, body, userId);
      case "create_script_variants_v1":
        return await handleCreateScriptVariants(db, body, userId, apiKey);
      case "select_script_run_v1":
        return await handleSelectScriptRun(db, body, userId);
      case "regenerate_crescendo_montage_v1":
        return await handleRegenerateCrescendoMontage(db, body, userId, apiKey);
      case "run_trailer_pipeline_v1":
        return await handleRunTrailerPipeline(db, body, userId, apiKey);
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
