
-- ============================================================
-- Document Assistant: threads, messages, actions, test_runs, apply_runs
-- ============================================================

-- A) document_assistant_threads
CREATE TABLE public.document_assistant_threads (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  title text NOT NULL DEFAULT 'Document Assistant',
  created_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_da_threads_project ON public.document_assistant_threads(project_id);

-- B) document_assistant_messages
CREATE TABLE public.document_assistant_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  thread_id uuid NOT NULL REFERENCES public.document_assistant_threads(id) ON DELETE CASCADE,
  role text NOT NULL CHECK (role IN ('user','assistant','system')),
  content text NOT NULL,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_da_messages_thread_time ON public.document_assistant_messages(thread_id, created_at);

-- C) document_assistant_actions
CREATE TABLE public.document_assistant_actions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  thread_id uuid NOT NULL REFERENCES public.document_assistant_threads(id) ON DELETE CASCADE,
  proposed_by_message_id uuid REFERENCES public.document_assistant_messages(id) ON DELETE SET NULL,
  action_type text NOT NULL,
  target_ref jsonb NOT NULL DEFAULT '{}'::jsonb,
  patch jsonb NOT NULL DEFAULT '{}'::jsonb,
  human_summary text NOT NULL,
  status text NOT NULL DEFAULT 'proposed' CHECK (status IN ('proposed','testing','test_failed','ready_to_apply','applied','rejected')),
  created_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_da_actions_thread_status ON public.document_assistant_actions(thread_id, status, created_at);

-- D) document_assistant_test_runs
CREATE TABLE public.document_assistant_test_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  action_id uuid NOT NULL REFERENCES public.document_assistant_actions(id) ON DELETE CASCADE,
  started_by uuid NOT NULL,
  started_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz,
  status text NOT NULL DEFAULT 'running' CHECK (status IN ('running','passed','failed','error')),
  summary text,
  details jsonb NOT NULL DEFAULT '{}'::jsonb,
  logs text NOT NULL DEFAULT ''
);
CREATE INDEX idx_da_test_runs_action ON public.document_assistant_test_runs(action_id, started_at);

-- E) document_assistant_apply_runs
CREATE TABLE public.document_assistant_apply_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  action_id uuid NOT NULL REFERENCES public.document_assistant_actions(id) ON DELETE CASCADE,
  started_by uuid NOT NULL,
  started_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz,
  status text NOT NULL DEFAULT 'running' CHECK (status IN ('running','applied','failed','error')),
  summary text,
  details jsonb NOT NULL DEFAULT '{}'::jsonb,
  logs text NOT NULL DEFAULT ''
);
CREATE INDEX idx_da_apply_runs_action ON public.document_assistant_apply_runs(action_id, started_at);

-- updated_at triggers
CREATE TRIGGER da_threads_updated_at BEFORE UPDATE ON public.document_assistant_threads
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER da_actions_updated_at BEFORE UPDATE ON public.document_assistant_actions
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- ============================================================
-- RLS (uses existing has_project_access function)
-- ============================================================

ALTER TABLE public.document_assistant_threads ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.document_assistant_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.document_assistant_actions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.document_assistant_test_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.document_assistant_apply_runs ENABLE ROW LEVEL SECURITY;

-- Threads
CREATE POLICY "da_threads_select" ON public.document_assistant_threads FOR SELECT TO authenticated
  USING (public.has_project_access(auth.uid(), project_id));
CREATE POLICY "da_threads_insert" ON public.document_assistant_threads FOR INSERT TO authenticated
  WITH CHECK (public.has_project_access(auth.uid(), project_id) AND created_by = auth.uid());
CREATE POLICY "da_threads_update" ON public.document_assistant_threads FOR UPDATE TO authenticated
  USING (public.has_project_access(auth.uid(), project_id));

-- Messages (join through thread)
CREATE POLICY "da_messages_select" ON public.document_assistant_messages FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.document_assistant_threads t WHERE t.id = thread_id AND public.has_project_access(auth.uid(), t.project_id)));
CREATE POLICY "da_messages_insert" ON public.document_assistant_messages FOR INSERT TO authenticated
  WITH CHECK (EXISTS (SELECT 1 FROM public.document_assistant_threads t WHERE t.id = thread_id AND public.has_project_access(auth.uid(), t.project_id)));

-- Actions
CREATE POLICY "da_actions_select" ON public.document_assistant_actions FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.document_assistant_threads t WHERE t.id = thread_id AND public.has_project_access(auth.uid(), t.project_id)));
CREATE POLICY "da_actions_insert" ON public.document_assistant_actions FOR INSERT TO authenticated
  WITH CHECK (EXISTS (SELECT 1 FROM public.document_assistant_threads t WHERE t.id = thread_id AND public.has_project_access(auth.uid(), t.project_id)));
CREATE POLICY "da_actions_update" ON public.document_assistant_actions FOR UPDATE TO authenticated
  USING (EXISTS (SELECT 1 FROM public.document_assistant_threads t WHERE t.id = thread_id AND public.has_project_access(auth.uid(), t.project_id)));

-- Test runs (join through action->thread)
CREATE POLICY "da_test_runs_select" ON public.document_assistant_test_runs FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.document_assistant_actions a
    JOIN public.document_assistant_threads t ON t.id = a.thread_id
    WHERE a.id = action_id AND public.has_project_access(auth.uid(), t.project_id)
  ));
CREATE POLICY "da_test_runs_insert" ON public.document_assistant_test_runs FOR INSERT TO authenticated
  WITH CHECK (EXISTS (
    SELECT 1 FROM public.document_assistant_actions a
    JOIN public.document_assistant_threads t ON t.id = a.thread_id
    WHERE a.id = action_id AND public.has_project_access(auth.uid(), t.project_id)
  ));
CREATE POLICY "da_test_runs_update" ON public.document_assistant_test_runs FOR UPDATE TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.document_assistant_actions a
    JOIN public.document_assistant_threads t ON t.id = a.thread_id
    WHERE a.id = action_id AND public.has_project_access(auth.uid(), t.project_id)
  ));

-- Apply runs
CREATE POLICY "da_apply_runs_select" ON public.document_assistant_apply_runs FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.document_assistant_actions a
    JOIN public.document_assistant_threads t ON t.id = a.thread_id
    WHERE a.id = action_id AND public.has_project_access(auth.uid(), t.project_id)
  ));
CREATE POLICY "da_apply_runs_insert" ON public.document_assistant_apply_runs FOR INSERT TO authenticated
  WITH CHECK (EXISTS (
    SELECT 1 FROM public.document_assistant_actions a
    JOIN public.document_assistant_threads t ON t.id = a.thread_id
    WHERE a.id = action_id AND public.has_project_access(auth.uid(), t.project_id)
  ));
CREATE POLICY "da_apply_runs_update" ON public.document_assistant_apply_runs FOR UPDATE TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.document_assistant_actions a
    JOIN public.document_assistant_threads t ON t.id = a.thread_id
    WHERE a.id = action_id AND public.has_project_access(auth.uid(), t.project_id)
  ));
