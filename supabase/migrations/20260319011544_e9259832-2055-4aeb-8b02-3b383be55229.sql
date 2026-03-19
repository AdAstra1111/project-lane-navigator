
-- Visual Decisions table: unified recommend → choose → lock → propagate
CREATE TABLE public.visual_decisions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  decision_domain text NOT NULL,
  target_scope text NOT NULL DEFAULT 'project',
  target_key text,
  recommended_value text,
  recommended_reason text,
  recommended_at timestamptz,
  selected_value text,
  selected_at timestamptz,
  is_locked boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (project_id, decision_domain, target_scope, target_key)
);

-- RLS
ALTER TABLE public.visual_decisions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can manage own project visual decisions"
  ON public.visual_decisions
  FOR ALL
  TO authenticated
  USING (public.has_project_access(auth.uid(), project_id))
  WITH CHECK (public.has_project_access(auth.uid(), project_id));

-- Index for fast lookups
CREATE INDEX idx_visual_decisions_project_domain 
  ON public.visual_decisions(project_id, decision_domain);

-- Auto-update timestamp
CREATE TRIGGER set_visual_decisions_updated_at
  BEFORE UPDATE ON public.visual_decisions
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
