
-- Add missing columns to storyboard_frames
ALTER TABLE public.storyboard_frames 
  ADD COLUMN IF NOT EXISTS deleted_at timestamptz DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS storage_path text DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS mime_type text DEFAULT 'image/png';

-- Add indexes for efficient querying
CREATE INDEX IF NOT EXISTS idx_storyboard_frames_project_shot_created 
  ON public.storyboard_frames(project_id, shot_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_storyboard_frames_project_deleted 
  ON public.storyboard_frames(project_id, deleted_at);

-- Make storyboards bucket public so images render
UPDATE storage.buckets SET public = true WHERE id = 'storyboards';

-- Enable RLS
ALTER TABLE public.storyboard_frames ENABLE ROW LEVEL SECURITY;

-- RLS policies
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'storyboard_frames' AND policyname = 'storyboard_frames_select') THEN
    CREATE POLICY storyboard_frames_select ON public.storyboard_frames FOR SELECT TO authenticated
      USING (public.has_project_access(auth.uid(), project_id));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'storyboard_frames' AND policyname = 'storyboard_frames_insert') THEN
    CREATE POLICY storyboard_frames_insert ON public.storyboard_frames FOR INSERT TO authenticated
      WITH CHECK (public.has_project_access(auth.uid(), project_id));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'storyboard_frames' AND policyname = 'storyboard_frames_update') THEN
    CREATE POLICY storyboard_frames_update ON public.storyboard_frames FOR UPDATE TO authenticated
      USING (public.has_project_access(auth.uid(), project_id));
  END IF;
END $$;
