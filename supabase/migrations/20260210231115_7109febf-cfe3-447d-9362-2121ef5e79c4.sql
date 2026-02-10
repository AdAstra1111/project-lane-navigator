
-- Add geography awareness columns to projects
ALTER TABLE public.projects
ADD COLUMN IF NOT EXISTS primary_territory text NOT NULL DEFAULT '',
ADD COLUMN IF NOT EXISTS secondary_territories text[] NOT NULL DEFAULT '{}';
