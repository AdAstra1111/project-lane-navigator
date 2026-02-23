/**
 * Trailer Audio Engine v1.1 — Frontend types
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
}

export interface TrailerAudioRun {
  id: string;
  project_id: string;
  trailer_cut_id: string;
  blueprint_id: string | null;
  status: 'draft' | 'mixing' | 'ready' | 'failed';
  music_bed_asset_id: string | null;
  sfx_pack_tag: string | null;
  plan_json: AudioPlanJson;
  mix_json: MixSettings;
  output_wav_path: string | null;
  created_by: string;
  created_at: string;
  updated_at: string;
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
  generated_at?: string;
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

export const DEFAULT_MIX: MixSettings = {
  music_gain_db: -10,
  sfx_gain_db: -6,
  dialogue_duck_db: -8,
  duck_attack_ms: 30,
  duck_release_ms: 250,
  target_lufs: -14,
};
