ALTER TABLE public.projects
ADD COLUMN IF NOT EXISTS min_runtime_minutes integer;

ALTER TABLE public.projects
ADD COLUMN IF NOT EXISTS min_runtime_hard_floor integer;

ALTER TABLE public.projects
ADD COLUMN IF NOT EXISTS runtime_estimation_mode text NOT NULL DEFAULT 'feature';