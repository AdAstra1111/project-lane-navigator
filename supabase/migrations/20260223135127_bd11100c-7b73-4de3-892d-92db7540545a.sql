-- Add trailer_shotlist_id to ai_generated_media for efficient querying
ALTER TABLE public.ai_generated_media
  ADD COLUMN IF NOT EXISTS trailer_shotlist_id uuid REFERENCES public.trailer_shotlists(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS ai_generated_media_trailer_shotlist_idx
  ON public.ai_generated_media(trailer_shotlist_id)
  WHERE trailer_shotlist_id IS NOT NULL;