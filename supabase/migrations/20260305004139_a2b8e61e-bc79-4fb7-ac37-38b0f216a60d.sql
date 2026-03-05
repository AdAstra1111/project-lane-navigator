
-- 1) Create feature_flags table (minimal, no schema drift risk)
CREATE TABLE IF NOT EXISTS public.feature_flags (
  key text PRIMARY KEY,
  is_enabled boolean NOT NULL DEFAULT false,
  description text DEFAULT '',
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- RLS: anyone authenticated can read flags, only service role can write
ALTER TABLE public.feature_flags ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can read feature flags"
  ON public.feature_flags FOR SELECT
  TO authenticated
  USING (true);

-- No INSERT/UPDATE/DELETE policies for authenticated = service role only writes

-- 2) Seed CANON_UNITS_EXPERIMENTAL = false
INSERT INTO public.feature_flags (key, is_enabled, description)
VALUES ('CANON_UNITS_EXPERIMENTAL', false, 'Gates writes to canon_units/canon_unit_mentions/canon_unit_relations. NON-CANON experimental index.')
ON CONFLICT (key) DO NOTHING;

-- 3) Create helper function (SECURITY DEFINER, fail-closed)
CREATE OR REPLACE FUNCTION public.is_feature_flag_enabled(_key text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = 'public'
AS $$
  SELECT COALESCE(
    (SELECT is_enabled FROM public.feature_flags WHERE key = _key),
    false
  );
$$;

-- 4) Drop existing INSERT/UPDATE policies on canon tables and recreate with flag gate

-- canon_units: DROP + RECREATE INSERT
DROP POLICY IF EXISTS "Users can insert canon units for their projects" ON public.canon_units;
CREATE POLICY "Users can insert canon units for their projects"
  ON public.canon_units FOR INSERT
  TO authenticated
  WITH CHECK (
    has_project_access(auth.uid(), project_id)
    AND is_feature_flag_enabled('CANON_UNITS_EXPERIMENTAL')
  );

-- canon_units: DROP + RECREATE UPDATE
DROP POLICY IF EXISTS "Users can update canon units for their projects" ON public.canon_units;
CREATE POLICY "Users can update canon units for their projects"
  ON public.canon_units FOR UPDATE
  TO authenticated
  USING (
    has_project_access(auth.uid(), project_id)
    AND is_feature_flag_enabled('CANON_UNITS_EXPERIMENTAL')
  );

-- canon_unit_mentions: DROP + RECREATE INSERT
DROP POLICY IF EXISTS "Users can insert canon unit mentions" ON public.canon_unit_mentions;
CREATE POLICY "Users can insert canon unit mentions"
  ON public.canon_unit_mentions FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM canon_units cu
      WHERE cu.id = canon_unit_mentions.unit_id
        AND has_project_access(auth.uid(), cu.project_id)
    )
    AND is_feature_flag_enabled('CANON_UNITS_EXPERIMENTAL')
  );

-- canon_unit_relations: DROP + RECREATE INSERT
DROP POLICY IF EXISTS "Users can insert canon unit relations for their projects" ON public.canon_unit_relations;
CREATE POLICY "Users can insert canon unit relations for their projects"
  ON public.canon_unit_relations FOR INSERT
  TO authenticated
  WITH CHECK (
    has_project_access(auth.uid(), project_id)
    AND is_feature_flag_enabled('CANON_UNITS_EXPERIMENTAL')
  );
