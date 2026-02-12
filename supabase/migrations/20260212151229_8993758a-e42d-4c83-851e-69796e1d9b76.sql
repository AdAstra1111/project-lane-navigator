
-- Phase 1: Extend corpus_scripts with analysis columns
ALTER TABLE public.corpus_scripts
  ADD COLUMN IF NOT EXISTS title text,
  ADD COLUMN IF NOT EXISTS production_type text,
  ADD COLUMN IF NOT EXISTS format_subtype text,
  ADD COLUMN IF NOT EXISTS genre text,
  ADD COLUMN IF NOT EXISTS subgenre text,
  ADD COLUMN IF NOT EXISTS page_count integer,
  ADD COLUMN IF NOT EXISTS runtime_est numeric,
  ADD COLUMN IF NOT EXISTS scene_count integer,
  ADD COLUMN IF NOT EXISTS word_count integer,
  ADD COLUMN IF NOT EXISTS avg_scene_length numeric,
  ADD COLUMN IF NOT EXISTS avg_dialogue_ratio numeric,
  ADD COLUMN IF NOT EXISTS cast_count integer,
  ADD COLUMN IF NOT EXISTS location_count integer,
  ADD COLUMN IF NOT EXISTS int_ext_ratio numeric,
  ADD COLUMN IF NOT EXISTS day_night_ratio numeric,
  ADD COLUMN IF NOT EXISTS vfx_flag boolean DEFAULT false,
  ADD COLUMN IF NOT EXISTS budget_tier_est text,
  ADD COLUMN IF NOT EXISTS quality_score_est numeric,
  ADD COLUMN IF NOT EXISTS market_success_flag boolean DEFAULT false,
  ADD COLUMN IF NOT EXISTS midpoint_position numeric,
  ADD COLUMN IF NOT EXISTS climax_position numeric,
  ADD COLUMN IF NOT EXISTS analysis_status text DEFAULT 'pending';

-- New table: corpus_scene_patterns
CREATE TABLE IF NOT EXISTS public.corpus_scene_patterns (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  corpus_script_id uuid NOT NULL REFERENCES public.corpus_scripts(id) ON DELETE CASCADE,
  user_id uuid NOT NULL,
  scene_number integer,
  act_estimate integer,
  has_turn boolean DEFAULT false,
  conflict_type text,
  scene_length_est numeric,
  created_at timestamptz DEFAULT now()
);

ALTER TABLE public.corpus_scene_patterns ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own scene patterns"
  ON public.corpus_scene_patterns FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own scene patterns"
  ON public.corpus_scene_patterns FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can delete own scene patterns"
  ON public.corpus_scene_patterns FOR DELETE
  USING (auth.uid() = user_id);

-- New table: corpus_character_profiles
CREATE TABLE IF NOT EXISTS public.corpus_character_profiles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  corpus_script_id uuid NOT NULL REFERENCES public.corpus_scripts(id) ON DELETE CASCADE,
  user_id uuid NOT NULL,
  character_name text,
  dialogue_ratio numeric,
  arc_type text,
  protagonist_flag boolean DEFAULT false,
  created_at timestamptz DEFAULT now()
);

ALTER TABLE public.corpus_character_profiles ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own character profiles"
  ON public.corpus_character_profiles FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own character profiles"
  ON public.corpus_character_profiles FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can delete own character profiles"
  ON public.corpus_character_profiles FOR DELETE
  USING (auth.uid() = user_id);

-- New table: corpus_insights (shared calibration data)
CREATE TABLE IF NOT EXISTS public.corpus_insights (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  insight_type text NOT NULL,
  production_type text,
  lane text,
  pattern jsonb DEFAULT '{}'::jsonb,
  weight numeric DEFAULT 1.0,
  created_at timestamptz DEFAULT now()
);

ALTER TABLE public.corpus_insights ENABLE ROW LEVEL SECURITY;

-- All authenticated users can read insights (shared calibration)
CREATE POLICY "Authenticated users can read insights"
  ON public.corpus_insights FOR SELECT
  USING (auth.uid() IS NOT NULL);

CREATE POLICY "Users can insert own insights"
  ON public.corpus_insights FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own insights"
  ON public.corpus_insights FOR UPDATE
  USING (auth.uid() = user_id);

CREATE POLICY "Users can delete own insights"
  ON public.corpus_insights FOR DELETE
  USING (auth.uid() = user_id);
