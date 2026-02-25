/**
 * Video Generation Plan — Type definitions (v1)
 * Pure types, no runtime logic.
 */

/* ── Enums ── */

export const SHOT_TYPES = ["WIDE", "MEDIUM", "CLOSE", "INSERT", "POV", "DRONE", "OTS", "ECU"] as const;
export type ShotType = typeof SHOT_TYPES[number];

export const CAMERA_MOVES = ["STATIC", "PAN", "TILT", "DOLLY", "HANDHELD", "CRANE", "STEADICAM", "TRACKING"] as const;
export type CameraMove = typeof CAMERA_MOVES[number];

export const LENS_BUCKETS = [24, 35, 50, 85] as const;
export type LensMm = typeof LENS_BUCKETS[number];

/* ── Shot ── */

export interface ShotAudio {
  dialogue?: string;
  sfx?: string;
  music?: string;
}

export interface Shot {
  shotIndex: number;
  unitIndex: number;
  shotType: ShotType;
  cameraMove: CameraMove;
  lensMm: LensMm;
  durationSec: number;
  description: string;
  audio?: ShotAudio;
  continuityTags: string[];
}

/* ── Continuity ── */

export interface ContinuityRuleResult {
  rule: string;
  passed: boolean;
  detail?: string;
}

export interface ContinuityWarning {
  shotIndex: number;
  rule: string;
  message: string;
  severity: "info" | "warn" | "error";
}

/* ── Unit Summary ── */

export interface PlanUnit {
  unitIndex: number;
  intent: string;
  energy: number;
  durationSec?: number;
  beatSummary?: string;
}

/* ── Pacing ── */

export interface PlanPacing {
  totalShots: number;
  avgShotLengthSec: number;
  energyCurve: number[];
}

/* ── Full Plan ── */

export interface VideoGenerationPlanMetadata {
  projectId: string;
  documentId?: string;
  qualityRunId?: string;
  lane: string;
  createdAt: string;
  planVersion: string;
}

export interface VideoGenerationPlanV1 {
  metadata: VideoGenerationPlanMetadata;
  units: PlanUnit[];
  shotPlan: Shot[];
  pacing: PlanPacing;
  continuity: {
    rules: ContinuityRuleResult[];
    warnings: ContinuityWarning[];
  };
}

/* ── DB Row ── */

export interface VideoGenerationPlanRow {
  id: string;
  project_id: string;
  document_id: string | null;
  quality_run_id: string | null;
  lane: string;
  source: string;
  plan_version: string;
  plan_json: VideoGenerationPlanV1;
  continuity_report_json: { rules: ContinuityRuleResult[]; warnings: ContinuityWarning[] };
  created_at: string;
  created_by: string | null;
}
