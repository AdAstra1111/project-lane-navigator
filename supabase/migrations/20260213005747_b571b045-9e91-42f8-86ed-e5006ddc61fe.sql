
-- Enrich outcome_deltas with lane and commercial prediction tracking
ALTER TABLE public.outcome_deltas
  ADD COLUMN IF NOT EXISTS predicted_lane text,
  ADD COLUMN IF NOT EXISTS actual_lane text,
  ADD COLUMN IF NOT EXISTS lane_prediction_correct boolean,
  ADD COLUMN IF NOT EXISTS predicted_budget_range text,
  ADD COLUMN IF NOT EXISTS actual_budget_range text,
  ADD COLUMN IF NOT EXISTS budget_range_prediction_correct boolean,
  ADD COLUMN IF NOT EXISTS commercial_score_delta numeric;

-- Drop and recreate the compute function with enriched rubric
CREATE OR REPLACE FUNCTION public.compute_outcome_deltas(p_project_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  o record;
  p record;
  predicted_financeable boolean;
  actual_financeable boolean;
  predicted_green boolean;
  actual_success boolean;
  gap numeric;
  p_lane text;
  p_budget text;
  commercial_delta numeric;
BEGIN
  SELECT * INTO o FROM public.project_outcomes WHERE project_id = p_project_id;
  IF o IS NULL THEN RETURN; END IF;

  -- Get project metadata for lane/budget comparisons
  SELECT assigned_lane, budget_range INTO p FROM public.projects WHERE id = p_project_id;

  -- Finance prediction
  predicted_financeable := (
    COALESCE(o.initial_finance_confidence, '') ILIKE '%high%'
    OR COALESCE(o.initial_finance_confidence, '') ILIKE '%strong%'
  );
  actual_financeable := COALESCE(o.budget_achieved, false)
    OR COALESCE(o.presales_secured, false)
    OR COALESCE(o.talent_attached, false)
    OR COALESCE(o.financed, false);

  -- Greenlight prediction
  predicted_green := (COALESCE(o.initial_greenlight_verdict, '') ILIKE '%green%');
  actual_success := COALESCE(o.financed, false)
    OR COALESCE(o.festival_selection, false)
    OR COALESCE(o.distribution_offer, false)
    OR COALESCE(o.streamer_interest, false);

  -- Commercial score delta (predicted vs success proxy 0-100)
  commercial_delta := ABS(
    COALESCE(o.initial_commercial_score, 50)
    - (CASE WHEN actual_success THEN 80 ELSE 30 END)
  );

  -- Weighted gap score (0=perfect, 100=total miss)
  gap := 0;
  IF predicted_financeable != actual_financeable THEN gap := gap + 30; END IF;
  IF predicted_green != actual_success THEN gap := gap + 30; END IF;
  -- Structural deviation
  gap := gap + LEAST(15, ABS(COALESCE(o.initial_structural_score, 50) - (CASE WHEN actual_success THEN 75 ELSE 35 END)) * 0.3);
  -- Commercial deviation
  gap := gap + LEAST(15, commercial_delta * 0.3);
  -- Lane mismatch penalty
  IF p.assigned_lane IS NOT NULL AND p.assigned_lane != '' THEN
    -- If project reached distribution but was classified in wrong lane, add penalty
    IF actual_success AND p.assigned_lane NOT IN ('prestige', 'mainstream') THEN
      gap := gap + 10;
    END IF;
  END IF;

  INSERT INTO public.outcome_deltas (
    project_id, user_id,
    initial_structural_score, initial_commercial_score,
    initial_finance_confidence, initial_greenlight_verdict,
    budget_achieved, talent_attached, presales_secured,
    financed, festival_selection, streamer_interest,
    distribution_offer, recoup_achieved, development_time_months,
    finance_prediction_correct, greenlight_prediction_correct,
    predicted_to_actual_gap_score,
    predicted_lane, actual_lane, lane_prediction_correct,
    predicted_budget_range, actual_budget_range, budget_range_prediction_correct,
    commercial_score_delta,
    notes, computed_at
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
    p.assigned_lane, p.assigned_lane, true,  -- actual_lane starts as assigned; updated manually later
    p.budget_range, p.budget_range, true,    -- same pattern
    commercial_delta,
    jsonb_build_object(
      'predicted_financeable', predicted_financeable,
      'actual_financeable', actual_financeable,
      'predicted_green', predicted_green,
      'actual_success', actual_success,
      'commercial_delta', commercial_delta,
      'lane', p.assigned_lane,
      'budget_range', p.budget_range
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
    predicted_lane = EXCLUDED.predicted_lane,
    actual_lane = EXCLUDED.actual_lane,
    lane_prediction_correct = EXCLUDED.lane_prediction_correct,
    predicted_budget_range = EXCLUDED.predicted_budget_range,
    actual_budget_range = EXCLUDED.actual_budget_range,
    budget_range_prediction_correct = EXCLUDED.budget_range_prediction_correct,
    commercial_score_delta = EXCLUDED.commercial_score_delta,
    notes = EXCLUDED.notes,
    computed_at = now();
END;
$$;

-- Update the accuracy summary view to include new metrics
DROP VIEW IF EXISTS public.outcome_accuracy_summary;
CREATE VIEW public.outcome_accuracy_summary AS
SELECT
  count(*) AS total,
  avg(CASE WHEN finance_prediction_correct THEN 1 ELSE 0 END) AS finance_accuracy,
  avg(CASE WHEN greenlight_prediction_correct THEN 1 ELSE 0 END) AS greenlight_accuracy,
  avg(CASE WHEN lane_prediction_correct THEN 1 ELSE 0 END) AS lane_accuracy,
  avg(CASE WHEN budget_range_prediction_correct THEN 1 ELSE 0 END) AS budget_accuracy,
  avg(predicted_to_actual_gap_score) AS avg_gap_score,
  avg(commercial_score_delta) AS avg_commercial_delta
FROM public.outcome_deltas;
