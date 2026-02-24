
-- Create trailer_clip_scores table for technical quality judging
CREATE TABLE IF NOT EXISTS public.trailer_clip_scores (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  clip_id uuid NOT NULL,
  blueprint_id uuid NOT NULL,
  beat_index integer NOT NULL,
  
  -- Technical scores (0.0 - 1.0)
  technical_motion_score numeric,
  technical_clarity_score numeric,
  artifact_penalty numeric,
  style_cohesion_score numeric,
  technical_overall numeric,
  technical_flags jsonb NOT NULL DEFAULT '[]'::jsonb,
  
  -- Creative scores (future use)
  creative_score numeric,
  creative_flags jsonb,
  
  -- Metadata
  judge_model text,
  raw_response jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid NOT NULL DEFAULT auth.uid()
);

-- Unique constraint: one score per clip
CREATE UNIQUE INDEX IF NOT EXISTS trailer_clip_scores_clip_id_idx ON public.trailer_clip_scores(clip_id);
CREATE INDEX IF NOT EXISTS trailer_clip_scores_project_beat_idx ON public.trailer_clip_scores(project_id, blueprint_id, beat_index);

-- RLS
ALTER TABLE public.trailer_clip_scores ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view clip scores for accessible projects"
  ON public.trailer_clip_scores FOR SELECT
  USING (public.has_project_access(auth.uid(), project_id));

CREATE POLICY "Users can insert clip scores for accessible projects"
  ON public.trailer_clip_scores FOR INSERT
  WITH CHECK (public.has_project_access(auth.uid(), project_id));

CREATE POLICY "Users can update clip scores for accessible projects"
  ON public.trailer_clip_scores FOR UPDATE
  USING (public.has_project_access(auth.uid(), project_id));
