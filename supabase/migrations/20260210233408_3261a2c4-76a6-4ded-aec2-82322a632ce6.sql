
-- Score history snapshots for trend sparklines
CREATE TABLE public.readiness_score_history (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  project_id UUID NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  user_id UUID NOT NULL,
  readiness_score INTEGER NOT NULL DEFAULT 0,
  finance_readiness_score INTEGER NOT NULL DEFAULT 0,
  snapshot_date DATE NOT NULL DEFAULT CURRENT_DATE,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- One snapshot per project per day
CREATE UNIQUE INDEX idx_score_history_project_date ON public.readiness_score_history(project_id, snapshot_date);
CREATE INDEX idx_score_history_project ON public.readiness_score_history(project_id);

ALTER TABLE public.readiness_score_history ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Project members can view score history"
  ON public.readiness_score_history FOR SELECT
  USING (has_project_access(auth.uid(), project_id));

CREATE POLICY "Project members can insert score history"
  ON public.readiness_score_history FOR INSERT
  WITH CHECK (auth.uid() = user_id AND has_project_access(auth.uid(), project_id));

-- Trigger function: create notification when readiness crosses 50 or 75
CREATE OR REPLACE FUNCTION public.notify_readiness_milestone()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  _prev_score INTEGER;
  _project_title TEXT;
  _threshold INTEGER;
BEGIN
  -- Get previous score
  SELECT readiness_score INTO _prev_score
  FROM public.readiness_score_history
  WHERE project_id = NEW.project_id AND snapshot_date < NEW.snapshot_date
  ORDER BY snapshot_date DESC LIMIT 1;

  IF _prev_score IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT title INTO _project_title FROM public.projects WHERE id = NEW.project_id;

  -- Check thresholds crossed upward
  FOREACH _threshold IN ARRAY ARRAY[50, 75] LOOP
    IF _prev_score < _threshold AND NEW.readiness_score >= _threshold THEN
      INSERT INTO public.notifications (user_id, type, title, body, project_id, link)
      VALUES (
        NEW.user_id,
        'milestone',
        _project_title || ' hit ' || _threshold || '% readiness',
        'Your project crossed the ' || _threshold || ' readiness threshold — review next steps.',
        NEW.project_id,
        '/projects/' || NEW.project_id
      );
    END IF;
  END LOOP;

  -- Same for finance readiness
  FOREACH _threshold IN ARRAY ARRAY[50, 75] LOOP
    IF _prev_score < _threshold AND NEW.finance_readiness_score >= _threshold THEN
      INSERT INTO public.notifications (user_id, type, title, body, project_id, link)
      VALUES (
        NEW.user_id,
        'milestone',
        _project_title || ' hit ' || _threshold || '% finance readiness',
        'Finance readiness crossed ' || _threshold || ' — the project may be ready for the next stage.',
        NEW.project_id,
        '/projects/' || NEW.project_id
      );
    END IF;
  END LOOP;

  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_readiness_milestone
  AFTER INSERT ON public.readiness_score_history
  FOR EACH ROW
  EXECUTE FUNCTION public.notify_readiness_milestone();
