
-- Brand assets table for reusable branding (logos, marks, etc.)
CREATE TABLE public.brand_assets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  asset_type TEXT NOT NULL DEFAULT 'logo',
  label TEXT NOT NULL DEFAULT 'primary',
  storage_path TEXT NOT NULL,
  mime_type TEXT NOT NULL DEFAULT 'image/png',
  width INTEGER,
  height INTEGER,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(user_id, asset_type, label)
);

ALTER TABLE public.brand_assets ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can manage own brand assets"
  ON public.brand_assets FOR ALL
  TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

-- Storage bucket for brand assets
INSERT INTO storage.buckets (id, name, public)
VALUES ('brand-assets', 'brand-assets', false)
ON CONFLICT (id) DO NOTHING;

-- RLS for brand-assets bucket
CREATE POLICY "Users can upload own brand assets"
  ON storage.objects FOR INSERT
  TO authenticated
  WITH CHECK (bucket_id = 'brand-assets' AND (storage.foldername(name))[1] = auth.uid()::text);

CREATE POLICY "Users can read own brand assets"
  ON storage.objects FOR SELECT
  TO authenticated
  USING (bucket_id = 'brand-assets' AND (storage.foldername(name))[1] = auth.uid()::text);

CREATE POLICY "Users can update own brand assets"
  ON storage.objects FOR UPDATE
  TO authenticated
  USING (bucket_id = 'brand-assets' AND (storage.foldername(name))[1] = auth.uid()::text);

CREATE POLICY "Users can delete own brand assets"
  ON storage.objects FOR DELETE
  TO authenticated
  USING (bucket_id = 'brand-assets' AND (storage.foldername(name))[1] = auth.uid()::text);

-- Service role needs to read brand assets for PDF export edge functions
CREATE POLICY "Service role can read all brand assets"
  ON storage.objects FOR SELECT
  TO service_role
  USING (bucket_id = 'brand-assets');

CREATE POLICY "Service role can read brand_assets table"
  ON public.brand_assets FOR SELECT
  TO service_role
  USING (true);
