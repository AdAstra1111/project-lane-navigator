
-- Canon OS: Atomic Unit Store
-- Three tables for structured narrative units, mentions, and relations.
-- Shadow mode: these tables are populated by NUE but do not affect existing pipelines.

-- 1. canon_units — atomic narrative units (characters, events, objects, etc.)
CREATE TABLE public.canon_units (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  project_id UUID NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  unit_type TEXT NOT NULL CHECK (unit_type IN ('character', 'event', 'object', 'location', 'relationship', 'theme', 'rule')),
  label TEXT NOT NULL,
  attributes JSONB NOT NULL DEFAULT '{}',
  confidence REAL NOT NULL DEFAULT 1.0,
  source_document_id UUID REFERENCES public.project_documents(id) ON DELETE SET NULL,
  source_version_id UUID REFERENCES public.project_document_versions(id) ON DELETE SET NULL,
  provenance_hash TEXT,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (project_id, unit_type, label)
);

-- Index for fast project-scoped lookups
CREATE INDEX idx_canon_units_project ON public.canon_units(project_id);
CREATE INDEX idx_canon_units_type ON public.canon_units(project_id, unit_type);

-- 2. canon_unit_mentions — where units appear in documents
CREATE TABLE public.canon_unit_mentions (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  unit_id UUID NOT NULL REFERENCES public.canon_units(id) ON DELETE CASCADE,
  document_id UUID NOT NULL REFERENCES public.project_documents(id) ON DELETE CASCADE,
  version_id UUID NOT NULL REFERENCES public.project_document_versions(id) ON DELETE CASCADE,
  offset_start INTEGER,
  offset_end INTEGER,
  confidence REAL NOT NULL DEFAULT 1.0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_canon_unit_mentions_unit ON public.canon_unit_mentions(unit_id);
CREATE INDEX idx_canon_unit_mentions_doc ON public.canon_unit_mentions(document_id, version_id);

-- 3. canon_unit_relations — relationships between units
CREATE TABLE public.canon_unit_relations (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  project_id UUID NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  unit_id_from UUID NOT NULL REFERENCES public.canon_units(id) ON DELETE CASCADE,
  unit_id_to UUID NOT NULL REFERENCES public.canon_units(id) ON DELETE CASCADE,
  relation_type TEXT NOT NULL,
  attributes JSONB NOT NULL DEFAULT '{}',
  confidence REAL NOT NULL DEFAULT 1.0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_canon_unit_relations_project ON public.canon_unit_relations(project_id);
CREATE INDEX idx_canon_unit_relations_from ON public.canon_unit_relations(unit_id_from);
CREATE INDEX idx_canon_unit_relations_to ON public.canon_unit_relations(unit_id_to);

-- RLS: all tables scoped to project access
ALTER TABLE public.canon_units ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.canon_unit_mentions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.canon_unit_relations ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can read canon units for their projects"
  ON public.canon_units FOR SELECT TO authenticated
  USING (public.has_project_access(auth.uid(), project_id));

CREATE POLICY "Users can insert canon units for their projects"
  ON public.canon_units FOR INSERT TO authenticated
  WITH CHECK (public.has_project_access(auth.uid(), project_id));

CREATE POLICY "Users can update canon units for their projects"
  ON public.canon_units FOR UPDATE TO authenticated
  USING (public.has_project_access(auth.uid(), project_id));

CREATE POLICY "Users can read canon unit mentions for their projects"
  ON public.canon_unit_mentions FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.canon_units cu WHERE cu.id = unit_id AND public.has_project_access(auth.uid(), cu.project_id)
  ));

CREATE POLICY "Users can insert canon unit mentions"
  ON public.canon_unit_mentions FOR INSERT TO authenticated
  WITH CHECK (EXISTS (
    SELECT 1 FROM public.canon_units cu WHERE cu.id = unit_id AND public.has_project_access(auth.uid(), cu.project_id)
  ));

CREATE POLICY "Users can read canon unit relations for their projects"
  ON public.canon_unit_relations FOR SELECT TO authenticated
  USING (public.has_project_access(auth.uid(), project_id));

CREATE POLICY "Users can insert canon unit relations for their projects"
  ON public.canon_unit_relations FOR INSERT TO authenticated
  WITH CHECK (public.has_project_access(auth.uid(), project_id));

-- Updated_at trigger for canon_units
CREATE TRIGGER canon_units_updated_at
  BEFORE UPDATE ON public.canon_units
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
