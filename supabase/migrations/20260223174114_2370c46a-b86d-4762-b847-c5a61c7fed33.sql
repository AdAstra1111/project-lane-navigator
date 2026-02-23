-- ═══════════════════════════════════════════════════════════
-- Visual Unit Engine v1.0 — Tables, Indexes, RLS, Triggers
-- ═══════════════════════════════════════════════════════════

-- 1) visual_unit_runs
CREATE TABLE public.visual_unit_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  source_versions jsonb NOT NULL DEFAULT '{}'::jsonb,
  engine_version text NOT NULL DEFAULT 'v1',
  prompt_version text NOT NULL DEFAULT 'v1',
  status text NOT NULL DEFAULT 'complete',
  error text NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid NULL
);
CREATE INDEX idx_visual_unit_runs_project ON public.visual_unit_runs(project_id, created_at DESC);
ALTER TABLE public.visual_unit_runs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "vue_runs_all" ON public.visual_unit_runs FOR ALL TO authenticated
  USING (public.has_project_access(auth.uid(), project_id))
  WITH CHECK (public.has_project_access(auth.uid(), project_id));

-- 2) visual_unit_candidates
CREATE TABLE public.visual_unit_candidates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  run_id uuid NOT NULL REFERENCES public.visual_unit_runs(id) ON DELETE CASCADE,
  unit_key text NOT NULL,
  status text NOT NULL DEFAULT 'proposed',
  candidate_payload jsonb NOT NULL,
  extracted_from jsonb NOT NULL DEFAULT '{}'::jsonb,
  scores jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid NULL
);
CREATE INDEX idx_vuc_project_run ON public.visual_unit_candidates(project_id, run_id);
CREATE INDEX idx_vuc_project_unit_key ON public.visual_unit_candidates(project_id, unit_key);
ALTER TABLE public.visual_unit_candidates ENABLE ROW LEVEL SECURITY;
CREATE POLICY "vue_candidates_all" ON public.visual_unit_candidates FOR ALL TO authenticated
  USING (public.has_project_access(auth.uid(), project_id))
  WITH CHECK (public.has_project_access(auth.uid(), project_id));

-- 3) visual_units (canonical)
CREATE TABLE public.visual_units (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  unit_key text NOT NULL,
  candidate_id uuid NULL REFERENCES public.visual_unit_candidates(id) ON DELETE SET NULL,
  canonical_payload jsonb NOT NULL,
  source_versions jsonb NOT NULL DEFAULT '{}'::jsonb,
  locked boolean NOT NULL DEFAULT false,
  stale boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid NULL,
  updated_by uuid NULL,
  UNIQUE (project_id, unit_key)
);
CREATE INDEX idx_vu_project_locked ON public.visual_units(project_id, locked);
CREATE INDEX idx_vu_project_stale ON public.visual_units(project_id, stale);
ALTER TABLE public.visual_units ENABLE ROW LEVEL SECURITY;
CREATE POLICY "vue_units_all" ON public.visual_units FOR ALL TO authenticated
  USING (public.has_project_access(auth.uid(), project_id))
  WITH CHECK (public.has_project_access(auth.uid(), project_id));

CREATE TRIGGER set_visual_units_updated_at
  BEFORE UPDATE ON public.visual_units
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- 4) visual_unit_events (audit log)
CREATE TABLE public.visual_unit_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  unit_id uuid NULL REFERENCES public.visual_units(id) ON DELETE CASCADE,
  candidate_id uuid NULL REFERENCES public.visual_unit_candidates(id) ON DELETE CASCADE,
  event_type text NOT NULL,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid NULL
);
CREATE INDEX idx_vue_events_project ON public.visual_unit_events(project_id, created_at DESC);
CREATE INDEX idx_vue_events_candidate ON public.visual_unit_events(candidate_id, created_at DESC);
CREATE INDEX idx_vue_events_unit ON public.visual_unit_events(unit_id, created_at DESC);
ALTER TABLE public.visual_unit_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY "vue_events_all" ON public.visual_unit_events FOR ALL TO authenticated
  USING (public.has_project_access(auth.uid(), project_id))
  WITH CHECK (public.has_project_access(auth.uid(), project_id));

-- 5) visual_unit_diffs
CREATE TABLE public.visual_unit_diffs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  from_candidate_id uuid NULL REFERENCES public.visual_unit_candidates(id) ON DELETE SET NULL,
  to_candidate_id uuid NULL REFERENCES public.visual_unit_candidates(id) ON DELETE SET NULL,
  from_unit_id uuid NULL REFERENCES public.visual_units(id) ON DELETE SET NULL,
  to_unit_id uuid NULL REFERENCES public.visual_units(id) ON DELETE SET NULL,
  unit_key text NULL,
  diff_summary text NOT NULL DEFAULT '',
  diff_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid NULL
);
CREATE INDEX idx_vue_diffs_project_key ON public.visual_unit_diffs(project_id, unit_key);
CREATE INDEX idx_vue_diffs_project_at ON public.visual_unit_diffs(project_id, created_at DESC);
ALTER TABLE public.visual_unit_diffs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "vue_diffs_all" ON public.visual_unit_diffs FOR ALL TO authenticated
  USING (public.has_project_access(auth.uid(), project_id))
  WITH CHECK (public.has_project_access(auth.uid(), project_id));