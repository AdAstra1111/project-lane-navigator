
ALTER TABLE public.execution_recommendation_triage
  ADD COLUMN comparison_key text;

CREATE INDEX idx_exec_rec_triage_compkey
  ON public.execution_recommendation_triage(project_id, comparison_key);
