
-- Shadow source evaluations: tracks performance of shadow-mode data sources
CREATE TABLE public.shadow_source_evaluations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  source_id UUID NOT NULL REFERENCES public.data_sources(id) ON DELETE CASCADE,
  evaluation_period TEXT NOT NULL DEFAULT '',
  accuracy_score REAL NOT NULL DEFAULT 0,
  sample_size INTEGER NOT NULL DEFAULT 0,
  correlation_details JSONB NOT NULL DEFAULT '{}'::jsonb,
  promoted_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.shadow_source_evaluations ENABLE ROW LEVEL SECURITY;

-- Policies: same pattern as data_sources (authenticated read, service write)
CREATE POLICY "Anyone authenticated can view shadow evaluations"
  ON public.shadow_source_evaluations
  FOR SELECT
  USING (auth.uid() IS NOT NULL);

CREATE POLICY "Service role can manage shadow evaluations"
  ON public.shadow_source_evaluations
  FOR ALL
  USING (auth.uid() IS NOT NULL)
  WITH CHECK (auth.uid() IS NOT NULL);
