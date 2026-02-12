
-- Concept Expansions: stores expansion engine outputs per pitch idea
CREATE TABLE public.concept_expansions (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  pitch_idea_id UUID NOT NULL REFERENCES public.pitch_ideas(id) ON DELETE CASCADE,
  user_id UUID NOT NULL,
  version INTEGER NOT NULL DEFAULT 1,
  production_type TEXT NOT NULL DEFAULT '',
  treatment TEXT NOT NULL DEFAULT '',
  character_bible TEXT NOT NULL DEFAULT '',
  world_bible TEXT NOT NULL DEFAULT '',
  tone_doc TEXT NOT NULL DEFAULT '',
  arc_map TEXT NOT NULL DEFAULT '',
  raw_response JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Concept Stress Tests: scores per expansion
CREATE TABLE public.concept_stress_tests (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  expansion_id UUID NOT NULL REFERENCES public.concept_expansions(id) ON DELETE CASCADE,
  user_id UUID NOT NULL,
  score_creative_structure NUMERIC NOT NULL DEFAULT 0,
  score_market_alignment NUMERIC NOT NULL DEFAULT 0,
  score_engine_sustainability NUMERIC NOT NULL DEFAULT 0,
  score_total NUMERIC NOT NULL DEFAULT 0,
  passed BOOLEAN NOT NULL DEFAULT false,
  details JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Concept Lock Versions: frozen snapshots of locked concepts
CREATE TABLE public.concept_lock_versions (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  pitch_idea_id UUID NOT NULL REFERENCES public.pitch_ideas(id) ON DELETE CASCADE,
  user_id UUID NOT NULL,
  version INTEGER NOT NULL DEFAULT 1,
  locked_fields JSONB NOT NULL DEFAULT '{}',
  stress_test_id UUID REFERENCES public.concept_stress_tests(id),
  expansion_id UUID REFERENCES public.concept_expansions(id),
  locked_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  unlocked_at TIMESTAMPTZ,
  unlock_reason TEXT
);

-- Add concept_lock_status to pitch_ideas
ALTER TABLE public.pitch_ideas 
  ADD COLUMN IF NOT EXISTS concept_lock_status TEXT NOT NULL DEFAULT 'unlocked',
  ADD COLUMN IF NOT EXISTS concept_lock_version INTEGER NOT NULL DEFAULT 0;

-- Enable RLS
ALTER TABLE public.concept_expansions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.concept_stress_tests ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.concept_lock_versions ENABLE ROW LEVEL SECURITY;

-- RLS policies for concept_expansions
CREATE POLICY "Users can view own expansions" ON public.concept_expansions FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users can create own expansions" ON public.concept_expansions FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can update own expansions" ON public.concept_expansions FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "Users can delete own expansions" ON public.concept_expansions FOR DELETE USING (auth.uid() = user_id);

-- RLS policies for concept_stress_tests
CREATE POLICY "Users can view own stress tests" ON public.concept_stress_tests FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users can create own stress tests" ON public.concept_stress_tests FOR INSERT WITH CHECK (auth.uid() = user_id);

-- RLS policies for concept_lock_versions
CREATE POLICY "Users can view own lock versions" ON public.concept_lock_versions FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users can create own lock versions" ON public.concept_lock_versions FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can update own lock versions" ON public.concept_lock_versions FOR UPDATE USING (auth.uid() = user_id);

-- Triggers for updated_at
CREATE TRIGGER update_concept_expansions_updated_at BEFORE UPDATE ON public.concept_expansions
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
