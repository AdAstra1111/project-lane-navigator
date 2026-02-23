/**
 * Trailer Clip Generator v1 — Frontend types
 */

export interface TrailerClipJob {
  id: string;
  project_id: string;
  blueprint_id: string;
  beat_index: number;
  clip_run_id: string | null;
  provider: 'veo' | 'runway';
  mode: 'text_to_video' | 'image_to_video';
  candidate_index: number;
  length_ms: number;
  aspect_ratio: string;
  fps: number;
  seed: string;
  prompt: string;
  init_image_paths: string[];
  params_json: Record<string, any>;
  status: 'queued' | 'running' | 'succeeded' | 'failed' | 'canceled';
  attempt: number;
  max_attempts: number;
  idempotency_key: string;
  provider_job_id: string | null;
  error: string | null;
  claimed_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface TrailerClipRun {
  id: string;
  project_id: string;
  blueprint_id: string;
  created_by: string;
  status: 'running' | 'complete' | 'failed' | 'canceled';
  total_jobs: number;
  done_jobs: number;
  failed_jobs: number;
  created_at: string;
  updated_at: string;
}

export interface ClipProgress {
  counts: {
    queued: number;
    running: number;
    succeeded: number;
    failed: number;
    canceled: number;
    total: number;
  };
  beatSummary: Record<number, {
    jobs: Array<{ beat_index: number; status: string; provider: string; candidate_index: number }>;
    clips: Array<{ beat_index: number; selected: boolean; id: string; provider: string; candidate_index: number; public_url: string; status: string }>;
    selectedClipId: string | null;
  }>;
  clipCount: number;
  runs: TrailerClipRun[];
}
