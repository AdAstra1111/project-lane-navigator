
-- Convergence score history for trajectory tracking
CREATE TABLE public.convergence_scores (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  project_id UUID NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  user_id UUID NOT NULL,
  creative_integrity_score INTEGER NOT NULL DEFAULT 0,
  greenlight_probability INTEGER NOT NULL DEFAULT 0,
  gap INTEGER NOT NULL DEFAULT 0,
  allowed_gap INTEGER NOT NULL DEFAULT 25,
  convergence_status TEXT NOT NULL DEFAULT 'Healthy Divergence',
  trajectory TEXT,
  strategic_priority TEXT NOT NULL DEFAULT 'BALANCED',
  development_stage TEXT NOT NULL DEFAULT 'IDEA',
  analysis_mode TEXT NOT NULL DEFAULT 'DUAL',
  executive_snapshot TEXT,
  primary_creative_risk TEXT,
  primary_commercial_risk TEXT,
  leverage_moves JSONB DEFAULT '[]'::jsonb,
  format_advisory JSONB,
  executive_guidance TEXT,
  full_result JSONB,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.convergence_scores ENABLE ROW LEVEL SECURITY;

-- RLS policies
CREATE POLICY "Users can view own convergence scores"
ON public.convergence_scores FOR SELECT
USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own convergence scores"
ON public.convergence_scores FOR INSERT
WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can delete own convergence scores"
ON public.convergence_scores FOR DELETE
USING (auth.uid() = user_id);

-- Index for fast project lookups
CREATE INDEX idx_convergence_scores_project ON public.convergence_scores(project_id, created_at DESC);
