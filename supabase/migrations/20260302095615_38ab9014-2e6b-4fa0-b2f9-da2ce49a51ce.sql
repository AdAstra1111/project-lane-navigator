
-- ================================================================
-- Strategic Intel Layer — Tables, Indexes, Seed Data
-- ================================================================

-- 1) intel_runs — audit log for every intel engine invocation
CREATE TABLE IF NOT EXISTS public.intel_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  engine_name text NOT NULL,
  trigger text NOT NULL,
  scope text NOT NULL,
  requested_filters jsonb,
  model_grounding text,
  model_synthesis text,
  ok boolean NOT NULL DEFAULT false,
  error text,
  stats jsonb
);
CREATE INDEX idx_intel_runs_created ON public.intel_runs (created_at DESC);
CREATE INDEX idx_intel_runs_engine_created ON public.intel_runs (engine_name, created_at DESC);

-- 2) intel_policies — hierarchical policy control
CREATE TABLE IF NOT EXISTS public.intel_policies (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  scope_type text NOT NULL,
  scope_key text NOT NULL,
  enabled boolean NOT NULL DEFAULT true,
  policy jsonb NOT NULL,
  priority int NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Seed balanced default global policy
INSERT INTO public.intel_policies (scope_type, scope_key, enabled, priority, policy)
VALUES ('global', 'default', true, 0, '{
  "advisory_only": true,
  "modules": {
    "trend_signals": true,
    "cast_trends": true,
    "convergence": true,
    "embeddings": true
  },
  "thresholds": {
    "min_signal_strength": 7,
    "min_convergence_score": 0.78,
    "min_persistence_runs": 2
  },
  "warnings": {
    "enabled": true,
    "severity_min": "medium",
    "suppress_days": 14
  },
  "cadence": {
    "recency_filter": "week"
  }
}'::jsonb);

-- 3) intel_events — fingerprinted, deduplicated events
CREATE TABLE IF NOT EXISTS public.intel_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  event_type text NOT NULL,
  severity text NOT NULL,
  event_fingerprint text NOT NULL,
  payload jsonb NOT NULL,
  status text NOT NULL DEFAULT 'open',
  project_id uuid,
  surface text
);
CREATE INDEX idx_intel_events_fingerprint ON public.intel_events (event_fingerprint);

-- 4) intel_alerts — delivery log
CREATE TABLE IF NOT EXISTS public.intel_alerts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id uuid NOT NULL REFERENCES public.intel_events(id),
  delivered_at timestamptz NOT NULL DEFAULT now(),
  surface text NOT NULL,
  status text NOT NULL DEFAULT 'new'
);

-- 5) Extend trend_signals with embedding + intel_run_id
ALTER TABLE public.trend_signals ADD COLUMN IF NOT EXISTS embedding extensions.vector(1536);
ALTER TABLE public.trend_signals ADD COLUMN IF NOT EXISTS embedding_model text;
ALTER TABLE public.trend_signals ADD COLUMN IF NOT EXISTS tags text[] DEFAULT '{}';
ALTER TABLE public.trend_signals ADD COLUMN IF NOT EXISTS intel_run_id uuid REFERENCES public.intel_runs(id);

-- 6) project_vectors — project-level embeddings
CREATE TABLE IF NOT EXISTS public.project_vectors (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL,
  vector_type text NOT NULL,
  embedding extensions.vector(1536),
  embedding_model text,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- 7) lane_profiles
CREATE TABLE IF NOT EXISTS public.lane_profiles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  lane_key text UNIQUE NOT NULL,
  description text NOT NULL,
  embedding extensions.vector(1536),
  risk_tolerance numeric,
  heat_preference numeric,
  budget_min numeric,
  budget_max numeric,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- 8) buyer_profiles
CREATE TABLE IF NOT EXISTS public.buyer_profiles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  buyer_key text UNIQUE NOT NULL,
  description text NOT NULL,
  embedding extensions.vector(1536),
  risk_profile numeric,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- 9) format_archetypes
CREATE TABLE IF NOT EXISTS public.format_archetypes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  format_key text UNIQUE NOT NULL,
  description text NOT NULL,
  embedding extensions.vector(1536),
  created_at timestamptz NOT NULL DEFAULT now()
);

-- 10) project_intel_alignment — persisted alignment results
CREATE TABLE IF NOT EXISTS public.project_intel_alignment (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL,
  run_id uuid REFERENCES public.intel_runs(id),
  alignment_score numeric,
  opportunity_score numeric,
  risk_score numeric,
  contrarian_score numeric,
  top_signal_ids uuid[],
  lane_fit_scores jsonb,
  buyer_fit_scores jsonb,
  format_fit_scores jsonb,
  convergence_matches jsonb,
  breakdown jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_project_intel_alignment_project ON public.project_intel_alignment (project_id, created_at DESC);

-- IVFFlat indexes for vector similarity (require some rows to exist, but CREATE INDEX IF NOT EXISTS is safe)
-- Using lists=10 since initial data is small
CREATE INDEX IF NOT EXISTS trend_signals_embedding_idx ON public.trend_signals USING ivfflat (embedding vector_cosine_ops) WITH (lists = 10);
CREATE INDEX IF NOT EXISTS project_vectors_embedding_idx ON public.project_vectors USING ivfflat (embedding vector_cosine_ops) WITH (lists = 10);
