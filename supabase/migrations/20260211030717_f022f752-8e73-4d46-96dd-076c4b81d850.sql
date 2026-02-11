
-- Decision Journal table
CREATE TABLE public.project_decisions (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  project_id UUID NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  user_id UUID NOT NULL,
  title TEXT NOT NULL DEFAULT '',
  context TEXT NOT NULL DEFAULT '',
  decision TEXT NOT NULL DEFAULT '',
  reasoning TEXT NOT NULL DEFAULT '',
  outcome TEXT NOT NULL DEFAULT '',
  decision_type TEXT NOT NULL DEFAULT 'strategic',
  status TEXT NOT NULL DEFAULT 'active',
  decided_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

ALTER TABLE public.project_decisions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Project members can view decisions"
  ON public.project_decisions FOR SELECT
  USING (public.has_project_access(auth.uid(), project_id));

CREATE POLICY "Project members can create decisions"
  ON public.project_decisions FOR INSERT
  WITH CHECK (auth.uid() = user_id AND public.has_project_access(auth.uid(), project_id));

CREATE POLICY "Project members can update decisions"
  ON public.project_decisions FOR UPDATE
  USING (public.has_project_access(auth.uid(), project_id));

CREATE POLICY "Project members can delete decisions"
  ON public.project_decisions FOR DELETE
  USING (public.has_project_access(auth.uid(), project_id));

CREATE TRIGGER update_project_decisions_updated_at
  BEFORE UPDATE ON public.project_decisions
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Activity log trigger
CREATE TRIGGER log_project_decisions_activity
  AFTER INSERT OR UPDATE OR DELETE ON public.project_decisions
  FOR EACH ROW EXECUTE FUNCTION public.log_project_activity();

-- AI Chat history table
CREATE TABLE public.project_chat_messages (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  project_id UUID NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  user_id UUID NOT NULL,
  role TEXT NOT NULL DEFAULT 'user',
  content TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

ALTER TABLE public.project_chat_messages ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Project members can view chat"
  ON public.project_chat_messages FOR SELECT
  USING (public.has_project_access(auth.uid(), project_id));

CREATE POLICY "Project members can create chat"
  ON public.project_chat_messages FOR INSERT
  WITH CHECK (auth.uid() = user_id AND public.has_project_access(auth.uid(), project_id));

CREATE POLICY "Project members can delete chat"
  ON public.project_chat_messages FOR DELETE
  USING (public.has_project_access(auth.uid(), project_id));
