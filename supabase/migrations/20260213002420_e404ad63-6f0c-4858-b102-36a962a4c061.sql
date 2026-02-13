-- Add Paradox Exec Confidence Score to project_baselines
ALTER TABLE public.project_baselines
  ADD COLUMN IF NOT EXISTS paradox_exec_confidence integer CHECK (paradox_exec_confidence IS NULL OR (paradox_exec_confidence >= 0 AND paradox_exec_confidence <= 10)),
  ADD COLUMN IF NOT EXISTS paradox_mode_flags jsonb DEFAULT '{}';
