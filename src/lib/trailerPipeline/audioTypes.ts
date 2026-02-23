/**
 * Trailer Audio Intelligence Engine v1 — Frontend types
 */

export interface TrailerAudioAsset {
  id: string;
  project_id: string;
  kind: 'music_bed' | 'sfx';
  name: string;
  tags: string[];
  storage_path: string;
  duration_ms: number | null;
  bpm: number | null;
  created_by: string;
  created_at: string;
  // Intelligence fields
  audio_run_id: string | null;
  asset_type: 'music' | 'voiceover' | 'sfx' | 'mix' | 'stem_music' | 'stem_vo' | 'stem_sfx' | 'loudness_report' | null;
  label: string;
  provider: string | null;
  model: string | null;
  meta_json: Record<string, any>;
  selected: boolean;
}

export interface TrailerAudioRun {
  id: string;
  project_id: string;
  trailer_cut_id: string;
  blueprint_id: string | null;
  status: 'draft' | 'planning' | 'generating' | 'mixing' | 'ready' | 'failed' | 'canceled';
  music_bed_asset_id: string | null;
  sfx_pack_tag: string | null;
  plan_json: AudioPlanJson;
  mix_json: MixSettings;
  output_wav_path: string | null;
  created_by: string;
  created_at: string;
  updated_at: string;
  // Intelligence fields
  inputs_json: AudioInputsJson;
  score_json: Record<string, any>;
  error: string | null;
}

export interface AudioInputsJson {
  musicStyleTags?: string;
  voiceStyle?: string;
  voiceProvider?: string;
  musicProvider?: string;
  sfxTag?: string;
}

export interface MixSettings {
  music_gain_db: number;
  sfx_gain_db: number;
  dialogue_duck_db: number;
  duck_attack_ms: number;
  duck_release_ms: number;
  target_lufs: number;
}

export interface AudioPlanJson {
  version?: string;
  total_duration_ms?: number;
  music_segments?: Array<{
    type: string;
    start_ms: number;
    end_ms: number;
    description: string;
    gain_db: number;
  }>;
  sfx_hits?: Array<{
    type: string;
    timestamp_ms: number;
    beat_index: number;
    role?: string;
    sfx_kind: string;
    duration_ms?: number;
    description?: string;
  }>;
  vo_lines?: Array<{
    type: string;
    timestamp_ms: number;
    beat_index: number;
    line: string;
    character: string;
  }>;
  ducking_regions?: Array<{
    start_ms: number;
    end_ms: number;
    duck_db: number;
  }>;
  vo_script?: string;
  sfx_selected?: Array<{
    type: string;
    timestamp_ms: number;
    beat_index: number;
    sfx_kind: string;
    asset_id?: string;
    storage_path?: string;
    asset_name?: string;
  }>;
  generated_at?: string;
}

export interface TrailerAudioJob {
  id: string;
  project_id: string;
  audio_run_id: string;
  job_type: 'plan' | 'gen_music' | 'gen_vo' | 'select_sfx' | 'mix' | 'mux_video' | 'export_zip';
  status: 'queued' | 'running' | 'succeeded' | 'failed' | 'canceled';
  attempt: number;
  idempotency_key: string;
  payload: Record<string, any>;
  provider_job_id: string | null;
  error: string | null;
  claimed_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface TrailerAudioEvent {
  id: string;
  project_id: string;
  audio_run_id: string;
  event_type: string;
  payload: Record<string, any>;
  created_by: string;
  created_at: string;
}

export interface TrailerRenderJob {
  id: string;
  project_id: string;
  trailer_cut_id: string;
  audio_run_id: string | null;
  status: 'queued' | 'running' | 'succeeded' | 'failed' | 'canceled';
  attempt: number;
  idempotency_key: string;
  input_json: Record<string, any>;
  output_mp4_path: string | null;
  output_audio_path: string | null;
  preset: string;
  error: string | null;
  claimed_at: string | null;
  created_by: string;
  created_at: string;
  updated_at: string;
}

export interface RenderProgress {
  jobs: TrailerRenderJob[];
  counts: {
    queued: number;
    running: number;
    succeeded: number;
    failed: number;
    canceled: number;
    total: number;
  };
  latest: TrailerRenderJob | null;
}

export interface AudioProgress {
  run: TrailerAudioRun | null;
  jobs: TrailerAudioJob[];
  assets: TrailerAudioAsset[];
  events: TrailerAudioEvent[];
  warnings: string[];
  summary: {
    total_jobs: number;
    succeeded: number;
    failed: number;
    running: number;
    queued: number;
    all_complete: boolean;
  };
}

export const DEFAULT_MIX: MixSettings = {
  music_gain_db: -10,
  sfx_gain_db: -6,
  dialogue_duck_db: -8,
  duck_attack_ms: 30,
  duck_release_ms: 250,
  target_lufs: -14,
};

export const VOICE_STYLES = [
  { value: 'calm', label: 'Calm / Understated' },
  { value: 'intense', label: 'Intense / Dramatic' },
  { value: 'trailer_announcer', label: 'Classic Trailer Announcer' },
  { value: 'narrator', label: 'Narrator / Documentary' },
] as const;

export const VOICE_PROVIDERS = [
  { value: 'elevenlabs', label: 'ElevenLabs' },
  { value: 'stub', label: 'Stub (Silent Placeholder)' },
] as const;
