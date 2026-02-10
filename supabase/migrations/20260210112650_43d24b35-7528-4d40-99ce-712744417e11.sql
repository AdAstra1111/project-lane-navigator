-- Create project role enum
CREATE TYPE public.project_role AS ENUM ('producer', 'sales_agent', 'lawyer', 'creative');

-- Project collaborators table
CREATE TABLE public.project_collaborators (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  project_id uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  user_id uuid NOT NULL,
  invited_by uuid NOT NULL,
  email text NOT NULL DEFAULT '',
  role project_role NOT NULL DEFAULT 'creative',
  status text NOT NULL DEFAULT 'pending', -- pending | accepted | declined
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(project_id, user_id)
);

ALTER TABLE public.project_collaborators ENABLE ROW LEVEL SECURITY;

-- Owner can manage collaborators on their projects
CREATE POLICY "Project owners can manage collaborators"
ON public.project_collaborators
FOR ALL
USING (
  EXISTS (
    SELECT 1 FROM public.projects
    WHERE projects.id = project_collaborators.project_id
    AND projects.user_id = auth.uid()
  )
)
WITH CHECK (
  EXISTS (
    SELECT 1 FROM public.projects
    WHERE projects.id = project_collaborators.project_id
    AND projects.user_id = auth.uid()
  )
);

-- Collaborators can view their own invitations
CREATE POLICY "Users can view their own collaborations"
ON public.project_collaborators
FOR SELECT
USING (auth.uid() = user_id);

-- Collaborators can update their own invitation (accept/decline)
CREATE POLICY "Users can update their own collaboration status"
ON public.project_collaborators
FOR UPDATE
USING (auth.uid() = user_id);

-- Project comments table (threaded)
CREATE TABLE public.project_comments (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  project_id uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  user_id uuid NOT NULL,
  parent_id uuid REFERENCES public.project_comments(id) ON DELETE CASCADE,
  section text NOT NULL DEFAULT 'general', -- general | analysis | cast | finance | incentives | packaging | script
  content text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.project_comments ENABLE ROW LEVEL SECURITY;

-- Security definer function to check project access (owner or accepted collaborator)
CREATE OR REPLACE FUNCTION public.has_project_access(_user_id uuid, _project_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.projects
    WHERE id = _project_id AND user_id = _user_id
  )
  OR EXISTS (
    SELECT 1 FROM public.project_collaborators
    WHERE project_id = _project_id
    AND user_id = _user_id
    AND status = 'accepted'
  )
$$;

-- Security definer function to get user's role on a project
CREATE OR REPLACE FUNCTION public.get_project_role(_user_id uuid, _project_id uuid)
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    CASE
      WHEN EXISTS (SELECT 1 FROM public.projects WHERE id = _project_id AND user_id = _user_id)
      THEN 'owner'
      ELSE (
        SELECT role::text FROM public.project_collaborators
        WHERE project_id = _project_id AND user_id = _user_id AND status = 'accepted'
        LIMIT 1
      )
    END
$$;

-- Anyone with project access can view comments
CREATE POLICY "Project members can view comments"
ON public.project_comments
FOR SELECT
USING (public.has_project_access(auth.uid(), project_id));

-- Anyone with project access can create comments
CREATE POLICY "Project members can create comments"
ON public.project_comments
FOR INSERT
WITH CHECK (
  auth.uid() = user_id
  AND public.has_project_access(auth.uid(), project_id)
);

-- Users can update their own comments
CREATE POLICY "Users can update their own comments"
ON public.project_comments
FOR UPDATE
USING (auth.uid() = user_id);

-- Users can delete their own comments, owners can delete any
CREATE POLICY "Users can delete their own comments"
ON public.project_comments
FOR DELETE
USING (
  auth.uid() = user_id
  OR EXISTS (
    SELECT 1 FROM public.projects
    WHERE id = project_comments.project_id
    AND user_id = auth.uid()
  )
);

-- Update projects SELECT policy to include collaborators
DROP POLICY IF EXISTS "Users can view their own projects" ON public.projects;
CREATE POLICY "Users can view their own projects or collaborations"
ON public.projects
FOR SELECT
USING (
  auth.uid() = user_id
  OR public.has_project_access(auth.uid(), id)
);

-- Timestamp triggers
CREATE TRIGGER update_project_collaborators_updated_at
BEFORE UPDATE ON public.project_collaborators
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER update_project_comments_updated_at
BEFORE UPDATE ON public.project_comments
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();

-- Enable realtime for comments
ALTER PUBLICATION supabase_realtime ADD TABLE public.project_comments;