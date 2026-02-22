
-- Phase 3 Story-Smart: project_story_spines, project_thread_ledgers, scene_role_taxonomy + scene_graph_versions columns

-- 1.1) project_story_spines
CREATE TABLE IF NOT EXISTS public.project_story_spines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid NULL,
  status text NOT NULL DEFAULT 'draft',
  source text NOT NULL DEFAULT 'scene_graph',
  spine jsonb NOT NULL DEFAULT '{}'::jsonb,
  summary text NULL,
  version int NOT NULL DEFAULT 1,
  UNIQUE(project_id, version)
);
CREATE INDEX IF NOT EXISTS idx_story_spines_project ON public.project_story_spines(project_id, created_at DESC);

ALTER TABLE public.project_story_spines ENABLE ROW LEVEL SECURITY;
CREATE POLICY "story_spines_select" ON public.project_story_spines FOR SELECT USING (public.has_project_access(auth.uid(), project_id));
CREATE POLICY "story_spines_insert" ON public.project_story_spines FOR INSERT WITH CHECK (public.has_project_access(auth.uid(), project_id));
CREATE POLICY "story_spines_update" ON public.project_story_spines FOR UPDATE USING (public.has_project_access(auth.uid(), project_id));
CREATE POLICY "story_spines_delete" ON public.project_story_spines FOR DELETE USING (public.has_project_access(auth.uid(), project_id));

-- 1.2) project_thread_ledgers
CREATE TABLE IF NOT EXISTS public.project_thread_ledgers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid NULL,
  status text NOT NULL DEFAULT 'draft',
  ledger jsonb NOT NULL DEFAULT '{}'::jsonb,
  summary text NULL,
  version int NOT NULL DEFAULT 1,
  UNIQUE(project_id, version)
);
CREATE INDEX IF NOT EXISTS idx_thread_ledgers_project ON public.project_thread_ledgers(project_id, created_at DESC);

ALTER TABLE public.project_thread_ledgers ENABLE ROW LEVEL SECURITY;
CREATE POLICY "thread_ledgers_select" ON public.project_thread_ledgers FOR SELECT USING (public.has_project_access(auth.uid(), project_id));
CREATE POLICY "thread_ledgers_insert" ON public.project_thread_ledgers FOR INSERT WITH CHECK (public.has_project_access(auth.uid(), project_id));
CREATE POLICY "thread_ledgers_update" ON public.project_thread_ledgers FOR UPDATE USING (public.has_project_access(auth.uid(), project_id));
CREATE POLICY "thread_ledgers_delete" ON public.project_thread_ledgers FOR DELETE USING (public.has_project_access(auth.uid(), project_id));

-- 1.3) Add columns to scene_graph_versions (if not present)
DO $$ BEGIN
  ALTER TABLE public.scene_graph_versions ADD COLUMN scene_roles jsonb NOT NULL DEFAULT '[]'::jsonb;
EXCEPTION WHEN duplicate_column THEN NULL;
END $$;
DO $$ BEGIN
  ALTER TABLE public.scene_graph_versions ADD COLUMN thread_links jsonb NOT NULL DEFAULT '[]'::jsonb;
EXCEPTION WHEN duplicate_column THEN NULL;
END $$;
DO $$ BEGIN
  ALTER TABLE public.scene_graph_versions ADD COLUMN tension_delta int NULL;
EXCEPTION WHEN duplicate_column THEN NULL;
END $$;
DO $$ BEGIN
  ALTER TABLE public.scene_graph_versions ADD COLUMN pacing_seconds int NULL;
EXCEPTION WHEN duplicate_column THEN NULL;
END $$;

-- 1.4) scene_role_taxonomy (seed)
CREATE TABLE IF NOT EXISTS public.scene_role_taxonomy (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  role_key text UNIQUE NOT NULL,
  label text NOT NULL,
  description text NOT NULL
);

INSERT INTO public.scene_role_taxonomy (role_key, label, description) VALUES
  ('setup', 'Setup', 'Establishes characters, world, or story questions'),
  ('escalation', 'Escalation', 'Raises stakes, tension, or conflict'),
  ('reversal', 'Reversal', 'Unexpected shift in direction or power dynamics'),
  ('reveal', 'Reveal', 'New information changes understanding'),
  ('payoff', 'Payoff', 'Delivers on a prior setup or promise'),
  ('breather', 'Breather', 'Emotional cooldown or character moment'),
  ('transition', 'Transition', 'Bridges two major story segments'),
  ('climax', 'Climax', 'Peak dramatic intensity'),
  ('denouement', 'Denouement', 'Resolution and aftermath')
ON CONFLICT (role_key) DO NOTHING;

ALTER TABLE public.scene_role_taxonomy ENABLE ROW LEVEL SECURITY;
CREATE POLICY "scene_role_taxonomy_select" ON public.scene_role_taxonomy FOR SELECT USING (true);
