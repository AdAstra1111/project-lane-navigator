ALTER TABLE public.projects
ADD COLUMN IF NOT EXISTS target_runtime_minutes integer NOT NULL DEFAULT 90;

ALTER TABLE public.projects
ADD COLUMN IF NOT EXISTS runtime_tolerance_pct numeric NOT NULL DEFAULT 0.10;