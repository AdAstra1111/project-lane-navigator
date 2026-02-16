
-- Canon Snapshots: stores locked canon state for series writer stage
CREATE TABLE public.canon_snapshots (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  project_id UUID NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  user_id UUID NOT NULL,
  blueprint_version_id UUID,
  character_bible_version_id UUID,
  episode_grid_version_id UUID,
  episode_1_version_id UUID,
  season_episode_count INTEGER NOT NULL,
  snapshot_data JSONB DEFAULT '{}'::jsonb,
  status TEXT NOT NULL DEFAULT 'active',
  invalidated_at TIMESTAMPTZ,
  invalidation_reason TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Only one active snapshot per project
CREATE UNIQUE INDEX idx_canon_snapshots_active ON public.canon_snapshots(project_id) WHERE status = 'active';

-- Enable RLS
ALTER TABLE public.canon_snapshots ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own canon snapshots"
  ON public.canon_snapshots FOR SELECT
  USING (auth.uid() = user_id OR has_project_access(auth.uid(), project_id));

CREATE POLICY "Users can create own canon snapshots"
  ON public.canon_snapshots FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own canon snapshots"
  ON public.canon_snapshots FOR UPDATE
  USING (auth.uid() = user_id);

CREATE POLICY "Users can delete own canon snapshots"
  ON public.canon_snapshots FOR DELETE
  USING (auth.uid() = user_id);

-- Series episode validation results
CREATE TABLE public.episode_validations (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  project_id UUID NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  episode_id UUID NOT NULL REFERENCES public.series_episodes(id) ON DELETE CASCADE,
  canon_snapshot_id UUID REFERENCES public.canon_snapshots(id) ON DELETE SET NULL,
  user_id UUID NOT NULL,
  character_consistency_score NUMERIC(4,2) DEFAULT 0,
  relationship_continuity_score NUMERIC(4,2) DEFAULT 0,
  location_limit_score NUMERIC(4,2) DEFAULT 0,
  season_arc_alignment_score NUMERIC(4,2) DEFAULT 0,
  emotional_escalation_score NUMERIC(4,2) DEFAULT 0,
  overall_score NUMERIC(4,2) DEFAULT 0,
  passed BOOLEAN DEFAULT false,
  issues JSONB DEFAULT '[]'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.episode_validations ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own episode validations"
  ON public.episode_validations FOR SELECT
  USING (auth.uid() = user_id OR has_project_access(auth.uid(), project_id));

CREATE POLICY "Users can create own episode validations"
  ON public.episode_validations FOR INSERT
  WITH CHECK (auth.uid() = user_id);

-- Add canon_snapshot_id to series_episodes for tracking
ALTER TABLE public.series_episodes 
  ADD COLUMN IF NOT EXISTS canon_snapshot_id UUID REFERENCES public.canon_snapshots(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS validation_status TEXT DEFAULT 'pending',
  ADD COLUMN IF NOT EXISTS validation_score NUMERIC(4,2);

-- Add pipeline_stage value for series_writer (extend projects if needed)
-- The pipeline_stage column already exists as text, so we just use 'series_writer' value

-- Updated at trigger for canon_snapshots
CREATE TRIGGER update_canon_snapshots_updated_at
  BEFORE UPDATE ON public.canon_snapshots
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();
