
-- Feature Script Unit Engine tables

-- 1) script_blueprints
CREATE TABLE public.script_blueprints (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  source_document_version_id uuid NULL REFERENCES public.project_document_versions(id) ON DELETE SET NULL,
  blueprint_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_by uuid NULL REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- 2) script_units
CREATE TABLE public.script_units (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  blueprint_id uuid NULL REFERENCES public.script_blueprints(id) ON DELETE SET NULL,
  unit_type text NOT NULL,
  parent_unit_id uuid NULL REFERENCES public.script_units(id) ON DELETE CASCADE,
  order_index int NOT NULL DEFAULT 0,
  title text NULL,
  slugline text NULL,
  time_of_day text NULL,
  location text NULL,
  page_estimate numeric NULL,
  plaintext text NOT NULL DEFAULT '',
  unit_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_by uuid NULL REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_script_units_project_type_order ON public.script_units(project_id, unit_type, order_index);
CREATE INDEX idx_script_units_parent ON public.script_units(parent_unit_id);

-- 3) script_unit_versions
CREATE TABLE public.script_unit_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  unit_id uuid NOT NULL REFERENCES public.script_units(id) ON DELETE CASCADE,
  version_number int NOT NULL,
  plaintext text NOT NULL,
  unit_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_by uuid NULL REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(unit_id, version_number)
);

-- 4) script_unit_links
CREATE TABLE public.script_unit_links (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  blueprint_id uuid NULL REFERENCES public.script_blueprints(id) ON DELETE SET NULL,
  from_unit_id uuid NOT NULL REFERENCES public.script_units(id) ON DELETE CASCADE,
  to_unit_id uuid NOT NULL REFERENCES public.script_units(id) ON DELETE CASCADE,
  link_type text NOT NULL,
  strength numeric NOT NULL DEFAULT 0.5,
  note text NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_script_unit_links_project_type ON public.script_unit_links(project_id, link_type);
CREATE INDEX idx_script_unit_links_from ON public.script_unit_links(from_unit_id);
CREATE INDEX idx_script_unit_links_to ON public.script_unit_links(to_unit_id);

-- 5) script_world_state
CREATE TABLE public.script_world_state (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  blueprint_id uuid NULL REFERENCES public.script_blueprints(id) ON DELETE SET NULL,
  state_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(project_id)
);

-- Triggers for updated_at
CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS trigger LANGUAGE plpgsql SET search_path TO 'public' AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_script_blueprints_updated_at BEFORE UPDATE ON public.script_blueprints FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE TRIGGER trg_script_units_updated_at BEFORE UPDATE ON public.script_units FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE TRIGGER trg_script_world_state_updated_at BEFORE UPDATE ON public.script_world_state FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- RLS
ALTER TABLE public.script_blueprints ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.script_units ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.script_unit_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.script_unit_links ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.script_world_state ENABLE ROW LEVEL SECURITY;

-- Policies using existing has_project_access helper
CREATE POLICY "Project members can manage script_blueprints" ON public.script_blueprints FOR ALL TO authenticated USING (public.has_project_access(auth.uid(), project_id)) WITH CHECK (public.has_project_access(auth.uid(), project_id));

CREATE POLICY "Project members can manage script_units" ON public.script_units FOR ALL TO authenticated USING (public.has_project_access(auth.uid(), project_id)) WITH CHECK (public.has_project_access(auth.uid(), project_id));

CREATE POLICY "Project members can manage script_unit_versions" ON public.script_unit_versions FOR ALL TO authenticated USING (
  EXISTS (SELECT 1 FROM public.script_units su WHERE su.id = unit_id AND public.has_project_access(auth.uid(), su.project_id))
) WITH CHECK (
  EXISTS (SELECT 1 FROM public.script_units su WHERE su.id = unit_id AND public.has_project_access(auth.uid(), su.project_id))
);

CREATE POLICY "Project members can manage script_unit_links" ON public.script_unit_links FOR ALL TO authenticated USING (public.has_project_access(auth.uid(), project_id)) WITH CHECK (public.has_project_access(auth.uid(), project_id));

CREATE POLICY "Project members can manage script_world_state" ON public.script_world_state FOR ALL TO authenticated USING (public.has_project_access(auth.uid(), project_id)) WITH CHECK (public.has_project_access(auth.uid(), project_id));
