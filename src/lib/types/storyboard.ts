/**
 * Storyboard Pipeline v1 — Frontend types
 */

export interface StoryboardRun {
  id: string;
  project_id: string;
  source_visual_unit_run_id: string | null;
  unit_keys: string[];
  style_preset: string;
  aspect_ratio: string;
  status: string;
  error: string | null;
  created_at: string;
  created_by: string | null;
}

export interface PanelPayload {
  panel_index: number;
  shot_type: string;
  camera: string;
  lens: string;
  composition: string;
  action: string;
  mood: string;
  lighting: string;
  prompt: string;
  negative_prompt: string;
  continuity_notes: string;
}

export interface StoryboardPanel {
  id: string;
  project_id: string;
  run_id: string;
  unit_key: string;
  panel_index: number;
  status: string;
  panel_payload: PanelPayload;
  created_at: string;
  created_by: string | null;
}

export interface StoryboardFrame {
  id: string;
  project_id: string;
  panel_id: string;
  status: string;
  storage_path: string;
  public_url: string;
  width: number | null;
  height: number | null;
  seed: string | null;
  model: string;
  gen_params: Record<string, any>;
  created_at: string;
  created_by: string | null;
}

export interface CanonicalUnitSummary {
  unit_key: string;
  canonical_payload: Record<string, any>;
  source_versions: Record<string, any>;
  locked: boolean;
  stale: boolean;
  scores: {
    trailer_value?: number;
    storyboard_value?: number;
    pitch_value?: number;
    complexity?: number;
  };
}
