-- ============================================================
-- Tighten scene_spine_links RLS: public ALL → authenticated SELECT
-- ============================================================
--
-- EVIDENCE (get_table_schema, 2026-03-11):
--
-- Current (overly broad) policy:
--   name:       "Users can manage scene spine links for own projects"
--   cmd:        ALL
--   role:       public  ← includes anonymous role
--   USING:      has_project_access(auth.uid(), project_id)
--   WITH CHECK: has_project_access(auth.uid(), project_id)
--
-- WHY THIS IS ACCEPTABLE IN PRACTICE BUT WRONG IN PRINCIPLE:
--   auth.uid() returns NULL for anonymous requests.
--   has_project_access(NULL, project_id) returns false (no project membership
--   for a null user), so anonymous users are effectively denied in practice.
--   However, access is controlled by implementation detail, not by policy
--   scope. A change to has_project_access semantics could inadvertently
--   open access. Defence-in-depth requires restricting at policy scope too.
--
-- CORRECT ACCESS SEMANTICS:
--   - frontend reads:  useImportPipelineStatus.ts queries spine link count
--     via authenticated Supabase client → SELECT for authenticated needed.
--   - writes:          scene_graph_sync_spine_links in dev-engine-v2 uses
--     service_role → bypasses RLS entirely. No user-JWT writes required.
--
-- MINIMUM SAFE CORRECTION:
--   DROP the public ALL policy.
--   CREATE SELECT policy for authenticated role only.
--
-- CANONICAL PATTERN (from scene_graph_scenes, scene_blueprint_bindings):
--   FOR SELECT TO authenticated USING (has_project_access(auth.uid(), project_id))
--
-- Migration is idempotent:
--   DROP POLICY IF EXISTS — no error if already removed.
--   IF NOT EXISTS guard on CREATE POLICY.

-- Step 1: remove the over-broad public ALL policy
DROP POLICY IF EXISTS "Users can manage scene spine links for own projects"
  ON public.scene_spine_links;

-- Step 2: add correct SELECT policy for authenticated users
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename='scene_spine_links' AND policyname='ssl_select'
  ) THEN
    CREATE POLICY "ssl_select"
      ON public.scene_spine_links
      FOR SELECT
      TO authenticated
      USING (has_project_access(auth.uid(), project_id));
  END IF;
END $$;

-- Note: no INSERT/UPDATE/DELETE policies for authenticated users.
-- All writes via service_role (scene_graph_sync_spine_links edge function),
-- which bypasses RLS. Adding user-JWT write policies would be speculative
-- and is not supported by any current frontend code path.
