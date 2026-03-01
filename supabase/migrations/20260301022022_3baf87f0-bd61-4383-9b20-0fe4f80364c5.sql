
-- Add criteria snapshot and measured metrics to project_document_versions
ALTER TABLE public.project_document_versions
  ADD COLUMN IF NOT EXISTS criteria_json JSONB DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS criteria_hash TEXT DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS measured_metrics_json JSONB DEFAULT NULL;

-- Index for fast criteria_hash lookups
CREATE INDEX IF NOT EXISTS idx_pdv_criteria_hash ON public.project_document_versions (criteria_hash) WHERE criteria_hash IS NOT NULL;
