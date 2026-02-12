
-- Table: project_baselines
CREATE TABLE public.project_baselines (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  project_id UUID NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  recorded_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  internal_confidence INTEGER CHECK (internal_confidence BETWEEN 1 AND 10),
  internal_commercial_tier TEXT CHECK (internal_commercial_tier IN ('A', 'B', 'C')),
  packaging_confidence INTEGER CHECK (packaging_confidence BETWEEN 1 AND 10),
  budget_confidence INTEGER CHECK (budget_confidence BETWEEN 1 AND 10),
  would_pursue BOOLEAN,
  notes TEXT,
  user_id UUID NOT NULL DEFAULT auth.uid(),
  UNIQUE (project_id)
);

CREATE INDEX idx_project_baselines_project_id ON public.project_baselines(project_id);

ALTER TABLE public.project_baselines ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users with project access can view baselines"
  ON public.project_baselines FOR SELECT
  USING (public.has_project_access(auth.uid(), project_id));

CREATE POLICY "Users with project access can insert baselines"
  ON public.project_baselines FOR INSERT
  WITH CHECK (public.has_project_access(auth.uid(), project_id));

CREATE POLICY "Users with project access can update baselines"
  ON public.project_baselines FOR UPDATE
  USING (public.has_project_access(auth.uid(), project_id));

CREATE POLICY "Users with project access can delete baselines"
  ON public.project_baselines FOR DELETE
  USING (public.has_project_access(auth.uid(), project_id));

-- Table: project_outcomes
CREATE TABLE public.project_outcomes (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  project_id UUID NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  recorded_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  financed BOOLEAN NOT NULL DEFAULT false,
  budget_secured_amount NUMERIC,
  streamer_interest BOOLEAN NOT NULL DEFAULT false,
  optioned BOOLEAN NOT NULL DEFAULT false,
  festival_selection BOOLEAN NOT NULL DEFAULT false,
  soft_money_secured BOOLEAN NOT NULL DEFAULT false,
  talent_attached BOOLEAN NOT NULL DEFAULT false,
  distribution_offer BOOLEAN NOT NULL DEFAULT false,
  recoup_achieved BOOLEAN NOT NULL DEFAULT false,
  notes TEXT,
  user_id UUID NOT NULL DEFAULT auth.uid(),
  UNIQUE (project_id)
);

CREATE INDEX idx_project_outcomes_project_id ON public.project_outcomes(project_id);

ALTER TABLE public.project_outcomes ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users with project access can view outcomes"
  ON public.project_outcomes FOR SELECT
  USING (public.has_project_access(auth.uid(), project_id));

CREATE POLICY "Users with project access can insert outcomes"
  ON public.project_outcomes FOR INSERT
  WITH CHECK (public.has_project_access(auth.uid(), project_id));

CREATE POLICY "Users with project access can update outcomes"
  ON public.project_outcomes FOR UPDATE
  USING (public.has_project_access(auth.uid(), project_id));

CREATE POLICY "Users with project access can delete outcomes"
  ON public.project_outcomes FOR DELETE
  USING (public.has_project_access(auth.uid(), project_id));
