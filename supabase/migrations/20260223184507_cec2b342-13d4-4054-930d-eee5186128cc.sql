-- Trailer Pipeline v2: Blueprint, Clips, Cuts

-- ═══ trailer_blueprints ═══
CREATE TABLE public.trailer_blueprints (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  storyboard_run_id uuid REFERENCES public.storyboard_runs(id) ON DELETE SET NULL,
  arc_type text NOT NULL DEFAULT 'main',
  status text NOT NULL DEFAULT 'draft',
  edl jsonb NOT NULL DEFAULT '[]'::jsonb,
  rhythm_analysis jsonb NOT NULL DEFAULT '{}'::jsonb,
  audio_plan jsonb NOT NULL DEFAULT '{}'::jsonb,
  text_card_plan jsonb NOT NULL DEFAULT '[]'::jsonb,
  options jsonb NOT NULL DEFAULT '{}'::jsonb,
  error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid NOT NULL
);

CREATE INDEX idx_trailer_blueprints_project ON public.trailer_blueprints(project_id, created_at DESC);
CREATE TRIGGER trg_trailer_blueprints_updated BEFORE UPDATE ON public.trailer_blueprints FOR EACH ROW EXECUTE FUNCTION set_updated_at();

ALTER TABLE public.trailer_blueprints ENABLE ROW LEVEL SECURITY;

CREATE POLICY "trailer_blueprints_select" ON public.trailer_blueprints
  FOR SELECT TO authenticated USING (public.has_project_access(auth.uid(), project_id));
CREATE POLICY "trailer_blueprints_insert" ON public.trailer_blueprints
  FOR INSERT TO authenticated WITH CHECK (public.has_project_access(auth.uid(), project_id) AND created_by = auth.uid());
CREATE POLICY "trailer_blueprints_update" ON public.trailer_blueprints
  FOR UPDATE TO authenticated USING (public.has_project_access(auth.uid(), project_id) AND created_by = auth.uid());

-- ═══ trailer_clips ═══
CREATE TABLE public.trailer_clips (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  blueprint_id uuid NOT NULL REFERENCES public.trailer_blueprints(id) ON DELETE CASCADE,
  beat_index integer NOT NULL,
  provider text NOT NULL DEFAULT 'stub',
  status text NOT NULL DEFAULT 'pending',
  media_type text NOT NULL DEFAULT 'video',
  storage_path text,
  public_url text,
  duration_ms integer,
  gen_params jsonb NOT NULL DEFAULT '{}'::jsonb,
  rating integer,
  used_in_cut boolean NOT NULL DEFAULT false,
  error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid NOT NULL
);

CREATE INDEX idx_trailer_clips_blueprint ON public.trailer_clips(project_id, blueprint_id, beat_index);
CREATE INDEX idx_trailer_clips_status ON public.trailer_clips(status);
CREATE TRIGGER trg_trailer_clips_updated BEFORE UPDATE ON public.trailer_clips FOR EACH ROW EXECUTE FUNCTION set_updated_at();

ALTER TABLE public.trailer_clips ENABLE ROW LEVEL SECURITY;

CREATE POLICY "trailer_clips_select" ON public.trailer_clips
  FOR SELECT TO authenticated USING (public.has_project_access(auth.uid(), project_id));
CREATE POLICY "trailer_clips_insert" ON public.trailer_clips
  FOR INSERT TO authenticated WITH CHECK (public.has_project_access(auth.uid(), project_id) AND created_by = auth.uid());
CREATE POLICY "trailer_clips_update" ON public.trailer_clips
  FOR UPDATE TO authenticated USING (public.has_project_access(auth.uid(), project_id) AND created_by = auth.uid());

-- ═══ trailer_cuts ═══
CREATE TABLE public.trailer_cuts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  blueprint_id uuid NOT NULL REFERENCES public.trailer_blueprints(id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'draft',
  timeline jsonb NOT NULL DEFAULT '[]'::jsonb,
  edl_export jsonb,
  storage_path text,
  public_url text,
  duration_ms integer,
  options jsonb NOT NULL DEFAULT '{}'::jsonb,
  error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid NOT NULL
);

CREATE INDEX idx_trailer_cuts_blueprint ON public.trailer_cuts(project_id, blueprint_id, created_at DESC);
CREATE TRIGGER trg_trailer_cuts_updated BEFORE UPDATE ON public.trailer_cuts FOR EACH ROW EXECUTE FUNCTION set_updated_at();

ALTER TABLE public.trailer_cuts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "trailer_cuts_select" ON public.trailer_cuts
  FOR SELECT TO authenticated USING (public.has_project_access(auth.uid(), project_id));
CREATE POLICY "trailer_cuts_insert" ON public.trailer_cuts
  FOR INSERT TO authenticated WITH CHECK (public.has_project_access(auth.uid(), project_id) AND created_by = auth.uid());
CREATE POLICY "trailer_cuts_update" ON public.trailer_cuts
  FOR UPDATE TO authenticated USING (public.has_project_access(auth.uid(), project_id) AND created_by = auth.uid());