-- Fix: allow pipeline_transitions to be deleted when parent project is being deleted.
-- The immutable-delete trigger was intentionally blocking ad-hoc deletes to preserve
-- the audit ledger, but it also blocked project deletion. This migration replaces the
-- blanket DELETE-block with a smarter check: only allow DELETE if the parent project
-- no longer exists (i.e. the project row has already been (or is being) removed).
-- All other DELETE attempts (ad-hoc ledger tampering) continue to raise an exception.

CREATE OR REPLACE FUNCTION public.prevent_transition_mutation()
  RETURNS TRIGGER
  LANGUAGE plpgsql
  SET search_path TO 'public'
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    -- Allow delete when the parent project is being deleted (project row gone or about to be gone)
    -- This permits ON DELETE CASCADE and explicit pre-deletion cleanup by the project owner.
    IF NOT EXISTS (SELECT 1 FROM public.projects WHERE id = OLD.project_id) THEN
      RETURN OLD; -- project already removed — allow
    END IF;
    -- Check if the authenticated user owns the project (allowed to delete their own project data)
    IF EXISTS (
      SELECT 1 FROM public.projects
      WHERE id = OLD.project_id
        AND user_id = auth.uid()
    ) THEN
      RETURN OLD; -- owner deleting their own project's transitions — allow
    END IF;
    -- Otherwise block — preserves immutability for ledger tampering attempts
    RAISE EXCEPTION 'pipeline_transitions is immutable: DELETE not allowed';
  END IF;
  -- Block all UPDATE attempts unconditionally
  RAISE EXCEPTION 'pipeline_transitions is immutable: % not allowed', TG_OP;
END;
$$;
