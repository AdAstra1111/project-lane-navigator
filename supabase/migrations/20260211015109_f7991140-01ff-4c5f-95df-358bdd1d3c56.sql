
-- Create deliverables tracking table
CREATE TABLE public.project_deliverables (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  project_id UUID NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  user_id UUID NOT NULL,
  territory TEXT NOT NULL DEFAULT '',
  buyer_name TEXT NOT NULL DEFAULT '',
  deliverable_type TEXT NOT NULL DEFAULT 'technical',
  item_name TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'pending',
  due_date TIMESTAMP WITH TIME ZONE,
  notes TEXT NOT NULL DEFAULT '',
  rights_window TEXT NOT NULL DEFAULT '',
  format_spec TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.project_deliverables ENABLE ROW LEVEL SECURITY;

-- RLS policies
CREATE POLICY "Project members can view deliverables"
  ON public.project_deliverables FOR SELECT
  USING (has_project_access(auth.uid(), project_id));

CREATE POLICY "Project members can create deliverables"
  ON public.project_deliverables FOR INSERT
  WITH CHECK (auth.uid() = user_id AND has_project_access(auth.uid(), project_id));

CREATE POLICY "Project members can update deliverables"
  ON public.project_deliverables FOR UPDATE
  USING (has_project_access(auth.uid(), project_id));

CREATE POLICY "Project members can delete deliverables"
  ON public.project_deliverables FOR DELETE
  USING (has_project_access(auth.uid(), project_id));

-- Trigger for updated_at
CREATE TRIGGER update_project_deliverables_updated_at
  BEFORE UPDATE ON public.project_deliverables
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

-- Index for fast lookups
CREATE INDEX idx_project_deliverables_project ON public.project_deliverables(project_id);
