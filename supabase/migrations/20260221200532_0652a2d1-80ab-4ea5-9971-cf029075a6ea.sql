
-- Phase 5.2: Override Governance Intelligence

-- Add governance + merge_policy columns to project_scenarios
ALTER TABLE public.project_scenarios
  ADD COLUMN IF NOT EXISTS governance jsonb NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS merge_policy jsonb NULL DEFAULT '{}'::jsonb;

-- Create merge approvals table
CREATE TABLE IF NOT EXISTS public.scenario_merge_approvals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  scenario_id uuid NOT NULL REFERENCES public.project_scenarios(id) ON DELETE CASCADE,
  requested_by uuid NULL,
  requested_at timestamptz NOT NULL DEFAULT now(),
  status text NOT NULL DEFAULT 'pending',
  reviewed_by uuid NULL,
  reviewed_at timestamptz NULL,
  payload jsonb NULL,
  decision_note text NULL
);

-- RLS
ALTER TABLE public.scenario_merge_approvals ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Members can read merge approvals"
  ON public.scenario_merge_approvals
  FOR SELECT
  USING (public.has_project_access(auth.uid(), project_id));

CREATE POLICY "Members can insert merge approvals"
  ON public.scenario_merge_approvals
  FOR INSERT
  WITH CHECK (public.has_project_access(auth.uid(), project_id));

CREATE POLICY "Members can update merge approvals"
  ON public.scenario_merge_approvals
  FOR UPDATE
  USING (public.has_project_access(auth.uid(), project_id));
