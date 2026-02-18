-- Add resolution tracking columns to project_deferred_notes
ALTER TABLE public.project_deferred_notes
  ADD COLUMN IF NOT EXISTS resolved_at TIMESTAMP WITH TIME ZONE,
  ADD COLUMN IF NOT EXISTS resolved_in_stage TEXT,
  ADD COLUMN IF NOT EXISTS resolution_method TEXT, -- 'user_marked' | 'ai_patch_applied' | 'dismissed'
  ADD COLUMN IF NOT EXISTS resolution_summary TEXT;

-- Add index for fast filtering of open notes
CREATE INDEX IF NOT EXISTS idx_project_deferred_notes_status_project
  ON public.project_deferred_notes (project_id, status)
  WHERE status NOT IN ('resolved', 'dismissed');

COMMENT ON COLUMN public.project_deferred_notes.resolved_at IS 'When the note was resolved';
COMMENT ON COLUMN public.project_deferred_notes.resolved_in_stage IS 'The doc_type stage at which the note was resolved';
COMMENT ON COLUMN public.project_deferred_notes.resolution_method IS 'user_marked | ai_patch_applied | dismissed';
COMMENT ON COLUMN public.project_deferred_notes.resolution_summary IS 'Brief description of what was done to resolve';