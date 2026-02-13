
-- Development Engine sessions
CREATE TABLE public.dev_engine_sessions (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL,
  project_id UUID REFERENCES public.projects(id) ON DELETE SET NULL,
  title TEXT NOT NULL DEFAULT 'Untitled Session',
  input_text TEXT NOT NULL DEFAULT '',
  input_type TEXT NOT NULL DEFAULT 'concept',
  format TEXT,
  genres TEXT[],
  lane TEXT,
  budget TEXT,
  status TEXT NOT NULL DEFAULT 'active',
  current_iteration INTEGER NOT NULL DEFAULT 0,
  latest_ci NUMERIC,
  latest_gp NUMERIC,
  latest_gap NUMERIC,
  convergence_status TEXT,
  trajectory TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Development Engine iterations (each loop pass)
CREATE TABLE public.dev_engine_iterations (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  session_id UUID NOT NULL REFERENCES public.dev_engine_sessions(id) ON DELETE CASCADE,
  user_id UUID NOT NULL,
  iteration_number INTEGER NOT NULL DEFAULT 1,
  phase TEXT NOT NULL DEFAULT 'review',
  
  -- Phase 1: Review
  ci_score NUMERIC,
  gp_score NUMERIC,
  gap NUMERIC,
  convergence_status TEXT,
  primary_creative_risk TEXT,
  primary_commercial_risk TEXT,
  protect_items JSONB DEFAULT '[]'::jsonb,
  strengthen_items JSONB DEFAULT '[]'::jsonb,
  clarify_items JSONB DEFAULT '[]'::jsonb,
  elevate_items JSONB DEFAULT '[]'::jsonb,
  remove_items JSONB DEFAULT '[]'::jsonb,
  
  -- Phase 2: Strategic Notes
  structural_adjustments JSONB DEFAULT '[]'::jsonb,
  character_enhancements JSONB DEFAULT '[]'::jsonb,
  escalation_improvements JSONB DEFAULT '[]'::jsonb,
  lane_clarity_moves JSONB DEFAULT '[]'::jsonb,
  packaging_magnetism_moves JSONB DEFAULT '[]'::jsonb,
  risk_mitigation_fixes JSONB DEFAULT '[]'::jsonb,
  
  -- Phase 3: Rewrite
  rewritten_text TEXT,
  changes_summary TEXT,
  creative_preserved TEXT,
  commercial_improvements TEXT,
  
  -- Phase 4: Reassess
  reassess_ci NUMERIC,
  reassess_gp NUMERIC,
  reassess_gap NUMERIC,
  reassess_convergence TEXT,
  delta_ci NUMERIC,
  delta_gp NUMERIC,
  delta_gap NUMERIC,
  trajectory TEXT,
  
  -- Meta
  approved_notes JSONB DEFAULT '[]'::jsonb,
  user_decision TEXT,
  raw_ai_response JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.dev_engine_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.dev_engine_iterations ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users manage own sessions" ON public.dev_engine_sessions FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users manage own iterations" ON public.dev_engine_iterations FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

CREATE TRIGGER update_dev_engine_sessions_updated_at BEFORE UPDATE ON public.dev_engine_sessions FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
