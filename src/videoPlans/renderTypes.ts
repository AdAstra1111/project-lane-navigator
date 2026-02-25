/**
 * Video Render Job — Type definitions
 * Pure types for render job queue system.
 */

export type RenderJobStatus = "queued" | "claimed" | "running" | "complete" | "error" | "canceled";
export type RenderShotStatus = "queued" | "claimed" | "running" | "complete" | "error";

export interface VideoRenderJobRow {
  id: string;
  project_id: string;
  plan_id: string;
  status: RenderJobStatus;
  attempt_count: number;
  last_error: string | null;
  settings_json: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

export interface VideoRenderShotRow {
  id: string;
  job_id: string;
  shot_index: number;
  status: RenderShotStatus;
  attempt_count: number;
  prompt_json: RenderShotPrompt;
  artifact_json: RenderShotArtifact;
  last_error: string | null;
  created_at: string;
  updated_at: string;
}

/** Provider-agnostic prompt params derived deterministically from shot plan. */
export interface RenderShotPrompt {
  shotIndex: number;
  unitIndex: number;
  shotType: string;
  cameraMove: string;
  lensMm: number;
  durationSec: number;
  description: string;
  continuityTags: string[];
  /** Fully assembled text prompt for a video gen provider */
  textPrompt: string;
}

/** Artifact metadata populated after render completes. */
export interface RenderShotArtifact {
  storagePath?: string;
  durationSec?: number;
  checksum?: string;
  provider?: string;
  generatedAt?: string;
}

/**
 * Deterministically build a provider-agnostic prompt_json from a plan shot.
 * Same input => identical output. No randomness.
 */
export function buildShotPrompt(shot: {
  shotIndex: number;
  unitIndex: number;
  shotType: string;
  cameraMove: string;
  lensMm: number;
  durationSec: number;
  description: string;
  continuityTags: string[];
}): RenderShotPrompt {
  const textPrompt = [
    `Shot ${shot.shotIndex}:`,
    `${shot.shotType} shot,`,
    `${shot.cameraMove} movement,`,
    `${shot.lensMm}mm lens,`,
    `${shot.durationSec}s duration.`,
    shot.description,
  ].join(" ");

  return {
    shotIndex: shot.shotIndex,
    unitIndex: shot.unitIndex,
    shotType: shot.shotType,
    cameraMove: shot.cameraMove,
    lensMm: shot.lensMm,
    durationSec: shot.durationSec,
    description: shot.description,
    continuityTags: [...shot.continuityTags],
    textPrompt,
  };
}
