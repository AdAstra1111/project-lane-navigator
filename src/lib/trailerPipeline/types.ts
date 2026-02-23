/**
 * Trailer Pipeline v2 — Frontend types
 */

export interface TrailerBlueprint {
  id: string;
  project_id: string;
  storyboard_run_id: string | null;
  arc_type: string;
  status: string;
  edl: EDLBeat[];
  rhythm_analysis: RhythmAnalysis;
  audio_plan: AudioPlan;
  text_card_plan: TextCard[];
  options: Record<string, any>;
  error: string | null;
  created_at: string;
  created_by: string;
}

export interface GeneratorHint {
  preferred_provider: "veo" | "runway";
  preferred_mode: "text_to_video" | "image_to_video";
  candidates: number;
  length_ms: number;
  aspect_ratio?: string;
  fps?: number;
  style_lock?: boolean;
  init_images?: { source?: string; frame_paths?: string[] };
}

export interface EDLBeat {
  beat_index: number;
  role: string;
  unit_key: string | null;
  panel_ref: string | null;
  duration_s: number;
  clip_spec: ClipSpec;
  generator_hint?: GeneratorHint;
}

export interface ClipSpec {
  shot_type: string;
  camera_move: string;
  action_description: string;
  visual_prompt: string;
  audio_cue: string;
  text_overlay: string | null;
}

export interface RhythmAnalysis {
  avg_beat_duration_s: number;
  fastest_beat_s: number;
  slowest_beat_s: number;
  cut_density: string;
  location_variety_score: number;
  shot_size_variety_score: number;
  warnings: string[];
}

export interface AudioPlan {
  music_cues: Array<{ beat_range: number[]; description: string; genre: string; energy: string }>;
  sfx_cues: Array<{ beat_index: number; description: string; timing: string }>;
  vo_lines: Array<{ beat_index: number; line: string; character: string }>;
}

export interface TextCard {
  beat_index: number;
  text: string;
  style: string;
  duration_s: number;
}

export interface TrailerClip {
  id: string;
  project_id: string;
  blueprint_id: string;
  beat_index: number;
  provider: string;
  status: string;
  media_type: string;
  storage_path: string | null;
  public_url: string | null;
  duration_ms: number | null;
  gen_params: Record<string, any>;
  rating: number | null;
  used_in_cut: boolean;
  error: string | null;
  created_at: string;
  created_by: string;
}

export interface TrailerCut {
  id: string;
  project_id: string;
  blueprint_id: string;
  status: string;
  timeline: TimelineEntry[];
  edl_export: any;
  storage_path: string | null;
  public_url: string | null;
  duration_ms: number | null;
  options: Record<string, any>;
  error: string | null;
  created_at: string;
  created_by: string;
}

export interface TimelineEntry {
  beat_index: number;
  role: string;
  duration_ms: number;
  clip_id: string | null;
  clip_url: string | null;
  media_type: string;
  text_overlay: string | null;
  audio_cue: string | null;
}

export interface ArcTemplate {
  name: string;
  target_duration_s: number;
  beats: Array<{ role: string; duration_range: number[]; description: string }>;
}

export type ClipProvider = 'stub' | 'elevenlabs_sfx' | 'elevenlabs_music' | 'gateway_i2v' | 'runway' | 'luma' | 'custom';
