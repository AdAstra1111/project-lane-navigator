
-- Share Packs
CREATE TABLE public.project_share_packs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  name TEXT NOT NULL DEFAULT '',
  pack_type TEXT NOT NULL DEFAULT 'investor',
  selection JSONB NOT NULL DEFAULT '[]'::jsonb,
  include_cover BOOLEAN NOT NULL DEFAULT true,
  include_contents BOOLEAN NOT NULL DEFAULT true,
  watermark_enabled BOOLEAN NOT NULL DEFAULT true,
  watermark_text TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.project_share_packs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Project members can manage share packs"
  ON public.project_share_packs FOR ALL
  TO authenticated
  USING (public.has_project_access(auth.uid(), project_id))
  WITH CHECK (public.has_project_access(auth.uid(), project_id));

CREATE INDEX idx_share_packs_project ON public.project_share_packs(project_id);

-- Share Pack Links
CREATE TABLE public.project_share_pack_links (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  share_pack_id UUID NOT NULL REFERENCES public.project_share_packs(id) ON DELETE CASCADE,
  token TEXT NOT NULL UNIQUE DEFAULT encode(gen_random_bytes(32), 'hex'),
  password_hash TEXT,
  expires_at TIMESTAMPTZ,
  max_downloads INT,
  download_count INT NOT NULL DEFAULT 0,
  is_revoked BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE
);

ALTER TABLE public.project_share_pack_links ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Project members can manage share pack links"
  ON public.project_share_pack_links FOR ALL
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.project_share_packs sp
      WHERE sp.id = share_pack_id
      AND public.has_project_access(auth.uid(), sp.project_id)
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.project_share_packs sp
      WHERE sp.id = share_pack_id
      AND public.has_project_access(auth.uid(), sp.project_id)
    )
  );

CREATE POLICY "Anyone can read links by token"
  ON public.project_share_pack_links FOR SELECT
  TO anon
  USING (true);

CREATE INDEX idx_share_pack_links_token ON public.project_share_pack_links(token);

-- Share Pack Events (analytics)
CREATE TABLE public.project_share_pack_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  link_id UUID NOT NULL REFERENCES public.project_share_pack_links(id) ON DELETE CASCADE,
  event_type TEXT NOT NULL DEFAULT 'view',
  metadata JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.project_share_pack_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Project members can read events"
  ON public.project_share_pack_events FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.project_share_pack_links l
      JOIN public.project_share_packs sp ON sp.id = l.share_pack_id
      WHERE l.id = link_id
      AND public.has_project_access(auth.uid(), sp.project_id)
    )
  );

CREATE POLICY "Anon can log events"
  ON public.project_share_pack_events FOR INSERT
  TO anon
  WITH CHECK (true);

CREATE POLICY "Authenticated can log events"
  ON public.project_share_pack_events FOR INSERT
  TO authenticated
  WITH CHECK (true);

CREATE TRIGGER set_share_packs_updated_at
  BEFORE UPDATE ON public.project_share_packs
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
