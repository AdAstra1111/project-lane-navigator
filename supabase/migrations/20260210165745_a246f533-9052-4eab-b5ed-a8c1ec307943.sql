
-- Table to store invite tokens
CREATE TABLE public.project_invite_links (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  project_id UUID NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  token TEXT NOT NULL UNIQUE DEFAULT encode(gen_random_bytes(24), 'hex'),
  role public.project_role NOT NULL DEFAULT 'creative',
  created_by UUID NOT NULL,
  expires_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT (now() + interval '7 days'),
  max_uses INT DEFAULT NULL,
  use_count INT NOT NULL DEFAULT 0,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

ALTER TABLE public.project_invite_links ENABLE ROW LEVEL SECURITY;

-- Only project owners can create/view invite links
CREATE POLICY "Project owners can manage invite links"
  ON public.project_invite_links
  FOR ALL
  USING (
    EXISTS (SELECT 1 FROM public.projects WHERE id = project_id AND user_id = auth.uid())
  )
  WITH CHECK (
    EXISTS (SELECT 1 FROM public.projects WHERE id = project_id AND user_id = auth.uid())
  );

-- Function to accept an invite link
CREATE OR REPLACE FUNCTION public.accept_invite_link(_token TEXT)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  _invite project_invite_links%ROWTYPE;
  _user_id UUID;
  _email TEXT;
BEGIN
  _user_id := auth.uid();
  IF _user_id IS NULL THEN
    RETURN jsonb_build_object('error', 'Not authenticated');
  END IF;

  SELECT * INTO _invite FROM project_invite_links WHERE token = _token;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('error', 'Invalid invite link');
  END IF;

  IF _invite.expires_at < now() THEN
    RETURN jsonb_build_object('error', 'This invite link has expired');
  END IF;

  IF _invite.max_uses IS NOT NULL AND _invite.use_count >= _invite.max_uses THEN
    RETURN jsonb_build_object('error', 'This invite link has reached its usage limit');
  END IF;

  -- Check if user is already the owner
  IF EXISTS (SELECT 1 FROM projects WHERE id = _invite.project_id AND user_id = _user_id) THEN
    RETURN jsonb_build_object('error', 'You are already the owner of this project');
  END IF;

  -- Check if already a collaborator
  IF EXISTS (SELECT 1 FROM project_collaborators WHERE project_id = _invite.project_id AND user_id = _user_id) THEN
    RETURN jsonb_build_object('error', 'You are already a collaborator on this project');
  END IF;

  -- Get user email
  SELECT email INTO _email FROM auth.users WHERE id = _user_id;

  -- Add as collaborator
  INSERT INTO project_collaborators (project_id, user_id, invited_by, email, role, status)
  VALUES (_invite.project_id, _user_id, _invite.created_by, COALESCE(_email, ''), _invite.role, 'accepted');

  -- Increment use count
  UPDATE project_invite_links SET use_count = use_count + 1 WHERE id = _invite.id;

  RETURN jsonb_build_object('success', true, 'project_id', _invite.project_id);
END;
$$;
