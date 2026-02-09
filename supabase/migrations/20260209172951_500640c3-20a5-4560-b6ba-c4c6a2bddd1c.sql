
-- Create project_hods table for Heads of Department
CREATE TABLE public.project_hods (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  project_id UUID NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  user_id UUID NOT NULL,
  department TEXT NOT NULL DEFAULT '',
  person_name TEXT NOT NULL DEFAULT '',
  known_for TEXT NOT NULL DEFAULT '',
  reputation_tier TEXT NOT NULL DEFAULT 'emerging',
  status TEXT NOT NULL DEFAULT 'wishlist',
  notes TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.project_hods ENABLE ROW LEVEL SECURITY;

-- RLS policies
CREATE POLICY "Users can view their own project HODs"
  ON public.project_hods FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can create their own project HODs"
  ON public.project_hods FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update their own project HODs"
  ON public.project_hods FOR UPDATE
  USING (auth.uid() = user_id);

CREATE POLICY "Users can delete their own project HODs"
  ON public.project_hods FOR DELETE
  USING (auth.uid() = user_id);

-- Trigger for updated_at
CREATE TRIGGER update_project_hods_updated_at
  BEFORE UPDATE ON public.project_hods
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();
