-- Add pinned flag to projects
ALTER TABLE public.projects ADD COLUMN pinned boolean NOT NULL DEFAULT false;