
-- Table for comp script source references (provenance only, no full text)
CREATE TABLE public.comparable_script_sources (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL,
  project_id UUID NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  lane TEXT NOT NULL DEFAULT 'feature_film',
  comp_title TEXT NOT NULL,
  source_type TEXT NOT NULL DEFAULT 'upload',  -- 'upload' | 'url' | 'project_doc'
  source_url TEXT,
  storage_path TEXT,
  project_doc_id UUID REFERENCES public.project_documents(id) ON DELETE SET NULL,
  file_name TEXT,
  char_count INTEGER,
  metadata JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- RLS
ALTER TABLE public.comparable_script_sources ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own script sources"
  ON public.comparable_script_sources FOR SELECT
  USING (user_id = auth.uid() OR has_project_access(auth.uid(), project_id));

CREATE POLICY "Users can insert own script sources"
  ON public.comparable_script_sources FOR INSERT
  WITH CHECK (user_id = auth.uid());

CREATE POLICY "Users can delete own script sources"
  ON public.comparable_script_sources FOR DELETE
  USING (user_id = auth.uid());

-- Storage bucket for comp scripts
INSERT INTO storage.buckets (id, name, public)
VALUES ('comp-scripts', 'comp-scripts', false)
ON CONFLICT (id) DO NOTHING;

-- Storage RLS
CREATE POLICY "Users can upload comp scripts"
  ON storage.objects FOR INSERT
  WITH CHECK (bucket_id = 'comp-scripts' AND auth.uid()::text = (storage.foldername(name))[1]);

CREATE POLICY "Users can read own comp scripts"
  ON storage.objects FOR SELECT
  USING (bucket_id = 'comp-scripts' AND auth.uid()::text = (storage.foldername(name))[1]);

CREATE POLICY "Users can delete own comp scripts"
  ON storage.objects FOR DELETE
  USING (bucket_id = 'comp-scripts' AND auth.uid()::text = (storage.foldername(name))[1]);
