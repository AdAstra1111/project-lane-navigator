
-- project_canon: single canonical record per project
CREATE TABLE IF NOT EXISTS public.project_canon (
  project_id UUID PRIMARY KEY REFERENCES public.projects(id) ON DELETE CASCADE,
  canon_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by UUID REFERENCES auth.users(id) ON DELETE SET NULL
);

ALTER TABLE public.project_canon ENABLE ROW LEVEL SECURITY;

CREATE POLICY "project_canon_select" ON public.project_canon
  FOR SELECT TO authenticated
  USING (public.has_project_access(auth.uid(), project_id));

CREATE POLICY "project_canon_insert" ON public.project_canon
  FOR INSERT TO authenticated
  WITH CHECK (public.has_project_access(auth.uid(), project_id));

CREATE POLICY "project_canon_update" ON public.project_canon
  FOR UPDATE TO authenticated
  USING (public.has_project_access(auth.uid(), project_id));

-- project_canon_versions: append-only version history
CREATE TABLE IF NOT EXISTS public.project_canon_versions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  canon_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  is_approved BOOLEAN NOT NULL DEFAULT false,
  approved_at TIMESTAMPTZ
);

ALTER TABLE public.project_canon_versions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "canon_versions_select" ON public.project_canon_versions
  FOR SELECT TO authenticated
  USING (public.has_project_access(auth.uid(), project_id));

CREATE POLICY "canon_versions_insert" ON public.project_canon_versions
  FOR INSERT TO authenticated
  WITH CHECK (public.has_project_access(auth.uid(), project_id));

CREATE POLICY "canon_versions_update" ON public.project_canon_versions
  FOR UPDATE TO authenticated
  USING (public.has_project_access(auth.uid(), project_id));

-- Index for fast lookups
CREATE INDEX IF NOT EXISTS idx_canon_versions_project ON public.project_canon_versions(project_id, created_at DESC);

-- Auto-create project_canon when project is created
CREATE OR REPLACE FUNCTION public.auto_create_project_canon()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = 'public'
AS $$
BEGIN
  INSERT INTO public.project_canon (project_id, canon_json, updated_by)
  VALUES (NEW.id, '{}'::jsonb, NEW.user_id)
  ON CONFLICT (project_id) DO NOTHING;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_auto_create_canon ON public.projects;
CREATE TRIGGER trg_auto_create_canon
  AFTER INSERT ON public.projects
  FOR EACH ROW
  EXECUTE FUNCTION public.auto_create_project_canon();

-- Auto-version on canon update
CREATE OR REPLACE FUNCTION public.auto_version_canon()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = 'public'
AS $$
BEGIN
  NEW.updated_at = now();
  INSERT INTO public.project_canon_versions (project_id, canon_json, created_by)
  VALUES (NEW.project_id, NEW.canon_json, NEW.updated_by);
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_auto_version_canon ON public.project_canon;
CREATE TRIGGER trg_auto_version_canon
  BEFORE UPDATE ON public.project_canon
  FOR EACH ROW
  EXECUTE FUNCTION public.auto_version_canon();
