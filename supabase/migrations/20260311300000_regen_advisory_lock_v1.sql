-- Migration: regen_advisory_lock_v1
-- Purpose: PL/pgSQL RPCs for advisory lock acquisition and release, used by
--   execute_selective_regeneration to prevent concurrent execution per project.
--
-- DESIGN:
--   - acquire_regen_advisory_lock(project_id):
--       Converts project_id UUID to a stable bigint key, then calls
--       pg_try_advisory_xact_lock(). This is a TRANSACTION-scoped lock —
--       it is automatically released when the calling transaction commits or
--       rolls back. Each supabase.rpc() call runs in its own implicit transaction,
--       so the lock is only held for the duration of the RPC, not the entire
--       edge function invocation.
--
--   - Strategy rationale:
--       The advisory lock prevents the race condition where two concurrent
--       requests both read "no running rows" before either has inserted one.
--       The transaction-level lock is the correct choice here:
--         (a) The RPC atomically checks + inserts the run row in one transaction.
--         (b) After that RPC returns, the row status='running' serves as the
--             persistent lock for the longer operation.
--         (c) No dangling locks are possible (xact-level = auto-release on commit).
--
--   - acquire_regen_advisory_lock is called in a combined "acquire + insert" RPC
--     (create_regen_run_locked) to keep the critical section atomic.
--
-- APPROVED KEY: regen_advisory_lock_v1

-- ── acquire_regen_advisory_lock ──────────────────────────────────────────────
-- Returns true if the advisory lock was acquired, false if already held.
-- Lock key is derived deterministically from the project_id UUID.
CREATE OR REPLACE FUNCTION public.acquire_regen_advisory_lock(p_project_id uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  lock_key bigint;
BEGIN
  -- Derive stable bigint from first 16 hex chars of the UUID
  lock_key := ('x' || replace(substring(p_project_id::text, 1, 18), '-', ''))::bit(64)::bigint;
  RETURN pg_try_advisory_xact_lock(lock_key);
END;
$$;

COMMENT ON FUNCTION public.acquire_regen_advisory_lock(uuid) IS
  'Acquires a transaction-scoped advisory lock for regeneration execution scoped to a project.
   Returns false if the lock is already held by another concurrent transaction.
   Lock is automatically released when the calling transaction ends.';

-- ── create_regen_run_locked ──────────────────────────────────────────────────
-- Atomically: acquire advisory lock → check for running rows → insert run row.
-- Returns the new run row id, or null with a reason string on failure.
-- Called once per execute_selective_regeneration invocation in Stage 2.
CREATE OR REPLACE FUNCTION public.create_regen_run_locked(
  p_project_id            uuid,
  p_triggered_by          uuid,
  p_source_unit_keys      text[],
  p_source_axes           text[],
  p_recommended_scope     text,
  p_target_scene_ids      uuid[],
  p_target_scene_count    integer,
  p_ndg_pre_at_risk_count integer,
  p_meta_json             jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  lock_key     bigint;
  lock_acquired boolean;
  running_count integer;
  new_run_id   uuid;
BEGIN
  -- 1. Derive lock key deterministically from project_id
  lock_key := ('x' || replace(substring(p_project_id::text, 1, 18), '-', ''))::bit(64)::bigint;

  -- 2. Try to acquire transaction-level advisory lock
  lock_acquired := pg_try_advisory_xact_lock(lock_key);
  IF NOT lock_acquired THEN
    RETURN jsonb_build_object(
      'ok', false,
      'abort_reason', 'execution_locked',
      'note', 'Another regeneration execution is starting concurrently for this project'
    );
  END IF;

  -- 3. Within the lock: check for any running rows (defence-in-depth)
  SELECT COUNT(*) INTO running_count
    FROM public.regeneration_runs
    WHERE project_id = p_project_id AND status = 'running';

  IF running_count > 0 THEN
    RETURN jsonb_build_object(
      'ok', false,
      'abort_reason', 'already_running',
      'note', 'A regeneration run is already in progress for this project'
    );
  END IF;

  -- 4. Insert the run row with status='running'
  INSERT INTO public.regeneration_runs (
    project_id, triggered_by, source_unit_keys, source_axes,
    recommended_scope, target_scene_ids, target_scene_count,
    status, ndg_pre_at_risk_count, meta_json
  ) VALUES (
    p_project_id, p_triggered_by, p_source_unit_keys, p_source_axes,
    p_recommended_scope, p_target_scene_ids, p_target_scene_count,
    'running', p_ndg_pre_at_risk_count, p_meta_json
  )
  RETURNING id INTO new_run_id;

  RETURN jsonb_build_object(
    'ok', true,
    'run_id', new_run_id
  );
END;
$$;

COMMENT ON FUNCTION public.create_regen_run_locked(uuid,uuid,text[],text[],text,uuid[],integer,integer,jsonb) IS
  'Atomically acquires an advisory lock, checks for running rows, and inserts a
   regeneration_runs row with status=running. Returns ok:true+run_id on success,
   or ok:false+abort_reason on failure. Advisory lock is auto-released on transaction end.';
