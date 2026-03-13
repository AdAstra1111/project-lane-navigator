-- narrative_entities
CREATE TABLE IF NOT EXISTS public.narrative_entities (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  entity_key TEXT NOT NULL,
  canonical_name TEXT NOT NULL DEFAULT '',
  entity_type TEXT NOT NULL DEFAULT 'character',
  source_kind TEXT NOT NULL DEFAULT 'project_canon',
  source_key TEXT,
  status TEXT NOT NULL DEFAULT 'active',
  meta_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (project_id, entity_key)
);

ALTER TABLE public.narrative_entities ENABLE ROW LEVEL SECURITY;
CREATE POLICY "ne_select" ON public.narrative_entities FOR SELECT TO authenticated USING (public.has_project_access(auth.uid(), project_id));
CREATE POLICY "ne_insert" ON public.narrative_entities FOR INSERT TO authenticated WITH CHECK (public.has_project_access(auth.uid(), project_id));
CREATE POLICY "ne_update" ON public.narrative_entities FOR UPDATE TO authenticated USING (public.has_project_access(auth.uid(), project_id));
CREATE POLICY "ne_delete" ON public.narrative_entities FOR DELETE TO authenticated USING (public.has_project_access(auth.uid(), project_id));

-- narrative_entity_relations
CREATE TABLE IF NOT EXISTS public.narrative_entity_relations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  source_entity_id UUID NOT NULL REFERENCES public.narrative_entities(id) ON DELETE CASCADE,
  target_entity_id UUID NOT NULL REFERENCES public.narrative_entities(id) ON DELETE CASCADE,
  relation_type TEXT NOT NULL DEFAULT 'related_to',
  source_kind TEXT NOT NULL DEFAULT 'system',
  confidence NUMERIC NOT NULL DEFAULT 0.5,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (project_id, source_entity_id, target_entity_id, relation_type)
);

ALTER TABLE public.narrative_entity_relations ENABLE ROW LEVEL SECURITY;
CREATE POLICY "ner_select" ON public.narrative_entity_relations FOR SELECT TO authenticated USING (public.has_project_access(auth.uid(), project_id));
CREATE POLICY "ner_insert" ON public.narrative_entity_relations FOR INSERT TO authenticated WITH CHECK (public.has_project_access(auth.uid(), project_id));
CREATE POLICY "ner_update" ON public.narrative_entity_relations FOR UPDATE TO authenticated USING (public.has_project_access(auth.uid(), project_id));
CREATE POLICY "ner_delete" ON public.narrative_entity_relations FOR DELETE TO authenticated USING (public.has_project_access(auth.uid(), project_id));

-- narrative_repairs
CREATE TABLE IF NOT EXISTS public.narrative_repairs (
  repair_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  source_diagnostic_id TEXT NOT NULL,
  source_system TEXT NOT NULL DEFAULT 'unknown',
  diagnostic_type TEXT NOT NULL DEFAULT 'unknown',
  repair_type TEXT NOT NULL DEFAULT 'unknown',
  scope_type TEXT NOT NULL DEFAULT 'project',
  scope_key TEXT,
  strategy TEXT NOT NULL DEFAULT 'balanced',
  priority_score NUMERIC NOT NULL DEFAULT 0,
  repairability TEXT NOT NULL DEFAULT 'unknown',
  status TEXT NOT NULL DEFAULT 'pending',
  summary TEXT NOT NULL DEFAULT '',
  recommended_action TEXT,
  skipped_reason TEXT,
  executed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (project_id, source_diagnostic_id)
);

ALTER TABLE public.narrative_repairs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "nr_select" ON public.narrative_repairs FOR SELECT TO authenticated USING (public.has_project_access(auth.uid(), project_id));
CREATE POLICY "nr_insert" ON public.narrative_repairs FOR INSERT TO authenticated WITH CHECK (public.has_project_access(auth.uid(), project_id));
CREATE POLICY "nr_update" ON public.narrative_repairs FOR UPDATE TO authenticated USING (public.has_project_access(auth.uid(), project_id));
CREATE POLICY "nr_delete" ON public.narrative_repairs FOR DELETE TO authenticated USING (public.has_project_access(auth.uid(), project_id));

-- narrative_scene_entity_links
CREATE TABLE IF NOT EXISTS public.narrative_scene_entity_links (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  scene_id UUID NOT NULL,
  entity_id UUID NOT NULL REFERENCES public.narrative_entities(id) ON DELETE CASCADE,
  relation_type TEXT NOT NULL DEFAULT 'appears_in',
  source_kind TEXT NOT NULL DEFAULT 'system',
  confidence NUMERIC NOT NULL DEFAULT 0.5,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (scene_id, entity_id, relation_type)
);

ALTER TABLE public.narrative_scene_entity_links ENABLE ROW LEVEL SECURITY;
CREATE POLICY "nsel_select" ON public.narrative_scene_entity_links FOR SELECT TO authenticated USING (public.has_project_access(auth.uid(), project_id));
CREATE POLICY "nsel_insert" ON public.narrative_scene_entity_links FOR INSERT TO authenticated WITH CHECK (public.has_project_access(auth.uid(), project_id));
CREATE POLICY "nsel_update" ON public.narrative_scene_entity_links FOR UPDATE TO authenticated USING (public.has_project_access(auth.uid(), project_id));
CREATE POLICY "nsel_delete" ON public.narrative_scene_entity_links FOR DELETE TO authenticated USING (public.has_project_access(auth.uid(), project_id));