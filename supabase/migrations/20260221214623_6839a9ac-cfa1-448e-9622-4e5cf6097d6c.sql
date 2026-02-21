
-- Add due_when and suggested_fixes to project_deferred_notes
ALTER TABLE public.project_deferred_notes
  ADD COLUMN IF NOT EXISTS due_when JSONB DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS suggested_fixes JSONB DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS severity TEXT DEFAULT 'high',
  ADD COLUMN IF NOT EXISTS category TEXT DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS pinned BOOLEAN NOT NULL DEFAULT false;

-- Add indexes for efficient queries
CREATE INDEX IF NOT EXISTS idx_deferred_notes_project_status ON public.project_deferred_notes(project_id, status);
CREATE INDEX IF NOT EXISTS idx_deferred_notes_project_target ON public.project_deferred_notes(project_id, target_deliverable_type);
CREATE INDEX IF NOT EXISTS idx_deferred_notes_project_created ON public.project_deferred_notes(project_id, created_at DESC);
