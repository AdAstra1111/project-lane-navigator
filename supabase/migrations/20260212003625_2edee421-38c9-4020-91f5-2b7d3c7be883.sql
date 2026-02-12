-- Add script coverage verdict to projects table
ALTER TABLE public.projects ADD COLUMN IF NOT EXISTS script_coverage_verdict text NOT NULL DEFAULT '';
-- Values will be: '', 'RECOMMEND', 'CONSIDER', 'PASS'