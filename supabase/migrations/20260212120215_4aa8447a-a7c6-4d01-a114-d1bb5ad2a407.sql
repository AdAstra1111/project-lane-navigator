
-- Pitch Ideas table
CREATE TABLE public.pitch_ideas (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL,
  project_id UUID REFERENCES public.projects(id) ON DELETE SET NULL,
  mode TEXT NOT NULL DEFAULT 'greenlight' CHECK (mode IN ('greenlight', 'coverage-transform')),
  production_type TEXT NOT NULL DEFAULT 'film',
  title TEXT NOT NULL DEFAULT '',
  logline TEXT NOT NULL DEFAULT '',
  one_page_pitch TEXT NOT NULL DEFAULT '',
  comps TEXT[] NOT NULL DEFAULT '{}',
  recommended_lane TEXT NOT NULL DEFAULT '',
  lane_confidence NUMERIC NOT NULL DEFAULT 0,
  budget_band TEXT NOT NULL DEFAULT '',
  packaging_suggestions JSONB NOT NULL DEFAULT '[]',
  development_sprint JSONB NOT NULL DEFAULT '[]',
  risks_mitigations JSONB NOT NULL DEFAULT '[]',
  why_us TEXT NOT NULL DEFAULT '',
  genre TEXT NOT NULL DEFAULT '',
  region TEXT NOT NULL DEFAULT '',
  platform_target TEXT NOT NULL DEFAULT '',
  risk_level TEXT NOT NULL DEFAULT 'medium',
  source_coverage_run_id UUID REFERENCES public.coverage_runs(id) ON DELETE SET NULL,
  raw_response JSONB,
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'shortlisted', 'in-development', 'archived')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.pitch_ideas ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own pitch ideas" ON public.pitch_ideas FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users can create own pitch ideas" ON public.pitch_ideas FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can update own pitch ideas" ON public.pitch_ideas FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "Users can delete own pitch ideas" ON public.pitch_ideas FOR DELETE USING (auth.uid() = user_id);

CREATE TRIGGER update_pitch_ideas_updated_at BEFORE UPDATE ON public.pitch_ideas
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Pitch Feedback table
CREATE TABLE public.pitch_feedback (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  pitch_idea_id UUID NOT NULL REFERENCES public.pitch_ideas(id) ON DELETE CASCADE,
  user_id UUID NOT NULL,
  rating TEXT NOT NULL CHECK (rating IN ('strong', 'meh', 'no')),
  direction TEXT CHECK (direction IN ('more', 'less')),
  tags TEXT[] NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.pitch_feedback ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own pitch feedback" ON public.pitch_feedback FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users can create own pitch feedback" ON public.pitch_feedback FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can update own pitch feedback" ON public.pitch_feedback FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "Users can delete own pitch feedback" ON public.pitch_feedback FOR DELETE USING (auth.uid() = user_id);
