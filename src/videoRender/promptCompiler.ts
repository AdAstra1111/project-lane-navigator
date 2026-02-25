/**
 * Video Render — Deterministic Prompt Compiler
 * Converts plan shot fields into a ProviderRequest with deterministic seed.
 * Same inputs => identical outputs. No randomness.
 */
import type { ProviderRequest } from "./providers/types";
import type { Shot } from "@/videoPlans/types";

/* ── Deterministic Seed Hashing ── */

/**
 * FNV-1a 32-bit hash for deterministic seed generation.
 * Same input string => same 32-bit integer, always.
 */
export function fnv1aHash(input: string): number {
  let hash = 0x811c9dc5; // FNV offset basis
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193); // FNV prime
  }
  return hash >>> 0; // ensure unsigned 32-bit
}

/**
 * Derive a deterministic seed from project_id + plan_id + shot_index.
 * Stable: same inputs always produce same seed.
 */
export function deriveSeed(projectId: string, planId: string, shotIndex: number): number {
  const key = `${projectId}:${planId}:${shotIndex}`;
  return fnv1aHash(key);
}

/* ── Negative Prompt ── */

/**
 * Fixed global negative prompt block.
 * Deterministic — never changes per shot.
 */
const GLOBAL_NEGATIVE_PROMPT = [
  "blurry", "low quality", "distorted faces", "extra limbs",
  "watermark", "text overlay", "lens flare artifact",
  "frame rate stutter", "color banding", "compression artifacts",
].join(", ");

/**
 * Extract "avoid" constraints from continuity tags.
 * Tags like "avoid:jumpcut" become negative prompt additions.
 */
function extractAvoidConstraints(tags: string[]): string[] {
  return tags
    .filter(t => t.startsWith("avoid:"))
    .map(t => t.slice(6));
}

/* ── Shot Type to Framing Map ── */

const SHOT_FRAMING: Record<string, string> = {
  WIDE: "wide establishing shot showing full environment",
  MEDIUM: "medium shot from waist up",
  CLOSE: "close-up shot focused on subject details",
  INSERT: "insert detail shot of specific object or action",
  POV: "point-of-view shot from character perspective",
  DRONE: "aerial drone shot looking down at scene",
  OTS: "over-the-shoulder shot",
  ECU: "extreme close-up on fine details",
};

const MOVE_DESCRIPTION: Record<string, string> = {
  STATIC: "static locked camera",
  PAN: "smooth horizontal pan",
  TILT: "vertical tilt movement",
  DOLLY: "dolly push forward or pull back",
  HANDHELD: "handheld organic camera movement",
  CRANE: "crane rising or descending movement",
  STEADICAM: "steadicam smooth tracking",
  TRACKING: "lateral tracking alongside subject",
};

/* ── Resolution Defaults ── */

const DEFAULT_RESOLUTION = "1280x720";
const DEFAULT_FPS = 24;
const DEFAULT_MODEL_ID = "veo-2";
const DEFAULT_PROVIDER_ID = "veo";

/* ── Prompt Compiler ── */

export interface CompilePromptInput {
  projectId: string;
  planId: string;
  shot: Shot;
  /** Optional unit-level context */
  unitIntent?: string;
  unitEnergy?: number;
  /** Override settings */
  providerId?: string;
  modelId?: string;
  resolution?: string;
  fps?: number;
  aspectRatio?: string;
}

export function compileProviderRequest(input: CompilePromptInput): ProviderRequest {
  const {
    projectId, planId, shot,
    unitIntent, unitEnergy,
    providerId = DEFAULT_PROVIDER_ID,
    modelId = DEFAULT_MODEL_ID,
    resolution = DEFAULT_RESOLUTION,
    fps = DEFAULT_FPS,
    aspectRatio,
  } = input;

  const seed = deriveSeed(projectId, planId, shot.shotIndex);

  // Build structured prompt deterministically
  const framing = SHOT_FRAMING[shot.shotType] || shot.shotType.toLowerCase();
  const movement = MOVE_DESCRIPTION[shot.cameraMove] || shot.cameraMove.toLowerCase();

  const promptParts: string[] = [
    `Cinematic ${framing}.`,
    `Camera: ${movement}.`,
    `Lens: ${shot.lensMm}mm focal length.`,
    `Duration: ${shot.durationSec} seconds.`,
  ];

  if (shot.description) {
    promptParts.push(shot.description);
  }

  if (unitIntent) {
    promptParts.push(`Narrative intent: ${unitIntent}.`);
  }

  if (unitEnergy !== undefined) {
    const energyDesc = unitEnergy >= 0.85 ? "high intensity, fast pacing"
      : unitEnergy >= 0.6 ? "moderate intensity, building tension"
      : unitEnergy >= 0.3 ? "calm, measured pacing"
      : "quiet, contemplative atmosphere";
    promptParts.push(`Energy: ${energyDesc}.`);
  }

  // Continuity constraints as explicit lines
  const continuityLines = shot.continuityTags
    .filter(t => !t.startsWith("avoid:"))
    .map(t => `Constraint: ${t}`);
  promptParts.push(...continuityLines);

  const prompt = promptParts.join(" ");

  // Negative prompt: global + avoid constraints
  const avoidParts = extractAvoidConstraints(shot.continuityTags);
  const negativePrompt = avoidParts.length > 0
    ? `${GLOBAL_NEGATIVE_PROMPT}, ${avoidParts.join(", ")}`
    : GLOBAL_NEGATIVE_PROMPT;

  return {
    providerId,
    modelId,
    resolution,
    fps,
    durationSec: shot.durationSec,
    seed,
    prompt,
    negativePrompt,
    continuityConstraints: shot.continuityTags,
    aspectRatio,
  };
}
