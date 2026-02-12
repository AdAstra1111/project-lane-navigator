
-- User preferences (global learning)
CREATE TABLE IF NOT EXISTS public.user_preferences (
  owner_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  prefs jsonb NOT NULL DEFAULT '{}'::jsonb,
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.user_preferences ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users manage own preferences"
  ON public.user_preferences FOR ALL
  USING (auth.uid() = owner_id)
  WITH CHECK (auth.uid() = owner_id);

-- Project-specific preferences
CREATE TABLE IF NOT EXISTS public.project_preferences (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id uuid NOT NULL,
  project_id uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  prefs jsonb NOT NULL DEFAULT '{}'::jsonb,
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(owner_id, project_id)
);

ALTER TABLE public.project_preferences ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users manage own project preferences"
  ON public.project_preferences FOR ALL
  USING (auth.uid() = owner_id)
  WITH CHECK (auth.uid() = owner_id);

-- Outcome signals
CREATE TABLE IF NOT EXISTS public.outcome_signals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id uuid NOT NULL,
  project_id uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  script_version_id uuid REFERENCES public.script_versions(id) ON DELETE SET NULL,
  signal_type text NOT NULL DEFAULT 'USER_RATING',
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.outcome_signals ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users manage own outcome signals"
  ON public.outcome_signals FOR ALL
  USING (auth.uid() = owner_id)
  WITH CHECK (auth.uid() = owner_id);

-- Rewrite playbooks
CREATE TABLE IF NOT EXISTS public.rewrite_playbooks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  production_type text NOT NULL DEFAULT 'film',
  lane text NOT NULL DEFAULT '',
  description text NOT NULL DEFAULT '',
  triggers jsonb NOT NULL DEFAULT '{}'::jsonb,
  operations jsonb NOT NULL DEFAULT '[]'::jsonb,
  expected_impacts jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.rewrite_playbooks ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Playbooks readable by authenticated users"
  ON public.rewrite_playbooks FOR SELECT
  USING (auth.role() = 'authenticated');

-- Improvement runs audit log
CREATE TABLE IF NOT EXISTS public.improvement_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id uuid NOT NULL,
  project_id uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  script_id uuid NOT NULL,
  before_version_id uuid REFERENCES public.script_versions(id) ON DELETE SET NULL,
  after_version_id uuid REFERENCES public.script_versions(id) ON DELETE SET NULL,
  goal text NOT NULL DEFAULT '',
  intensity text NOT NULL DEFAULT 'balanced',
  playbooks_used jsonb NOT NULL DEFAULT '[]'::jsonb,
  before_scores jsonb NOT NULL DEFAULT '{}'::jsonb,
  after_scores jsonb NOT NULL DEFAULT '{}'::jsonb,
  score_deltas jsonb NOT NULL DEFAULT '{}'::jsonb,
  regression_detected boolean NOT NULL DEFAULT false,
  rolled_back boolean NOT NULL DEFAULT false,
  changes_summary text NOT NULL DEFAULT '',
  scene_ops jsonb NOT NULL DEFAULT '[]'::jsonb,
  status text NOT NULL DEFAULT 'running',
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.improvement_runs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users manage own improvement runs"
  ON public.improvement_runs FOR ALL
  USING (auth.uid() = owner_id)
  WITH CHECK (auth.uid() = owner_id);

-- Seed default playbooks
INSERT INTO public.rewrite_playbooks (name, production_type, lane, description, triggers, operations, expected_impacts) VALUES
('Tighten Act 2 Sag', 'film', '', 'Reduce mid-script pacing issues by cutting/merging redundant scenes in Act 2', '{"pacing_score_below": 6}', '["CUT low-stakes scenes in pages 40-80", "MERGE consecutive dialogue-only scenes", "ADD tension escalator at midpoint"]', '{"pacing_score": "+1.0", "economy_score": "+0.5"}'),
('Boost Protagonist Agency', 'film', '', 'Increase protagonist decision-making moments', '{"structural_score_below": 6}', '["ADD decision points at act breaks", "REWRITE passive reactions as active choices", "CUT scenes where protagonist is absent from main plot"]', '{"structural_score": "+0.8", "dialogue_score": "+0.3"}'),
('Reduce On-The-Nose Dialogue', 'film', '', 'Replace explicit dialogue with subtext and visual storytelling', '{"dialogue_score_below": 6}', '["REWRITE exposition dumps as conflict scenes", "ADD visual reveals replacing dialogue", "CUT redundant character explanations"]', '{"dialogue_score": "+1.2", "economy_score": "+0.4"}'),
('Increase Hook Intensity', 'film', '', 'Strengthen first 10 pages with stronger inciting incident', '{"structural_score_below": 7}', '["MOVE inciting incident earlier", "ADD cold open with conflict", "CUT slow setup exposition"]', '{"structural_score": "+0.7", "pacing_score": "+0.5"}'),
('Lower Budget Footprint', 'film', '', 'Reduce production cost signals without losing narrative scale', '{"budget_score_below": 5}', '["MERGE multiple locations into fewer", "CUT crowd scenes", "REWRITE exterior action as interior tension", "REDUCE night shoots"]', '{"budget_score": "+1.5", "economy_score": "+0.3"}'),
('Strengthen Pilot Engine', 'tv', '', 'Ensure series engine is clear and repeatable from pilot', '{"structural_score_below": 6}', '["ADD clear engine demonstration scene", "REWRITE climax to reset status quo", "ADD B-story that models weekly pattern"]', '{"structural_score": "+1.0", "lane_alignment_score": "+0.5"}'),
('Increase Cliff Density', 'vertical_drama', '', 'Add more cliffhangers for vertical drama retention', '{"pacing_score_below": 6}', '["ADD mini-cliff every 8-12 scenes", "REWRITE scene endings as questions", "CUT resolution before next episode hook"]', '{"pacing_score": "+1.5", "lane_alignment_score": "+0.8"}'),
('Sharpen Dialogue Voice', 'film', '', 'Make each character voice distinctive and memorable', '{"dialogue_score_below": 5}', '["REWRITE dialogue to match character backstory", "ADD verbal tics/patterns per character", "CUT generic lines"]', '{"dialogue_score": "+1.5"}'),
('Make It More Commercial', 'film', '', 'Increase marketability while preserving artistic intent', '{"lane_alignment_score_below": 6}', '["ADD clear genre hooks", "REWRITE logline-relevant scenes for clarity", "ADD satisfying resolution beats"]', '{"lane_alignment_score": "+1.0", "structural_score": "+0.3"}');
