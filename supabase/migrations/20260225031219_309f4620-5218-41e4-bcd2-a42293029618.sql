
-- Project Doc Sets: named groupings of documents for context control
CREATE TABLE public.project_doc_sets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  name text NOT NULL,
  description text NULL,
  is_default boolean NOT NULL DEFAULT false,
  created_by uuid NULL DEFAULT auth.uid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (project_id, name)
);

-- Partial unique index: at most one default per project
CREATE UNIQUE INDEX idx_doc_sets_one_default ON public.project_doc_sets (project_id) WHERE is_default = true;

CREATE INDEX idx_doc_sets_project_created ON public.project_doc_sets (project_id, created_at DESC);

ALTER TABLE public.project_doc_sets ENABLE ROW LEVEL SECURITY;

CREATE POLICY "doc_sets_select" ON public.project_doc_sets
  FOR SELECT USING (public.has_project_access(auth.uid(), project_id));

CREATE POLICY "doc_sets_insert" ON public.project_doc_sets
  FOR INSERT WITH CHECK (public.has_project_access(auth.uid(), project_id));

CREATE POLICY "doc_sets_update" ON public.project_doc_sets
  FOR UPDATE USING (public.has_project_access(auth.uid(), project_id));

CREATE POLICY "doc_sets_delete" ON public.project_doc_sets
  FOR DELETE USING (public.has_project_access(auth.uid(), project_id));

CREATE TRIGGER update_doc_sets_updated_at
  BEFORE UPDATE ON public.project_doc_sets
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- Doc Set Items: documents in a doc set with ordering
CREATE TABLE public.project_doc_set_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  doc_set_id uuid NOT NULL REFERENCES public.project_doc_sets(id) ON DELETE CASCADE,
  document_id uuid NOT NULL REFERENCES public.project_documents(id) ON DELETE CASCADE,
  sort_order int NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (doc_set_id, document_id)
);

CREATE INDEX idx_doc_set_items_set_order ON public.project_doc_set_items (doc_set_id, sort_order);

ALTER TABLE public.project_doc_set_items ENABLE ROW LEVEL SECURITY;

CREATE POLICY "doc_set_items_select" ON public.project_doc_set_items
  FOR SELECT USING (EXISTS (
    SELECT 1 FROM public.project_doc_sets ds
    WHERE ds.id = doc_set_id AND public.has_project_access(auth.uid(), ds.project_id)
  ));

CREATE POLICY "doc_set_items_insert" ON public.project_doc_set_items
  FOR INSERT WITH CHECK (EXISTS (
    SELECT 1 FROM public.project_doc_sets ds
    WHERE ds.id = doc_set_id AND public.has_project_access(auth.uid(), ds.project_id)
  ));

CREATE POLICY "doc_set_items_update" ON public.project_doc_set_items
  FOR UPDATE USING (EXISTS (
    SELECT 1 FROM public.project_doc_sets ds
    WHERE ds.id = doc_set_id AND public.has_project_access(auth.uid(), ds.project_id)
  ));

CREATE POLICY "doc_set_items_delete" ON public.project_doc_set_items
  FOR DELETE USING (EXISTS (
    SELECT 1 FROM public.project_doc_sets ds
    WHERE ds.id = doc_set_id AND public.has_project_access(auth.uid(), ds.project_id)
  ));
