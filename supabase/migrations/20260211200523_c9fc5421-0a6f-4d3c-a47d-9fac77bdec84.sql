
-- ============================================================
-- Trend Engine Intelligence Layer
-- ============================================================

-- 1. Trend Engines (the 14 intelligence engines)
CREATE TABLE public.trend_engines (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  engine_name TEXT NOT NULL UNIQUE,
  engine_type TEXT NOT NULL DEFAULT 'financial',
  description TEXT NOT NULL DEFAULT '',
  base_weight_default REAL NOT NULL DEFAULT 0.07,
  refresh_frequency TEXT NOT NULL DEFAULT 'monthly',
  last_refresh TIMESTAMP WITH TIME ZONE,
  confidence TEXT NOT NULL DEFAULT 'medium',
  status TEXT NOT NULL DEFAULT 'active',
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

ALTER TABLE public.trend_engines ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone authenticated can view engines"
  ON public.trend_engines FOR SELECT
  USING (auth.uid() IS NOT NULL);

CREATE POLICY "Service role can manage engines"
  ON public.trend_engines FOR ALL
  USING (auth.uid() IS NOT NULL)
  WITH CHECK (auth.uid() IS NOT NULL);

-- 2. Production-type to engine weight mapping
CREATE TABLE public.production_engine_weights (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  production_type TEXT NOT NULL,
  engine_id UUID NOT NULL REFERENCES public.trend_engines(id) ON DELETE CASCADE,
  weight_value REAL NOT NULL DEFAULT 0.07,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  UNIQUE(production_type, engine_id)
);

ALTER TABLE public.production_engine_weights ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone authenticated can view weights"
  ON public.production_engine_weights FOR SELECT
  USING (auth.uid() IS NOT NULL);

CREATE POLICY "Service role can manage weights"
  ON public.production_engine_weights FOR ALL
  USING (auth.uid() IS NOT NULL)
  WITH CHECK (auth.uid() IS NOT NULL);

-- 3. Per-project engine scores (hybrid: AI + manual override)
CREATE TABLE public.project_engine_scores (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  project_id UUID NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  engine_id UUID NOT NULL REFERENCES public.trend_engines(id) ON DELETE CASCADE,
  user_id UUID NOT NULL,
  score REAL NOT NULL DEFAULT 5.0,
  confidence TEXT NOT NULL DEFAULT 'medium',
  source TEXT NOT NULL DEFAULT 'ai',
  notes TEXT NOT NULL DEFAULT '',
  last_scored_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  UNIQUE(project_id, engine_id)
);

ALTER TABLE public.project_engine_scores ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Project members can view engine scores"
  ON public.project_engine_scores FOR SELECT
  USING (has_project_access(auth.uid(), project_id));

CREATE POLICY "Project members can create engine scores"
  ON public.project_engine_scores FOR INSERT
  WITH CHECK ((auth.uid() = user_id) AND has_project_access(auth.uid(), project_id));

CREATE POLICY "Project members can update engine scores"
  ON public.project_engine_scores FOR UPDATE
  USING (has_project_access(auth.uid(), project_id));

CREATE POLICY "Project members can delete engine scores"
  ON public.project_engine_scores FOR DELETE
  USING (has_project_access(auth.uid(), project_id));

-- 4. Prediction outcomes (Phase 3)
CREATE TABLE public.prediction_outcomes (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  project_id UUID NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  user_id UUID NOT NULL,
  predicted_viability REAL NOT NULL DEFAULT 0,
  predicted_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  actual_financing_outcome TEXT NOT NULL DEFAULT 'pending',
  distribution_type TEXT NOT NULL DEFAULT '',
  revenue_if_known TEXT NOT NULL DEFAULT '',
  outcome_recorded_at TIMESTAMP WITH TIME ZONE,
  notes TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

ALTER TABLE public.prediction_outcomes ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Project members can view outcomes"
  ON public.prediction_outcomes FOR SELECT
  USING (has_project_access(auth.uid(), project_id));

CREATE POLICY "Project members can create outcomes"
  ON public.prediction_outcomes FOR INSERT
  WITH CHECK ((auth.uid() = user_id) AND has_project_access(auth.uid(), project_id));

CREATE POLICY "Project members can update outcomes"
  ON public.prediction_outcomes FOR UPDATE
  USING (has_project_access(auth.uid(), project_id));

CREATE POLICY "Project members can delete outcomes"
  ON public.prediction_outcomes FOR DELETE
  USING (has_project_access(auth.uid(), project_id));

-- Triggers for updated_at
CREATE TRIGGER update_trend_engines_updated_at
  BEFORE UPDATE ON public.trend_engines
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER update_production_engine_weights_updated_at
  BEFORE UPDATE ON public.production_engine_weights
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER update_project_engine_scores_updated_at
  BEFORE UPDATE ON public.project_engine_scores
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER update_prediction_outcomes_updated_at
  BEFORE UPDATE ON public.prediction_outcomes
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
