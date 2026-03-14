
-- Create execution_recommendation_triage table
CREATE TABLE public.execution_recommendation_triage (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  recommendation_id text NOT NULL,
  triage_status text NOT NULL,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  UNIQUE (project_id, recommendation_id)
);

-- Validation trigger for triage_status
CREATE OR REPLACE FUNCTION public.validate_triage_status()
  RETURNS trigger
  LANGUAGE plpgsql
  SET search_path TO 'public'
AS $$
BEGIN
  IF NEW.triage_status NOT IN ('do_now', 'watch', 'ignore') THEN
    RAISE EXCEPTION 'Invalid triage_status: %. Must be do_now, watch, or ignore.', NEW.triage_status;
  END IF;
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_validate_triage_status
  BEFORE INSERT OR UPDATE ON public.execution_recommendation_triage
  FOR EACH ROW EXECUTE FUNCTION public.validate_triage_status();

-- RLS
ALTER TABLE public.execution_recommendation_triage ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can read triage for accessible projects"
  ON public.execution_recommendation_triage
  FOR SELECT
  TO authenticated
  USING (public.has_project_access(auth.uid(), project_id));

CREATE POLICY "Users can insert triage for accessible projects"
  ON public.execution_recommendation_triage
  FOR INSERT
  TO authenticated
  WITH CHECK (public.has_project_access(auth.uid(), project_id));

CREATE POLICY "Users can update triage for accessible projects"
  ON public.execution_recommendation_triage
  FOR UPDATE
  TO authenticated
  USING (public.has_project_access(auth.uid(), project_id));

CREATE POLICY "Users can delete triage for accessible projects"
  ON public.execution_recommendation_triage
  FOR DELETE
  TO authenticated
  USING (public.has_project_access(auth.uid(), project_id));

-- Index for fast project-scoped lookups
CREATE INDEX idx_exec_rec_triage_project ON public.execution_recommendation_triage(project_id);
