
-- Failure Contrast: scripts exhibiting structural/commercial weakness for risk detection training
CREATE TABLE public.failure_contrast (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  title TEXT NOT NULL,
  year INTEGER,
  produced BOOLEAN NOT NULL DEFAULT false,
  budget_est TEXT,                                         -- e.g. "5M", "80M", null for unproduced
  box_office_est TEXT,                                     -- e.g. "2M", null
  genre TEXT NOT NULL,
  format TEXT NOT NULL DEFAULT 'film',                     -- film | tv-pilot
  development_outcome TEXT NOT NULL DEFAULT 'unproduced',  -- unproduced | flopped | critical-failure | development-hell
  primary_weakness TEXT NOT NULL DEFAULT 'structure',      -- structure | character | dialogue | stakes | tone | budget-misalignment | concept-confusion
  inciting_incident_page INTEGER,                          -- page number of inciting incident
  midpoint_strength TEXT NOT NULL DEFAULT 'weak',          -- weak | moderate | strong
  third_act_strength TEXT NOT NULL DEFAULT 'weak',         -- weak | moderate | strong
  protagonist_agency TEXT NOT NULL DEFAULT 'low',          -- low | moderate | high
  conflict_density TEXT NOT NULL DEFAULT 'low',            -- low | moderate | high
  dialogue_subtext_level TEXT NOT NULL DEFAULT 'low',      -- low | moderate | high

  -- Failure pattern flags (for pattern matching)
  late_inciting_incident BOOLEAN NOT NULL DEFAULT false,   -- inciting incident after p20 (film) / p10 (pilot)
  passive_protagonist BOOLEAN NOT NULL DEFAULT false,      -- reactive > 60% of scenes
  on_the_nose_dialogue BOOLEAN NOT NULL DEFAULT false,     -- dialogue explains theme directly
  no_midpoint_shift BOOLEAN NOT NULL DEFAULT false,        -- no meaningful midpoint power shift
  flat_escalation BOOLEAN NOT NULL DEFAULT false,          -- stakes not escalating by Act 2B
  costless_climax BOOLEAN NOT NULL DEFAULT false,          -- climax resolves without protagonist sacrifice

  notes TEXT,                                              -- brief description of why this is a failure pattern
  dataset_type TEXT NOT NULL DEFAULT 'FAILURE_CONTRAST',
  weight TEXT NOT NULL DEFAULT 'high',
  active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.failure_contrast ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can read failure contrast"
  ON public.failure_contrast FOR SELECT
  USING (auth.uid() IS NOT NULL);

CREATE POLICY "Admins can manage failure contrast"
  ON public.failure_contrast FOR ALL
  USING (public.has_role(auth.uid(), 'admin'));

CREATE TRIGGER update_failure_contrast_updated_at
  BEFORE UPDATE ON public.failure_contrast
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

CREATE INDEX idx_failure_contrast_genre ON public.failure_contrast(genre);
CREATE INDEX idx_failure_contrast_weakness ON public.failure_contrast(primary_weakness);
CREATE INDEX idx_failure_contrast_outcome ON public.failure_contrast(development_outcome);
