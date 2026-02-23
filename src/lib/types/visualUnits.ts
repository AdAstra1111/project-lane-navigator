/**
 * Visual Unit Engine v1.0 — Frontend types
 */

export interface VisualUnitRun {
  id: string;
  project_id: string;
  source_versions: Record<string, any>;
  engine_version: string;
  prompt_version: string;
  status: string;
  error: string | null;
  created_at: string;
  created_by: string | null;
}

export interface VisualUnitCandidate {
  id: string;
  project_id: string;
  run_id: string;
  unit_key: string;
  status: string;
  candidate_payload: CandidatePayload;
  extracted_from: Record<string, any>;
  scores: CandidateScores;
  created_at: string;
  created_by: string | null;
}

export interface CandidatePayload {
  unit_key: string;
  scene_number?: number | null;
  beat_ref?: string | null;
  logline: string;
  pivot: string;
  stakes_shift: string;
  power_shift: string;
  visual_intention: string;
  location: string;
  time: string;
  characters_present: string[];
  wardrobe_props_notes: string;
  tone: string[];
  setpieces: string[];
  trailer_value: number;
  storyboard_value: number;
  pitch_value: number;
  complexity: number;
  risks: string[];
  suggested_shots: SuggestedShot[];
}

export interface SuggestedShot {
  type: string;
  subject: string;
  purpose: string;
}

export interface CandidateScores {
  trailer_value?: number;
  storyboard_value?: number;
  pitch_value?: number;
  complexity?: number;
}

export interface VisualUnit {
  id: string;
  project_id: string;
  unit_key: string;
  candidate_id: string | null;
  canonical_payload: CandidatePayload;
  source_versions: Record<string, any>;
  locked: boolean;
  stale: boolean;
  created_at: string;
  updated_at: string;
  created_by: string | null;
  updated_by: string | null;
}

export interface VisualUnitEvent {
  id: string;
  project_id: string;
  unit_id: string | null;
  candidate_id: string | null;
  event_type: string;
  payload: Record<string, any>;
  created_at: string;
  created_by: string | null;
}

export interface VisualUnitDiff {
  id: string;
  project_id: string;
  from_candidate_id: string | null;
  to_candidate_id: string | null;
  from_unit_id: string | null;
  to_unit_id: string | null;
  unit_key: string | null;
  diff_summary: string;
  diff_json: DiffJson;
  created_at: string;
  created_by: string | null;
}

export interface DiffJson {
  changed_fields: Array<{ field: string; from: any; to: any }>;
  summary: string;
  score_deltas: Record<string, number>;
  shot_deltas: { added: number; removed: number };
}

export interface SourceVersionInfo {
  document_id: string;
  version_id: string;
  approval_status: string;
  version_number: number;
  label: string;
}
