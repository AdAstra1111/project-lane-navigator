
-- trend_refresh_runs: log every refresh invocation
CREATE TABLE public.trend_refresh_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  trigger text NOT NULL DEFAULT 'manual',
  scope text NOT NULL DEFAULT 'one',
  requested_types text[] NOT NULL DEFAULT '{}',
  completed_types text[] NOT NULL DEFAULT '{}',
  ok boolean NOT NULL DEFAULT false,
  error text,
  model_trends text,
  model_grounding text,
  recency_filter text,
  citations_total int NOT NULL DEFAULT 0,
  signals_total int NOT NULL DEFAULT 0,
  cast_total int NOT NULL DEFAULT 0,
  meta jsonb NOT NULL DEFAULT '{}'::jsonb
);

CREATE INDEX idx_trend_refresh_runs_created_at ON public.trend_refresh_runs (created_at DESC);

-- Add refresh_run_id to trend_signals and cast_trends
ALTER TABLE public.trend_signals ADD COLUMN IF NOT EXISTS refresh_run_id uuid REFERENCES public.trend_refresh_runs(id);
ALTER TABLE public.cast_trends ADD COLUMN IF NOT EXISTS refresh_run_id uuid REFERENCES public.trend_refresh_runs(id);

CREATE INDEX idx_trend_signals_refresh_run_id ON public.trend_signals (refresh_run_id);
CREATE INDEX idx_cast_trends_refresh_run_id ON public.cast_trends (refresh_run_id);

-- RLS: allow authenticated users to read runs
ALTER TABLE public.trend_refresh_runs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can read trend_refresh_runs"
  ON public.trend_refresh_runs FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "Service role can insert/update trend_refresh_runs"
  ON public.trend_refresh_runs FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);
