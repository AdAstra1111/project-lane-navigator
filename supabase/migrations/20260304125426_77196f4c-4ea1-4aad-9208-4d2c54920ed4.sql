
-- Layer 2: Project Pending Decisions (workflow decisions, NOT canon)
CREATE TABLE public.project_pending_decisions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  decision_key text NOT NULL,
  question text NOT NULL,
  options jsonb,
  recommendation jsonb,
  classification text NOT NULL DEFAULT 'BLOCKING_NOW',
  required_evidence jsonb DEFAULT '[]'::jsonb,
  revisit_stage text,
  scope_json jsonb DEFAULT '{}'::jsonb,
  source jsonb DEFAULT '{}'::jsonb,
  status text NOT NULL DEFAULT 'pending',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Only one pending decision per key per project
CREATE UNIQUE INDEX project_pending_decisions_unique_key
ON public.project_pending_decisions (project_id, decision_key)
WHERE status = 'pending';

-- Fast lookup by project + status
CREATE INDEX project_pending_decisions_project_status
ON public.project_pending_decisions (project_id, status);

-- Validation triggers (no CHECK constraints per project doctrine)
CREATE OR REPLACE FUNCTION public.validate_pending_decision()
RETURNS trigger LANGUAGE plpgsql SET search_path TO 'public' AS $$
BEGIN
  IF NEW.classification NOT IN ('BLOCKING_NOW', 'DEFERRABLE', 'NEVER_BLOCKING') THEN
    RAISE EXCEPTION 'Invalid classification: %. Must be BLOCKING_NOW, DEFERRABLE, or NEVER_BLOCKING.', NEW.classification;
  END IF;
  IF NEW.status NOT IN ('pending', 'resolved', 'dismissed', 'expired') THEN
    RAISE EXCEPTION 'Invalid status: %. Must be pending, resolved, dismissed, or expired.', NEW.status;
  END IF;
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_validate_pending_decision
BEFORE INSERT OR UPDATE ON public.project_pending_decisions
FOR EACH ROW EXECUTE FUNCTION public.validate_pending_decision();

-- RLS: same model as decision_ledger
ALTER TABLE public.project_pending_decisions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can read own project pending decisions"
ON public.project_pending_decisions FOR SELECT
TO authenticated
USING (public.has_project_access(auth.uid(), project_id));

CREATE POLICY "Users can insert own project pending decisions"
ON public.project_pending_decisions FOR INSERT
TO authenticated
WITH CHECK (public.has_project_access(auth.uid(), project_id));

CREATE POLICY "Users can update own project pending decisions"
ON public.project_pending_decisions FOR UPDATE
TO authenticated
USING (public.has_project_access(auth.uid(), project_id));

CREATE POLICY "Users can delete own project pending decisions"
ON public.project_pending_decisions FOR DELETE
TO authenticated
USING (public.has_project_access(auth.uid(), project_id));
