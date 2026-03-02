ALTER TABLE public.trend_signals ADD COLUMN IF NOT EXISTS source_citations jsonb;
ALTER TABLE public.cast_trends ADD COLUMN IF NOT EXISTS source_citations jsonb;