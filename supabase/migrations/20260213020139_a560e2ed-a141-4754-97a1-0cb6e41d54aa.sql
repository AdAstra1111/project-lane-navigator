
-- Table to store generated pitch decks
CREATE TABLE public.pitch_decks (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  project_id UUID NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  user_id UUID NOT NULL,
  slides JSONB NOT NULL DEFAULT '[]'::jsonb,
  tone TEXT NOT NULL DEFAULT 'adaptive',
  share_token TEXT UNIQUE DEFAULT encode(gen_random_bytes(16), 'hex'),
  status TEXT NOT NULL DEFAULT 'generating',
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.pitch_decks ENABLE ROW LEVEL SECURITY;

-- Owner access
CREATE POLICY "Users can view their own pitch decks"
  ON public.pitch_decks FOR SELECT
  USING (auth.uid() = user_id OR public.has_project_access(auth.uid(), project_id));

CREATE POLICY "Users can create pitch decks for their projects"
  ON public.pitch_decks FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update their own pitch decks"
  ON public.pitch_decks FOR UPDATE
  USING (auth.uid() = user_id);

CREATE POLICY "Users can delete their own pitch decks"
  ON public.pitch_decks FOR DELETE
  USING (auth.uid() = user_id);

-- Public access via share token (for shareable links)
CREATE POLICY "Anyone can view shared pitch decks"
  ON public.pitch_decks FOR SELECT
  USING (share_token IS NOT NULL);

-- Indexes
CREATE INDEX idx_pitch_decks_project ON public.pitch_decks(project_id);
CREATE INDEX idx_pitch_decks_share ON public.pitch_decks(share_token);

-- Updated at trigger
CREATE TRIGGER update_pitch_decks_updated_at
  BEFORE UPDATE ON public.pitch_decks
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
