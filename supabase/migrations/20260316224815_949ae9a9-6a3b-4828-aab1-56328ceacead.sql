
-- DNA source links child table
CREATE TABLE public.dna_source_links (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  dna_profile_id UUID NOT NULL REFERENCES public.narrative_dna_profiles(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  source_label TEXT NOT NULL,
  source_url TEXT NOT NULL,
  source_type TEXT NOT NULL DEFAULT 'other',
  is_primary BOOLEAN NOT NULL DEFAULT false,
  notes TEXT DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Indexes
CREATE INDEX idx_dna_source_links_dna_profile_id ON public.dna_source_links(dna_profile_id);
CREATE INDEX idx_dna_source_links_user_id ON public.dna_source_links(user_id);

-- Updated_at trigger
CREATE TRIGGER set_dna_source_links_updated_at
  BEFORE UPDATE ON public.dna_source_links
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- RLS
ALTER TABLE public.dna_source_links ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own dna source links"
  ON public.dna_source_links FOR SELECT
  TO authenticated
  USING (user_id = auth.uid());

CREATE POLICY "Users can insert own dna source links"
  ON public.dna_source_links FOR INSERT
  TO authenticated
  WITH CHECK (user_id = auth.uid());

CREATE POLICY "Users can update own dna source links"
  ON public.dna_source_links FOR UPDATE
  TO authenticated
  USING (user_id = auth.uid());

CREATE POLICY "Users can delete own dna source links"
  ON public.dna_source_links FOR DELETE
  TO authenticated
  USING (user_id = auth.uid());
