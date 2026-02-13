
-- A) Track embedding status + model metadata
ALTER TABLE public.corpus_chunks
  ADD COLUMN IF NOT EXISTS embedding_status text DEFAULT 'pending',
  ADD COLUMN IF NOT EXISTS embedding_model text,
  ADD COLUMN IF NOT EXISTS embedding_updated_at timestamptz;

CREATE INDEX IF NOT EXISTS corpus_chunks_embedding_status_idx
  ON public.corpus_chunks (embedding_status);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'corpus_chunks_embedding_status_check'
  ) THEN
    ALTER TABLE public.corpus_chunks
      ADD CONSTRAINT corpus_chunks_embedding_status_check
      CHECK (embedding_status IN ('pending','processing','ready','error'));
  END IF;
END $$;

-- B) Vector index for cosine distance
CREATE INDEX IF NOT EXISTS corpus_chunks_embedding_ivfflat_idx
  ON public.corpus_chunks
  USING ivfflat (embedding vector_cosine_ops)
  WITH (lists = 100);

-- C) Semantic search function
CREATE OR REPLACE FUNCTION public.search_corpus_semantic(
  query_embedding extensions.vector,
  match_count int DEFAULT 12,
  filter_script_id uuid DEFAULT NULL
)
RETURNS TABLE (
  chunk_id uuid,
  script_id uuid,
  chunk_text text,
  distance float
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'extensions'
AS $$
BEGIN
  RETURN QUERY
  SELECT
    cc.id AS chunk_id,
    cc.script_id,
    cc.chunk_text,
    (cc.embedding <=> query_embedding)::double precision AS distance
  FROM public.corpus_chunks cc
  WHERE cc.embedding_status = 'ready'
    AND cc.embedding IS NOT NULL
    AND (filter_script_id IS NULL OR cc.script_id = filter_script_id)
  ORDER BY cc.embedding <=> query_embedding
  LIMIT match_count;
END;
$$;
