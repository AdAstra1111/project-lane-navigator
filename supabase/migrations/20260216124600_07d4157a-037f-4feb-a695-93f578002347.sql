
-- ══════════════════════════════════════════════════════════
-- Ask Anything / Propose Changes data model
-- ══════════════════════════════════════════════════════════

-- 1) doc_queries: user questions about documents
CREATE TABLE public.doc_queries (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  project_id UUID NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  user_id UUID NOT NULL,
  doc_type TEXT,
  doc_version_id UUID,
  scope TEXT NOT NULL DEFAULT 'current_doc',
  query_text TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.doc_queries ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can manage own doc queries" ON public.doc_queries FOR ALL USING (auth.uid() = user_id);

-- 2) doc_query_answers: AI answers with citations
CREATE TABLE public.doc_query_answers (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  doc_query_id UUID NOT NULL REFERENCES public.doc_queries(id) ON DELETE CASCADE,
  answer_text TEXT NOT NULL,
  citations JSONB DEFAULT '[]'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.doc_query_answers ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can view answers for own queries" ON public.doc_query_answers FOR ALL
  USING (EXISTS (SELECT 1 FROM public.doc_queries q WHERE q.id = doc_query_id AND q.user_id = auth.uid()));

-- 3) doc_change_proposals: change proposals with test reports
CREATE TABLE public.doc_change_proposals (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  project_id UUID NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  user_id UUID NOT NULL,
  target_doc_type TEXT NOT NULL,
  target_version_id UUID,
  proposal_text TEXT NOT NULL,
  selected_span JSONB,
  status TEXT NOT NULL DEFAULT 'draft',
  test_report JSONB,
  draft_new_version_id UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.doc_change_proposals ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can manage own proposals" ON public.doc_change_proposals FOR ALL USING (auth.uid() = user_id);

-- 4) project_doc_chunks: document chunks for RAG retrieval
CREATE TABLE public.project_doc_chunks (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  project_id UUID NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  version_id UUID NOT NULL,
  doc_type TEXT NOT NULL,
  chunk_index INTEGER NOT NULL DEFAULT 0,
  chunk_text TEXT NOT NULL,
  embedding vector(768),
  search_vector tsvector GENERATED ALWAYS AS (to_tsvector('english', chunk_text)) STORED,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.project_doc_chunks ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users with project access can read chunks" ON public.project_doc_chunks FOR SELECT
  USING (public.has_project_access(auth.uid(), project_id));
CREATE POLICY "Users with project access can manage chunks" ON public.project_doc_chunks FOR ALL
  USING (public.has_project_access(auth.uid(), project_id));

-- Indexes for RAG performance
CREATE INDEX idx_project_doc_chunks_project ON public.project_doc_chunks(project_id);
CREATE INDEX idx_project_doc_chunks_version ON public.project_doc_chunks(version_id);
CREATE INDEX idx_project_doc_chunks_search ON public.project_doc_chunks USING GIN(search_vector);
CREATE UNIQUE INDEX idx_project_doc_chunks_unique ON public.project_doc_chunks(version_id, chunk_index);

-- Semantic search function for project docs
CREATE OR REPLACE FUNCTION public.search_project_doc_chunks(
  p_project_id UUID,
  search_query TEXT,
  match_count INTEGER DEFAULT 10
)
RETURNS TABLE(id UUID, version_id UUID, doc_type TEXT, chunk_index INTEGER, chunk_text TEXT, rank REAL)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$
  SELECT
    pdc.id, pdc.version_id, pdc.doc_type, pdc.chunk_index, pdc.chunk_text,
    ts_rank(pdc.search_vector, websearch_to_tsquery('english', search_query)) AS rank
  FROM public.project_doc_chunks pdc
  WHERE pdc.project_id = p_project_id
    AND pdc.search_vector @@ websearch_to_tsquery('english', search_query)
  ORDER BY rank DESC
  LIMIT match_count;
$$;
