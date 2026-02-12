-- Add inflation guard columns to improvement_runs
ALTER TABLE public.improvement_runs
ADD COLUMN IF NOT EXISTS pre_rewrite_viability integer,
ADD COLUMN IF NOT EXISTS post_rewrite_viability integer,
ADD COLUMN IF NOT EXISTS viability_delta integer,
ADD COLUMN IF NOT EXISTS inflation_flag boolean DEFAULT false,
ADD COLUMN IF NOT EXISTS inflation_reason text,
ADD COLUMN IF NOT EXISTS pre_rewrite_breakdown jsonb,
ADD COLUMN IF NOT EXISTS post_rewrite_breakdown jsonb;
