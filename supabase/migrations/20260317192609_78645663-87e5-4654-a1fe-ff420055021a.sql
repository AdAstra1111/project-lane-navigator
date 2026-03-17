
-- PART 1: Enrich narrative_engines with structural columns
ALTER TABLE public.narrative_engines
  ADD COLUMN IF NOT EXISTS label text,
  ADD COLUMN IF NOT EXISTS structural_traits jsonb DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS antagonist_topology text,
  ADD COLUMN IF NOT EXISTS escalation_pattern text,
  ADD COLUMN IF NOT EXISTS protagonist_pressure_mode text,
  ADD COLUMN IF NOT EXISTS spatial_logic text,
  ADD COLUMN IF NOT EXISTS failure_modes text[] DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS example_titles text[] DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS structural_pattern text,
  ADD COLUMN IF NOT EXISTS active boolean DEFAULT true,
  ADD COLUMN IF NOT EXISTS taxonomy_version integer DEFAULT 1;

-- Backfill label from engine_name
UPDATE public.narrative_engines SET label = engine_name WHERE label IS NULL;

-- PART 2: Create narrative_engine_blueprint_families
CREATE TABLE IF NOT EXISTS public.narrative_engine_blueprint_families (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  engine_key text NOT NULL REFERENCES public.narrative_engines(engine_key) ON DELETE CASCADE,
  family_key text NOT NULL UNIQUE,
  label text NOT NULL,
  description text NOT NULL DEFAULT '',
  execution_pattern jsonb DEFAULT '{}'::jsonb,
  lane_suitability text[] DEFAULT '{}',
  budget_suitability text[] DEFAULT '{}',
  structural_strengths text[] DEFAULT '{}',
  structural_risks text[] DEFAULT '{}',
  when_to_use text DEFAULT '',
  when_not_to_use text DEFAULT '',
  active boolean DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.narrative_engine_blueprint_families ENABLE ROW LEVEL SECURITY;

-- Public read for authenticated users
CREATE POLICY "Authenticated users can read blueprint families"
  ON public.narrative_engine_blueprint_families FOR SELECT TO authenticated USING (true);

-- Trigger for updated_at
CREATE TRIGGER set_blueprint_families_updated_at
  BEFORE UPDATE ON public.narrative_engine_blueprint_families
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- Index
CREATE INDEX IF NOT EXISTS idx_blueprint_families_engine_key
  ON public.narrative_engine_blueprint_families(engine_key);
