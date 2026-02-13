
-- Add packaging_mode column to projects table
ALTER TABLE public.projects 
ADD COLUMN IF NOT EXISTS packaging_mode text NOT NULL DEFAULT 'streamer_prestige';

-- Add a check constraint for allowed values
ALTER TABLE public.projects 
ADD CONSTRAINT projects_packaging_mode_check 
CHECK (packaging_mode IN ('awards', 'commercial', 'streamer_prestige'));
