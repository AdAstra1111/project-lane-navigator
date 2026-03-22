CREATE TABLE public.project_ai_cast_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  character_key text NOT NULL,
  previous_ai_actor_id uuid,
  previous_ai_actor_version_id uuid,
  next_ai_actor_id uuid,
  next_ai_actor_version_id uuid,
  change_type text NOT NULL DEFAULT 'rebind',
  change_reason text,
  changed_by uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.project_ai_cast_history ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can read own cast history"
  ON public.project_ai_cast_history FOR SELECT TO authenticated
  USING (public.has_project_access(auth.uid(), project_id));

CREATE POLICY "Users can insert own cast history"
  ON public.project_ai_cast_history FOR INSERT TO authenticated
  WITH CHECK (public.has_project_access(auth.uid(), project_id));

CREATE INDEX idx_cast_history_project ON public.project_ai_cast_history(project_id);
CREATE INDEX idx_cast_history_character ON public.project_ai_cast_history(project_id, character_key);