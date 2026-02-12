
-- Masterwork Canon: curated high-standard reference scripts for structural benchmarking
CREATE TABLE public.masterwork_canon (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  title TEXT NOT NULL,
  year INTEGER NOT NULL,
  format TEXT NOT NULL DEFAULT 'film',              -- film | tv-pilot
  genre TEXT NOT NULL,
  budget_tier TEXT NOT NULL DEFAULT 'mid',           -- low | mid | studio
  monetisation_lane TEXT NOT NULL DEFAULT 'prestige-awards',
  awards_recognition TEXT NOT NULL DEFAULT 'none',   -- none | nominated | won
  box_office_tier TEXT NOT NULL DEFAULT 'mid',       -- low | mid | high
  structural_model TEXT NOT NULL DEFAULT 'three-act', -- three-act | nonlinear | dual-timeline | contained | ensemble
  dialogue_density TEXT NOT NULL DEFAULT 'medium',   -- low | medium | high
  thematic_depth TEXT NOT NULL DEFAULT 'medium',     -- low | medium | high
  escalation_pattern TEXT NOT NULL DEFAULT 'linear', -- linear | compounding | reversal-driven | psychological
  third_act_type TEXT NOT NULL DEFAULT 'cathartic',  -- cathartic | tragic | ambiguous | twist-based

  -- Structural benchmark metrics (percentages 0-100 where applicable)
  act1_break_pct NUMERIC,          -- % of script where Act 1 ends
  midpoint_pct NUMERIC,            -- % where midpoint power shift occurs
  act2_break_pct NUMERIC,          -- % where Act 2 ends / Act 3 begins
  inciting_incident_pct NUMERIC,   -- % where inciting incident lands
  escalation_velocity TEXT,        -- qualitative: slow-burn | steady | rapid | explosive
  scene_purpose_density TEXT,      -- low | medium | high | very-high
  character_objective_clarity TEXT, -- weak | moderate | strong | razor-sharp
  dialogue_compression TEXT,       -- loose | moderate | tight | surgical
  emotional_layering TEXT,         -- surface | moderate | deep | profound

  dataset_type TEXT NOT NULL DEFAULT 'MASTERWORK_CANON',
  weight TEXT NOT NULL DEFAULT 'high',  -- structural authority weight
  active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.masterwork_canon ENABLE ROW LEVEL SECURITY;

-- Masterwork canon is readable by all authenticated users (shared reference data)
CREATE POLICY "Authenticated users can read masterwork canon"
  ON public.masterwork_canon FOR SELECT
  USING (auth.uid() IS NOT NULL);

-- Only admins can modify (via has_role check)
CREATE POLICY "Admins can manage masterwork canon"
  ON public.masterwork_canon FOR ALL
  USING (public.has_role(auth.uid(), 'admin'));

-- Trigger for updated_at
CREATE TRIGGER update_masterwork_canon_updated_at
  BEFORE UPDATE ON public.masterwork_canon
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

-- Index for common queries
CREATE INDEX idx_masterwork_canon_genre ON public.masterwork_canon(genre);
CREATE INDEX idx_masterwork_canon_format ON public.masterwork_canon(format);
CREATE INDEX idx_masterwork_canon_lane ON public.masterwork_canon(monetisation_lane);
