-- Add unique constraint for upsert on trend_weekly_briefs
ALTER TABLE public.trend_weekly_briefs
ADD CONSTRAINT trend_weekly_briefs_week_type_unique UNIQUE (week_start, production_type);