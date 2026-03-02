
-- Add embedding provenance columns to project_vectors
ALTER TABLE public.project_vectors
  ADD COLUMN IF NOT EXISTS source_hash text,
  ADD COLUMN IF NOT EXISTS source_len int,
  ADD COLUMN IF NOT EXISTS source_meta jsonb DEFAULT '{}'::jsonb;

-- Add embedding text hash to trend_signals
ALTER TABLE public.trend_signals
  ADD COLUMN IF NOT EXISTS embedding_text_hash text,
  ADD COLUMN IF NOT EXISTS embedding_text_len int;

-- Indexes for efficient lookup
CREATE INDEX IF NOT EXISTS idx_project_vectors_project_type ON public.project_vectors (project_id, vector_type, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_trend_signals_embedding_status ON public.trend_signals (status) WHERE embedding IS NOT NULL;
