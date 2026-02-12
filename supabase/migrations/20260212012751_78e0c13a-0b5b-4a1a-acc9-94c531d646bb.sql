
-- Add new columns to coverage_feedback_notes
ALTER TABLE public.coverage_feedback_notes
  ADD COLUMN IF NOT EXISTS writer_status text NOT NULL DEFAULT 'open',
  ADD COLUMN IF NOT EXISTS category text,
  ADD COLUMN IF NOT EXISTS priority int,
  ADD COLUMN IF NOT EXISTS section text,
  ADD COLUMN IF NOT EXISTS note_snapshot jsonb,
  ADD COLUMN IF NOT EXISTS last_updated_at timestamptz DEFAULT now();

-- Create coverage_note_threads table
CREATE TABLE IF NOT EXISTS public.coverage_note_threads (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  coverage_run_id uuid NOT NULL REFERENCES public.coverage_runs(id) ON DELETE CASCADE,
  note_id text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid NOT NULL REFERENCES auth.users(id),
  UNIQUE(coverage_run_id, note_id)
);

ALTER TABLE public.coverage_note_threads ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view threads for accessible projects"
  ON public.coverage_note_threads FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.coverage_runs cr
    JOIN public.projects p ON p.id = cr.project_id
    WHERE cr.id = coverage_run_id
    AND public.has_project_access(auth.uid(), p.id)
  ));

CREATE POLICY "Users can create threads for accessible projects"
  ON public.coverage_note_threads FOR INSERT TO authenticated
  WITH CHECK (
    auth.uid() = created_by
    AND EXISTS (
      SELECT 1 FROM public.coverage_runs cr
      JOIN public.projects p ON p.id = cr.project_id
      WHERE cr.id = coverage_run_id
      AND public.has_project_access(auth.uid(), p.id)
    )
  );

-- Create coverage_note_comments table
CREATE TABLE IF NOT EXISTS public.coverage_note_comments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  thread_id uuid NOT NULL REFERENCES public.coverage_note_threads(id) ON DELETE CASCADE,
  comment text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid NOT NULL REFERENCES auth.users(id)
);

ALTER TABLE public.coverage_note_comments ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view comments for accessible threads"
  ON public.coverage_note_comments FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.coverage_note_threads t
    JOIN public.coverage_runs cr ON cr.id = t.coverage_run_id
    JOIN public.projects p ON p.id = cr.project_id
    WHERE t.id = thread_id
    AND public.has_project_access(auth.uid(), p.id)
  ));

CREATE POLICY "Users can create comments on accessible threads"
  ON public.coverage_note_comments FOR INSERT TO authenticated
  WITH CHECK (
    auth.uid() = created_by
    AND EXISTS (
      SELECT 1 FROM public.coverage_note_threads t
      JOIN public.coverage_runs cr ON cr.id = t.coverage_run_id
      JOIN public.projects p ON p.id = cr.project_id
      WHERE t.id = thread_id
      AND public.has_project_access(auth.uid(), p.id)
    )
  );

-- Create trigger for last_updated_at on coverage_feedback_notes
CREATE OR REPLACE FUNCTION public.update_feedback_notes_timestamp()
RETURNS TRIGGER AS $$
BEGIN
  NEW.last_updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SET search_path = public;

CREATE TRIGGER update_coverage_feedback_notes_timestamp
  BEFORE UPDATE ON public.coverage_feedback_notes
  FOR EACH ROW EXECUTE FUNCTION public.update_feedback_notes_timestamp();
