
-- Trailer Definition Packs
CREATE TABLE IF NOT EXISTS public.trailer_definition_packs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  title text NOT NULL DEFAULT 'Trailer Definition Pack',
  status text NOT NULL DEFAULT 'draft',
  created_by uuid NOT NULL,
  updated_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS trailer_definition_packs_project_idx
ON public.trailer_definition_packs(project_id, created_at DESC);

-- Pack items
CREATE TABLE IF NOT EXISTS public.trailer_definition_pack_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  pack_id uuid NOT NULL REFERENCES public.trailer_definition_packs(id) ON DELETE CASCADE,
  project_id uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  document_id uuid NOT NULL REFERENCES public.project_documents(id) ON DELETE CASCADE,
  version_id uuid NULL REFERENCES public.project_document_versions(id) ON DELETE SET NULL,
  role text NOT NULL DEFAULT 'supporting',
  sort_order int NOT NULL DEFAULT 0,
  include boolean NOT NULL DEFAULT true,
  notes text NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS trailer_definition_pack_items_pack_idx
ON public.trailer_definition_pack_items(pack_id, sort_order);

CREATE UNIQUE INDEX IF NOT EXISTS trailer_definition_pack_items_unique_doc
ON public.trailer_definition_pack_items(pack_id, document_id);

-- Updated_at trigger
CREATE TRIGGER set_trailer_definition_packs_updated_at
  BEFORE UPDATE ON public.trailer_definition_packs
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- RLS
ALTER TABLE public.trailer_definition_packs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.trailer_definition_pack_items ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can manage packs for their projects"
  ON public.trailer_definition_packs
  FOR ALL
  USING (public.has_project_access(auth.uid(), project_id))
  WITH CHECK (public.has_project_access(auth.uid(), project_id));

CREATE POLICY "Users can manage pack items for their projects"
  ON public.trailer_definition_pack_items
  FOR ALL
  USING (public.has_project_access(auth.uid(), project_id))
  WITH CHECK (public.has_project_access(auth.uid(), project_id));
