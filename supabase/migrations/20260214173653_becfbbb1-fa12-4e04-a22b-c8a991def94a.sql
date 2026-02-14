
-- Step 3: Add vertical engine weights to projects
ALTER TABLE public.projects ADD COLUMN IF NOT EXISTS vertical_engine_weights jsonb DEFAULT '{"power_conflict": 20, "romantic_tension": 20, "thriller_mystery": 20, "revenge_arc": 20, "social_exposure": 20}'::jsonb;

-- Step 7: Create development_branches table
CREATE TABLE IF NOT EXISTS public.development_branches (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  parent_branch_id uuid REFERENCES public.development_branches(id),
  branch_name text NOT NULL DEFAULT 'Mainline',
  branch_type text NOT NULL DEFAULT 'mainline' CHECK (branch_type IN ('mainline', 'sandbox')),
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'archived')),
  created_at timestamptz NOT NULL DEFAULT now(),
  user_id uuid NOT NULL
);

ALTER TABLE public.development_branches ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own branches" ON public.development_branches
  FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users can create own branches" ON public.development_branches
  FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can update own branches" ON public.development_branches
  FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "Users can delete own branches" ON public.development_branches
  FOR DELETE USING (auth.uid() = user_id);

-- Add branch_id to project_document_versions for branch association
ALTER TABLE public.project_document_versions ADD COLUMN IF NOT EXISTS branch_id uuid REFERENCES public.development_branches(id);

-- Index for fast branch lookups
CREATE INDEX IF NOT EXISTS idx_branches_project ON public.development_branches(project_id);
CREATE INDEX IF NOT EXISTS idx_versions_branch ON public.project_document_versions(branch_id);
