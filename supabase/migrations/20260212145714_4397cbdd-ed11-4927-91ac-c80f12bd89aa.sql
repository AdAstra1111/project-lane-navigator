
-- Enable pgvector extension
CREATE EXTENSION IF NOT EXISTS vector WITH SCHEMA extensions;

-- Approved Sources allowlist
CREATE TABLE public.approved_sources (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  title text NOT NULL DEFAULT '',
  source_url text NOT NULL DEFAULT '',
  format text NOT NULL DEFAULT 'pdf',
  rights_status text NOT NULL DEFAULT 'PENDING',
  license_reference text NOT NULL DEFAULT '',
  added_by text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.approved_sources ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own approved_sources" ON public.approved_sources FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users can insert own approved_sources" ON public.approved_sources FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can update own approved_sources" ON public.approved_sources FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "Users can delete own approved_sources" ON public.approved_sources FOR DELETE USING (auth.uid() = user_id);

-- Corpus Scripts (ingested metadata)
CREATE TABLE public.corpus_scripts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  source_id uuid NOT NULL REFERENCES public.approved_sources(id) ON DELETE CASCADE,
  checksum text NOT NULL DEFAULT '',
  raw_storage_path text NOT NULL DEFAULT '',
  parsed_storage_path text NOT NULL DEFAULT '',
  page_count_estimate integer DEFAULT 0,
  ingestion_status text NOT NULL DEFAULT 'pending',
  ingestion_log text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.corpus_scripts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own corpus_scripts" ON public.corpus_scripts FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users can insert own corpus_scripts" ON public.corpus_scripts FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can update own corpus_scripts" ON public.corpus_scripts FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "Users can delete own corpus_scripts" ON public.corpus_scripts FOR DELETE USING (auth.uid() = user_id);

-- Corpus Scenes
CREATE TABLE public.corpus_scenes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  script_id uuid NOT NULL REFERENCES public.corpus_scripts(id) ON DELETE CASCADE,
  scene_number integer NOT NULL DEFAULT 0,
  slugline text NOT NULL DEFAULT '',
  location text NOT NULL DEFAULT '',
  time_of_day text NOT NULL DEFAULT '',
  scene_text text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.corpus_scenes ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own corpus_scenes" ON public.corpus_scenes FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users can insert own corpus_scenes" ON public.corpus_scenes FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can delete own corpus_scenes" ON public.corpus_scenes FOR DELETE USING (auth.uid() = user_id);

-- Corpus Chunks (with full-text search + vector placeholder)
CREATE TABLE public.corpus_chunks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  script_id uuid NOT NULL REFERENCES public.corpus_scripts(id) ON DELETE CASCADE,
  chunk_index integer NOT NULL DEFAULT 0,
  chunk_text text NOT NULL DEFAULT '',
  search_vector tsvector,
  embedding extensions.vector(1536),
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.corpus_chunks ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own corpus_chunks" ON public.corpus_chunks FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users can insert own corpus_chunks" ON public.corpus_chunks FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can delete own corpus_chunks" ON public.corpus_chunks FOR DELETE USING (auth.uid() = user_id);

-- Full-text search index
CREATE INDEX idx_corpus_chunks_search ON public.corpus_chunks USING GIN (search_vector);

-- Auto-generate tsvector on insert/update
CREATE OR REPLACE FUNCTION public.corpus_chunks_search_vector_trigger()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  NEW.search_vector := to_tsvector('english', COALESCE(NEW.chunk_text, ''));
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_corpus_chunks_search_vector
BEFORE INSERT OR UPDATE ON public.corpus_chunks
FOR EACH ROW EXECUTE FUNCTION public.corpus_chunks_search_vector_trigger();

-- Derived Artifacts
CREATE TABLE public.corpus_derived_artifacts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  script_id uuid NOT NULL REFERENCES public.corpus_scripts(id) ON DELETE CASCADE,
  artifact_type text NOT NULL DEFAULT 'beats',
  json_data jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.corpus_derived_artifacts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own corpus_derived_artifacts" ON public.corpus_derived_artifacts FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users can insert own corpus_derived_artifacts" ON public.corpus_derived_artifacts FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can delete own corpus_derived_artifacts" ON public.corpus_derived_artifacts FOR DELETE USING (auth.uid() = user_id);

-- Full-text search function for corpus
CREATE OR REPLACE FUNCTION public.search_corpus_chunks(
  search_query text,
  match_count integer DEFAULT 10,
  p_user_id uuid DEFAULT auth.uid()
)
RETURNS TABLE (
  id uuid,
  script_id uuid,
  chunk_index integer,
  chunk_text text,
  rank real
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    cc.id,
    cc.script_id,
    cc.chunk_index,
    cc.chunk_text,
    ts_rank(cc.search_vector, websearch_to_tsquery('english', search_query)) AS rank
  FROM public.corpus_chunks cc
  WHERE cc.user_id = p_user_id
    AND cc.search_vector @@ websearch_to_tsquery('english', search_query)
  ORDER BY rank DESC
  LIMIT match_count;
$$;
