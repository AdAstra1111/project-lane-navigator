
-- Add mode_preference to existing profiles table
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS mode_preference text NOT NULL DEFAULT 'simple';

-- Add check constraint
ALTER TABLE public.profiles
  ADD CONSTRAINT profiles_mode_preference_check CHECK (mode_preference IN ('simple', 'advanced'));

-- Add ui_mode_override to projects table
ALTER TABLE public.projects
  ADD COLUMN IF NOT EXISTS ui_mode_override text NULL;

ALTER TABLE public.projects
  ADD CONSTRAINT projects_ui_mode_override_check CHECK (ui_mode_override IS NULL OR ui_mode_override IN ('simple', 'advanced'));
