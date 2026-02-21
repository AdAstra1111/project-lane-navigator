
-- Add pinned column to project_scenarios (is_archived already exists)
ALTER TABLE public.project_scenarios ADD COLUMN IF NOT EXISTS pinned boolean NOT NULL DEFAULT false;

-- Indexes for pin/archive queries
CREATE INDEX IF NOT EXISTS idx_scenarios_pinned ON public.project_scenarios(project_id, pinned) WHERE pinned = true;
CREATE INDEX IF NOT EXISTS idx_scenarios_archived ON public.project_scenarios(project_id, is_archived);
