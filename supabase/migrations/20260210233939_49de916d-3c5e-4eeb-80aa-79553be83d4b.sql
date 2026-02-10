
CREATE OR REPLACE FUNCTION public.notify_readiness_milestone()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  _prev_readiness INTEGER;
  _prev_finance INTEGER;
  _project_title TEXT;
  _threshold INTEGER;
BEGIN
  -- Get previous scores
  SELECT readiness_score, finance_readiness_score 
  INTO _prev_readiness, _prev_finance
  FROM public.readiness_score_history
  WHERE project_id = NEW.project_id AND snapshot_date < NEW.snapshot_date
  ORDER BY snapshot_date DESC LIMIT 1;

  IF _prev_readiness IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT title INTO _project_title FROM public.projects WHERE id = NEW.project_id;

  -- Check readiness thresholds
  FOREACH _threshold IN ARRAY ARRAY[50, 75] LOOP
    IF _prev_readiness < _threshold AND NEW.readiness_score >= _threshold THEN
      INSERT INTO public.notifications (user_id, type, title, body, project_id, link)
      VALUES (
        NEW.user_id, 'milestone',
        _project_title || ' hit ' || _threshold || '% readiness',
        'Your project crossed the ' || _threshold || ' readiness threshold — review next steps.',
        NEW.project_id, '/projects/' || NEW.project_id
      );
    END IF;
  END LOOP;

  -- Check finance readiness thresholds
  FOREACH _threshold IN ARRAY ARRAY[50, 75] LOOP
    IF _prev_finance < _threshold AND NEW.finance_readiness_score >= _threshold THEN
      INSERT INTO public.notifications (user_id, type, title, body, project_id, link)
      VALUES (
        NEW.user_id, 'milestone',
        _project_title || ' hit ' || _threshold || '% finance readiness',
        'Finance readiness crossed ' || _threshold || ' — the project may be ready for the next stage.',
        NEW.project_id, '/projects/' || NEW.project_id
      );
    END IF;
  END LOOP;

  RETURN NEW;
END;
$$;
