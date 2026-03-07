
-- Pipeline Transitions: immutable, append-only transition ledger
-- Records every critical pipeline state mutation as a validated transition event.

CREATE TABLE public.pipeline_transitions (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  project_id UUID NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  event_type TEXT NOT NULL,
  event_domain TEXT NOT NULL DEFAULT 'pipeline',
  status TEXT NOT NULL DEFAULT 'completed',
  
  -- State context
  doc_type TEXT,
  stage TEXT,
  lane TEXT,
  
  -- Version binding
  source_version_id UUID,
  resulting_version_id UUID,
  
  -- Correlation
  job_id UUID,
  run_id UUID,
  analysis_run_id UUID,
  decision_id UUID,
  
  -- State payload (previous/resulting state snapshots)
  previous_state JSONB NOT NULL DEFAULT '{}',
  resulting_state JSONB NOT NULL DEFAULT '{}',
  
  -- Trigger/source
  trigger TEXT,
  source_of_truth TEXT,
  generator_id TEXT,
  
  -- Scores at time of transition
  ci NUMERIC,
  gp NUMERIC,
  gap NUMERIC,
  
  -- Audit
  created_by UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Indexes for lookup patterns
CREATE INDEX idx_pipeline_transitions_project_id ON public.pipeline_transitions(project_id);
CREATE INDEX idx_pipeline_transitions_event_type ON public.pipeline_transitions(event_type);
CREATE INDEX idx_pipeline_transitions_job_id ON public.pipeline_transitions(job_id) WHERE job_id IS NOT NULL;
CREATE INDEX idx_pipeline_transitions_project_event ON public.pipeline_transitions(project_id, event_type, created_at DESC);
CREATE INDEX idx_pipeline_transitions_version ON public.pipeline_transitions(resulting_version_id) WHERE resulting_version_id IS NOT NULL;

-- RLS: service-role writes, authenticated reads own projects
ALTER TABLE public.pipeline_transitions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own project transitions"
  ON public.pipeline_transitions
  FOR SELECT
  TO authenticated
  USING (public.has_project_access(auth.uid(), project_id));

-- Immutability: prevent UPDATE and DELETE via trigger
CREATE OR REPLACE FUNCTION public.prevent_transition_mutation()
  RETURNS TRIGGER
  LANGUAGE plpgsql
  SET search_path TO 'public'
AS $$
BEGIN
  RAISE EXCEPTION 'pipeline_transitions is immutable: % not allowed', TG_OP;
END;
$$;

CREATE TRIGGER trg_pipeline_transitions_immutable_update
  BEFORE UPDATE ON public.pipeline_transitions
  FOR EACH ROW EXECUTE FUNCTION public.prevent_transition_mutation();

CREATE TRIGGER trg_pipeline_transitions_immutable_delete
  BEFORE DELETE ON public.pipeline_transitions
  FOR EACH ROW EXECUTE FUNCTION public.prevent_transition_mutation();
