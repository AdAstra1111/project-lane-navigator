
-- =====================================================
-- DOCUMENTARY INTELLIGENCE TABLES
-- =====================================================

-- 1. documentary_profiles: Core documentary project metadata
CREATE TABLE public.documentary_profiles (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  project_id UUID NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  user_id UUID NOT NULL,
  central_question TEXT DEFAULT '',
  thematic_focus TEXT DEFAULT '',
  access_level TEXT DEFAULT 'none', -- none, partial, full, embedded
  access_notes TEXT DEFAULT '',
  subject_count INT DEFAULT 0,
  archive_status TEXT DEFAULT 'none', -- none, researching, partial, secured, cleared
  archive_cost_estimate NUMERIC DEFAULT 0,
  legal_exposure TEXT DEFAULT 'low', -- low, medium, high, critical
  political_sensitivity TEXT DEFAULT 'low', -- low, medium, high, extreme
  insurance_risk TEXT DEFAULT 'standard', -- standard, elevated, high, specialist
  character_reliability TEXT DEFAULT 'unknown', -- unknown, stable, volatile, unreliable
  impact_strategy TEXT DEFAULT '',
  grant_status TEXT DEFAULT 'not_started', -- not_started, researching, applying, partial, funded
  broadcaster_targets TEXT[] DEFAULT '{}',
  festival_targets TEXT[] DEFAULT '{}',
  story_type TEXT DEFAULT 'observational', -- observational, investigative, personal, historical, hybrid
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(project_id)
);

ALTER TABLE public.documentary_profiles ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users manage own doc profiles" ON public.documentary_profiles FOR ALL USING (auth.uid() = user_id);

-- 2. story_spine_versions: Versioned story arcs for docs
CREATE TABLE public.story_spine_versions (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  project_id UUID NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  user_id UUID NOT NULL,
  version INT DEFAULT 1,
  act1_facts TEXT DEFAULT '',
  act2_hypotheses TEXT DEFAULT '',
  act3_outcome_paths JSONB DEFAULT '[]',
  central_tension TEXT DEFAULT '',
  discovery_notes TEXT DEFAULT '',
  status TEXT DEFAULT 'draft', -- draft, active, superseded
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.story_spine_versions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users manage own story spines" ON public.story_spine_versions FOR ALL USING (auth.uid() = user_id);

-- 3. interview_subjects: Track real people in documentary
CREATE TABLE public.interview_subjects (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  project_id UUID NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  user_id UUID NOT NULL,
  name TEXT NOT NULL DEFAULT '',
  role_in_story TEXT DEFAULT '',
  access_status TEXT DEFAULT 'identified', -- identified, approached, confirmed, filmed, declined
  consent_status TEXT DEFAULT 'none', -- none, verbal, written, released
  reliability_rating TEXT DEFAULT 'unknown', -- unknown, reliable, variable, unreliable
  interview_notes TEXT DEFAULT '',
  contact_info TEXT DEFAULT '',
  location TEXT DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.interview_subjects ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users manage own interview subjects" ON public.interview_subjects FOR ALL USING (auth.uid() = user_id);

-- 4. archive_assets: Track archival material
CREATE TABLE public.archive_assets (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  project_id UUID NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  user_id UUID NOT NULL,
  asset_type TEXT DEFAULT 'footage', -- footage, photo, document, audio, news_clip, social_media
  description TEXT DEFAULT '',
  source TEXT DEFAULT '',
  rights_status TEXT DEFAULT 'unknown', -- unknown, public_domain, licensed, pending, cleared, denied
  cost_estimate NUMERIC DEFAULT 0,
  duration_seconds INT DEFAULT 0,
  clearance_notes TEXT DEFAULT '',
  priority TEXT DEFAULT 'medium', -- low, medium, high, essential
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.archive_assets ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users manage own archive assets" ON public.archive_assets FOR ALL USING (auth.uid() = user_id);

-- 5. consent_forms: Track releases and consent
CREATE TABLE public.consent_forms (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  project_id UUID NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  user_id UUID NOT NULL,
  subject_name TEXT NOT NULL DEFAULT '',
  interview_subject_id UUID REFERENCES public.interview_subjects(id) ON DELETE SET NULL,
  form_type TEXT DEFAULT 'appearance', -- appearance, interview, location, archive, music
  status TEXT DEFAULT 'pending', -- pending, sent, signed, expired, revoked
  signed_date DATE,
  expiry_date DATE,
  notes TEXT DEFAULT '',
  file_path TEXT DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.consent_forms ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users manage own consent forms" ON public.consent_forms FOR ALL USING (auth.uid() = user_id);

-- 6. legal_flags: Track legal risks for documentary
CREATE TABLE public.legal_flags (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  project_id UUID NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  user_id UUID NOT NULL,
  flag_type TEXT DEFAULT 'defamation', -- defamation, privacy, copyright, contempt, national_security, commercial
  severity TEXT DEFAULT 'medium', -- low, medium, high, critical
  description TEXT DEFAULT '',
  affected_subjects TEXT DEFAULT '',
  mitigation_plan TEXT DEFAULT '',
  status TEXT DEFAULT 'open', -- open, mitigated, cleared, escalated
  reviewed_by TEXT DEFAULT '',
  reviewed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.legal_flags ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users manage own legal flags" ON public.legal_flags FOR ALL USING (auth.uid() = user_id);

-- 7. impact_partners: NGOs, universities, campaign orgs
CREATE TABLE public.impact_partners (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  project_id UUID NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  user_id UUID NOT NULL,
  partner_name TEXT NOT NULL DEFAULT '',
  partner_type TEXT DEFAULT 'ngo', -- ngo, university, government, foundation, media, grassroots
  contact_name TEXT DEFAULT '',
  contact_email TEXT DEFAULT '',
  engagement_status TEXT DEFAULT 'identified', -- identified, approached, interested, committed, active
  contribution TEXT DEFAULT '', -- what they bring (distribution, screening, funding, advocacy)
  territory TEXT DEFAULT '',
  notes TEXT DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.impact_partners ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users manage own impact partners" ON public.impact_partners FOR ALL USING (auth.uid() = user_id);

-- 8. grant_matches: Matched grant opportunities
CREATE TABLE public.grant_matches (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  project_id UUID NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  user_id UUID NOT NULL,
  fund_name TEXT NOT NULL DEFAULT '',
  fund_body TEXT DEFAULT '', -- Sundance, BFI, IDFA, etc
  max_amount NUMERIC DEFAULT 0,
  currency TEXT DEFAULT 'USD',
  deadline DATE,
  eligibility_match NUMERIC DEFAULT 0, -- 0-100 match score
  topic_relevance NUMERIC DEFAULT 0,
  geography_match NUMERIC DEFAULT 0,
  status TEXT DEFAULT 'identified', -- identified, researching, applying, submitted, awarded, rejected
  application_notes TEXT DEFAULT '',
  url TEXT DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.grant_matches ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users manage own grant matches" ON public.grant_matches FOR ALL USING (auth.uid() = user_id);

-- 9. broadcaster_fit_scores: How well project fits each broadcaster
CREATE TABLE public.broadcaster_fit_scores (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  project_id UUID NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  user_id UUID NOT NULL,
  broadcaster_name TEXT NOT NULL DEFAULT '',
  territory TEXT DEFAULT '',
  fit_score NUMERIC DEFAULT 0, -- 0-100
  genre_match NUMERIC DEFAULT 0,
  tone_match NUMERIC DEFAULT 0,
  budget_match NUMERIC DEFAULT 0,
  slot_fit TEXT DEFAULT '', -- e.g. "Storyville", "True Stories", "POV"
  notes TEXT DEFAULT '',
  last_assessed_at TIMESTAMPTZ DEFAULT now(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.broadcaster_fit_scores ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users manage own broadcaster scores" ON public.broadcaster_fit_scores FOR ALL USING (auth.uid() = user_id);

-- Add triggers for updated_at
CREATE TRIGGER update_documentary_profiles_updated_at BEFORE UPDATE ON public.documentary_profiles FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER update_interview_subjects_updated_at BEFORE UPDATE ON public.interview_subjects FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
