-- Stage 6.9: Add pipeline-aware fields to auto_run_jobs for transparent progress + pinned inputs
ALTER TABLE public.auto_run_jobs
  ADD COLUMN IF NOT EXISTS pipeline_key text,
  ADD COLUMN IF NOT EXISTS current_stage_index integer DEFAULT 0,
  ADD COLUMN IF NOT EXISTS stage_history jsonb DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS pinned_inputs jsonb DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS last_ui_message text,
  ADD COLUMN IF NOT EXISTS approval_required_for_doc_type text,
  ADD COLUMN IF NOT EXISTS pause_reason text;