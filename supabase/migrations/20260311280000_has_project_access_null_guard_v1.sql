-- Migration: has_project_access_null_guard_v1
-- Purpose: Add explicit NULL guard to has_project_access()
--
-- DIAGNOSIS:
--   The function is semantically correct — PostgreSQL three-valued logic
--   causes NULL inputs to fail-closed naturally. However, the intent is
--   implicit. A future maintenance edit (e.g. plpgsql conversion, logic
--   extension) could accidentally change NULL behaviour without the guard
--   being visible.
--
-- CHANGE:
--   Add `_user_id IS NOT NULL AND _project_id IS NOT NULL` as the leading
--   condition. This short-circuits before touching any table when either
--   argument is NULL, making the fail-closed intent explicit and
--   unconditional regardless of future edits.
--
-- COMPATIBILITY:
--   - Signature unchanged: (uuid, uuid) -> boolean
--   - STABLE / SECURITY DEFINER / search_path unchanged
--   - All 688 RLS policy references remain compatible
--   - All 61 edge function RPC call sites remain compatible
--   - Behaviour for all non-NULL inputs is identical to the previous version
--   - Behaviour for NULL inputs: was implicit false (via 3-valued logic),
--     is now explicit false (via leading guard) — same outcome, clearer intent
--
-- APPROVED KEY: has_project_access_null_guard_v1
-- RISK LEVEL:   Low — no functional change for non-NULL inputs

CREATE OR REPLACE FUNCTION public.has_project_access(_user_id uuid, _project_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    _user_id IS NOT NULL
    AND _project_id IS NOT NULL
    AND (
      EXISTS (
        SELECT 1 FROM public.projects
        WHERE id = _project_id AND user_id = _user_id
      )
      OR EXISTS (
        SELECT 1 FROM public.project_collaborators
        WHERE project_id = _project_id
          AND user_id = _user_id
          AND status = 'accepted'
      )
    )
$$;
