/**
 * Timeline Builder — Deterministic EDL-like timeline from completed render shots.
 * Same inputs => identical timeline_json. No randomness.
 */

export interface TimelineClip {
  shotIndex: number;
  srcPath: string;
  publicUrl?: string;
  startSec: number;
  endSec: number;
  durationSec: number;
}

export interface TimelineTrack {
  type: "video";
  clips: TimelineClip[];
}

export interface TimelineV1 {
  version: "v1";
  fps: number;
  resolution: string;
  totalDurationSec: number;
  tracks: TimelineTrack[];
}

export interface TimelineShotInput {
  shot_index: number;
  status: string;
  artifact_json: {
    storagePath?: string;
    publicUrl?: string;
    durationSec?: number;
    [key: string]: unknown;
  };
  prompt_json: {
    durationSec?: number;
    [key: string]: unknown;
  };
}

export interface TimelineBuildOptions {
  fps?: number;
  resolution?: string;
}

/**
 * Build a deterministic timeline from ordered shots.
 * Shots MUST be sorted by shot_index ascending before calling.
 * Only includes shots with status === 'complete'.
 */
export function buildTimeline(
  shots: TimelineShotInput[],
  options: TimelineBuildOptions = {}
): TimelineV1 {
  const fps = options.fps || 24;
  const resolution = options.resolution || "1280x720";

  // Filter to complete shots, already sorted by shot_index
  const completeShots = shots
    .filter(s => s.status === "complete")
    .sort((a, b) => a.shot_index - b.shot_index);

  let cursor = 0;
  const clips: TimelineClip[] = completeShots.map(shot => {
    const artifact = shot.artifact_json || {};
    const prompt = shot.prompt_json || {};
    // Duration: prefer artifact metadata, fallback to plan duration, then default 4s
    const durationSec = artifact.durationSec ?? prompt.durationSec ?? 4;
    const startSec = cursor;
    const endSec = cursor + durationSec;
    cursor = endSec;

    return {
      shotIndex: shot.shot_index,
      srcPath: artifact.storagePath || "",
      publicUrl: artifact.publicUrl,
      startSec: roundTo3(startSec),
      endSec: roundTo3(endSec),
      durationSec: roundTo3(durationSec),
    };
  });

  return {
    version: "v1",
    fps,
    resolution,
    totalDurationSec: roundTo3(cursor),
    tracks: [{ type: "video", clips }],
  };
}

function roundTo3(n: number): number {
  return Math.round(n * 1000) / 1000;
}
