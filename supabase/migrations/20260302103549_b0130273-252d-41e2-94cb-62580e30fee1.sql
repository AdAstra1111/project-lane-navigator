
-- Intel V2 Migration: taxonomy columns + convergence tables + event links

-- 1) Extend trend_signals with taxonomy columns
ALTER TABLE public.trend_signals ADD COLUMN IF NOT EXISTS dimension text;
ALTER TABLE public.trend_signals ADD COLUMN IF NOT EXISTS modality text;
ALTER TABLE public.trend_signals ADD COLUMN IF NOT EXISTS style_tags text[] NOT NULL DEFAULT '{}';
ALTER TABLE public.trend_signals ADD COLUMN IF NOT EXISTS narrative_tags text[] NOT NULL DEFAULT '{}';
ALTER TABLE public.trend_signals ADD COLUMN IF NOT EXISTS signal_tags text[] NOT NULL DEFAULT '{}';
ALTER TABLE public.trend_signals ADD COLUMN IF NOT EXISTS updated_bucket date;

-- 2) intel_convergence_state
CREATE TABLE IF NOT EXISTS public.intel_convergence_state (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  key text NOT NULL,
  week_bucket date NOT NULL,
  score numeric NOT NULL DEFAULT 0,
  observations int NOT NULL DEFAULT 0,
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  contributing_signal_ids uuid[] NOT NULL DEFAULT '{}',
  contributing_signal_names text[] NOT NULL DEFAULT '{}',
  contributing_citations jsonb,
  UNIQUE(key, week_bucket)
);

CREATE INDEX IF NOT EXISTS idx_intel_convergence_state_week ON public.intel_convergence_state (week_bucket);
CREATE INDEX IF NOT EXISTS idx_intel_convergence_state_score ON public.intel_convergence_state (score DESC);

-- 3) intel_event_links
CREATE TABLE IF NOT EXISTS public.intel_event_links (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id uuid NOT NULL REFERENCES public.intel_events(id) ON DELETE CASCADE,
  signal_id uuid REFERENCES public.trend_signals(id) ON DELETE SET NULL,
  cast_id uuid REFERENCES public.cast_trends(id) ON DELETE SET NULL,
  meta jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_intel_event_links_event ON public.intel_event_links (event_id);

-- 4) RLS on new tables
ALTER TABLE public.intel_convergence_state ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.intel_event_links ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated read intel_convergence_state"
  ON public.intel_convergence_state FOR SELECT
  TO authenticated USING (true);

CREATE POLICY "Authenticated read intel_event_links"
  ON public.intel_event_links FOR SELECT
  TO authenticated USING (true);

-- 5) Update global policy to V2 balanced defaults
UPDATE public.intel_policies SET policy = '{
  "advisory_only": true,
  "modules": {
    "trend_signals": true,
    "cast_trends": true,
    "convergence": true,
    "alignment": true,
    "alerts": true
  },
  "thresholds": {
    "min_signal_strength": 7,
    "min_convergence_score": 0.72,
    "min_convergence_persistence_weeks": 2
  },
  "warnings": {
    "enabled": true,
    "severity_min": "medium",
    "suppress_days": 7
  },
  "cadence": {
    "convergence_run": "weekly",
    "alignment_run": "manual"
  }
}'::jsonb, updated_at = now()
WHERE scope_type = 'global' AND scope_key = 'default';
