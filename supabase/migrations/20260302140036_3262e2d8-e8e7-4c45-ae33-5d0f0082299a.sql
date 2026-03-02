-- ============================================================
-- Reduce embedding dimension from 1536 to 64 so LLM tool-calling
-- can reliably produce vectors. Both columns are currently empty (0 rows).
-- ============================================================

-- 1) Alter trend_signals.embedding from vector(1536) to vector(64)
ALTER TABLE public.trend_signals
  ALTER COLUMN embedding TYPE extensions.vector(64)
  USING NULL;

-- 2) Alter project_vectors.embedding from vector(1536) to vector(64)
ALTER TABLE public.project_vectors
  ALTER COLUMN embedding TYPE extensions.vector(64)
  USING NULL;

-- 3) Recreate match_trend_signals RPC with vector(64)
CREATE OR REPLACE FUNCTION public.match_trend_signals(
  _project_embedding extensions.vector(64),
  _min_strength integer DEFAULT 1,
  _limit integer DEFAULT 30
)
RETURNS TABLE(
  signal_id uuid,
  name text,
  strength integer,
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