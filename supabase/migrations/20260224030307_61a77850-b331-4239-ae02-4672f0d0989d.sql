
-- Add technical quality columns to trailer_clips
ALTER TABLE public.trailer_clips
  ADD COLUMN IF NOT EXISTS technical_score numeric NULL,
  ADD COLUMN IF NOT EXISTS motion_score numeric NULL,
  ADD COLUMN IF NOT EXISTS clarity_score numeric NULL,
  ADD COLUMN IF NOT EXISTS artifact_score numeric NULL,
  ADD COLUMN IF NOT EXISTS style_match_score numeric NULL,
  ADD COLUMN IF NOT EXISTS framing_score numeric NULL,
  ADD COLUMN IF NOT EXISTS auto_rejected boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS rejection_reason text NULL,
  ADD COLUMN IF NOT EXISTS quality_flags_json jsonb NULL;

-- Index for quality-based queries
CREATE INDEX IF NOT EXISTS idx_trailer_clips_quality
  ON public.trailer_clips (project_id, clip_run_id, technical_score);
