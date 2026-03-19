
ALTER TABLE public.project_images
  ADD COLUMN IF NOT EXISTS provider text NOT NULL DEFAULT 'lovable-ai',
  ADD COLUMN IF NOT EXISTS model text NOT NULL DEFAULT 'google/gemini-3-pro-image-preview',
  ADD COLUMN IF NOT EXISTS style_mode text NOT NULL DEFAULT 'photorealistic_cinematic',
  ADD COLUMN IF NOT EXISTS generation_config jsonb NOT NULL DEFAULT '{}'::jsonb;

COMMENT ON COLUMN public.project_images.provider IS 'Image generation provider (e.g. lovable-ai)';
COMMENT ON COLUMN public.project_images.model IS 'Model used for generation (e.g. google/gemini-3-pro-image-preview)';
COMMENT ON COLUMN public.project_images.style_mode IS 'Resolved style mode at generation time';
COMMENT ON COLUMN public.project_images.generation_config IS 'Full resolver output including rationale, settings, fallback info';
