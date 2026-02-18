
-- project_shares table for "Share with People" feature
CREATE TABLE IF NOT EXISTS public.project_shares (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  project_id UUID NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  email TEXT,
  user_id UUID,
  role TEXT NOT NULL DEFAULT 'viewer' CHECK (role IN ('viewer', 'commenter', 'editor')),
  invited_by UUID NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  CONSTRAINT email_or_user CHECK (email IS NOT NULL OR user_id IS NOT NULL)
);

ALTER TABLE public.project_shares ENABLE ROW LEVEL SECURITY;

-- Owner can manage all shares for their projects
CREATE POLICY "project_shares_owner_all"
  ON public.project_shares
  FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM public.projects
      WHERE id = project_shares.project_id
        AND user_id = auth.uid()
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.projects
      WHERE id = project_shares.project_id
        AND user_id = auth.uid()
    )
  );

-- Shared users can see their own share record
CREATE POLICY "project_shares_self_read"
  ON public.project_shares
  FOR SELECT
  USING (user_id = auth.uid() OR email = (SELECT email FROM auth.users WHERE id = auth.uid()));

-- project_share_links table for "Share Link" feature
CREATE TABLE IF NOT EXISTS public.project_share_links (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  project_id UUID NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  scope TEXT NOT NULL DEFAULT 'approved_preferred' CHECK (scope IN ('approved_preferred', 'approved_only', 'latest_only')),
  expires_at TIMESTAMP WITH TIME ZONE NOT NULL,
  signed_url TEXT,
  storage_path TEXT,
  created_by UUID NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

ALTER TABLE public.project_share_links ENABLE ROW LEVEL SECURITY;

-- Owner can manage their share links
CREATE POLICY "project_share_links_owner_all"
  ON public.project_share_links
  FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM public.projects
      WHERE id = project_share_links.project_id
        AND user_id = auth.uid()
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.projects
      WHERE id = project_share_links.project_id
        AND user_id = auth.uid()
    )
  );

-- Create exports storage bucket if not exists
INSERT INTO storage.buckets (id, name, public) 
VALUES ('exports', 'exports', false)
ON CONFLICT (id) DO NOTHING;

-- RLS policies for exports bucket
CREATE POLICY "exports_owner_access"
  ON storage.objects
  FOR ALL
  USING (
    bucket_id = 'exports'
    AND auth.uid()::text = (storage.foldername(name))[1]
  )
  WITH CHECK (
    bucket_id = 'exports'
    AND auth.uid()::text = (storage.foldername(name))[1]
  );
