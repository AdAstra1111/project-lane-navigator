-- ============================================================
-- Restore all vector columns and RPCs to 1536 dimensions
-- ============================================================

-- 1) Alter columns back to vector(1536)
ALTER TABLE public.project_vectors
  ALTER COLUMN embedding TYPE extensions.vector(1536) USING NULL;

ALTER TABLE public.trend_signals
  ALTER COLUMN embedding TYPE extensions.vector(1536) USING NULL;

-- 2) Recreate insert_project_vector with 1536 validation
CREATE OR REPLACE FUNCTION public.insert_project_vector(
  _project_id uuid,
  _vector_type text,
  _embedding float8[],
  _embedding_model text,
  _source_hash text,
  _source_len int,
  _source_meta jsonb DEFAULT '{}'::jsonb
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'extensions'
AS $$
DECLARE
  _new_id uuid;
BEGIN
  IF array_length(_embedding, 1) != 1536 THEN
    RAISE EXCEPTION 'embedding dimension must be 1536, got %', array_length(_embedding, 1);
  END IF;

  INSERT INTO project_vectors (project_id, vector_type, embedding, embedding_model, source_hash, source_len, source_meta)
  VALUES (_project_id, _vector_type, _embedding::vector(1536), _embedding_model, _source_hash, _source_len, _source_meta)
  ON CONFLICT (project_id, vector_type, source_hash) DO NOTHING
  RETURNING id INTO _new_id;

  RETURN _new_id;
END;
$$;

-- 3) Recreate upsert_trend_signal_embedding with 1536 validation
CREATE OR REPLACE FUNCTION public.upsert_trend_signal_embedding(
  _signal_id uuid,
  _embedding float8[],
  _embedding_model text,
  _embedding_text_hash text,
  _embedding_text_len int
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'extensions'
AS $$
BEGIN
  IF array_length(_embedding, 1) != 1536 THEN
    RAISE EXCEPTION 'embedding dimension must be 1536, got %', array_length(_embedding, 1);
  END IF;

  UPDATE trend_signals
  SET
    embedding = _embedding::vector(1536),
    embedding_model = _embedding_model,
    embedding_text_hash = _embedding_text_hash,
    embedding_text_len = _embedding_text_len,
    last_updated_at = now()
  WHERE id = _signal_id
    AND (embedding IS NULL OR embedding_text_hash IS DISTINCT FROM _embedding_text_hash);

  RETURN FOUND;
END;
$$;

-- 4) Recreate match_trend_signals with explicit vector(1536) input
CREATE OR REPLACE FUNCTION public.match_trend_signals(
  _project_embedding extensions.vector(1536),
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