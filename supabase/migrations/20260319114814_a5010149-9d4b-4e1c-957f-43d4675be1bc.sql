
-- Character Visual DNA — versioned, per-character visual truth model
CREATE TABLE public.character_visual_dna (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  character_name TEXT NOT NULL,
  version_number INTEGER NOT NULL DEFAULT 1,
  
  -- DNA layers (structured JSON)
  script_truth JSONB NOT NULL DEFAULT '[]'::jsonb,
  narrative_markers JSONB NOT NULL DEFAULT '[]'::jsonb,
  inferred_guidance JSONB NOT NULL DEFAULT '[]'::jsonb,
  producer_guidance JSONB NOT NULL DEFAULT '[]'::jsonb,
  locked_invariants JSONB NOT NULL DEFAULT '[]'::jsonb,
  flexible_axes JSONB NOT NULL DEFAULT '[]'::jsonb,
  contradiction_flags JSONB NOT NULL DEFAULT '[]'::jsonb,
  missing_clarifications JSONB NOT NULL DEFAULT '[]'::jsonb,
  
  -- Identity signature snapshot
  identity_signature JSONB DEFAULT NULL,
  identity_strength TEXT DEFAULT 'weak',
  
  -- Metadata
  is_current BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by UUID REFERENCES auth.users(id),
  
  UNIQUE(project_id, character_name, version_number)
);

ALTER TABLE public.character_visual_dna ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own project DNA"
  ON public.character_visual_dna FOR SELECT TO authenticated
  USING (public.has_project_access(auth.uid(), project_id));

CREATE POLICY "Users can insert own project DNA"
  ON public.character_visual_dna FOR INSERT TO authenticated
  WITH CHECK (public.has_project_access(auth.uid(), project_id));

CREATE POLICY "Users can update own project DNA"
  ON public.character_visual_dna FOR UPDATE TO authenticated
  USING (public.has_project_access(auth.uid(), project_id));

-- Image Evaluations — per-image assessment against DNA
CREATE TABLE public.image_evaluations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  image_id UUID NOT NULL,
  dna_version_id UUID REFERENCES public.character_visual_dna(id),
  
  -- Evaluation results
  canon_match TEXT NOT NULL DEFAULT 'unknown',
  continuity_match TEXT NOT NULL DEFAULT 'unknown',
  narrative_fit TEXT NOT NULL DEFAULT 'unknown',
  wardrobe_fit TEXT NOT NULL DEFAULT 'unknown',
  drift_risk TEXT NOT NULL DEFAULT 'unknown',
  period_plausibility TEXT DEFAULT NULL,
  lore_compatibility TEXT DEFAULT NULL,
  
  -- Details
  contradiction_flags JSONB NOT NULL DEFAULT '[]'::jsonb,
  traits_satisfied JSONB NOT NULL DEFAULT '[]'::jsonb,
  traits_violated JSONB NOT NULL DEFAULT '[]'::jsonb,
  evaluation_summary TEXT DEFAULT '',
  evaluation_method TEXT NOT NULL DEFAULT 'rule_based',
  
  -- Approval governance
  decision_type TEXT DEFAULT NULL,
  decision_reason TEXT DEFAULT NULL,
  decision_note TEXT DEFAULT NULL,
  decided_at TIMESTAMPTZ DEFAULT NULL,
  decided_by UUID REFERENCES auth.users(id),
  destination TEXT DEFAULT NULL,
  
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by UUID REFERENCES auth.users(id)
);

ALTER TABLE public.image_evaluations ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own project evaluations"
  ON public.image_evaluations FOR SELECT TO authenticated
  USING (public.has_project_access(auth.uid(), project_id));

CREATE POLICY "Users can insert own project evaluations"
  ON public.image_evaluations FOR INSERT TO authenticated
  WITH CHECK (public.has_project_access(auth.uid(), project_id));

CREATE POLICY "Users can update own project evaluations"
  ON public.image_evaluations FOR UPDATE TO authenticated
  USING (public.has_project_access(auth.uid(), project_id));

-- Visual Scenarios — what-if branching system
CREATE TABLE public.visual_scenarios (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  domain TEXT NOT NULL DEFAULT 'character',
  target TEXT NOT NULL DEFAULT '',
  query_text TEXT NOT NULL DEFAULT '',
  
  -- Change specification
  change_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  classification TEXT DEFAULT NULL,
  
  -- Compatibility assessments
  canon_compatibility TEXT DEFAULT NULL,
  lore_compatibility TEXT DEFAULT NULL,
  historical_compatibility TEXT DEFAULT NULL,
  material_compatibility TEXT DEFAULT NULL,
  
  -- Impact
  impact_summary TEXT DEFAULT '',
  impacted_systems JSONB NOT NULL DEFAULT '[]'::jsonb,
  recommended_path TEXT DEFAULT NULL,
  
  -- State machine
  state TEXT NOT NULL DEFAULT 'preview_only',
  
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by UUID REFERENCES auth.users(id),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.visual_scenarios ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can manage own project scenarios"
  ON public.visual_scenarios FOR ALL TO authenticated
  USING (public.has_project_access(auth.uid(), project_id));

CREATE INDEX idx_visual_dna_project_char ON public.character_visual_dna(project_id, character_name, is_current);
CREATE INDEX idx_image_evaluations_image ON public.image_evaluations(image_id);
CREATE INDEX idx_image_evaluations_project ON public.image_evaluations(project_id);
CREATE INDEX idx_visual_scenarios_project ON public.visual_scenarios(project_id, state);
