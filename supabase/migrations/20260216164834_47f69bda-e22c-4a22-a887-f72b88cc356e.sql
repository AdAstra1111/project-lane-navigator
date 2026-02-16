
-- ═══════════════════════════════════════════════════════════
-- IFFY SIGNALS ENGINE v1 — Phase 1 Migration
-- Extends existing trend_signals, creates new tables
-- ═══════════════════════════════════════════════════════════

-- A) trend_observations — raw signal inputs
CREATE TABLE IF NOT EXISTS public.trend_observations (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  observed_at TIMESTAMPTZ,
  source_type TEXT NOT NULL DEFAULT 'manual',
  source_name TEXT NOT NULL DEFAULT '',
  source_url TEXT,
  raw_text TEXT,
  raw_metrics JSONB NOT NULL DEFAULT '{}'::jsonb,
  extraction_confidence NUMERIC NOT NULL DEFAULT 0.6,
  format_hint TEXT,
  tags JSONB NOT NULL DEFAULT '[]'::jsonb,
  cluster_id UUID,
  ingested_by TEXT NOT NULL DEFAULT 'manual',
  user_id UUID
);

CREATE INDEX IF NOT EXISTS idx_trend_observations_created ON public.trend_observations (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_trend_observations_source ON public.trend_observations (source_type, observed_at DESC);
CREATE INDEX IF NOT EXISTS idx_trend_observations_tags ON public.trend_observations USING gin(tags);
CREATE INDEX IF NOT EXISTS idx_trend_observations_cluster ON public.trend_observations (cluster_id);

ALTER TABLE public.trend_observations ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can view observations"
  ON public.trend_observations FOR SELECT
  USING (auth.uid() IS NOT NULL);

CREATE POLICY "Authenticated users can insert observations"
  ON public.trend_observations FOR INSERT
  WITH CHECK (auth.uid() IS NOT NULL);

CREATE POLICY "Authenticated users can update observations"
  ON public.trend_observations FOR UPDATE
  USING (auth.uid() IS NOT NULL);

-- B) Extend trend_signals to serve as canonical clusters
ALTER TABLE public.trend_signals
  ADD COLUMN IF NOT EXISTS description TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS example_titles JSONB NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS format_applicability JSONB NOT NULL DEFAULT '["vertical_drama","film","documentary"]'::jsonb,
  ADD COLUMN IF NOT EXISTS cluster_scoring JSONB NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS sources_used JSONB NOT NULL DEFAULT '[]'::jsonb;

CREATE INDEX IF NOT EXISTS idx_trend_signals_format_applicability ON public.trend_signals USING gin(format_applicability);

-- C) project_signal_matches — project ↔ signal relevance
CREATE TABLE IF NOT EXISTS public.project_signal_matches (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  project_id UUID NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  cluster_id UUID NOT NULL REFERENCES public.trend_signals(id) ON DELETE CASCADE,
  relevance_score NUMERIC NOT NULL DEFAULT 0.0,
  impact_score NUMERIC NOT NULL DEFAULT 0.0,
  rationale JSONB NOT NULL DEFAULT '{}'::jsonb,
  applied_to JSONB NOT NULL DEFAULT '[]'::jsonb,
  last_applied_at TIMESTAMPTZ,
  UNIQUE (project_id, cluster_id)
);

CREATE INDEX IF NOT EXISTS idx_project_signal_matches_project ON public.project_signal_matches (project_id, impact_score DESC);
CREATE INDEX IF NOT EXISTS idx_project_signal_matches_cluster ON public.project_signal_matches (cluster_id);

ALTER TABLE public.project_signal_matches ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own project signal matches"
  ON public.project_signal_matches FOR SELECT
  USING (public.has_project_access(auth.uid(), project_id));

CREATE POLICY "Users can insert own project signal matches"
  ON public.project_signal_matches FOR INSERT
  WITH CHECK (public.has_project_access(auth.uid(), project_id));

CREATE POLICY "Users can update own project signal matches"
  ON public.project_signal_matches FOR UPDATE
  USING (public.has_project_access(auth.uid(), project_id));

CREATE POLICY "Users can delete own project signal matches"
  ON public.project_signal_matches FOR DELETE
  USING (public.has_project_access(auth.uid(), project_id));

-- D) doc_fact_ledger_items — documentary fact safety
CREATE TABLE IF NOT EXISTS public.doc_fact_ledger_items (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  project_id UUID NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  claim TEXT NOT NULL,
  evidence_type TEXT NOT NULL DEFAULT 'unknown',
  evidence_link TEXT,
  status TEXT NOT NULL DEFAULT 'needs_check',
  notes TEXT NOT NULL DEFAULT '',
  user_id UUID
);

CREATE INDEX IF NOT EXISTS idx_doc_fact_ledger_project ON public.doc_fact_ledger_items (project_id, status);

ALTER TABLE public.doc_fact_ledger_items ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own project fact ledger"
  ON public.doc_fact_ledger_items FOR SELECT
  USING (public.has_project_access(auth.uid(), project_id));

CREATE POLICY "Users can insert fact ledger items"
  ON public.doc_fact_ledger_items FOR INSERT
  WITH CHECK (public.has_project_access(auth.uid(), project_id));

CREATE POLICY "Users can update fact ledger items"
  ON public.doc_fact_ledger_items FOR UPDATE
  USING (public.has_project_access(auth.uid(), project_id));

CREATE POLICY "Users can delete fact ledger items"
  ON public.doc_fact_ledger_items FOR DELETE
  USING (public.has_project_access(auth.uid(), project_id));

-- E) Extend projects table with signals settings
ALTER TABLE public.projects
  ADD COLUMN IF NOT EXISTS project_features JSONB NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS signals_influence NUMERIC NOT NULL DEFAULT 0.5,
  ADD COLUMN IF NOT EXISTS signals_apply JSONB NOT NULL DEFAULT '{"pitch":true,"dev":true,"grid":true,"doc":true}'::jsonb;

CREATE INDEX IF NOT EXISTS idx_projects_features ON public.projects USING gin(project_features);
