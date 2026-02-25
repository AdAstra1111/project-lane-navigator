/**
 * trailer-clip-generator v2 — Two-provider clip generation with job queue.
 * Providers: Veo (Google, primary), Runway (hero beats), ElevenLabs (audio), Stub (fallback).
 * Actions: enqueue_for_run, claim_next_job, process_job, progress, retry_job, cancel_job,
 *          select_clip, list_clips, list_jobs
 */
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const STORAGE_BUCKET = "trailers";

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

// ─── Shared Constants ───

/** Blueprint statuses that are clip-enqueue-ready. Must match frontend READY_STATUSES. */
const BLUEPRINT_READY_STATUSES = ["complete", "ready", "v2_shim"] as const;

/** Known Veo/Gemini content-policy error patterns */
const VEO_CONTENT_POLICY_PATTERNS = [
  "usage guidelines",
  "content policy",
  "safety filter",
  "safety settings",
  "blocked by safety",
  "prohibited content",
  "violates",
  "SAFETY",
  "ResponsibleAI",
] as const;

function isContentPolicyError(errorMessage: string): boolean {
  const lower = errorMessage.toLowerCase();
  return VEO_CONTENT_POLICY_PATTERNS.some(p => lower.includes(p.toLowerCase()));
}

/** Maximum Runway prompt length (hard limit is 1000, we use 990 margin) */
const RUNWAY_MAX_PROMPT_CHARS = 990;

/** Truncate prompt deterministically to fit provider limits */
function truncatePrompt(prompt: string, maxChars: number): string {
  if (prompt.length <= maxChars) return prompt;
  return prompt.slice(0, maxChars - 3) + "...";
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

// ─── Helpers ───

// ─── Look Bible Loader ───

async function loadLookBible(db: any, projectId: string, scopeRefId?: string): Promise<any | null> {
  if (scopeRefId) {
    const { data } = await db.from("trailer_look_bibles")
      .select("*").eq("project_id", projectId).eq("scope_ref_id", scopeRefId)
      .order("updated_at", { ascending: false }).limit(1).maybeSingle();
    if (data) return data;
  }
  const { data } = await db.from("trailer_look_bibles")
    .select("*").eq("project_id", projectId).eq("scope", "project")
    .order("updated_at", { ascending: false }).limit(1).maybeSingle();
  return data || null;
}

function buildLookBiblePromptSuffix(lb: any): string {
  if (!lb) return "";
  const parts: string[] = [];
  if (lb.palette) parts.push(`Color palette: ${lb.palette}`);
  if (lb.lighting_style) parts.push(`Lighting: ${lb.lighting_style}`);
  if (lb.contrast) parts.push(`Contrast: ${lb.contrast}`);
  if (lb.camera_language) parts.push(`Camera: ${lb.camera_language}`);
  if (lb.grain) parts.push(`Film texture: ${lb.grain}`);
  if (lb.color_grade) parts.push(`Grade: ${lb.color_grade}`);
  if (lb.custom_directives) parts.push(lb.custom_directives);
  const positives = parts.join(". ");
  const negatives = (lb.avoid_list || []).length > 0
    ? `Absolutely avoid: ${lb.avoid_list.join(", ")}.`
    : "";
  return [positives, negatives].filter(Boolean).join(". ");
}

class RateLimitError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RateLimitError";
  }
}

async function sha256Short(input: string): Promise<string> {
  const encoded = new TextEncoder().encode(input);
  const hash = await crypto.subtle.digest("SHA-256", encoded);
  return Array.from(new Uint8Array(hash)).map(b => b.toString(16).padStart(2, "0")).join("").slice(0, 40);
}

function sleep(ms: number): Promise<void> {
  return new Promise(r => setTimeout(r, ms));
}

async function logEvent(db: any, e: {
  project_id: string; blueprint_id: string; beat_index?: number;
  job_id?: string; clip_id?: string; clip_run_id?: string;
  event_type: string; payload?: any; created_by: string;
}) {
  await db.from("trailer_clip_events").insert({
    project_id: e.project_id,
    blueprint_id: e.blueprint_id,
    beat_index: e.beat_index ?? null,
    job_id: e.job_id ?? null,
    clip_id: e.clip_id ?? null,
    clip_run_id: e.clip_run_id ?? null,
    event_type: e.event_type,
    payload: e.payload || {},
    created_by: e.created_by,
  });
}

// ─── Generation Profiles ───

interface GenerationProfile {
  key: string;
  prompt_prefix: string;
  motion_directives: string[];
  subject_clarity_directives: string[];
  negative_directives: string[];
  veo_params: Record<string, any>;
  runway_params: Record<string, any>;
  default_fps: number;
  motion_boost: number; // 0..3
}

const GENERATION_PROFILES: Record<string, GenerationProfile> = {
  measured_prestige: {
    key: "measured_prestige",
    prompt_prefix: "Cinematic prestige drama. Controlled, deliberate camera movement. Rich shadows, naturalistic light.",
    motion_directives: [
      "slow measured dolly or track", "motivated push-in on emotional beats",
      "minimal handheld — steady controlled movement", "parallax through layered foreground elements",
    ],
    subject_clarity_directives: [
      "subject always sharp and centered in depth of field",
      "intentional rack focus for dramatic emphasis",
      "clean silhouette separation from background",
    ],
    negative_directives: [
      "no rapid cuts or whip pans", "no text overlays or logos", "no warping or morphing",
      "do not invent characters or locations", "no shaky amateur handheld",
    ],
    veo_params: { motion: "stable", clarity: "high", subject_lock: true },
    runway_params: { motion: "medium", camera: "dolly", guidance: "strong", aesthetic: "cinematic" },
    default_fps: 24,
    motion_boost: 1,
  },
  kinetic_trailer: {
    key: "kinetic_trailer",
    prompt_prefix: "High-energy cinematic trailer. Dynamic camera movement. Bold contrast, punchy color grading.",
    motion_directives: [
      "aggressive tracking shots with parallax", "motivated push-ins building tension",
      "whip pans and smash transitions between shots", "subject crosses frame with camera following",
      "depth shifts and rack focus for reveals",
    ],
    subject_clarity_directives: [
      "hero subject always readable even in motion",
      "strong foreground-background separation",
      "punchy lighting with dramatic key-fill ratio",
    ],
    negative_directives: [
      "no static locked-off shots unless intentional stillness beat",
      "no text overlays or logos", "no warping or face morphing",
      "do not invent characters or locations or props",
    ],
    veo_params: { motion: "high", clarity: "high", subject_lock: true },
    runway_params: { motion: "high", camera: "tracking", guidance: "strong", aesthetic: "cinematic" },
    default_fps: 24,
    motion_boost: 2,
  },
  handheld_doc: {
    key: "handheld_doc",
    prompt_prefix: "Documentary-style handheld camera. Naturalistic, observational, intimate. Available light.",
    motion_directives: [
      "organic handheld movement with subtle drift", "observational following of subject",
      "gentle reframing as action unfolds", "shallow depth breathing with subject",
    ],
    subject_clarity_directives: [
      "subject in natural context, not artificially lit",
      "allow slight softness for authenticity",
      "environmental framing — subject within world",
    ],
    negative_directives: [
      "no slick crane or dolly moves", "no text overlays or logos",
      "no artificial perfect framing", "do not invent characters or locations",
    ],
    veo_params: { motion: "medium", clarity: "medium" },
    runway_params: { motion: "medium", camera: "handheld", aesthetic: "documentary" },
    default_fps: 24,
    motion_boost: 1,
  },
  floating_dream: {
    key: "floating_dream",
    prompt_prefix: "Ethereal floating camera. Dreamlike, weightless movement. Soft diffused lighting, atmospheric haze.",
    motion_directives: [
      "slow floating crane movement", "weightless drift through space",
      "gentle arc around subject", "dreamy parallax with soft foreground bokeh",
    ],
    subject_clarity_directives: [
      "subject emerges from atmosphere", "soft glow on key elements",
      "deliberate shallow depth creating layered depth planes",
    ],
    negative_directives: [
      "no harsh or sudden movements", "no text overlays or logos",
      "no jarring cuts — everything flows", "do not invent characters or locations",
    ],
    veo_params: { motion: "stable", clarity: "medium" },
    runway_params: { motion: "low", camera: "crane", aesthetic: "dreamlike" },
    default_fps: 24,
    motion_boost: 1,
  },
  whip_promo: {
    key: "whip_promo",
    prompt_prefix: "Fast-cut promotional energy. Whip pans, smash cuts, high velocity. Bold saturated color.",
    motion_directives: [
      "rapid whip pans between elements", "aggressive push-ins with speed ramp feel",
      "subject snap-to with kinetic energy", "quick arc reveals with motion blur",
    ],
    subject_clarity_directives: [
      "hero moment freeze clarity amid motion",
      "strong graphic composition for impact frames",
      "high contrast pop on key subjects",
    ],
    negative_directives: [
      "no slow contemplative movement", "no text overlays or logos",
      "no warping or morphing artifacts", "do not invent characters or locations",
    ],
    veo_params: { motion: "high", clarity: "high" },
    runway_params: { motion: "high", camera: "whip", guidance: "strong", aesthetic: "promo" },
    default_fps: 24,
    motion_boost: 3,
  },
  horror_dread_slow: {
    key: "horror_dread_slow",
    prompt_prefix: "Slow dread horror. Creeping camera movement. Deep shadows, desaturated palette, tension through stillness broken by movement.",
    motion_directives: [
      "creeping slow push-in building unease", "static hold then sudden motivated move",
      "slow tracking revealing hidden details", "parallax through doorways and corridors",
    ],
    subject_clarity_directives: [
      "subject partially obscured — revealed through movement",
      "deep shadows with selective edge lighting",
      "negative space creating tension around subject",
    ],
    negative_directives: [
      "no bright cheerful lighting", "no text overlays or logos",
      "no fast whip pans unless scare beat", "do not invent characters or locations",
    ],
    veo_params: { motion: "stable", clarity: "high", subject_lock: true },
    runway_params: { motion: "low", camera: "dolly", guidance: "strong", aesthetic: "horror" },
    default_fps: 24,
    motion_boost: 1,
  },
};

function resolveProfile(styleOptions: Record<string, any>): { profile: GenerationProfile; reason: string } {
  const tone = styleOptions?.tonePreset || "";
  const cam = styleOptions?.cameraStyle || "";

  if (tone === "horror_dread" || tone === "horror_dread_slow")
    return { profile: GENERATION_PROFILES.horror_dread_slow, reason: `tonePreset=${tone}` };
  if (cam === "handheld")
    return { profile: GENERATION_PROFILES.handheld_doc, reason: `cameraStyle=handheld` };
  if (cam === "floating")
    return { profile: GENERATION_PROFILES.floating_dream, reason: `cameraStyle=floating` };
  if (cam === "whip_heavy")
    return { profile: GENERATION_PROFILES.whip_promo, reason: `cameraStyle=whip_heavy` };
  if (cam === "measured" && ["a24", "prestige_dark"].includes(tone))
    return { profile: GENERATION_PROFILES.measured_prestige, reason: `cameraStyle=measured+tonePreset=${tone}` };

  return { profile: GENERATION_PROFILES.kinetic_trailer, reason: "default" };
}

function applyMotionBoost(basePrompt: string, spec: any, beat: any, profile: GenerationProfile): string {
  const lines: string[] = [basePrompt];
  const phase = beat?.phase || beat?.role || "";
  const intensity = spec?.movement_intensity || beat?.movement_intensity_target || 5;
  const cameraMove = spec?.camera_move || beat?.clip_spec?.camera_move || "";
  const hasSilence = (beat?.silence_before_ms > 0 || beat?.silence_after_ms > 0);
  const withholding = beat?.withholding_note;

  // Phase-specific motion directives
  if (["hook", "twist", "crescendo"].includes(phase) || intensity >= 7) {
    lines.push("Strong parallax with foreground occlusion. Aggressive motivated camera movement. Subject crosses frame with energy.");
  }

  if (phase === "crescendo") {
    lines.push("Rapid kinetic movement. Whip-pan energy. Smash-cut feel. Multiple depth planes shifting.");
  }

  if (phase === "setup") {
    if (!hasSilence) lines.push("Controlled but non-static camera. Slow establish with subtle drift or push-in.");
  }

  // Override static to slow push-in when intensity warrants
  if (cameraMove === "static" && intensity >= 6 && !hasSilence && !withholding) {
    lines.push("Despite static framing request, add subtle slow push-in to maintain visual energy.");
  }

  // Subject action and reveal from spec
  if (spec?.prompt_hint_json?.subject_action) {
    lines.push(`Subject action: ${spec.prompt_hint_json.subject_action}`);
  }
  if (spec?.prompt_hint_json?.reveal_mechanic) {
    lines.push(`Reveal: ${spec.prompt_hint_json.reveal_mechanic}`);
  }

  // Foreground element for parallax
  if (spec?.foreground_element) {
    lines.push(`Foreground parallax element: ${spec.foreground_element}`);
  }

  // Profile motion directives
  const boostCount = Math.min(profile.motion_boost + 1, profile.motion_directives.length);
  for (let i = 0; i < boostCount; i++) {
    lines.push(profile.motion_directives[i]);
  }

  return lines.join(". ") + ".";
}

function buildVeoPrompt(boostedPrompt: string, profile: GenerationProfile, spec: any): string {
  const parts: string[] = [
    profile.prompt_prefix,
    boostedPrompt,
  ];
  if (spec?.lens_mm) parts.push(`${spec.lens_mm}mm lens`);
  if (spec?.depth_strategy) parts.push(`${spec.depth_strategy} depth of field`);
  if (spec?.lighting_note) parts.push(spec.lighting_note);
  // Clarity directives
  parts.push(...profile.subject_clarity_directives.slice(0, 2));
  // Negatives as suffix
  parts.push("Steady cinematic motion. Stable subject. No warping.");
  parts.push(profile.negative_directives.join(". "));
  return parts.join(". ") + ".";
}

function buildRunwayPrompt(boostedPrompt: string, profile: GenerationProfile, spec: any): string {
  const parts: string[] = [
    profile.prompt_prefix,
    boostedPrompt,
  ];
  if (spec?.lens_mm) parts.push(`${spec.lens_mm}mm lens`);
  if (spec?.lighting_note) parts.push(`Dramatic lighting: ${spec.lighting_note}`);
  // Stylistic emphasis
  parts.push("Hero composition. Trailer-grade cinematic punch.");
  if (spec?.transition_out) parts.push(`Transition energy: ${spec.transition_out}`);
  parts.push(...profile.subject_clarity_directives.slice(0, 1));
  parts.push(profile.negative_directives.slice(0, 3).join(". "));
  return parts.join(". ") + ".";
}

// ─── Provider: Veo (Google Gemini Video) ───

async function callVeo(params: {
  prompt: string; lengthMs: number; aspectRatio: string; fps: number;
  seed: string; initImagePaths: string[]; paramsJson: any;
}, maxRetries = 3): Promise<{ videoUrl?: string; providerJobId?: string; model: string; status: string }> {
  const apiKey = Deno.env.get("VEO_API_KEY") || Deno.env.get("GOOGLE_API_KEY");
  if (!apiKey) throw new Error("VEO_API_KEY not configured — using stub mode");

  const model = "veo-2.0-generate-001";
  const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${model}:predictLongRunning?key=${apiKey}`;

  const durationSec = Math.max(5, Math.min(8, Math.round(params.lengthMs / 1000)));

  const body: any = {
    instances: [{
      prompt: params.prompt,
    }],
    parameters: {
      aspectRatio: params.aspectRatio,
      durationSeconds: durationSec,
    },
  };

  console.log(`[Veo] Calling ${endpoint.replace(apiKey, 'REDACTED')} with duration=${durationSec}s`);

  for (let attempt = 0; attempt < maxRetries; attempt++) {
    const resp = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

    if (resp.status === 429) {
      const retryAfter = resp.headers.get("Retry-After");
      const retryMs = retryAfter ? parseInt(retryAfter, 10) * 1000 : NaN;
      const waitMs = retryMs > 0 ? retryMs : Math.pow(2, attempt + 1) * 5000 + Math.random() * 2000;
      console.log(`[Veo] Rate limited (429), attempt ${attempt + 1}/${maxRetries}, waiting ${Math.round(waitMs)}ms`);
      await resp.text(); // consume body
      if (attempt < maxRetries - 1) {
        await sleep(waitMs);
        continue;
      }
      // Last attempt still 429 — throw a special error
      throw new RateLimitError(`Veo rate limited after ${maxRetries} retries`);
    }

    if (!resp.ok) {
      const errText = await resp.text();
      console.error(`[Veo] API error ${resp.status}:`, errText.slice(0, 800));
      throw new Error(`Veo API error ${resp.status}: ${errText.slice(0, 500)}`);
    }

    const result = await resp.json();
    console.log(`[Veo] Response:`, JSON.stringify(result).slice(0, 1000));

    // Veo returns a long-running operation — we need to poll
    if (result.name) {
      return { providerJobId: result.name, model, status: "polling" };
    }

    // Direct result (unlikely for video but handle it)
    const videoUri = result?.predictions?.[0]?.videoUri;
    if (videoUri) {
      return { videoUrl: videoUri, model, status: "complete" };
    }

    throw new Error("Unexpected Veo response format: " + JSON.stringify(result).slice(0, 500));
  }

  // Should not reach here
  throw new Error("Veo: exhausted retries without result");
}

async function pollVeo(operationName: string): Promise<{ videoUrl?: string; status: string }> {
  const apiKey = Deno.env.get("VEO_API_KEY") || Deno.env.get("GOOGLE_API_KEY");
  if (!apiKey) throw new Error("VEO_API_KEY not configured");

  const endpoint = `https://generativelanguage.googleapis.com/v1beta/${operationName}?key=${apiKey}`;
  const resp = await fetch(endpoint);
  if (!resp.ok) {
    const errText = await resp.text();
    console.error(`[Veo poll] Error ${resp.status}:`, errText.slice(0, 500));
    throw new Error(`Veo poll error ${resp.status}`);
  }

  const result = await resp.json();
  console.log(`[Veo poll] Response:`, JSON.stringify(result).slice(0, 1500));

  if (result.done) {
    // Try multiple known response shapes
    const videoUri = result.response?.predictions?.[0]?.videoUri ||
                     result.response?.generatedSamples?.[0]?.video?.uri ||
                     result.response?.generateVideoResponse?.generatedSamples?.[0]?.video?.uri ||
                     result.metadata?.generatedSamples?.[0]?.video?.uri;
    if (videoUri) return { videoUrl: videoUri, status: "complete" };
    if (result.error) throw new Error(`Veo generation failed: ${result.error.message}`);
    // Log full response for debugging
    console.error(`[Veo poll] Done but no video URI found. Full response:`, JSON.stringify(result));
    throw new Error("Veo completed but no video returned. Response: " + JSON.stringify(result).slice(0, 500));
  }
  return { status: "polling" };
}

// ─── Provider: Runway ───

async function callRunway(params: {
  prompt: string; lengthMs: number; aspectRatio: string;
  seed: string; initImagePaths: string[]; paramsJson: any;
}): Promise<{ videoUrl?: string; providerJobId?: string; model: string; status: string }> {
  const apiKey = Deno.env.get("RUNWAY_API_KEY");
  if (!apiKey) throw new Error("RUNWAY_API_KEY not configured — using stub mode");

  const model = "gen4.5";
  const durationSec = Math.max(5, Math.min(10, Math.round(params.lengthMs / 1000)));

  // Runway enforces a 1000-char limit on promptText — use shared truncation
  const truncatedPrompt = truncatePrompt(params.prompt, RUNWAY_MAX_PROMPT_CHARS);

  const body: any = {
    model,
    promptText: truncatedPrompt,
    duration: durationSec,
    ratio: params.aspectRatio === "16:9" ? "1280:720" : params.aspectRatio,
  };

  const resp = await fetch("https://api.dev.runwayml.com/v1/text_to_video", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      "X-Runway-Version": "2024-11-06",
    },
    body: JSON.stringify(body),
  });

  if (!resp.ok) {
    const errText = await resp.text();
    throw new Error(`Runway API error ${resp.status}: ${errText.slice(0, 500)}`);
  }

  const result = await resp.json();
  return { providerJobId: result.id, model, status: "polling" };
}

async function pollRunway(taskId: string): Promise<{ videoUrl?: string; status: string }> {
  const apiKey = Deno.env.get("RUNWAY_API_KEY");
  if (!apiKey) throw new Error("RUNWAY_API_KEY not configured");

  const resp = await fetch(`https://api.dev.runwayml.com/v1/tasks/${taskId}`, {
    headers: {
      "Authorization": `Bearer ${apiKey}`,
      "X-Runway-Version": "2024-11-06",
    },
  });
  if (!resp.ok) throw new Error(`Runway poll error ${resp.status}`);

  const result = await resp.json();
  if (result.status === "SUCCEEDED") {
    const videoUrl = result.output?.[0];
    if (videoUrl) return { videoUrl, status: "complete" };
    throw new Error("Runway completed but no video URL");
  }
  if (result.status === "FAILED") {
    throw new Error(`Runway generation failed: ${result.failure || "unknown"}`);
  }
  return { status: "polling" };
}

// ─── Provider: Stub (placeholder when no keys) ───

function generateStubVideo(): { bytes: Uint8Array; mimeType: string } {
  // Return a tiny 1x1 PNG as placeholder
  const png = new Uint8Array([
    0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d,
    0x49, 0x48, 0x44, 0x52, 0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01,
    0x08, 0x02, 0x00, 0x00, 0x00, 0x90, 0x77, 0x53, 0xde, 0x00, 0x00, 0x00,
    0x0c, 0x49, 0x44, 0x41, 0x54, 0x08, 0xd7, 0x63, 0xf8, 0xcf, 0xc0, 0x00,
    0x00, 0x00, 0x02, 0x00, 0x01, 0xe2, 0x21, 0xbc, 0x33, 0x00, 0x00, 0x00,
    0x00, 0x49, 0x45, 0x4e, 0x44, 0xae, 0x42, 0x60, 0x82,
  ]);
  return { bytes: png, mimeType: "image/png" };
}

// ─── Cinematic v2 Gate Validation ───

async function validateCinematicGates(db: any, scriptRunId: string, manualOverride: boolean) {
  // Gate 1: Script run must be complete
  const { data: scriptRun } = await db.from("trailer_script_runs")
    .select("status").eq("id", scriptRunId).single();
  if (!scriptRun || scriptRun.status !== "complete") {
    return { passed: false, error: `Script run status is '${scriptRun?.status || "not found"}', must be 'complete'`, blockers: ["script_incomplete"] };
  }

  // Gate 2: All beats must have citations (source_refs_json length >= 1)
  const { data: beats } = await db.from("trailer_script_beats")
    .select("beat_index, source_refs_json").eq("script_run_id", scriptRunId);
  const missingCitations = (beats || []).filter((b: any) => !b.source_refs_json || (Array.isArray(b.source_refs_json) && b.source_refs_json.length === 0));
  if (missingCitations.length > 0) {
    return {
      passed: false,
      error: `${missingCitations.length} beat(s) missing citations`,
      blockers: ["citations_missing"],
      missingBeats: missingCitations.map((b: any) => b.beat_index),
    };
  }

  // Gate 3: Judge v2 must have passed thresholds (or manual override)
  if (!manualOverride) {
    const { data: judgeRuns } = await db.from("trailer_judge_v2_runs")
      .select("scores_json, repair_actions_json, status")
      .eq("script_run_id", scriptRunId)
      .eq("status", "complete")
      .order("created_at", { ascending: false })
      .limit(1);

    if (!judgeRuns?.length) {
      return { passed: false, error: "No completed judge v2 run found. Run cinematic judge first.", blockers: ["no_judge_run"] };
    }

    const scores = judgeRuns[0].scores_json || {};
    const blockers: string[] = [];
    if ((scores.canon_adherence ?? 1) < 0.9) blockers.push("canon_adherence < 0.9");
    if ((scores.movement_escalation ?? 1) < 0.75) blockers.push("movement_escalation < 0.75");
    if ((scores.contrast_density ?? 1) < 0.75) blockers.push("contrast_density < 0.75");

    if (blockers.length > 0) {
      return { passed: false, error: "Judge v2 thresholds not met. Repair script or set manualOverride.", blockers };
    }
  }

  return { passed: true };
}

// ─── Action: enqueue_for_run ───

async function handleEnqueueForRun(db: any, body: any, userId: string) {
  const { projectId, blueprintId, force = false, enabledProviders, beatIndices,
          scriptRunId, manualOverride = false } = body;
  if (!blueprintId) return json({ error: "blueprintId required" }, 400);

  // ─── SAFETY GATE: Require v2 cinematic script run ───
  if (scriptRunId) {
    const gateResult = await validateCinematicGates(db, scriptRunId, manualOverride);
    if (!gateResult.passed) {
      return json({ error: gateResult.error, blockers: gateResult.blockers }, 400);
    }
  }
  if (!scriptRunId) {
    console.warn(`[DEPRECATION] Clip enqueue without scriptRunId for blueprint ${blueprintId}. Legacy path.`);
  }

  const allowedProviders: Set<string> | null = Array.isArray(enabledProviders) && enabledProviders.length > 0
    ? new Set(enabledProviders as string[])
    : null;

  const { data: bp } = await db.from("trailer_blueprints")
    .select("id, edl, status, options")
    .eq("id", blueprintId).eq("project_id", projectId).single();
  if (!bp) return json({ error: "Blueprint not found" }, 404);
  if (!BLUEPRINT_READY_STATUSES.includes(bp.status as any)) {
    return json({ error: `Blueprint status '${bp.status}' is not clip-ready. Expected one of: ${BLUEPRINT_READY_STATUSES.join(", ")}` }, 400);
  }

  const edl = bp.edl || [];
  if (edl.length === 0) return json({ error: "Blueprint has empty EDL — cannot enqueue clips" }, 400);

  // Load styleOptions from script run
  let styleOptions: Record<string, any> = {};
  const resolvedScriptRunId = scriptRunId || bp?.options?.script_run_id;
  if (resolvedScriptRunId) {
    const { data: sr } = await db.from("trailer_script_runs")
      .select("style_options_json").eq("id", resolvedScriptRunId).single();
    styleOptions = sr?.style_options_json || {};
  }

  // Resolve generation profile
  const { profile, reason: profileReason } = resolveProfile(styleOptions);

  // Load Look Bible for prompt injection
  const lookBible = await loadLookBible(db, projectId, resolvedScriptRunId);
  const lookBibleSuffix = buildLookBiblePromptSuffix(lookBible);

  // Load shot specs if available
  const shotDesignRunId = bp?.options?.shot_design_run_id;
  let shotSpecsByBeat: Record<number, any[]> = {};
  if (shotDesignRunId) {
    const { data: specs } = await db.from("trailer_shot_specs")
      .select("*, prompt_hint_json, beat_id").eq("shot_design_run_id", shotDesignRunId);
    for (const s of (specs || [])) {
      const { data: beatRow } = await db.from("trailer_script_beats")
        .select("beat_index").eq("id", s.beat_id).single();
      const bi = beatRow?.beat_index ?? 0;
      if (!shotSpecsByBeat[bi]) shotSpecsByBeat[bi] = [];
      shotSpecsByBeat[bi].push(s);
    }
  }

  // Create clip run
  const { data: clipRun, error: crErr } = await db.from("trailer_clip_runs").insert({
    project_id: projectId,
    blueprint_id: blueprintId,
    created_by: userId,
    status: "running",
    total_jobs: 0,
  }).select().single();
  if (crErr) return json({ error: crErr.message }, 500);

  let totalJobs = 0;
  const jobsToInsert: any[] = [];

  const beatFilter: Set<number> | null = Array.isArray(beatIndices) && beatIndices.length > 0
    ? new Set(beatIndices as number[])
    : null;

  for (let beatIndex = 0; beatIndex < edl.length; beatIndex++) {
    if (beatFilter && !beatFilter.has(beatIndex)) continue;
    const beat = edl[beatIndex];
    const hint = beat.generator_hint || {};
    let provider = hint.preferred_provider || "veo";

    if (allowedProviders && !allowedProviders.has(provider)) {
      provider = allowedProviders.values().next().value || "veo";
    }
    const mode = hint.preferred_mode || "text_to_video";
    const candidates = hint.candidates || 1;
    const lengthMs = hint.length_ms || Math.round((beat.duration_s || 3) * 1000);
    const aspectRatio = hint.aspect_ratio || "16:9";
    const fps = hint.fps || profile.default_fps;

    // Get shot specs for this beat
    const beatSpecs = shotSpecsByBeat[beatIndex] || [];
    const cs = beat.clip_spec || {};

    for (let ci = 1; ci <= candidates; ci++) {
      const seedBase = force ? `${blueprintId}-${beatIndex}-${ci}-${Date.now()}` : `${blueprintId}-${beatIndex}-${ci}`;
      const seed = seedBase;

      const idemInput = `${projectId}|${blueprintId}|${beatIndex}|${provider}|${mode}|${ci}|${lengthMs}|${seed}`;
      const idempotencyKey = await sha256Short(idemInput);

      // Find matching shot spec for this candidate
      const matchSpec = beatSpecs.find((s: any) => s.shot_index === ci) || beatSpecs[0] || null;

      // Build base prompt from visual_prompt or shot spec prompt_hint
      const basePrompt = matchSpec?.prompt_hint_json?.visual_prompt
        || cs.visual_prompt
        || cs.action_description
        || `${beat.role}: ${cs.shot_type || ""} ${cs.camera_move || ""} — ${cs.action_description || "cinematic scene"}`;

      // Apply motion boost
      const boostedPrompt = applyMotionBoost(basePrompt, matchSpec, beat, profile);

      // Wrap for provider + Look Bible injection
      let finalPrompt = provider === "runway"
        ? buildRunwayPrompt(boostedPrompt, profile, matchSpec)
        : buildVeoPrompt(boostedPrompt, profile, matchSpec);

      // Append Look Bible constraints to every clip prompt
      if (lookBibleSuffix) {
        finalPrompt = finalPrompt + " " + lookBibleSuffix;
      }

      // Build provider-specific params
      const providerParams = provider === "runway" ? profile.runway_params : profile.veo_params;

      jobsToInsert.push({
        project_id: projectId,
        blueprint_id: blueprintId,
        beat_index: beatIndex,
        clip_run_id: clipRun.id,
        provider,
        mode,
        candidate_index: ci,
        length_ms: lengthMs,
        aspect_ratio: aspectRatio,
        fps,
        seed,
        prompt: finalPrompt,
        init_image_paths: [],
        params_json: {
          beat_role: beat.role,
          clip_spec: cs,
          generator_hint: hint,
          generation_profile: {
            key: profile.key,
            version: "v1",
            reason: profileReason,
            derivedFrom: { tonePreset: styleOptions?.tonePreset || null, cameraStyle: styleOptions?.cameraStyle || null },
          },
          provider_params: providerParams,
          shot_spec_used: matchSpec ? {
            camera_move: matchSpec.camera_move,
            movement_intensity: matchSpec.movement_intensity,
            lens_mm: matchSpec.lens_mm,
            depth_strategy: matchSpec.depth_strategy,
            transition_in: matchSpec.transition_in,
            transition_out: matchSpec.transition_out,
          } : null,
        },
        status: "queued",
        attempt: 0,
        idempotency_key: idempotencyKey,
      });
      totalJobs++;
    }
  }

  // Batch insert
  if (jobsToInsert.length > 0) {
    const { error: insertErr } = await db.from("trailer_clip_jobs").upsert(jobsToInsert, {
      onConflict: "idempotency_key",
      ignoreDuplicates: !force,
    });
    if (insertErr) {
      console.error("Job insert error:", insertErr);
      for (const job of jobsToInsert) {
        await db.from("trailer_clip_jobs").upsert(job, {
          onConflict: "idempotency_key",
          ignoreDuplicates: true,
        });
      }
    }
  }

  await db.from("trailer_clip_runs").update({ total_jobs: totalJobs }).eq("id", clipRun.id);

  await logEvent(db, {
    project_id: projectId, blueprint_id: blueprintId,
    clip_run_id: clipRun.id,
    event_type: "enqueue_for_run",
    payload: { totalJobs, force, beatCount: edl.length, profile: profile.key, profileReason },
    created_by: userId,
  });

  return json({ ok: true, clipRunId: clipRun.id, totalJobs, profile: profile.key });
}

// ─── Action: claim_next_job ───

async function handleClaimNextJob(db: any, body: any) {
  const { projectId, blueprintId } = body;
  if (!blueprintId) return json({ error: "blueprintId required" }, 400);

  const { data: jobId } = await db.rpc("claim_next_trailer_clip_job", {
    _project_id: projectId,
    _blueprint_id: blueprintId,
  });

  if (!jobId) return json({ ok: true, job: null, message: "No queued jobs" });

  const { data: job } = await db.from("trailer_clip_jobs").select("*").eq("id", jobId).single();
  return json({ ok: true, job });
}

// ─── Action: process_job ───

async function handleProcessJob(db: any, body: any, userId: string) {
  const { projectId, jobId } = body;
  if (!jobId) return json({ error: "jobId required" }, 400);

  const { data: job } = await db.from("trailer_clip_jobs").select("*")
    .eq("id", jobId).eq("project_id", projectId).single();
  if (!job) return json({ error: "Job not found" }, 404);
  if (job.status !== "running") return json({ error: `Job status is ${job.status}, expected running` }, 400);

  const useStub = Deno.env.get("CLIP_GEN_PROVIDER_STUB") === "true";

  try {
    // ── Stub mode ──
    if (useStub || (job.provider === "veo" && !Deno.env.get("VEO_API_KEY") && !Deno.env.get("GOOGLE_API_KEY")) ||
        (job.provider === "runway" && !Deno.env.get("RUNWAY_API_KEY"))) {
      const { bytes, mimeType } = generateStubVideo();
      const storagePath = `${projectId}/clips/${job.blueprint_id}/${job.beat_index}/${jobId}.png`;
      const blob = new Blob([bytes], { type: mimeType });
      await db.storage.from(STORAGE_BUCKET).upload(storagePath, blob, { contentType: mimeType, upsert: true });
      return await finalizeClip(db, job, jobId, projectId, userId, storagePath, mimeType, "stub");
    }

    // ── Real provider: fire-and-forget ──
    if (job.provider === "veo") {
      const veoResult = await callVeo({
        prompt: job.prompt, lengthMs: job.length_ms, aspectRatio: job.aspect_ratio,
        fps: job.fps, seed: job.seed, initImagePaths: job.init_image_paths || [],
        paramsJson: job.params_json || {},
      });

      if (veoResult.status === "polling" && veoResult.providerJobId) {
        // Save provider job ID and set status to "polling" — return immediately
        await db.from("trailer_clip_jobs").update({
          provider_job_id: veoResult.providerJobId,
          status: "polling",
        }).eq("id", jobId);
        console.log(`[process_job] Veo submitted, polling: ${veoResult.providerJobId}`);
        return json({ ok: true, status: "polling", providerJobId: veoResult.providerJobId });
      }
      // Direct result (unlikely)
      if (veoResult.videoUrl) {
        const storagePath = await downloadAndStore(db, veoResult.videoUrl, projectId, job.blueprint_id, job.beat_index, jobId);
        return await finalizeClip(db, job, jobId, projectId, userId, storagePath, "video/mp4", veoResult.model);
      }
    } else if (job.provider === "runway") {
      const rwResult = await callRunway({
        prompt: job.prompt, lengthMs: job.length_ms, aspectRatio: job.aspect_ratio,
        seed: job.seed, initImagePaths: job.init_image_paths || [],
        paramsJson: job.params_json || {},
      });

      if (rwResult.status === "polling" && rwResult.providerJobId) {
        await db.from("trailer_clip_jobs").update({
          provider_job_id: rwResult.providerJobId,
          status: "polling",
        }).eq("id", jobId);
        return json({ ok: true, status: "polling", providerJobId: rwResult.providerJobId });
      }
    } else {
      throw new Error(`Unknown provider: ${job.provider}`);
    }

    throw new Error("Provider returned no job ID or video URL");
  } catch (err: any) {
    // On rate limit, re-queue the job instead of failing permanently
    if (err instanceof RateLimitError || err.name === "RateLimitError") {
      console.log(`[process_job] Rate limited — re-queuing job ${jobId}`);
      await db.from("trailer_clip_jobs").update({
        status: "queued",
        error: "Rate limited — will retry automatically",
        claimed_at: null,
      }).eq("id", jobId);
      return json({ ok: true, status: "requeued", message: "Rate limited, job re-queued for later" });
    }
    // ── Veo content-policy failure: deterministic single fallback to Runway ──
    if (job.provider === "veo" && isContentPolicyError(err.message)) {
      console.log(`[process_job] Veo content-policy failure for job ${jobId} — attempting Runway fallback`);
      await markJobFailed(db, job, jobId, projectId, userId, `Veo content-policy: ${err.message}`);

      // Idempotency: check if a fallback job already exists for same beat/candidate
      const fallbackKey = `${job.idempotency_key}-runway-fallback`;
      const { data: existingFallback } = await db.from("trailer_clip_jobs")
        .select("id").eq("idempotency_key", fallbackKey).maybeSingle();

      if (!existingFallback) {
        const fallbackPrompt = truncatePrompt(job.prompt, RUNWAY_MAX_PROMPT_CHARS);
        await db.from("trailer_clip_jobs").insert({
          project_id: projectId,
          blueprint_id: job.blueprint_id,
          clip_run_id: job.clip_run_id,
          beat_index: job.beat_index,
          candidate_index: job.candidate_index,
          provider: "runway",
          mode: job.mode,
          prompt: fallbackPrompt,
          length_ms: job.length_ms,
          aspect_ratio: job.aspect_ratio,
          fps: job.fps,
          seed: job.seed,
          init_image_paths: job.init_image_paths || [],
          params_json: { ...(job.params_json || {}), fallback_from_provider: "veo" },
          idempotency_key: fallbackKey,
          status: "queued",
        });
        console.log(`[process_job] Created Runway fallback job for beat ${job.beat_index}, candidate ${job.candidate_index}`);
      } else {
        console.log(`[process_job] Runway fallback already exists for beat ${job.beat_index} — skipping duplicate`);
      }

      return json({ ok: true, status: "fallback_to_runway", message: "Veo content-policy failure, fallback job created" });
    }

    console.error(`[process_job] Error:`, err.message);
    await markJobFailed(db, job, jobId, projectId, userId, err.message);
    return json({ error: err.message }, 500);
  }
}

// ─── Helper: download video and store ───

async function downloadAndStore(db: any, videoUrl: string, projectId: string, blueprintId: string, beatIndex: number, jobId: string): Promise<string> {
  // Google generativelanguage file URIs require the API key
  const apiKey = Deno.env.get("VEO_API_KEY") || Deno.env.get("GOOGLE_API_KEY") || "";
  let fetchUrl = videoUrl;
  if (videoUrl.includes("generativelanguage.googleapis.com") && !videoUrl.includes("key=")) {
    fetchUrl += (videoUrl.includes("?") ? "&" : "?") + `key=${apiKey}`;
  }
  console.log(`[download] Fetching video from ${fetchUrl.replace(apiKey, 'REDACTED')}`);
  const videoResp = await fetch(fetchUrl);
  if (!videoResp.ok) {
    const errText = await videoResp.text();
    console.error(`[download] Failed ${videoResp.status}:`, errText.slice(0, 500));
    throw new Error(`Failed to download video (${videoResp.status})`);
  }
  const videoBytes = await videoResp.arrayBuffer();
  const storagePath = `${projectId}/clips/${blueprintId}/${beatIndex}/${jobId}.mp4`;
  const blob = new Blob([videoBytes], { type: "video/mp4" });
  await db.storage.from(STORAGE_BUCKET).upload(storagePath, blob, { contentType: "video/mp4", upsert: true });
  console.log(`[download] Stored ${storagePath} (${videoBytes.byteLength} bytes)`);
  return storagePath;
}

// ─── Helper: evaluate clip quality (inline, no AI call) ───

function evaluateClipQuality(
  clip: any, genProfile: any, beat: any, styleOptions: any
): {
  technical_score: number; motion_score: number; clarity_score: number;
  artifact_score: number; style_match_score: number; framing_score: number;
  auto_rejected: boolean; rejection_reason: string | null;
  quality_flags_json: any;
} {
  const phase = beat?.phase || beat?.role || "";
  const intensityTarget = beat?.movement_intensity_target || beat?.clip_spec?.movement_intensity || 5;
  const cameraMove = beat?.clip_spec?.camera_move || "";
  const prompt = clip.prompt || "";
  const provider = clip.provider || "";
  const genParams = clip.gen_params || clip.params_json || {};
  const profileKey = genProfile?.key || genParams?.generation_profile?.key || "";
  const negatives = genProfile?.negative_directives || [];
  const flags: string[] = [];

  // --- 1) Motion score (0-10) ---
  let motion = 5;
  const hasMotionWords = /track|dolly|push|pull|pan|whip|crane|arc|handheld|drift|follow/i.test(prompt);
  const isStatic = cameraMove === "static" || /static|locked|still/i.test(prompt);
  if (hasMotionWords) motion += 2;
  if (isStatic && ["hook", "twist", "crescendo"].includes(phase)) {
    motion -= 3;
    flags.push("static_in_high_energy_phase");
  }
  if (intensityTarget >= 7) motion += 1;
  if (intensityTarget >= 9) motion += 1;
  if (provider === "runway") motion += 1; // Runway tends to produce better motion
  motion = Math.max(0, Math.min(10, motion));

  // --- 2) Clarity score (0-10) ---
  let clarity = 7;
  if (/sharp|crisp|clear|high.?res|4k/i.test(prompt)) clarity += 1;
  if (/blur|soft|haze|fog/i.test(prompt) && phase !== "atmosphere") {
    clarity -= 1;
    flags.push("soft_focus_non_atmosphere");
  }
  if (provider === "veo") clarity += 0.5; // Veo generally sharper
  clarity = Math.max(0, Math.min(10, clarity));

  // --- 3) Artifact score (0-10, higher = cleaner) ---
  let artifact = 8;
  if (/warp|morph|distort/i.test(prompt)) {
    artifact -= 2;
    flags.push("prompt_mentions_warping");
  }
  if (provider === "runway") artifact -= 0.5; // Slightly more artifacts historically
  artifact = Math.max(0, Math.min(10, artifact));

  // --- 4) Style match score (0-10) ---
  let styleMatch = 7;
  const tonePreset = styleOptions?.tonePreset || "";
  if (profileKey && prompt.toLowerCase().includes(profileKey.replace(/_/g, " "))) styleMatch += 1;
  // Check negative violations
  for (const neg of negatives) {
    const negWords = neg.toLowerCase().replace(/^no\s+/, "").split(/\s+/).slice(0, 3).join(" ");
    if (prompt.toLowerCase().includes(negWords)) {
      styleMatch -= 1;
      flags.push(`negative_violation: ${neg.slice(0, 40)}`);
    }
  }
  if (tonePreset && /horror|dread/i.test(tonePreset) && /bright|cheerful|sunny/i.test(prompt)) {
    styleMatch -= 2;
    flags.push("tone_mismatch");
  }
  styleMatch = Math.max(0, Math.min(10, styleMatch));

  // --- 5) Framing score (0-10) ---
  let framing = 7;
  if (/composition|rule.?of.?thirds|centered|symmetr/i.test(prompt)) framing += 1;
  if (/cut.?off|awkward|crop/i.test(prompt)) {
    framing -= 2;
    flags.push("poor_framing_hint");
  }
  framing = Math.max(0, Math.min(10, framing));

  // --- Composite ---
  const technical_score = (motion * 0.25) + (clarity * 0.25) + (artifact * 0.25) + (styleMatch * 0.20) + (framing * 0.05);

  // --- Auto rejection logic ---
  let auto_rejected = false;
  let rejection_reason: string | null = null;

  if (technical_score < 6.0) {
    auto_rejected = true;
    rejection_reason = `Technical score ${technical_score.toFixed(1)} below 6.0 threshold`;
  } else if (artifact < 4) {
    auto_rejected = true;
    rejection_reason = `Artifact score ${artifact.toFixed(1)} below 4.0 — likely visual defects`;
  } else if (motion < 3 && ["hook", "crescendo"].includes(phase)) {
    auto_rejected = true;
    rejection_reason = `Motion score ${motion.toFixed(1)} too low for ${phase} phase`;
  }

  return {
    technical_score: Math.round(technical_score * 100) / 100,
    motion_score: Math.round(motion * 100) / 100,
    clarity_score: Math.round(clarity * 100) / 100,
    artifact_score: Math.round(artifact * 100) / 100,
    style_match_score: Math.round(styleMatch * 100) / 100,
    framing_score: Math.round(framing * 100) / 100,
    auto_rejected,
    rejection_reason,
    quality_flags_json: flags.length > 0 ? flags : null,
  };
}

// ─── Helper: finalize a completed clip ───

async function finalizeClip(db: any, job: any, jobId: string, projectId: string, userId: string, storagePath: string, contentType: string, model: string) {
  const { data: pubData } = db.storage.from(STORAGE_BUCKET).getPublicUrl(storagePath);
  const publicUrl = pubData?.publicUrl || "";

  // Load beat data for quality evaluation
  let beatData: any = null;
  let styleOpts: any = {};
  let genProfile: any = null;
  try {
    const { data: bp } = await db.from("trailer_blueprints")
      .select("edl, options").eq("id", job.blueprint_id).single();
    beatData = bp?.edl?.[job.beat_index] || null;
    const scriptRunId = bp?.options?.script_run_id;
    if (scriptRunId) {
      const { data: sr } = await db.from("trailer_script_runs")
        .select("style_options_json").eq("id", scriptRunId).single();
      styleOpts = sr?.style_options_json || {};
    }
    genProfile = job.params_json?.generation_profile || null;
  } catch (e) {
    console.warn("[finalizeClip] Could not load beat/style data for quality eval:", e);
  }

  // Evaluate quality
  const quality = evaluateClipQuality(
    { prompt: job.prompt, provider: job.provider, gen_params: job.params_json },
    genProfile, beatData, styleOpts
  );

  const clipStatus = quality.auto_rejected ? "rejected" : "complete";

  const { data: clip } = await db.from("trailer_clips").insert({
    project_id: projectId, blueprint_id: job.blueprint_id, beat_index: job.beat_index,
    provider: job.provider, status: clipStatus, media_type: contentType.startsWith("video") ? "video" : "image",
    storage_path: storagePath, public_url: publicUrl, duration_ms: job.length_ms,
    gen_params: job.params_json, created_by: userId, job_id: jobId,
    clip_run_id: job.clip_run_id, candidate_index: job.candidate_index,
    seed: job.seed, model, mode: job.mode, aspect_ratio: job.aspect_ratio, fps: job.fps,
    // Quality scores
    technical_score: quality.technical_score,
    motion_score: quality.motion_score,
    clarity_score: quality.clarity_score,
    artifact_score: quality.artifact_score,
    style_match_score: quality.style_match_score,
    framing_score: quality.framing_score,
    auto_rejected: quality.auto_rejected,
    rejection_reason: quality.rejection_reason,
    quality_flags_json: quality.quality_flags_json,
  }).select().single();

  await db.from("trailer_clip_jobs").update({ status: "succeeded" }).eq("id", jobId);
  await updateRunCounters(db, job.clip_run_id);

  // Log quality event
  if (quality.auto_rejected) {
    await logEvent(db, {
      project_id: projectId, blueprint_id: job.blueprint_id,
      beat_index: job.beat_index, job_id: jobId, clip_id: clip?.id,
      event_type: "auto_rejected",
      payload: {
        technical_score: quality.technical_score,
        motion_score: quality.motion_score,
        clarity_score: quality.clarity_score,
        artifact_score: quality.artifact_score,
        style_match_score: quality.style_match_score,
        rejection_reason: quality.rejection_reason,
        flags: quality.quality_flags_json,
      },
      created_by: userId,
    });
  }

  await logEvent(db, {
    project_id: projectId, blueprint_id: job.blueprint_id,
    beat_index: job.beat_index, job_id: jobId, clip_id: clip?.id,
    event_type: "job_succeeded",
    payload: {
      provider: job.provider, model, candidate_index: job.candidate_index,
      technical_score: quality.technical_score,
      auto_rejected: quality.auto_rejected,
    },
    created_by: userId,
  });

  return json({ ok: true, clipId: clip?.id, publicUrl, quality });
}

// ─── Helper: mark job failed ───

async function markJobFailed(db: any, job: any, jobId: string, projectId: string, userId: string, errorMsg: string) {
  await db.from("trailer_clip_jobs").update({ status: "failed", error: errorMsg }).eq("id", jobId);
  await updateRunCounters(db, job.clip_run_id);
  await logEvent(db, {
    project_id: projectId, blueprint_id: job.blueprint_id,
    beat_index: job.beat_index, job_id: jobId,
    event_type: "job_failed",
    payload: { provider: job.provider, error: errorMsg, attempt: job.attempt },
    created_by: userId,
  });
}

// ─── Helper: update run counters ───

async function updateRunCounters(db: any, clipRunId: string | null) {
  if (!clipRunId) return;
  const { data: runJobs } = await db.from("trailer_clip_jobs")
    .select("status").eq("clip_run_id", clipRunId);
  const done = (runJobs || []).filter((j: any) => j.status === "succeeded").length;
  const failed = (runJobs || []).filter((j: any) => j.status === "failed").length;
  const allDone = (runJobs || []).every((j: any) => ["succeeded", "failed", "canceled"].includes(j.status));
  await db.from("trailer_clip_runs").update({
    done_jobs: done, failed_jobs: failed,
    status: allDone ? "complete" : "running",
  }).eq("id", clipRunId);
}

// ─── Action: poll_pending_jobs ───

async function handlePollPendingJobs(db: any, body: any, userId: string) {
  const { projectId, blueprintId } = body;
  if (!blueprintId) return json({ error: "blueprintId required" }, 400);

  const { data: pollingJobs } = await db.from("trailer_clip_jobs")
    .select("*")
    .eq("project_id", projectId)
    .eq("blueprint_id", blueprintId)
    .eq("status", "polling");

  if (!pollingJobs || pollingJobs.length === 0) {
    return json({ ok: true, polled: 0, completed: 0, stillPolling: 0 });
  }

  let completed = 0;
  let stillPolling = 0;
  let failed = 0;

  for (const job of pollingJobs) {
    try {
      let pollResult: { videoUrl?: string; status: string };

      if (job.provider === "veo") {
        pollResult = await pollVeo(job.provider_job_id);
      } else if (job.provider === "runway") {
        pollResult = await pollRunway(job.provider_job_id);
      } else {
        continue;
      }

      if (pollResult.status === "complete" && pollResult.videoUrl) {
        const storagePath = await downloadAndStore(db, pollResult.videoUrl, projectId, job.blueprint_id, job.beat_index, job.id);
        await finalizeClip(db, job, job.id, projectId, userId, storagePath, "video/mp4", job.provider === "veo" ? "veo-2.0-generate-001" : "gen4.5");
        completed++;
      } else {
        stillPolling++;
        // Check if job has been polling too long (>10 min)
        const claimedAt = new Date(job.claimed_at).getTime();
        const timeoutMs = job.provider === "runway" ? 5 * 60 * 1000 : 10 * 60 * 1000;
        if (Date.now() - claimedAt > timeoutMs) {
          await markJobFailed(db, job, job.id, projectId, userId, `${job.provider} generation timed out after ${timeoutMs / 60000} minutes`);
          failed++;
          stillPolling--;
        }
      }
    } catch (err: any) {
      console.error(`[poll_pending] Job ${job.id} error:`, err.message);
      await markJobFailed(db, job, job.id, projectId, userId, err.message);
      failed++;

      // Veo content-policy failure during polling — single fallback to Runway
      if (job.provider === "veo" && isContentPolicyError(err.message)) {
        const fallbackKey = `${job.idempotency_key}-runway-fallback`;
        const { data: existingFb } = await db.from("trailer_clip_jobs")
          .select("id").eq("idempotency_key", fallbackKey).maybeSingle();
        if (!existingFb) {
          const fallbackPrompt = truncatePrompt(job.prompt, RUNWAY_MAX_PROMPT_CHARS);
          await db.from("trailer_clip_jobs").insert({
            project_id: projectId, blueprint_id: job.blueprint_id,
            clip_run_id: job.clip_run_id, beat_index: job.beat_index,
            candidate_index: job.candidate_index, provider: "runway",
            mode: job.mode, prompt: fallbackPrompt,
            length_ms: job.length_ms, aspect_ratio: job.aspect_ratio,
            fps: job.fps, seed: job.seed, init_image_paths: job.init_image_paths || [],
            params_json: { ...(job.params_json || {}), fallback_from_provider: "veo" },
            idempotency_key: fallbackKey, status: "queued",
          });
          console.log(`[poll_pending] Created Runway fallback for Veo content-policy on beat ${job.beat_index}`);
        }
      }
    }
  }

  return json({ ok: true, polled: pollingJobs.length, completed, stillPolling, failed });
}

// ─── Action: progress ───

async function handleProgress(db: any, body: any) {
  const { projectId, blueprintId } = body;
  if (!blueprintId) return json({ error: "blueprintId required" }, 400);

  const { data: jobs } = await db.from("trailer_clip_jobs").select("id, beat_index, status, provider, candidate_index")
    .eq("project_id", projectId).eq("blueprint_id", blueprintId);

  const { data: clips } = await db.from("trailer_clips").select("beat_index, selected, id, provider, candidate_index, public_url, status, technical_score, auto_rejected, rejection_reason")
    .eq("project_id", projectId).eq("blueprint_id", blueprintId);

  const counts: Record<string, number> = { queued: 0, running: 0, polling: 0, succeeded: 0, failed: 0, canceled: 0, total: 0 };
  for (const j of (jobs || [])) {
    counts.total++;
    counts[j.status as keyof typeof counts] = ((counts[j.status as keyof typeof counts] as number) || 0) + 1;
  }

  // Per-beat summary
  const beatSummary: Record<number, any> = {};
  for (const j of (jobs || [])) {
    if (!beatSummary[j.beat_index]) beatSummary[j.beat_index] = { jobs: [], clips: [], selectedClipId: null };
    beatSummary[j.beat_index].jobs.push(j);
  }
  for (const c of (clips || [])) {
    if (!beatSummary[c.beat_index]) beatSummary[c.beat_index] = { jobs: [], clips: [], selectedClipId: null };
    beatSummary[c.beat_index].clips.push(c);
    if (c.selected) beatSummary[c.beat_index].selectedClipId = c.id;
  }

  // Clip runs
  const { data: runs } = await db.from("trailer_clip_runs").select("*")
    .eq("blueprint_id", blueprintId).order("created_at", { ascending: false }).limit(5);

  return json({ ok: true, counts, beatSummary, clipCount: (clips || []).length, runs: runs || [] });
}

// ─── Action: retry_job ───

async function handleRetryJob(db: any, body: any, userId: string) {
  const { projectId, jobId } = body;
  if (!jobId) return json({ error: "jobId required" }, 400);

  const { data: job } = await db.from("trailer_clip_jobs").select("*")
    .eq("id", jobId).eq("project_id", projectId).single();
  if (!job) return json({ error: "Job not found" }, 404);
  if (job.status !== "failed") return json({ error: "Can only retry failed jobs" }, 400);
  if (job.attempt >= job.max_attempts) return json({ error: `Max attempts (${job.max_attempts}) reached` }, 400);

  await db.from("trailer_clip_jobs").update({
    status: "queued", error: null, provider_job_id: null, claimed_at: null,
  }).eq("id", jobId);

  await logEvent(db, {
    project_id: projectId, blueprint_id: job.blueprint_id,
    beat_index: job.beat_index, job_id: jobId,
    event_type: "job_retried", payload: { attempt: job.attempt },
    created_by: userId,
  });

  return json({ ok: true });
}

// ─── Action: cancel_job ───

async function handleCancelJob(db: any, body: any, userId: string) {
  const { projectId, jobId } = body;
  if (!jobId) return json({ error: "jobId required" }, 400);

  const { data: job } = await db.from("trailer_clip_jobs").select("*")
    .eq("id", jobId).eq("project_id", projectId).single();
  if (!job) return json({ error: "Job not found" }, 404);
  if (!["queued", "running"].includes(job.status)) return json({ error: "Can only cancel queued/running jobs" }, 400);

  await db.from("trailer_clip_jobs").update({ status: "canceled" }).eq("id", jobId);

  await logEvent(db, {
    project_id: projectId, blueprint_id: job.blueprint_id,
    beat_index: job.beat_index, job_id: jobId,
    event_type: "job_canceled", created_by: userId,
  });

  return json({ ok: true });
}

// ─── Action: select_clip ───

async function handleSelectClip(db: any, body: any, userId: string) {
  const { projectId, clipId, blueprintId, beatIndex } = body;
  if (!clipId) return json({ error: "clipId required" }, 400);

  // Deselect all for same beat
  await db.from("trailer_clips")
    .update({ used_in_cut: false, selected: false })
    .eq("blueprint_id", blueprintId).eq("beat_index", beatIndex).eq("project_id", projectId);

  // Select this one
  await db.from("trailer_clips")
    .update({ used_in_cut: true, selected: true, status: "selected" })
    .eq("id", clipId).eq("project_id", projectId);

  await logEvent(db, {
    project_id: projectId, blueprint_id: blueprintId,
    beat_index: beatIndex, clip_id: clipId,
    event_type: "clip_selected", created_by: userId,
  });

  return json({ ok: true });
}

// ─── Action: list_clips ───

async function handleListClips(db: any, body: any) {
  const { projectId, blueprintId } = body;
  if (!blueprintId) return json({ error: "blueprintId required" }, 400);
  const { data } = await db.from("trailer_clips").select("*")
    .eq("project_id", projectId).eq("blueprint_id", blueprintId)
    .order("beat_index").order("technical_score", { ascending: false }).order("candidate_index");
  return json({ clips: data || [] });
}

// ─── Action: list_jobs ───

async function handleListJobs(db: any, body: any) {
  const { projectId, blueprintId } = body;
  if (!blueprintId) return json({ error: "blueprintId required" }, 400);
  const { data } = await db.from("trailer_clip_jobs").select("*")
    .eq("project_id", projectId).eq("blueprint_id", blueprintId)
    .order("beat_index").order("candidate_index");
  return json({ jobs: data || [] });
}

// ─── Action: process_queue (batch process N jobs) ───

async function handleProcessQueue(db: any, body: any, userId: string) {
  const { projectId, blueprintId, maxJobs = 2 } = body;
  if (!blueprintId) return json({ error: "blueprintId required" }, 400);

  const results: any[] = [];
  const rateLimitedProviders = new Set<string>();

  for (let i = 0; i < maxJobs; i++) {
    const { data: jobId } = await db.rpc("claim_next_trailer_clip_job", {
      _project_id: projectId,
      _blueprint_id: blueprintId,
    });
    if (!jobId) break;

    // Check if this job's provider is rate-limited — if so, re-queue and try next
    const { data: peekedJob } = await db.from("trailer_clip_jobs").select("provider").eq("id", jobId).single();
    if (peekedJob && rateLimitedProviders.has(peekedJob.provider)) {
      // Re-queue this job and continue to the next one
      await db.from("trailer_clip_jobs").update({ status: "queued", claimed_at: null }).eq("id", jobId);
      continue;
    }

    const processResult = await handleProcessJob(db, { projectId, jobId }, userId);
    const resultBody = await processResult.json();
    results.push({ jobId, ...resultBody });

    // If rate limited, mark this provider as blocked but keep processing other providers
    if (resultBody.status === "requeued" && peekedJob?.provider) {
      rateLimitedProviders.add(peekedJob.provider);
      console.log(`[process_queue] ${peekedJob.provider} rate limited — skipping provider, continuing others`);
      continue;
    }

    // Delay between jobs to respect rate limits
    if (i < maxJobs - 1) await sleep(3000);
  }

  // Also poll any pending/polling jobs in the same cycle
  let pollResult = { polled: 0, completed: 0, stillPolling: 0, failed: 0 };
  try {
    const pollResp = await handlePollPendingJobs(db, { projectId, blueprintId }, userId);
    pollResult = await pollResp.json();
  } catch {}

  return json({ ok: true, processed: results.length, results, poll: pollResult });
}

// ─── Action: cancel_all (stop all queued/running jobs) ───

async function handleCancelAll(db: any, body: any, userId: string) {
  const { projectId, blueprintId } = body;
  if (!blueprintId) return json({ error: "blueprintId required" }, 400);

  const { data: affected } = await db.from("trailer_clip_jobs")
    .update({ status: "canceled" })
    .eq("project_id", projectId)
    .eq("blueprint_id", blueprintId)
    .in("status", ["queued", "running"])
    .select("id");

  const count = (affected || []).length;

  // Update any active clip runs to reflect cancellation
  await db.from("trailer_clip_runs")
    .update({ status: "canceled" })
    .eq("blueprint_id", blueprintId)
    .eq("status", "running");

  await logEvent(db, {
    project_id: projectId, blueprint_id: blueprintId,
    event_type: "cancel_all",
    payload: { canceledCount: count },
    created_by: userId,
  });

  return json({ ok: true, canceled: count });
}

// ─── Action: reset_failed (re-queue all failed jobs) ───

async function handleResetFailed(db: any, body: any, userId: string) {
  const { projectId, blueprintId } = body;
  if (!blueprintId) return json({ error: "blueprintId required" }, 400);

  const { data: affected } = await db.from("trailer_clip_jobs")
    .update({ status: "queued", error: null, provider_job_id: null, claimed_at: null })
    .eq("project_id", projectId)
    .eq("blueprint_id", blueprintId)
    .eq("status", "failed")
    .select("id");

  const count = (affected || []).length;

  await logEvent(db, {
    project_id: projectId, blueprint_id: blueprintId,
    event_type: "reset_failed",
    payload: { resetCount: count },
    created_by: userId,
  });

  return json({ ok: true, reset: count });
}

// ─── Action: test_veo (diagnostic) ───

async function handleTestVeo() {
  const apiKey = Deno.env.get("VEO_API_KEY") || Deno.env.get("GOOGLE_API_KEY");
  if (!apiKey) return json({ error: "VEO_API_KEY not configured", keyPresent: false }, 400);

  const model = "veo-2.0-generate-001";
  const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${model}:predictLongRunning?key=${apiKey}`;

  const body = {
    instances: [{ prompt: "A calm ocean wave at sunset, cinematic, 4K" }],
    parameters: { aspectRatio: "16:9", durationSeconds: 5 },
  };

  console.log(`[test_veo] Calling Veo API...`);

  try {
    const resp = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

    const text = await resp.text();
    console.log(`[test_veo] Status: ${resp.status}, Response: ${text.slice(0, 2000)}`);

    let parsed: any = null;
    try { parsed = JSON.parse(text); } catch {}

    return json({
      ok: resp.ok,
      status: resp.status,
      keyPresent: true,
      keyPrefix: apiKey.slice(0, 8) + "...",
      response: parsed || text.slice(0, 1000),
    }, resp.ok ? 200 : 400);
  } catch (err: any) {
    console.error(`[test_veo] Fetch error:`, err.message);
    return json({ error: err.message, keyPresent: true }, 500);
  }
}

// ─── Action: run_technical_clip_judge ───

async function handleRunTechnicalClipJudge(db: any, body: any, userId: string) {
  const { projectId, blueprintId, clipRunId } = body;
  if (!blueprintId) return json({ error: "blueprintId required" }, 400);

  // Load complete clips
  const query = db.from("trailer_clips").select("*")
    .eq("project_id", projectId)
    .eq("blueprint_id", blueprintId)
    .eq("status", "complete");
  if (clipRunId) query.eq("clip_run_id", clipRunId);

  const { data: clips } = await query;
  if (!clips?.length) return json({ error: "No complete clips to judge" }, 400);

  // Load beat metadata (from blueprint EDL)
  const { data: bp } = await db.from("trailer_blueprints")
    .select("edl, options").eq("id", blueprintId).single();
  const edl = bp?.edl || [];

  // Load style options from script run if available
  let styleOptions: Record<string, any> = {};
  const scriptRunId = bp?.options?.script_run_id;
  if (scriptRunId) {
    const { data: sr } = await db.from("trailer_script_runs")
      .select("style_options_json, trailer_type").eq("id", scriptRunId).single();
    styleOptions = sr?.style_options_json || {};
  }

  // Load shot specs if shot design run exists
  const shotDesignRunId = bp?.options?.shot_design_run_id;
  let shotSpecsByBeat: Record<number, any[]> = {};
  if (shotDesignRunId) {
    const { data: specs } = await db.from("trailer_shot_specs")
      .select("*, prompt_hint_json").eq("shot_design_run_id", shotDesignRunId);
    for (const s of (specs || [])) {
      // Map back to beat_index via the beat relationship
      const { data: beatRow } = await db.from("trailer_script_beats")
        .select("beat_index").eq("id", s.beat_id).single();
      const bi = beatRow?.beat_index ?? s.shot_index ?? 0;
      if (!shotSpecsByBeat[bi]) shotSpecsByBeat[bi] = [];
      shotSpecsByBeat[bi].push(s);
    }
  }

  // Use Lovable AI for judging
  const lovableApiKey = Deno.env.get("LOVABLE_API_KEY") || "";

  const results: any[] = [];
  let judged = 0;
  let rejected = 0;
  let passed = 0;

  for (const clip of clips) {
    // Skip already-judged clips (check existing score)
    const { data: existingScore } = await db.from("trailer_clip_scores")
      .select("id").eq("clip_id", clip.id).single();
    if (existingScore) continue;

    const beatIndex = clip.beat_index;
    const beatEdl = edl[beatIndex] || {};
    const beatSpecs = shotSpecsByBeat[beatIndex] || [];
    const clipSpec = beatEdl.clip_spec || {};

    // Find matching shot spec for this clip
    const matchSpec = beatSpecs.find((s: any) => 
      s.shot_index === (clip.candidate_index || 0)
    ) || beatSpecs[0] || {};

    const specContext = [
      `Shot type: ${matchSpec.shot_type || clipSpec.shot_type || "unknown"}`,
      `Camera move: ${matchSpec.camera_move || clipSpec.camera_move || "unknown"}`,
      `Movement intensity: ${matchSpec.movement_intensity || "5"}/10`,
      matchSpec.lens_mm ? `Lens: ${matchSpec.lens_mm}mm` : "",
      matchSpec.depth_strategy ? `Depth: ${matchSpec.depth_strategy}` : "",
      matchSpec.foreground_element ? `FG element: ${matchSpec.foreground_element}` : "",
      matchSpec.lighting_note ? `Lighting: ${matchSpec.lighting_note}` : "",
      matchSpec.transition_in ? `Transition in: ${matchSpec.transition_in}` : "",
      matchSpec.transition_out ? `Transition out: ${matchSpec.transition_out}` : "",
      matchSpec.prompt_hint_json?.subject_action ? `Subject action: ${matchSpec.prompt_hint_json.subject_action}` : "",
      matchSpec.prompt_hint_json?.reveal_mechanic ? `Reveal: ${matchSpec.prompt_hint_json.reveal_mechanic}` : "",
    ].filter(Boolean).join("\n");

    const styleContext = [
      styleOptions.tonePreset ? `Tone: ${styleOptions.tonePreset}` : "",
      styleOptions.cameraStyle ? `Camera style: ${styleOptions.cameraStyle}` : "",
      styleOptions.lensBias ? `Lens bias: ${styleOptions.lensBias}` : "",
      styleOptions.pacingProfile ? `Pacing: ${styleOptions.pacingProfile}` : "",
    ].filter(Boolean).join("\n");

    const system = `You are a professional trailer editor assessing raw AI-generated cinematic clips for technical quality.

Score the clip 0.0–1.0 on each dimension:

MOTION (0.0-1.0):
- Is the camera actually moving as requested?
- Is there subject motion in frame?
- Is there parallax or depth shift?
- Does motion match the requested intensity level?
- 0.0 = completely static when motion was requested
- 1.0 = perfect motivated camera movement matching spec

CLARITY (0.0-1.0):
- Is the subject readable and identifiable?
- Is the focal plane coherent?
- Is framing intentional and composed?
- 0.0 = completely unreadable
- 1.0 = crisp, well-composed, intentional framing

ARTIFACTS (0.0-1.0) — THIS IS A PENALTY SCORE:
- 0.0 = no artifacts (good)
- 1.0 = severe artifacts (bad)
- Check for: warping, limb distortion, texture melt, frame tearing, morphing faces, flickering

STYLE (0.0-1.0):
- Does the visual mood match the tone preset?
- Is the energy appropriate for the trailer phase?
- Does color/lighting feel cohesive?
- 0.0 = completely wrong style
- 1.0 = perfect style match

Return STRICT JSON only:
{
  "motion": 0.0-1.0,
  "clarity": 0.0-1.0,
  "artifacts": 0.0-1.0,
  "style": 0.0-1.0,
  "flags": ["list of specific issues found"],
  "overall": weighted_score
}

Weighting formula:
overall = (motion * 0.35) + (clarity * 0.25) + (style * 0.25) - (artifacts * 0.25)
Clamp overall between 0.0 and 1.0.

No commentary. No markdown. Only valid JSON.`;

    const userMsg = `Assess this AI-generated video clip:

CLIP URL: ${clip.public_url}
PROVIDER: ${clip.provider}
DURATION: ${clip.duration_ms}ms
BEAT PHASE: ${beatEdl.phase || beatEdl.role || "unknown"}

SHOT SPEC (what was requested):
${specContext}

STYLE DIRECTIVES:
${styleContext || "No specific style directives"}

GENERATION PROMPT USED:
${(clip.gen_params?.prompt || clip.gen_params?.clip_spec?.visual_prompt || "").toString().slice(0, 500)}`;

    try {
      // Use Lovable AI via the shared LLM pattern
      const llmResp = await fetch("https://api.lovable.dev/v1/chat/completions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${lovableApiKey}`,
        },
        body: JSON.stringify({
          model: "google/gemini-2.5-flash",
          messages: [
            { role: "system", content: system },
            { role: "user", content: userMsg },
          ],
          temperature: 0.2,
          max_tokens: 1000,
        }),
      });

      if (!llmResp.ok) {
        console.error(`[tech_judge] LLM error for clip ${clip.id}: ${llmResp.status}`);
        continue;
      }

      const llmResult = await llmResp.json();
      const content = llmResult.choices?.[0]?.message?.content || "";
      
      // Parse JSON from response
      let scores: any;
      try {
        const jsonMatch = content.match(/\{[\s\S]*\}/);
        scores = jsonMatch ? JSON.parse(jsonMatch[0]) : null;
      } catch {
        console.error(`[tech_judge] Failed to parse response for clip ${clip.id}`);
        continue;
      }
      if (!scores) continue;

      // Compute overall with clamping
      const motion = Math.max(0, Math.min(1, scores.motion || 0));
      const clarity = Math.max(0, Math.min(1, scores.clarity || 0));
      const artifacts = Math.max(0, Math.min(1, scores.artifacts || 0));
      const style = Math.max(0, Math.min(1, scores.style || 0));
      const overall = Math.max(0, Math.min(1,
        (motion * 0.35) + (clarity * 0.25) + (style * 0.25) - (artifacts * 0.25)
      ));

      // Insert score
      await db.from("trailer_clip_scores").upsert({
        project_id: projectId,
        clip_id: clip.id,
        blueprint_id: blueprintId,
        beat_index: beatIndex,
        technical_motion_score: motion,
        technical_clarity_score: clarity,
        artifact_penalty: artifacts,
        style_cohesion_score: style,
        technical_overall: overall,
        technical_flags: scores.flags || [],
        judge_model: "gemini-2.5-flash",
        raw_response: scores,
        created_by: userId,
      }, { onConflict: "clip_id" });

      // Auto-rejection rules
      const shouldReject = motion < 0.5 || clarity < 0.5 || artifacts > 0.6 || overall < 0.55;

      if (shouldReject) {
        // Only reject if not manually selected
        if (!clip.selected) {
          await db.from("trailer_clips").update({ 
            status: "rejected",
            selected: false,
          }).eq("id", clip.id);
        }
        await logEvent(db, {
          project_id: projectId, blueprint_id: blueprintId,
          beat_index: beatIndex, clip_id: clip.id,
          event_type: "technical_reject",
          payload: { motion, clarity, artifacts, style, overall, flags: scores.flags },
          created_by: userId,
        });
        rejected++;
      } else {
        // Only update status if not already selected by user
        if (!clip.selected) {
          await db.from("trailer_clips").update({ 
            status: "approved_technical",
          }).eq("id", clip.id);
        }
        await logEvent(db, {
          project_id: projectId, blueprint_id: blueprintId,
          beat_index: beatIndex, clip_id: clip.id,
          event_type: "technical_pass",
          payload: { motion, clarity, artifacts, style, overall },
          created_by: userId,
        });
        passed++;
      }

      results.push({ clipId: clip.id, beatIndex, motion, clarity, artifacts, style, overall, rejected: shouldReject });
      judged++;

    } catch (err: any) {
      console.error(`[tech_judge] Error judging clip ${clip.id}:`, err.message);
    }
  }

  // Auto-pick best per beat: keep top 2, reject rest
  const beatGroups: Record<number, any[]> = {};
  for (const r of results) {
    if (!r.rejected) {
      if (!beatGroups[r.beatIndex]) beatGroups[r.beatIndex] = [];
      beatGroups[r.beatIndex].push(r);
    }
  }

  let autoRejectedOverflow = 0;
  for (const [bi, group] of Object.entries(beatGroups)) {
    // Sort by overall descending
    group.sort((a: any, b: any) => b.overall - a.overall);
    // Keep top 2, reject rest (unless manually selected)
    for (let i = 2; i < group.length; i++) {
      const clipId = group[i].clipId;
      // Check if manually selected
      const { data: clipRow } = await db.from("trailer_clips")
        .select("selected").eq("id", clipId).single();
      if (clipRow?.selected) continue;

      await db.from("trailer_clips").update({
        status: "rejected",
        selected: false,
      }).eq("id", clipId);

      await logEvent(db, {
        project_id: projectId, blueprint_id: blueprintId,
        beat_index: parseInt(bi), clip_id: clipId,
        event_type: "technical_overflow_reject",
        payload: { reason: "exceeded_top_2", overall: group[i].overall },
        created_by: userId,
      });
      autoRejectedOverflow++;
    }
  }

  return json({
    ok: true,
    judged,
    passed,
    rejected,
    autoRejectedOverflow,
    results,
  });
}

// ─── Action: regenerate_low_quality ───

async function handleRegenerateLowQuality(db: any, body: any, userId: string) {
  const { projectId, blueprintId, threshold = 6.0 } = body;
  if (!blueprintId) return json({ error: "blueprintId required" }, 400);

  // Find low-quality clips
  const { data: lowClips } = await db.from("trailer_clips")
    .select("beat_index, seed")
    .eq("project_id", projectId)
    .eq("blueprint_id", blueprintId)
    .or(`technical_score.lt.${threshold},auto_rejected.eq.true`)
    .not("selected", "eq", true);

  if (!lowClips?.length) return json({ ok: true, regenerated: 0, message: "No low-quality clips to regenerate" });

  const beatIndices = [...new Set(lowClips.map((c: any) => c.beat_index))];

  // Re-enqueue these beats with force + seed modifier
  const result = await handleEnqueueForRun(db, {
    ...body,
    force: true,
    beatIndices,
  }, userId);

  return result;
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

    // test_veo doesn't need projectId
    if (action === "test_veo") return await handleTestVeo();

    const projectId = body.projectId || body.project_id;
    if (!projectId) return json({ error: "projectId required" }, 400);

    const db = adminClient();
    const hasAccess = await verifyAccess(db, userId, projectId);
    if (!hasAccess) return json({ error: "Forbidden" }, 403);

    switch (action) {
      case "test_veo": return await handleTestVeo();
      case "enqueue_for_run": return await handleEnqueueForRun(db, body, userId);
      case "claim_next_job": return await handleClaimNextJob(db, body);
      case "process_job": return await handleProcessJob(db, body, userId);
      case "process_queue": return await handleProcessQueue(db, body, userId);
      case "progress": return await handleProgress(db, body);
      case "poll_pending_jobs": return await handlePollPendingJobs(db, body, userId);
      case "retry_job": return await handleRetryJob(db, body, userId);
      case "cancel_job": return await handleCancelJob(db, body, userId);
      case "cancel_all": return await handleCancelAll(db, body, userId);
      case "reset_failed": return await handleResetFailed(db, body, userId);
      case "select_clip": return await handleSelectClip(db, body, userId);
      case "list_clips": return await handleListClips(db, body);
      case "list_jobs": return await handleListJobs(db, body);
      case "run_technical_clip_judge": return await handleRunTechnicalClipJudge(db, body, userId);
      case "regenerate_low_quality": return await handleRegenerateLowQuality(db, body, userId);
      default: return json({ error: `Unknown action: ${action}` }, 400);
    }
  } catch (err: any) {
    console.error("trailer-clip-generator error:", err);
    return json({ error: err.message || "Internal error" }, 500);
  }
});
