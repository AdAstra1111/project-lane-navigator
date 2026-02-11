
-- Add representation/contact fields to project_cast
ALTER TABLE public.project_cast
  ADD COLUMN IF NOT EXISTS agent_name text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS manager_name text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS agency text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS contact_phone text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS contact_email text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS imdb_id text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS tmdb_id text NOT NULL DEFAULT '';

-- Add representation/contact fields to project_hods
ALTER TABLE public.project_hods
  ADD COLUMN IF NOT EXISTS agent_name text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS manager_name text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS agency text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS contact_phone text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS contact_email text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS imdb_id text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS tmdb_id text NOT NULL DEFAULT '';
