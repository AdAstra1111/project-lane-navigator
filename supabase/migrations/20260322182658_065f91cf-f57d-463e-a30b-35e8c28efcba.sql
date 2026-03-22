
-- Phase 17.1: Pending actor bind context table
CREATE TABLE public.pending_actor_binds (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_id uuid NOT NULL,
  project_id uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  character_key text NOT NULL,
  source text NOT NULL DEFAULT 'project-casting-inline-create',
  status text NOT NULL DEFAULT 'pending_bind',
  created_at timestamptz NOT NULL DEFAULT now(),
  resolved_at timestamptz,
  user_id uuid NOT NULL,
  UNIQUE (actor_id, project_id, character_key)
);

ALTER TABLE public.pending_actor_binds ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can manage own pending binds"
  ON public.pending_actor_binds
  FOR ALL
  TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

CREATE INDEX idx_pending_actor_binds_project ON public.pending_actor_binds(project_id, status);
