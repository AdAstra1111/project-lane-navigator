/**
 * CIK Engine Opts Builder
 * 
 * Extracts assigned_lane from a project row and builds CinematicQualityOpts
 * with lane properly threaded. Used by trailer + storyboard engines.
 * 
 * This helper exists so that:
 * 1. Lane extraction from project is testable without DB/network.
 * 2. Future engines get lane propagation for free.
 */
import type { CinematicScore, CinematicUnit } from "../cinematic-model.ts";
import type { AdapterResult } from "../cinematic-adapters.ts";
import type { CinematicQualityOpts } from "../cinematic-kernel.ts";

/** Minimal project shape needed for lane extraction. */
export interface ProjectLaneSource {
  assigned_lane?: string | null;
}

export interface BuildEngineOptsArgs<T> {
  handler: string;
  phase: string;
  model: string;
  project: ProjectLaneSource;
  rawOutput: T;
  adapter: CinematicQualityOpts<T>["adapter"];
  buildRepairInstruction: (score: CinematicScore, unitCount?: number, lane?: string) => string;
  regenerateOnce: (repairInstruction: string) => Promise<T>;
  expected_unit_count?: number;
  isStoryboard?: boolean;
}

/**
 * Build CinematicQualityOpts from engine context.
 * Reads project.assigned_lane and maps it to opts.lane.
 */
export function buildEngineOpts<T>(args: BuildEngineOptsArgs<T>): CinematicQualityOpts<T> {
  const lane = args.project.assigned_lane || undefined;
  return {
    handler: args.handler,
    phase: args.phase,
    model: args.model,
    rawOutput: args.rawOutput,
    adapter: args.adapter,
    buildRepairInstruction: args.buildRepairInstruction,
    regenerateOnce: args.regenerateOnce,
    expected_unit_count: args.expected_unit_count,
    isStoryboard: args.isStoryboard,
    lane,
  };
}
