-- ============================================================
-- 1) RPC: upsert_trend_signal_embedding
--    Accepts float8[] and casts to vector(64) server-side.
--    Only updates if hash changed or embedding is null.
-- ============================================================
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
  IF array_length(_embedding, 1) != 64 THEN
    RAISE EXCEPTION 'embedding dimension must be 64, got %', array_length(_embedding, 1);
  END IF;

  UPDATE trend_signals
  SET
    embedding = _embedding::vector(64),
    embedding_model = _embedding_model,
    embedding_text_hash = _embedding_text_hash,
    embedding_text_len = _embedding_text_len,
    last_updated_at = now()
  WHERE id = _signal_id
    AND (embedding IS NULL OR embedding_text_hash IS DISTINCT FROM _embedding_text_hash);

  RETURN FOUND;
END;
$$;

-- ============================================================
-- 2) RPC: insert_project_vector
--    Accepts float8[] and casts to vector(64) server-side.
--    Returns the new row id, or null if skipped (same hash exists).
-- ============================================================
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
  IF array_length(_embedding, 1) != 64 THEN
    RAISE EXCEPTION 'embedding dimension must be 64, got %', array_length(_embedding, 1);
  END IF;

  -- Skip if same hash already exists for this project+type
  IF EXISTS (
    SELECT 1 FROM project_vectors
    WHERE project_id = _project_id
      AND vector_type = _vector_type
      AND source_hash = _source_hash
  ) THEN
    RETURN NULL;
  END IF;

  INSERT INTO project_vectors (project_id, vector_type, embedding, embedding_model, source_hash, source_len, source_meta)
  VALUES (_project_id, _vector_type, _embedding::vector(64), _embedding_model, _source_hash, _source_len, _source_meta)
  RETURNING id INTO _new_id;

  RETURN _new_id;
END;
$$;

-- ============================================================
-- 3) Unique index for project_vectors idempotency
-- ============================================================
CREATE UNIQUE INDEX IF NOT EXISTS idx_project_vectors_dedup
  ON public.project_vectors (project_id, vector_type, source_hash);