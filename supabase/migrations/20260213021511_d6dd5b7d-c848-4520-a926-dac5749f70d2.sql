
-- Add packaging_stage column to projects table
ALTER TABLE public.projects 
ADD COLUMN IF NOT EXISTS packaging_stage text NOT NULL DEFAULT 'early_dev';

-- Add check constraint for allowed values
ALTER TABLE public.projects 
ADD CONSTRAINT projects_packaging_stage_check 
CHECK (packaging_stage IN ('early_dev', 'packaging_now', 'financing_live'));
