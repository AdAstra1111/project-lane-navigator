-- Add lifecycle_stage column to projects table
-- This replaces pipeline_stage as the primary stage tracker
ALTER TABLE public.projects 
ADD COLUMN IF NOT EXISTS lifecycle_stage TEXT NOT NULL DEFAULT 'development';

-- Migrate existing pipeline_stage values to lifecycle_stage
UPDATE public.projects SET lifecycle_stage = 
  CASE 
    WHEN pipeline_stage = 'pre-production' THEN 'pre-production'
    WHEN pipeline_stage = 'financing' THEN 'packaging' -- financing merges into packaging initially
    ELSE COALESCE(pipeline_stage, 'development')
  END;

-- Create index for common queries
CREATE INDEX IF NOT EXISTS idx_projects_lifecycle_stage ON public.projects (lifecycle_stage);