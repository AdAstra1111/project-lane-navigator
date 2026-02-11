
-- Add branding columns to production companies
ALTER TABLE public.production_companies
  ADD COLUMN color_accent TEXT NOT NULL DEFAULT '',
  ADD COLUMN jurisdiction TEXT NOT NULL DEFAULT '';

-- Create storage bucket for company logos
INSERT INTO storage.buckets (id, name, public) VALUES ('company-logos', 'company-logos', true);

-- Allow authenticated users to upload their own logos
CREATE POLICY "Users can upload company logos"
  ON storage.objects FOR INSERT
  WITH CHECK (bucket_id = 'company-logos' AND auth.uid()::text = (storage.foldername(name))[1]);

CREATE POLICY "Users can update company logos"
  ON storage.objects FOR UPDATE
  USING (bucket_id = 'company-logos' AND auth.uid()::text = (storage.foldername(name))[1]);

CREATE POLICY "Users can delete company logos"
  ON storage.objects FOR DELETE
  USING (bucket_id = 'company-logos' AND auth.uid()::text = (storage.foldername(name))[1]);

CREATE POLICY "Company logos are publicly viewable"
  ON storage.objects FOR SELECT
  USING (bucket_id = 'company-logos');
