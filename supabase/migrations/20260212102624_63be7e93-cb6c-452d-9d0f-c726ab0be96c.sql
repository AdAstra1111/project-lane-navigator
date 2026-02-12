
-- Model accuracy scores: tracks prediction vs outcome per project, engine, and production type
CREATE TABLE public.model_accuracy_scores (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  production_type TEXT NOT NULL DEFAULT '',
  engine_id UUID REFERENCES public.trend_engines(id) ON DELETE CASCADE,
  total_predictions INTEGER NOT NULL DEFAULT 0,
  correct_predictions INTEGER NOT NULL DEFAULT 0,
  accuracy_pct NUMERIC(5,2) NOT NULL DEFAULT 0,
  avg_predicted_score NUMERIC(5,2) NOT NULL DEFAULT 0,
  avg_actual_outcome NUMERIC(5,2) NOT NULL DEFAULT 0,
  last_calculated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(production_type, engine_id)
);

ALTER TABLE public.model_accuracy_scores ENABLE ROW LEVEL SECURITY;

-- Readable by authenticated users (governance data)
CREATE POLICY "Authenticated users can read accuracy scores"
  ON public.model_accuracy_scores FOR SELECT
  USING (auth.uid() IS NOT NULL);

CREATE TRIGGER update_model_accuracy_scores_updated_at
  BEFORE UPDATE ON public.model_accuracy_scores
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
