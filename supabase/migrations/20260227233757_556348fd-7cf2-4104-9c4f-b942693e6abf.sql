
-- Add policy_json to regen_jobs for autorun policy configuration
ALTER TABLE public.regen_jobs
  ADD COLUMN IF NOT EXISTS policy_json jsonb DEFAULT '{}'::jsonb;

-- Add auto_approve column to regen_job_items for tracking approval status
ALTER TABLE public.regen_job_items
  ADD COLUMN IF NOT EXISTS auto_approved boolean DEFAULT false;

-- Add approved_version_id to track which version was auto-approved
ALTER TABLE public.regen_job_items
  ADD COLUMN IF NOT EXISTS approved_version_id uuid NULL;
