
-- note_change_plans table
CREATE TABLE public.note_change_plans (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  thread_id uuid NOT NULL REFERENCES public.note_threads(id) ON DELETE CASCADE,
  project_id uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  document_id uuid NOT NULL REFERENCES public.project_documents(id) ON DELETE CASCADE,
  version_id uuid NOT NULL REFERENCES public.project_document_versions(id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'draft',
  plan jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_by text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_note_change_plans_thread ON public.note_change_plans(thread_id);
CREATE INDEX idx_note_change_plans_project ON public.note_change_plans(project_id);

-- updated_at trigger
CREATE TRIGGER set_note_change_plans_updated_at
  BEFORE UPDATE ON public.note_change_plans
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- Add provenance columns to project_document_versions
ALTER TABLE public.project_document_versions
  ADD COLUMN IF NOT EXISTS applied_change_plan_id uuid REFERENCES public.note_change_plans(id),
  ADD COLUMN IF NOT EXISTS applied_change_plan jsonb,
  ADD COLUMN IF NOT EXISTS verification_json jsonb;

-- RLS for note_change_plans
ALTER TABLE public.note_change_plans ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can select own project change plans"
  ON public.note_change_plans FOR SELECT
  USING (public.has_project_access(auth.uid(), project_id));

CREATE POLICY "Users can insert own project change plans"
  ON public.note_change_plans FOR INSERT
  WITH CHECK (public.has_project_access(auth.uid(), project_id));

CREATE POLICY "Users can update own project change plans"
  ON public.note_change_plans FOR UPDATE
  USING (public.has_project_access(auth.uid(), project_id));
