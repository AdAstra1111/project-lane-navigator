
-- Fix: recreate view without SECURITY DEFINER (use SECURITY INVOKER which is default)
DROP VIEW IF EXISTS public.outcome_accuracy_summary;
CREATE VIEW public.outcome_accuracy_summary
WITH (security_invoker = true)
AS
SELECT
  count(*) AS total,
  avg(CASE WHEN finance_prediction_correct THEN 1 ELSE 0 END) AS finance_accuracy,
  avg(CASE WHEN greenlight_prediction_correct THEN 1 ELSE 0 END) AS greenlight_accuracy,
  avg(CASE WHEN lane_prediction_correct THEN 1 ELSE 0 END) AS lane_accuracy,
  avg(CASE WHEN budget_range_prediction_correct THEN 1 ELSE 0 END) AS budget_accuracy,
  avg(predicted_to_actual_gap_score) AS avg_gap_score,
  avg(commercial_score_delta) AS avg_commercial_delta
FROM public.outcome_deltas;
