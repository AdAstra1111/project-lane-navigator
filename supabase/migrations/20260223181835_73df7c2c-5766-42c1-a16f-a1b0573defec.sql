
-- Add missing columns to existing storyboard_exports table
ALTER TABLE public.storyboard_exports
  ADD COLUMN IF NOT EXISTS run_id uuid,
  ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'pending',
  ADD COLUMN IF NOT EXISTS options jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS public_url text,
  ADD COLUMN IF NOT EXISTS error text,
  ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();

-- Backfill run_id from shot_list_id if needed (nullable for now)
-- Create indexes
CREATE INDEX IF NOT EXISTS idx_storyboard_exports_proj_run ON public.storyboard_exports(project_id, run_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_storyboard_exports_status ON public.storyboard_exports(status);

-- Trigger for updated_at
DROP TRIGGER IF EXISTS set_storyboard_exports_updated_at ON public.storyboard_exports;
CREATE TRIGGER set_storyboard_exports_updated_at
  BEFORE UPDATE ON public.storyboard_exports
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- RLS
ALTER TABLE public.storyboard_exports ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "storyboard_exports_select" ON public.storyboard_exports;
DROP POLICY IF EXISTS "storyboard_exports_insert" ON public.storyboard_exports;
DROP POLICY IF EXISTS "storyboard_exports_update" ON public.storyboard_exports;

CREATE POLICY "storyboard_exports_select" ON public.storyboard_exports
  FOR SELECT USING (auth.role() = 'authenticated' AND has_project_access(auth.uid(), project_id));

CREATE POLICY "storyboard_exports_insert" ON public.storyboard_exports
  FOR INSERT WITH CHECK (auth.role() = 'authenticated' AND has_project_access(auth.uid(), project_id) AND created_by = auth.uid());

CREATE POLICY "storyboard_exports_update" ON public.storyboard_exports
  FOR UPDATE USING (auth.role() = 'authenticated' AND has_project_access(auth.uid(), project_id) AND created_by = auth.uid())
  WITH CHECK (auth.role() = 'authenticated' AND has_project_access(auth.uid(), project_id) AND created_by = auth.uid());
