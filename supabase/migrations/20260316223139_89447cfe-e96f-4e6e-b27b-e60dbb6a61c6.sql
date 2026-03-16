
-- Narrative DNA Profiles — Phase 1
-- Stores reusable narrative DNA extracted from source stories.

CREATE TABLE public.narrative_dna_profiles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,

  -- Source identity / provenance
  source_title TEXT NOT NULL,
  source_type TEXT NOT NULL DEFAULT 'public_domain',
  source_corpus_script_id UUID REFERENCES public.corpus_scripts(id),
  source_text_hash TEXT,
  source_text_length INT,
  source_ref_json JSONB NOT NULL DEFAULT '{}',

  -- Structural DNA (reuses NarrativeSpine shape)
  spine_json JSONB NOT NULL DEFAULT '{}',

  -- Extended DNA
  escalation_architecture TEXT,
  antagonist_pattern TEXT,
  thematic_spine TEXT,
  emotional_cadence TEXT[] DEFAULT '{}',
  world_logic_rules TEXT[] DEFAULT '{}',
  set_piece_grammar TEXT,
  ending_logic TEXT,
  power_dynamic TEXT,

  -- Mutation constraints
  forbidden_carryovers TEXT[] DEFAULT '{}',
  mutable_variables TEXT[] DEFAULT '{}',
  surface_expression_notes TEXT,

  -- Audit / extraction
  extraction_json JSONB NOT NULL DEFAULT '{}',
  extraction_model TEXT,
  extraction_confidence NUMERIC(4,2),

  -- Lifecycle
  status TEXT NOT NULL DEFAULT 'draft',
  locked_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- RLS: users manage own profiles only
ALTER TABLE public.narrative_dna_profiles ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users manage own DNA profiles"
  ON public.narrative_dna_profiles
  FOR ALL TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

-- Index for user lookup
CREATE INDEX idx_narrative_dna_profiles_user_id ON public.narrative_dna_profiles (user_id);

-- Auto-update updated_at
CREATE TRIGGER trg_narrative_dna_profiles_updated_at
  BEFORE UPDATE ON public.narrative_dna_profiles
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
