
-- ================================================================
-- INTEL V2 FIXES: Migration for all 4 issues
-- ================================================================

-- =============================================
-- FIX 1: DB-side pgvector similarity (match_trend_signals RPC)
-- =============================================
CREATE OR REPLACE FUNCTION public.match_trend_signals(
  _project_embedding extensions.vector(1536),
  _min_strength int DEFAULT 1,
  _limit int DEFAULT 30
)
RETURNS TABLE (
  signal_id uuid,
  name text,
  strength int,
  velocity text,
  saturation_risk text,
  dimension text,
  modality text,
  cycle_phase text,
  similarity double precision,
  distance double precision
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'extensions'
AS $$
  SELECT
    ts.id AS signal_id,
    ts.name,
    ts.strength::int,
    ts.velocity,
    ts.saturation_risk,
    ts.dimension,
    ts.modality,
    ts.cycle_phase,
    (1 - (ts.embedding <=> _project_embedding))::double precision AS similarity,
    (ts.embedding <=> _project_embedding)::double precision AS distance
  FROM public.trend_signals ts
  WHERE ts.status = 'active'
    AND ts.embedding IS NOT NULL
    AND ts.strength >= _min_strength
  ORDER BY ts.embedding <=> _project_embedding ASC
  LIMIT _limit;
$$;

-- =============================================
-- FIX 2 & 3: Scoped convergence state + bounded persistence
-- =============================================
-- Add scope columns
ALTER TABLE public.intel_convergence_state
  ADD COLUMN IF NOT EXISTS scope_project_id uuid,
  ADD COLUMN IF NOT EXISTS scope_production_type text,
  ADD COLUMN IF NOT EXISTS scope_modality text,
  ADD COLUMN IF NOT EXISTS key_base text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS key_scoped text NOT NULL DEFAULT '';

-- Backfill existing rows: key_base = key, key_scoped = 'pt:*|mod:*|proj:*|' || key
UPDATE public.intel_convergence_state
SET key_base = key,
    key_scoped = 'pt:*|mod:*|proj:*|' || key
WHERE key_scoped = '' OR key_scoped IS NULL;

-- Drop old unique constraint if exists, add new one on (key_scoped, week_bucket)
CREATE UNIQUE INDEX IF NOT EXISTS idx_intel_convergence_state_key_scoped_week
  ON public.intel_convergence_state (key_scoped, week_bucket);

CREATE INDEX IF NOT EXISTS idx_intel_convergence_state_key_scoped
  ON public.intel_convergence_state (key_scoped);

-- =============================================
-- FIX 4: intel_policies write RLS
-- =============================================
-- Add ownership columns
ALTER TABLE public.intel_policies
  ADD COLUMN IF NOT EXISTS created_by uuid DEFAULT auth.uid(),
  ADD COLUMN IF NOT EXISTS updated_by uuid;

-- Backfill existing rows with null created_by (system rows)
-- (No update needed - they stay NULL which our policy allows)

-- INSERT policy
CREATE POLICY "Authenticated insert intel_policies"
  ON public.intel_policies FOR INSERT
  TO authenticated
  WITH CHECK (true);

-- UPDATE policy
CREATE POLICY "Authenticated update intel_policies"
  ON public.intel_policies FOR UPDATE
  TO authenticated
  USING (created_by = auth.uid() OR created_by IS NULL)
  WITH CHECK (true);

-- DELETE policy
CREATE POLICY "Authenticated delete intel_policies"
  ON public.intel_policies FOR DELETE
  TO authenticated
  USING (created_by = auth.uid() OR created_by IS NULL);
