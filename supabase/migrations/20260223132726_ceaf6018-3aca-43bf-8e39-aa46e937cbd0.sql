
-- AI Production Layer: extend scene_shots with AI readiness columns
ALTER TABLE public.scene_shots
  ADD COLUMN IF NOT EXISTS ai_candidate boolean DEFAULT false,
  ADD COLUMN IF NOT EXISTS ai_readiness_tier text,
  ADD COLUMN IF NOT EXISTS ai_max_quality text,
  ADD COLUMN IF NOT EXISTS ai_confidence integer,
  ADD COLUMN IF NOT EXISTS ai_blocking_constraints text[],
  ADD COLUMN IF NOT EXISTS ai_required_assets text[],
  ADD COLUMN IF NOT EXISTS ai_model_route text,
  ADD COLUMN IF NOT EXISTS ai_legal_risk_flags text[],
  ADD COLUMN IF NOT EXISTS ai_estimated_cost_band text,
  ADD COLUMN IF NOT EXISTS ai_analysis_json jsonb,
  ADD COLUMN IF NOT EXISTS ai_last_labeled_at timestamptz,
  ADD COLUMN IF NOT EXISTS ai_last_labeled_by uuid;

-- Add AI production mode to projects
ALTER TABLE public.projects
  ADD COLUMN IF NOT EXISTS ai_production_mode boolean NOT NULL DEFAULT false;

-- Trailer moments table
CREATE TABLE IF NOT EXISTS public.trailer_moments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  source_document_id uuid NULL,
  source_version_id uuid NULL,
  scene_number integer NULL,
  moment_summary text NOT NULL,
  hook_strength integer NOT NULL DEFAULT 0,
  spectacle_score integer NOT NULL DEFAULT 0,
  emotional_score integer NOT NULL DEFAULT 0,
  ai_friendly boolean NOT NULL DEFAULT false,
  suggested_visual_approach text NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS trailer_moments_project_idx
  ON public.trailer_moments(project_id, created_at DESC);

ALTER TABLE public.trailer_moments ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can manage trailer moments" ON public.trailer_moments
  FOR ALL USING (public.has_project_access(auth.uid(), project_id));

-- AI generated media table
CREATE TABLE IF NOT EXISTS public.ai_generated_media (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  shot_id uuid NULL REFERENCES public.scene_shots(id) ON DELETE CASCADE,
  media_type text NOT NULL,
  storage_path text NOT NULL,
  generation_params jsonb NOT NULL DEFAULT '{}'::jsonb,
  selected boolean NOT NULL DEFAULT false,
  created_by uuid NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS ai_generated_media_project_idx
  ON public.ai_generated_media(project_id, created_at DESC);
CREATE INDEX IF NOT EXISTS ai_generated_media_shot_idx
  ON public.ai_generated_media(shot_id, created_at DESC);

ALTER TABLE public.ai_generated_media ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can manage ai generated media" ON public.ai_generated_media
  FOR ALL USING (public.has_project_access(auth.uid(), project_id));

-- Trailer shotlists table
CREATE TABLE IF NOT EXISTS public.trailer_shotlists (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  items jsonb NOT NULL DEFAULT '[]'::jsonb,
  source_moment_ids uuid[] NOT NULL DEFAULT '{}',
  status text NOT NULL DEFAULT 'draft',
  created_by uuid NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.trailer_shotlists ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can manage trailer shotlists" ON public.trailer_shotlists
  FOR ALL USING (public.has_project_access(auth.uid(), project_id));

-- Storage bucket for AI media
INSERT INTO storage.buckets (id, name, public)
VALUES ('ai-media', 'ai-media', true)
ON CONFLICT (id) DO NOTHING;

CREATE POLICY "Project members can upload ai media" ON storage.objects
  FOR INSERT WITH CHECK (bucket_id = 'ai-media' AND auth.uid() IS NOT NULL);

CREATE POLICY "Project members can read ai media" ON storage.objects
  FOR SELECT USING (bucket_id = 'ai-media');

CREATE POLICY "Project members can update ai media" ON storage.objects
  FOR UPDATE USING (bucket_id = 'ai-media' AND auth.uid() IS NOT NULL);

CREATE POLICY "Project members can delete ai media" ON storage.objects
  FOR DELETE USING (bucket_id = 'ai-media' AND auth.uid() IS NOT NULL);
