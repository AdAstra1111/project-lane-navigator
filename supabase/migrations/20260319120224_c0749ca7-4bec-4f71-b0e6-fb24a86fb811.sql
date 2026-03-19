
-- Add dna_version_id to image_evaluations for strict DNA provenance
ALTER TABLE public.image_evaluations
ADD COLUMN IF NOT EXISTS dna_version_id uuid REFERENCES public.character_visual_dna(id),
ADD COLUMN IF NOT EXISTS prompt_audit_result jsonb DEFAULT '{}'::jsonb,
ADD COLUMN IF NOT EXISTS image_audit_result jsonb DEFAULT '{}'::jsonb,
ADD COLUMN IF NOT EXISTS governance_verdict text DEFAULT 'pending',
ADD COLUMN IF NOT EXISTS explanation jsonb DEFAULT '[]'::jsonb;

-- Add source_dna_version_id to visual_scenarios
ALTER TABLE public.visual_scenarios
ADD COLUMN IF NOT EXISTS source_dna_version_id uuid REFERENCES public.character_visual_dna(id),
ADD COLUMN IF NOT EXISTS affected_traits jsonb DEFAULT '[]'::jsonb,
ADD COLUMN IF NOT EXISTS affected_canon_fields jsonb DEFAULT '[]'::jsonb,
ADD COLUMN IF NOT EXISTS affected_image_families jsonb DEFAULT '[]'::jsonb,
ADD COLUMN IF NOT EXISTS affected_downstream jsonb DEFAULT '[]'::jsonb,
ADD COLUMN IF NOT EXISTS preview_safe boolean DEFAULT true,
ADD COLUMN IF NOT EXISTS analysis_method text DEFAULT 'rule_based';
