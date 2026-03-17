
-- CI Blueprint Engine schema

-- Blueprint runs: each invocation of the engine
CREATE TABLE public.idea_blueprint_runs (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  config JSONB NOT NULL DEFAULT '{}',
  exemplar_ids UUID[] DEFAULT '{}',
  trend_signal_ids UUID[] DEFAULT '{}',
  source_idea_ids UUID[] DEFAULT '{}',
  blueprint_count INTEGER NOT NULL DEFAULT 0,
  candidate_count INTEGER NOT NULL DEFAULT 0,
  error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Blueprints: structural patterns derived from high-CI ideas
CREATE TABLE public.idea_blueprints (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  run_id UUID NOT NULL REFERENCES public.idea_blueprint_runs(id) ON DELETE CASCADE,
  user_id UUID NOT NULL,
  format TEXT NOT NULL DEFAULT '',
  lane TEXT NOT NULL DEFAULT '',
  genre TEXT NOT NULL DEFAULT '',
  engine TEXT,
  budget_band TEXT NOT NULL DEFAULT '',
  structural_patterns JSONB NOT NULL DEFAULT '{}',
  market_design JSONB NOT NULL DEFAULT '{}',
  protagonist_archetype TEXT,
  conflict_engine TEXT,
  novelty_constraints JSONB NOT NULL DEFAULT '[]',
  feasibility_constraints JSONB NOT NULL DEFAULT '[]',
  derived_from_idea_ids UUID[] DEFAULT '{}',
  trend_inputs JSONB DEFAULT '[]',
  exemplar_inputs JSONB DEFAULT '[]',
  score_pattern JSONB DEFAULT '{}',
  status TEXT NOT NULL DEFAULT 'active',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Candidates: generated pitch ideas from blueprints
CREATE TABLE public.idea_blueprint_candidates (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  blueprint_id UUID NOT NULL REFERENCES public.idea_blueprints(id) ON DELETE CASCADE,
  run_id UUID NOT NULL REFERENCES public.idea_blueprint_runs(id) ON DELETE CASCADE,
  user_id UUID NOT NULL,
  pitch_idea_id UUID REFERENCES public.pitch_ideas(id) ON DELETE SET NULL,
  title TEXT NOT NULL DEFAULT '',
  logline TEXT NOT NULL DEFAULT '',
  one_page_pitch TEXT NOT NULL DEFAULT '',
  genre TEXT NOT NULL DEFAULT '',
  format TEXT NOT NULL DEFAULT '',
  lane TEXT NOT NULL DEFAULT '',
  engine TEXT,
  budget_band TEXT NOT NULL DEFAULT '',
  score_market_heat NUMERIC NOT NULL DEFAULT 0,
  score_feasibility NUMERIC NOT NULL DEFAULT 0,
  score_lane_fit NUMERIC NOT NULL DEFAULT 0,
  score_saturation_risk NUMERIC NOT NULL DEFAULT 0,
  score_company_fit NUMERIC NOT NULL DEFAULT 0,
  score_total NUMERIC NOT NULL DEFAULT 0,
  raw_response JSONB DEFAULT '{}',
  promotion_status TEXT NOT NULL DEFAULT 'none',
  promotion_source TEXT,
  promoted_at TIMESTAMPTZ,
  promoted_pitch_idea_id UUID,
  provenance JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.idea_blueprint_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.idea_blueprints ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.idea_blueprint_candidates ENABLE ROW LEVEL SECURITY;

-- RLS policies
CREATE POLICY "Users see own blueprint runs" ON public.idea_blueprint_runs FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users create own blueprint runs" ON public.idea_blueprint_runs FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users update own blueprint runs" ON public.idea_blueprint_runs FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "Users delete own blueprint runs" ON public.idea_blueprint_runs FOR DELETE USING (auth.uid() = user_id);

CREATE POLICY "Users see own blueprints" ON public.idea_blueprints FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users create own blueprints" ON public.idea_blueprints FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users update own blueprints" ON public.idea_blueprints FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "Users delete own blueprints" ON public.idea_blueprints FOR DELETE USING (auth.uid() = user_id);

CREATE POLICY "Users see own candidates" ON public.idea_blueprint_candidates FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users create own candidates" ON public.idea_blueprint_candidates FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users update own candidates" ON public.idea_blueprint_candidates FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "Users delete own candidates" ON public.idea_blueprint_candidates FOR DELETE USING (auth.uid() = user_id);

-- Triggers for updated_at
CREATE TRIGGER set_updated_at_blueprint_runs BEFORE UPDATE ON public.idea_blueprint_runs FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER set_updated_at_blueprints BEFORE UPDATE ON public.idea_blueprints FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER set_updated_at_candidates BEFORE UPDATE ON public.idea_blueprint_candidates FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
