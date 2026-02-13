
-- A) Create outcome_deltas table (adapted to actual project_outcomes schema)
CREATE TABLE IF NOT EXISTS public.outcome_deltas (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE UNIQUE,
  user_id uuid NOT NULL,
  -- snapshot of predictions
  initial_structural_score numeric,
  initial_commercial_score numeric,
  initial_finance_confidence text,
  initial_greenlight_verdict text,
  -- outcomes (from project_outcomes)
  budget_achieved boolean,
  talent_attached boolean,
  presales_secured boolean,
  financed boolean,
  festival_selection boolean,
  streamer_interest boolean,
  distribution_offer boolean,
  recoup_achieved boolean,
  development_time_months int,
  -- computed deltas/flags
  finance_prediction_correct boolean,
  greenlight_prediction_correct boolean,
  predicted_to_actual_gap_score numeric,
  notes jsonb DEFAULT '{}'::jsonb,
  computed_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS outcome_deltas_project_id_idx ON public.outcome_deltas(project_id);

-- RLS
ALTER TABLE public.outcome_deltas ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users with project access can view deltas"
  ON public.outcome_deltas FOR SELECT
  USING (has_project_access(auth.uid(), project_id));

CREATE POLICY "Users with project access can insert deltas"
  ON public.outcome_deltas FOR INSERT
  WITH CHECK (has_project_access(auth.uid(), project_id));

CREATE POLICY "Users with project access can update deltas"
  ON public.outcome_deltas FOR UPDATE
  USING (has_project_access(auth.uid(), project_id));

CREATE POLICY "Users with project access can delete deltas"
  ON public.outcome_deltas FOR DELETE
  USING (has_project_access(auth.uid(), project_id));

-- B) Compute function (adapted to actual columns)
CREATE OR REPLACE FUNCTION public.compute_outcome_deltas(p_project_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  o record;
  predicted_financeable boolean;
  actual_financeable boolean;
  predicted_green boolean;
  actual_success boolean;
  gap numeric;
BEGIN
  SELECT * INTO o FROM public.project_outcomes WHERE project_id = p_project_id;
  IF o IS NULL THEN RETURN; END IF;

  -- Predicted financeable if initial_finance_confidence contains 'high' or numeric >= 7
  predicted_financeable := (
    COALESCE(o.initial_finance_confidence, '') ILIKE '%high%'
    OR COALESCE(o.initial_finance_confidence, '') ILIKE '%strong%'
  );

  -- Actual financeable if any financing milestone achieved
  actual_financeable := COALESCE(o.budget_achieved, false)
    OR COALESCE(o.presales_secured, false)
    OR COALESCE(o.talent_attached, false)
    OR COALESCE(o.financed, false);

  -- Greenlight verdict considered "green" if text contains GREEN
  predicted_green := (COALESCE(o.initial_greenlight_verdict, '') ILIKE '%green%');

  -- Actual success proxy
  actual_success := COALESCE(o.financed, false)
    OR COALESCE(o.festival_selection, false)
    OR COALESCE(o.distribution_offer, false)
    OR COALESCE(o.streamer_interest, false);

  -- Gap score: weighted miss penalty (0=perfect, 100=total miss)
  gap := 0;
  IF predicted_financeable != actual_financeable THEN gap := gap + 40; END IF;
  IF predicted_green != actual_success THEN gap := gap + 40; END IF;
  -- Structural/commercial deviation (scale 0-10 each)
  gap := gap + LEAST(20, ABS(COALESCE(o.initial_structural_score, 50) - (CASE WHEN actual_success THEN 75 ELSE 35 END)) * 0.4);

  INSERT INTO public.outcome_deltas (
    project_id, user_id,
    initial_structural_score, initial_commercial_score,
    initial_finance_confidence, initial_greenlight_verdict,
    budget_achieved, talent_attached, presales_secured,
    financed, festival_selection, streamer_interest,
    distribution_offer, recoup_achieved, development_time_months,
    finance_prediction_correct, greenlight_prediction_correct,
    predicted_to_actual_gap_score, notes, computed_at
  ) VALUES (
    p_project_id, o.user_id,
    o.initial_structural_score, o.initial_commercial_score,
    o.initial_finance_confidence, o.initial_greenlight_verdict,
    o.budget_achieved, o.talent_attached, o.presales_secured,
    o.financed, o.festival_selection, o.streamer_interest,
    o.distribution_offer, o.recoup_achieved, o.development_time_months,
    (predicted_financeable = actual_financeable),
    (predicted_green = actual_success),
    gap,
    jsonb_build_object(
      'predicted_financeable', predicted_financeable,
      'actual_financeable', actual_financeable,
      'predicted_green', predicted_green,
      'actual_success', actual_success
    ),
    now()
  )
  ON CONFLICT (project_id) DO UPDATE SET
    initial_structural_score = EXCLUDED.initial_structural_score,
    initial_commercial_score = EXCLUDED.initial_commercial_score,
    initial_finance_confidence = EXCLUDED.initial_finance_confidence,
    initial_greenlight_verdict = EXCLUDED.initial_greenlight_verdict,
    budget_achieved = EXCLUDED.budget_achieved,
    talent_attached = EXCLUDED.talent_attached,
    presales_secured = EXCLUDED.presales_secured,
    financed = EXCLUDED.financed,
    festival_selection = EXCLUDED.festival_selection,
    streamer_interest = EXCLUDED.streamer_interest,
    distribution_offer = EXCLUDED.distribution_offer,
    recoup_achieved = EXCLUDED.recoup_achieved,
    development_time_months = EXCLUDED.development_time_months,
    finance_prediction_correct = EXCLUDED.finance_prediction_correct,
    greenlight_prediction_correct = EXCLUDED.greenlight_prediction_correct,
    predicted_to_actual_gap_score = EXCLUDED.predicted_to_actual_gap_score,
    notes = EXCLUDED.notes,
    computed_at = now();
END;
$$;

-- C) Trigger: recompute when outcomes change
CREATE OR REPLACE FUNCTION public.trg_project_outcomes_recompute()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  PERFORM public.compute_outcome_deltas(NEW.project_id);
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS project_outcomes_recompute ON public.project_outcomes;
CREATE TRIGGER project_outcomes_recompute
  AFTER INSERT OR UPDATE ON public.project_outcomes
  FOR EACH ROW
  EXECUTE FUNCTION public.trg_project_outcomes_recompute();

-- D) Accuracy rollup view
CREATE OR REPLACE VIEW public.outcome_accuracy_summary AS
SELECT
  count(*) AS total,
  avg(CASE WHEN finance_prediction_correct THEN 1 ELSE 0 END) AS finance_accuracy,
  avg(CASE WHEN greenlight_prediction_correct THEN 1 ELSE 0 END) AS greenlight_accuracy,
  avg(predicted_to_actual_gap_score) AS avg_gap_score
FROM public.outcome_deltas;
