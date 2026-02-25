
-- 1. comparable_candidates
CREATE TABLE public.comparable_candidates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  lane text NOT NULL,
  query jsonb NOT NULL DEFAULT '{}',
  title text NOT NULL,
  year int NULL,
  format text NOT NULL DEFAULT 'film',
  region text NULL,
  genres jsonb NOT NULL DEFAULT '[]',
  rationale text NOT NULL DEFAULT '',
  confidence numeric NOT NULL DEFAULT 0,
  source_urls jsonb NOT NULL DEFAULT '[]',
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid NOT NULL
);
CREATE INDEX idx_comp_candidates_project_lane ON public.comparable_candidates(project_id, lane, created_at DESC);
CREATE INDEX idx_comp_candidates_genres ON public.comparable_candidates USING GIN(genres);

-- 2. comparable_influencers
CREATE TABLE public.comparable_influencers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  lane text NOT NULL,
  candidate_id uuid NOT NULL REFERENCES public.comparable_candidates(id) ON DELETE CASCADE,
  influencer_weight numeric NOT NULL DEFAULT 1.0,
  influence_dimensions jsonb NOT NULL DEFAULT '["pacing","stakes_ladder","dialogue_style","twist_budget"]',
  emulate_tags jsonb NOT NULL DEFAULT '[]',
  avoid_tags jsonb NOT NULL DEFAULT '[]',
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid NOT NULL,
  UNIQUE(project_id, lane, candidate_id)
);
CREATE INDEX idx_comp_influencers_project_lane ON public.comparable_influencers(project_id, lane);

-- 3. engine_profiles
CREATE TABLE public.engine_profiles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  lane text NOT NULL,
  name text NOT NULL DEFAULT 'Derived from comps',
  derived_from_influencers jsonb NOT NULL DEFAULT '[]',
  rules jsonb NOT NULL,
  rules_summary text NOT NULL DEFAULT '',
  conflicts jsonb NOT NULL DEFAULT '[]',
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid NOT NULL,
  is_active boolean NOT NULL DEFAULT true
);
CREATE INDEX idx_engine_profiles_project_lane ON public.engine_profiles(project_id, lane, created_at DESC);
CREATE INDEX idx_engine_profiles_active ON public.engine_profiles(project_id, lane, is_active);

-- 4. engine_overrides
CREATE TABLE public.engine_overrides (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  lane text NOT NULL,
  scope text NOT NULL DEFAULT 'project_default',
  target_run_id uuid NULL,
  patch jsonb NOT NULL,
  patch_summary text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid NOT NULL
);
CREATE INDEX idx_engine_overrides_project_lane ON public.engine_overrides(project_id, lane, scope, created_at DESC);
CREATE INDEX idx_engine_overrides_run ON public.engine_overrides(target_run_id);

-- 5. story_rulesets
CREATE TABLE public.story_rulesets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  lane text NOT NULL,
  run_type text NOT NULL,
  run_id uuid NOT NULL,
  engine_profile_id uuid NULL REFERENCES public.engine_profiles(id),
  override_ids jsonb NOT NULL DEFAULT '[]',
  resolved_rules jsonb NOT NULL,
  resolved_summary text NOT NULL DEFAULT '',
  fingerprint jsonb NOT NULL DEFAULT '{}',
  similarity_risk numeric NOT NULL DEFAULT 0,
  nuance_metrics jsonb NOT NULL DEFAULT '{}',
  nuance_score numeric NOT NULL DEFAULT 0,
  melodrama_score numeric NOT NULL DEFAULT 0,
  nuance_gate jsonb NOT NULL DEFAULT '{}',
  attempt int NOT NULL DEFAULT 0,
  repaired_from_ruleset_id uuid NULL REFERENCES public.story_rulesets(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid NOT NULL
);
CREATE INDEX idx_story_rulesets_project_lane ON public.story_rulesets(project_id, lane, created_at DESC);
CREATE INDEX idx_story_rulesets_sim ON public.story_rulesets(project_id, lane, similarity_risk);
CREATE INDEX idx_story_rulesets_fingerprint ON public.story_rulesets USING GIN(fingerprint);
CREATE INDEX idx_story_rulesets_rules ON public.story_rulesets USING GIN(resolved_rules);

-- RLS
ALTER TABLE public.comparable_candidates ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.comparable_influencers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.engine_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.engine_overrides ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.story_rulesets ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can manage own project candidates" ON public.comparable_candidates
  FOR ALL USING (public.has_project_access(auth.uid(), project_id));

CREATE POLICY "Users can manage own project influencers" ON public.comparable_influencers
  FOR ALL USING (public.has_project_access(auth.uid(), project_id));

CREATE POLICY "Users can manage own project engine profiles" ON public.engine_profiles
  FOR ALL USING (public.has_project_access(auth.uid(), project_id));

CREATE POLICY "Users can manage own project engine overrides" ON public.engine_overrides
  FOR ALL USING (public.has_project_access(auth.uid(), project_id));

CREATE POLICY "Users can manage own project story rulesets" ON public.story_rulesets
  FOR ALL USING (public.has_project_access(auth.uid(), project_id));
