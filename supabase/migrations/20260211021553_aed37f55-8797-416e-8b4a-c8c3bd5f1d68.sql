
-- Activity log for tracking changes across project sections
CREATE TABLE public.project_activity_log (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  project_id UUID NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  user_id UUID NOT NULL,
  action TEXT NOT NULL DEFAULT 'update',
  section TEXT NOT NULL DEFAULT 'general',
  entity_type TEXT NOT NULL DEFAULT '',
  entity_id UUID,
  summary TEXT NOT NULL DEFAULT '',
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Index for fast project lookups
CREATE INDEX idx_activity_log_project ON public.project_activity_log(project_id, created_at DESC);

-- Enable RLS
ALTER TABLE public.project_activity_log ENABLE ROW LEVEL SECURITY;

-- Project members can view activity
CREATE POLICY "Project members can view activity"
ON public.project_activity_log FOR SELECT
USING (has_project_access(auth.uid(), project_id));

-- Authenticated users can insert activity for accessible projects
CREATE POLICY "Project members can create activity"
ON public.project_activity_log FOR INSERT
WITH CHECK (auth.uid() = user_id AND has_project_access(auth.uid(), project_id));

-- Enable realtime
ALTER PUBLICATION supabase_realtime ADD TABLE public.project_activity_log;

-- Trigger function to auto-log updates on key tables
CREATE OR REPLACE FUNCTION public.log_project_activity()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  _action TEXT;
  _summary TEXT;
  _section TEXT;
BEGIN
  _action := TG_OP;
  _section := TG_TABLE_NAME;

  IF TG_OP = 'INSERT' THEN
    _summary := 'Added ' || TG_TABLE_NAME;
    INSERT INTO public.project_activity_log (project_id, user_id, action, section, entity_type, entity_id, summary)
    VALUES (NEW.project_id, NEW.user_id, 'create', _section, TG_TABLE_NAME, NEW.id, _summary);
    RETURN NEW;
  ELSIF TG_OP = 'UPDATE' THEN
    _summary := 'Updated ' || TG_TABLE_NAME;
    INSERT INTO public.project_activity_log (project_id, user_id, action, section, entity_type, entity_id, summary)
    VALUES (NEW.project_id, NEW.user_id, 'update', _section, TG_TABLE_NAME, NEW.id, _summary);
    RETURN NEW;
  ELSIF TG_OP = 'DELETE' THEN
    _summary := 'Removed ' || TG_TABLE_NAME;
    INSERT INTO public.project_activity_log (project_id, user_id, action, section, entity_type, entity_id, summary)
    VALUES (OLD.project_id, OLD.user_id, 'delete', _section, TG_TABLE_NAME, OLD.id, _summary);
    RETURN OLD;
  END IF;
  RETURN NULL;
END;
$$;

-- Attach triggers to key project tables
CREATE TRIGGER log_activity_project_cast
AFTER INSERT OR UPDATE OR DELETE ON public.project_cast
FOR EACH ROW EXECUTE FUNCTION public.log_project_activity();

CREATE TRIGGER log_activity_project_deals
AFTER INSERT OR UPDATE OR DELETE ON public.project_deals
FOR EACH ROW EXECUTE FUNCTION public.log_project_activity();

CREATE TRIGGER log_activity_project_budgets
AFTER INSERT OR UPDATE OR DELETE ON public.project_budgets
FOR EACH ROW EXECUTE FUNCTION public.log_project_activity();

CREATE TRIGGER log_activity_project_contracts
AFTER INSERT OR UPDATE OR DELETE ON public.project_contracts
FOR EACH ROW EXECUTE FUNCTION public.log_project_activity();

CREATE TRIGGER log_activity_project_deliverables
AFTER INSERT OR UPDATE OR DELETE ON public.project_deliverables
FOR EACH ROW EXECUTE FUNCTION public.log_project_activity();

CREATE TRIGGER log_activity_project_hods
AFTER INSERT OR UPDATE OR DELETE ON public.project_hods
FOR EACH ROW EXECUTE FUNCTION public.log_project_activity();

CREATE TRIGGER log_activity_project_partners
AFTER INSERT OR UPDATE OR DELETE ON public.project_partners
FOR EACH ROW EXECUTE FUNCTION public.log_project_activity();

CREATE TRIGGER log_activity_project_documents
AFTER INSERT OR UPDATE OR DELETE ON public.project_documents
FOR EACH ROW EXECUTE FUNCTION public.log_project_activity();

CREATE TRIGGER log_activity_project_comments
AFTER INSERT OR UPDATE OR DELETE ON public.project_comments
FOR EACH ROW EXECUTE FUNCTION public.log_project_activity();

CREATE TRIGGER log_activity_project_scripts
AFTER INSERT OR UPDATE OR DELETE ON public.project_scripts
FOR EACH ROW EXECUTE FUNCTION public.log_project_activity();
