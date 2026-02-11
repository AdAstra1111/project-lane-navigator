
-- Create project deadlines table
CREATE TABLE public.project_deadlines (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  project_id UUID NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  user_id UUID NOT NULL,
  label TEXT NOT NULL DEFAULT '',
  deadline_type TEXT NOT NULL DEFAULT 'custom',
  due_date TIMESTAMP WITH TIME ZONE NOT NULL,
  notes TEXT NOT NULL DEFAULT '',
  completed BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.project_deadlines ENABLE ROW LEVEL SECURITY;

-- RLS policies
CREATE POLICY "Project members can view deadlines"
  ON public.project_deadlines FOR SELECT
  USING (has_project_access(auth.uid(), project_id));

CREATE POLICY "Project members can create deadlines"
  ON public.project_deadlines FOR INSERT
  WITH CHECK ((auth.uid() = user_id) AND has_project_access(auth.uid(), project_id));

CREATE POLICY "Project members can update deadlines"
  ON public.project_deadlines FOR UPDATE
  USING (has_project_access(auth.uid(), project_id));

CREATE POLICY "Project members can delete deadlines"
  ON public.project_deadlines FOR DELETE
  USING (has_project_access(auth.uid(), project_id));

-- Auto-update timestamp
CREATE TRIGGER update_project_deadlines_updated_at
  BEFORE UPDATE ON public.project_deadlines
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

-- Activity logging trigger
CREATE TRIGGER log_project_deadlines_activity
  AFTER INSERT OR UPDATE OR DELETE ON public.project_deadlines
  FOR EACH ROW
  EXECUTE FUNCTION public.log_project_activity();
