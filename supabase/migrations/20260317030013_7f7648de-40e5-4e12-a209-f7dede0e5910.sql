
ALTER TABLE public.pitch_ideas
  ADD COLUMN IF NOT EXISTS is_exemplar boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS exemplar_notes text,
  ADD COLUMN IF NOT EXISTS strength_tags text[] NOT NULL DEFAULT '{}';
