
-- Commercial Proof: proven commercial hits for viability benchmarking
CREATE TABLE public.commercial_proof (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  title TEXT NOT NULL,
  year INTEGER NOT NULL,
  format TEXT NOT NULL DEFAULT 'film',                -- film | tv-pilot
  genre TEXT NOT NULL,
  budget_tier TEXT NOT NULL DEFAULT 'mid',             -- low | mid | studio
  production_budget_est TEXT,                          -- e.g. "20M", "150M"
  worldwide_gross_est TEXT,                            -- e.g. "320M", "1.5B"
  roi_tier TEXT NOT NULL DEFAULT 'moderate',           -- low | moderate | high | exceptional
  franchise_potential TEXT NOT NULL DEFAULT 'none',    -- none | sequel | universe
  audience_target TEXT NOT NULL DEFAULT '18-34',       -- ya | 18-34 | family | four-quadrant | niche
  streamer_appeal TEXT NOT NULL DEFAULT 'moderate',    -- low | moderate | high
  hook_clarity TEXT NOT NULL DEFAULT 'moderate',       -- low | moderate | high
  concept_simplicity TEXT NOT NULL DEFAULT 'moderate', -- low | moderate | high
  trailer_moment_density TEXT NOT NULL DEFAULT 'moderate', -- low | moderate | high
  international_travelability TEXT NOT NULL DEFAULT 'moderate', -- low | moderate | high

  dataset_type TEXT NOT NULL DEFAULT 'COMMERCIAL_PROOF',
  weight TEXT NOT NULL DEFAULT 'high',
  active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.commercial_proof ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can read commercial proof"
  ON public.commercial_proof FOR SELECT
  USING (auth.uid() IS NOT NULL);

CREATE POLICY "Admins can manage commercial proof"
  ON public.commercial_proof FOR ALL
  USING (public.has_role(auth.uid(), 'admin'));

CREATE TRIGGER update_commercial_proof_updated_at
  BEFORE UPDATE ON public.commercial_proof
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

CREATE INDEX idx_commercial_proof_genre ON public.commercial_proof(genre);
CREATE INDEX idx_commercial_proof_format ON public.commercial_proof(format);
CREATE INDEX idx_commercial_proof_roi ON public.commercial_proof(roi_tier);
