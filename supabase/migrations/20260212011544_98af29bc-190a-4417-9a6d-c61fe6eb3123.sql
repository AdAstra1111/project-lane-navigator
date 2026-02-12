
-- ============================================================
-- PHASE 1: COVERAGE SYSTEM — FULL SCHEMA (retry)
-- ============================================================

-- 0. ROLE SYSTEM
CREATE TYPE public.app_role AS ENUM ('admin', 'moderator', 'user');

CREATE TABLE public.user_roles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role app_role NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, role)
);
ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.has_role(_user_id UUID, _role app_role)
RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_id = _user_id AND role = _role
  )
$$;

CREATE POLICY "Users can view own roles" ON public.user_roles
  FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Admins can manage roles" ON public.user_roles
  FOR ALL USING (public.has_role(auth.uid(), 'admin'));

-- 1. SCRIPTS TABLE
CREATE TABLE public.scripts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  version INT NOT NULL DEFAULT 1,
  file_path TEXT,
  text_content TEXT,
  hash TEXT,
  page_map JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by UUID NOT NULL REFERENCES auth.users(id)
);
ALTER TABLE public.scripts ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Scripts project access" ON public.scripts
  FOR ALL USING (public.has_project_access(auth.uid(), project_id));

-- 2. COVERAGE PROMPT VERSIONS (created_by nullable for system seeds)
CREATE TABLE public.coverage_prompt_versions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active',
  project_type_scope TEXT[] NOT NULL DEFAULT '{}',
  analyst_prompt TEXT NOT NULL,
  producer_prompt TEXT NOT NULL,
  qc_prompt TEXT NOT NULL,
  output_contract JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by UUID REFERENCES auth.users(id)
);
ALTER TABLE public.coverage_prompt_versions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Authenticated can read prompt versions" ON public.coverage_prompt_versions
  FOR SELECT TO authenticated USING (true);
CREATE POLICY "Admins can manage prompt versions" ON public.coverage_prompt_versions
  FOR ALL USING (public.has_role(auth.uid(), 'admin'));

-- 3. COVERAGE RUNS
CREATE TABLE public.coverage_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  script_id UUID NOT NULL REFERENCES public.scripts(id) ON DELETE CASCADE,
  prompt_version_id UUID NOT NULL REFERENCES public.coverage_prompt_versions(id),
  model TEXT NOT NULL,
  project_type TEXT NOT NULL,
  lane TEXT,
  inputs JSONB NOT NULL DEFAULT '{}',
  pass_a TEXT NOT NULL DEFAULT '',
  pass_b TEXT NOT NULL DEFAULT '',
  pass_c TEXT NOT NULL DEFAULT '',
  final_coverage TEXT NOT NULL DEFAULT '',
  structured_notes JSONB,
  metrics JSONB NOT NULL DEFAULT '{}',
  draft_label TEXT NOT NULL DEFAULT 'Draft 1',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by UUID NOT NULL REFERENCES auth.users(id)
);
ALTER TABLE public.coverage_runs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Coverage runs project access" ON public.coverage_runs
  FOR ALL USING (public.has_project_access(auth.uid(), project_id));

-- 4. COVERAGE FEEDBACK
CREATE TABLE public.coverage_feedback (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  coverage_run_id UUID NOT NULL REFERENCES public.coverage_runs(id) ON DELETE CASCADE,
  overall_usefulness INT NOT NULL DEFAULT 3,
  accuracy_to_script INT NOT NULL DEFAULT 3,
  specificity INT NOT NULL DEFAULT 3,
  actionability INT NOT NULL DEFAULT 3,
  market_realism INT NOT NULL DEFAULT 3,
  free_text TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by UUID NOT NULL REFERENCES auth.users(id)
);
ALTER TABLE public.coverage_feedback ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Feedback creator access" ON public.coverage_feedback
  FOR ALL USING (auth.uid() = created_by);

-- 5. COVERAGE FEEDBACK NOTES
CREATE TABLE public.coverage_feedback_notes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  coverage_run_id UUID NOT NULL REFERENCES public.coverage_runs(id) ON DELETE CASCADE,
  note_id TEXT NOT NULL,
  tag TEXT NOT NULL,
  user_edit TEXT,
  reason TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by UUID NOT NULL REFERENCES auth.users(id)
);
ALTER TABLE public.coverage_feedback_notes ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Note feedback creator access" ON public.coverage_feedback_notes
  FOR ALL USING (auth.uid() = created_by);

-- 6. GREAT NOTES LIBRARY
CREATE TABLE public.great_notes_library (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_type TEXT NOT NULL,
  genre TEXT,
  problem_type TEXT NOT NULL,
  budget_band TEXT,
  note_text TEXT NOT NULL,
  evidence_style TEXT,
  tags TEXT[] NOT NULL DEFAULT '{}',
  source_coverage_run_id UUID REFERENCES public.coverage_runs(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by UUID NOT NULL REFERENCES auth.users(id)
);
ALTER TABLE public.great_notes_library ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Authenticated can read great notes" ON public.great_notes_library
  FOR SELECT TO authenticated USING (true);
CREATE POLICY "Creator can manage great notes" ON public.great_notes_library
  FOR ALL USING (auth.uid() = created_by);

-- 7. HOUSE STYLE
CREATE TABLE public.house_style (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID,
  style_name TEXT NOT NULL DEFAULT 'Paradox House',
  preferences JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.house_style ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Authenticated can read house style" ON public.house_style
  FOR SELECT TO authenticated USING (true);
CREATE POLICY "Admins can manage house style" ON public.house_style
  FOR ALL USING (public.has_role(auth.uid(), 'admin'));

INSERT INTO public.house_style (style_name, preferences) VALUES (
  'Paradox House',
  '{"tone":"direct, producer-grade, non-fluffy","must_include":["Top 3 core notes","evidence + fix","2 options: safe/bold","sequenced rewrite plan"],"avoid":["generic advice without how","inventing plot events","irrelevant industry talk"],"comps_rules":"2 mainstream comps + 1 prestige/indie comp, explain why each comp maps","risk_tolerance":"prefer bold but implementable fixes","coverage_length":"medium, prioritized, no long essays"}'::jsonb
);

CREATE TRIGGER update_house_style_updated_at
  BEFORE UPDATE ON public.house_style
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- 8. COVERAGE BENCHMARKS (created_by nullable for seeds)
CREATE TABLE public.coverage_benchmarks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  project_type TEXT NOT NULL,
  script_id UUID NOT NULL REFERENCES public.scripts(id) ON DELETE CASCADE,
  must_catch_issues JSONB NOT NULL DEFAULT '[]',
  gold_notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by UUID REFERENCES auth.users(id)
);
ALTER TABLE public.coverage_benchmarks ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admins can manage benchmarks" ON public.coverage_benchmarks
  FOR ALL USING (public.has_role(auth.uid(), 'admin'));
CREATE POLICY "Authenticated can read benchmarks" ON public.coverage_benchmarks
  FOR SELECT TO authenticated USING (true);

-- 9. COVERAGE BENCHMARK RUNS
CREATE TABLE public.coverage_benchmark_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  benchmark_id UUID NOT NULL REFERENCES public.coverage_benchmarks(id) ON DELETE CASCADE,
  prompt_version_id UUID NOT NULL REFERENCES public.coverage_prompt_versions(id),
  model TEXT NOT NULL,
  coverage_run_id UUID NOT NULL REFERENCES public.coverage_runs(id) ON DELETE CASCADE,
  scores JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by UUID REFERENCES auth.users(id)
);
ALTER TABLE public.coverage_benchmark_runs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admins can manage benchmark runs" ON public.coverage_benchmark_runs
  FOR ALL USING (public.has_role(auth.uid(), 'admin'));
CREATE POLICY "Authenticated can read benchmark runs" ON public.coverage_benchmark_runs
  FOR SELECT TO authenticated USING (true);

-- 10. DROP OLD TABLE
DROP TABLE IF EXISTS public.script_coverages;

-- 11. STORAGE BUCKET for scripts
INSERT INTO storage.buckets (id, name, public) VALUES ('scripts', 'scripts', false)
ON CONFLICT (id) DO NOTHING;

CREATE POLICY "Script upload access" ON storage.objects
  FOR INSERT WITH CHECK (bucket_id = 'scripts' AND auth.uid() IS NOT NULL);
CREATE POLICY "Script read access" ON storage.objects
  FOR SELECT USING (bucket_id = 'scripts' AND auth.uid() IS NOT NULL);

-- 12. SEED: Initial prompt version v1.0
INSERT INTO public.coverage_prompt_versions (
  name, status, project_type_scope,
  analyst_prompt, producer_prompt, qc_prompt, output_contract
) VALUES (
  'coverage_v1.0',
  'active',
  ARRAY['Film','TV Series','Short Film','Documentary','Documentary Series','Digital Series','Vertical Drama'],
  'You are a strict script analyst. Identify problems and strengths WITH EVIDENCE from the provided script text. Do NOT propose rewrites. Cite evidence using scene headings, short excerpt quotes (<=25 words), or beat references. If evidence is missing, say "INSUFFICIENT EVIDENCE". Never invent events.

Return JSON with keys:
- script_facts: array of grounded fact strings (5-12)
- strengths_with_evidence: array of {finding, evidence} objects (8-15)
- problems_with_evidence: array of {finding, evidence, severity} objects (12-25)
- top_diagnostics: array of {rank, diagnosis} objects (top 10)
- uncertainties: array of {claim, reason} objects',

  'You are a producer-grade story editor. Convert analyst diagnostics into prioritized actionable coverage. Every critique must include Evidence + Diagnosis + Prescription. Provide 2 options: SAFE FIX vs BOLD FIX.

PROJECT_TYPE ADAPTATION:
- Commercial/Advert/Branded: treatment/spot coverage focusing on concept clarity, brand fit, hook, structure, visual storytelling
- Vertical Drama: fast hooks, cliffhangers, loopable structure, retention beats, platform realities
- Documentary: subject access, editorial approach, narrative spine, impact potential

Return the final coverage as markdown following the strict Output Contract sections.',

  'You are a coverage quality controller. Enforce Output Contract headings/order. Remove vagueness (notes without evidence+prescription). Detect contradictions. Flag hallucinations. Ensure project_type relevance.

Return JSON with keys:
- cleaned_coverage: the contract-compliant markdown
- qc_changelog: array of {action, detail} objects
- hallucination_flags: array of {claim, reason} objects
- metrics: {specificity_rate, hallucinations_count, contract_compliance, missing_sections}',

  '{"sections":["LOGLINE","SNAP VERDICT","WHATS WORKING","WHATS NOT WORKING","TOP 3 CORE NOTES","CHARACTER","STRUCTURE & PACING","DIALOGUE","THEME & TONE","AUDIENCE + COMPS","MARKET REALITY & RISKS","PRODUCER ACTION PLAN","OPTIONAL: HIGH-LEVERAGE SCENE FIXES"],"rules":["Every negative note requires Evidence + Prescription","If uncertain label INFERENCE","Never invent plot details","No irrelevant industry advice for project_type"]}'::jsonb
);
