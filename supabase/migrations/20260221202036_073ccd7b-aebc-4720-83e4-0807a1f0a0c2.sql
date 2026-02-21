
-- Phase 5.3: Adaptive Governance Engine
-- Safe additive changes only

-- Ensure governance column exists on project_scenarios (idempotent)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'project_scenarios' AND column_name = 'governance'
  ) THEN
    ALTER TABLE public.project_scenarios ADD COLUMN governance jsonb DEFAULT '{}'::jsonb;
  END IF;
END$$;

-- Ensure is_locked column exists
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'project_scenarios' AND column_name = 'is_locked'
  ) THEN
    ALTER TABLE public.project_scenarios ADD COLUMN is_locked boolean DEFAULT false;
  END IF;
END$$;

-- Ensure protected_paths column exists
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'project_scenarios' AND column_name = 'protected_paths'
  ) THEN
    ALTER TABLE public.project_scenarios ADD COLUMN protected_paths jsonb DEFAULT '[]'::jsonb;
  END IF;
END$$;

-- Ensure locked_at column exists
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'project_scenarios' AND column_name = 'locked_at'
  ) THEN
    ALTER TABLE public.project_scenarios ADD COLUMN locked_at timestamptz NULL;
  END IF;
END$$;

-- Ensure locked_by column exists
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'project_scenarios' AND column_name = 'locked_by'
  ) THEN
    ALTER TABLE public.project_scenarios ADD COLUMN locked_by uuid NULL;
  END IF;
END$$;

-- Ensure merge_policy column exists
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'project_scenarios' AND column_name = 'merge_policy'
  ) THEN
    ALTER TABLE public.project_scenarios ADD COLUMN merge_policy jsonb DEFAULT '{}'::jsonb;
  END IF;
END$$;
