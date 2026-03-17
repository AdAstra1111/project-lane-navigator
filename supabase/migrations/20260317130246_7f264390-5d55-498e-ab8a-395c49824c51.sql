
-- IEL Safety Net: Database trigger to enforce learning_pool_eligible on every insert/update
-- This is the fail-closed guard ensuring no write path can bypass eligibility logic.
CREATE OR REPLACE FUNCTION public.enforce_learning_pool_eligibility()
  RETURNS trigger
  LANGUAGE plpgsql
  SET search_path TO 'public'
AS $$
BEGIN
  IF NEW.score_total >= 95 THEN
    NEW.learning_pool_eligible := true;
    IF NEW.learning_pool_eligibility_reason IS NULL OR NEW.learning_pool_eligibility_reason = 'ci_below_threshold' THEN
      NEW.learning_pool_eligibility_reason := 'ci_95_threshold_met';
    END IF;
    IF NEW.learning_pool_qualified_at IS NULL THEN
      NEW.learning_pool_qualified_at := now();
    END IF;
  ELSE
    NEW.learning_pool_eligible := false;
    NEW.learning_pool_eligibility_reason := 'ci_below_threshold';
    NEW.learning_pool_qualified_at := NULL;
  END IF;
  RETURN NEW;
END;
$$;

-- Apply to both INSERT and UPDATE
DROP TRIGGER IF EXISTS trg_enforce_learning_pool ON public.pitch_ideas;
CREATE TRIGGER trg_enforce_learning_pool
  BEFORE INSERT OR UPDATE OF score_total ON public.pitch_ideas
  FOR EACH ROW
  EXECUTE FUNCTION public.enforce_learning_pool_eligibility();
