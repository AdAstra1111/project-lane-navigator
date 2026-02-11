
CREATE TABLE public.vertical_data_sources (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  source_name TEXT NOT NULL,
  region TEXT NOT NULL DEFAULT 'Global',
  source_type TEXT NOT NULL DEFAULT 'platform',
  refresh_frequency TEXT NOT NULL DEFAULT 'weekly',
  reliability_score INTEGER NOT NULL DEFAULT 5,
  category TEXT NOT NULL DEFAULT '',
  url TEXT NOT NULL DEFAULT '',
  notes TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'active',
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

ALTER TABLE public.vertical_data_sources ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone authenticated can view vertical data sources"
  ON public.vertical_data_sources FOR SELECT
  USING (auth.uid() IS NOT NULL);

CREATE POLICY "Service role can manage vertical data sources"
  ON public.vertical_data_sources FOR ALL
  USING (auth.uid() IS NOT NULL)
  WITH CHECK (auth.uid() IS NOT NULL);

CREATE TABLE public.vertical_trend_snapshots (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  snapshot_date DATE NOT NULL DEFAULT CURRENT_DATE,
  region TEXT NOT NULL DEFAULT 'Global',
  top_apps JSONB NOT NULL DEFAULT '[]'::jsonb,
  revenue_shifts JSONB NOT NULL DEFAULT '[]'::jsonb,
  top_micro_genres JSONB NOT NULL DEFAULT '[]'::jsonb,
  episode_patterns JSONB NOT NULL DEFAULT '{}'::jsonb,
  raw_data JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

ALTER TABLE public.vertical_trend_snapshots ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone authenticated can view vertical snapshots"
  ON public.vertical_trend_snapshots FOR SELECT
  USING (auth.uid() IS NOT NULL);

CREATE POLICY "Service role can manage vertical snapshots"
  ON public.vertical_trend_snapshots FOR ALL
  USING (auth.uid() IS NOT NULL)
  WITH CHECK (auth.uid() IS NOT NULL);
