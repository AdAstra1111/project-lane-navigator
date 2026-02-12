
-- Budget Assumptions table
CREATE TABLE public.budget_assumptions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL,
  project_id UUID NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  version INTEGER DEFAULT 1,
  currency TEXT DEFAULT 'GBP',
  budget_band TEXT DEFAULT '',
  estimated_total NUMERIC DEFAULT 0,
  schedule_weeks INTEGER DEFAULT 0,
  shoot_days INTEGER DEFAULT 0,
  union_level TEXT DEFAULT '',
  location_count INTEGER DEFAULT 0,
  vfx_level TEXT DEFAULT 'none',
  cast_level TEXT DEFAULT '',
  notes TEXT DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.budget_assumptions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own budget assumptions"
ON public.budget_assumptions FOR SELECT
USING (public.has_project_access(auth.uid(), project_id));

CREATE POLICY "Users can insert budget assumptions"
ON public.budget_assumptions FOR INSERT
WITH CHECK (auth.uid() = user_id AND public.has_project_access(auth.uid(), project_id));

CREATE POLICY "Users can update budget assumptions"
ON public.budget_assumptions FOR UPDATE
USING (public.has_project_access(auth.uid(), project_id));

CREATE POLICY "Users can delete budget assumptions"
ON public.budget_assumptions FOR DELETE
USING (public.has_project_access(auth.uid(), project_id));

-- Packaging Items table
CREATE TABLE public.packaging_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL,
  project_id UUID NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  item_type TEXT NOT NULL DEFAULT 'CAST',
  name TEXT DEFAULT '',
  archetype TEXT DEFAULT '',
  status TEXT DEFAULT 'TARGET',
  priority INTEGER DEFAULT 3,
  notes TEXT DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.packaging_items ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view packaging items"
ON public.packaging_items FOR SELECT
USING (public.has_project_access(auth.uid(), project_id));

CREATE POLICY "Users can insert packaging items"
ON public.packaging_items FOR INSERT
WITH CHECK (auth.uid() = user_id AND public.has_project_access(auth.uid(), project_id));

CREATE POLICY "Users can update packaging items"
ON public.packaging_items FOR UPDATE
USING (public.has_project_access(auth.uid(), project_id));

CREATE POLICY "Users can delete packaging items"
ON public.packaging_items FOR DELETE
USING (public.has_project_access(auth.uid(), project_id));

-- Stage Gates table
CREATE TABLE public.stage_gates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL,
  project_id UUID NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  gate_name TEXT NOT NULL,
  status TEXT DEFAULT 'NOT_STARTED',
  score NUMERIC DEFAULT 0,
  blockers TEXT[] DEFAULT '{}',
  required_artifacts TEXT[] DEFAULT '{}',
  sort_order INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.stage_gates ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view stage gates"
ON public.stage_gates FOR SELECT
USING (public.has_project_access(auth.uid(), project_id));

CREATE POLICY "Users can insert stage gates"
ON public.stage_gates FOR INSERT
WITH CHECK (auth.uid() = user_id AND public.has_project_access(auth.uid(), project_id));

CREATE POLICY "Users can update stage gates"
ON public.stage_gates FOR UPDATE
USING (public.has_project_access(auth.uid(), project_id));

CREATE POLICY "Users can delete stage gates"
ON public.stage_gates FOR DELETE
USING (public.has_project_access(auth.uid(), project_id));

-- Triggers for updated_at
CREATE TRIGGER update_budget_assumptions_updated_at
BEFORE UPDATE ON public.budget_assumptions
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER update_packaging_items_updated_at
BEFORE UPDATE ON public.packaging_items
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER update_stage_gates_updated_at
BEFORE UPDATE ON public.stage_gates
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
