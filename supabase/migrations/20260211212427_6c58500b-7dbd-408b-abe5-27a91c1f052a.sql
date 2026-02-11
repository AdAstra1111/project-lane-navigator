
-- ═══════════════════════════════════════════════════════════
-- Phase 1: Data Source Registry + Staleness Detection
-- Phase 2: Engine-Source Mapping
-- ═══════════════════════════════════════════════════════════

-- 1. Data Sources Registry
CREATE TABLE public.data_sources (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  source_name TEXT NOT NULL,
  production_types_supported TEXT[] NOT NULL DEFAULT '{}',
  intelligence_layer TEXT NOT NULL DEFAULT 'market',
  source_type TEXT NOT NULL DEFAULT 'api',
  region TEXT NOT NULL DEFAULT '',
  refresh_frequency TEXT NOT NULL DEFAULT 'weekly',
  last_refresh TIMESTAMP WITH TIME ZONE,
  data_staleness_score REAL NOT NULL DEFAULT 0,
  reliability_score REAL NOT NULL DEFAULT 0.8,
  volatility_score REAL NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'active',
  description TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

ALTER TABLE public.data_sources ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone authenticated can view data sources"
  ON public.data_sources FOR SELECT
  USING (auth.uid() IS NOT NULL);

CREATE POLICY "Service role can manage data sources"
  ON public.data_sources FOR ALL
  USING (auth.uid() IS NOT NULL)
  WITH CHECK (auth.uid() IS NOT NULL);

-- 2. Engine-Source Mapping
CREATE TABLE public.engine_source_map (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  engine_id UUID NOT NULL REFERENCES public.trend_engines(id) ON DELETE CASCADE,
  source_id UUID NOT NULL REFERENCES public.data_sources(id) ON DELETE CASCADE,
  source_weight REAL NOT NULL DEFAULT 1.0,
  validation_method TEXT NOT NULL DEFAULT 'manual_audit',
  status TEXT NOT NULL DEFAULT 'active',
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  UNIQUE(engine_id, source_id)
);

ALTER TABLE public.engine_source_map ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone authenticated can view engine source map"
  ON public.engine_source_map FOR SELECT
  USING (auth.uid() IS NOT NULL);

CREATE POLICY "Service role can manage engine source map"
  ON public.engine_source_map FOR ALL
  USING (auth.uid() IS NOT NULL)
  WITH CHECK (auth.uid() IS NOT NULL);

-- 3. Model version log for quarterly audits (Phase 3 prep)
CREATE TABLE public.model_version_log (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  version_label TEXT NOT NULL DEFAULT '',
  production_type TEXT NOT NULL DEFAULT '',
  change_type TEXT NOT NULL DEFAULT 'weight_adjustment',
  changes JSONB NOT NULL DEFAULT '{}',
  reason TEXT NOT NULL DEFAULT '',
  triggered_by TEXT NOT NULL DEFAULT 'manual',
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

ALTER TABLE public.model_version_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone authenticated can view model versions"
  ON public.model_version_log FOR SELECT
  USING (auth.uid() IS NOT NULL);

CREATE POLICY "Anyone authenticated can create model versions"
  ON public.model_version_log FOR INSERT
  WITH CHECK (auth.uid() IS NOT NULL);

-- Triggers for updated_at
CREATE TRIGGER update_data_sources_updated_at
  BEFORE UPDATE ON public.data_sources
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER update_engine_source_map_updated_at
  BEFORE UPDATE ON public.engine_source_map
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
