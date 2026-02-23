
-- ============================================================
-- Trailer Assembler v2 — Enhanced timeline + audit
-- ============================================================

-- 1) Add trim/reorder fields to existing timeline entries in trailer_cuts
ALTER TABLE public.trailer_cuts
  ADD COLUMN IF NOT EXISTS title text NULL,
  ADD COLUMN IF NOT EXISTS arc_type text NULL,
  ADD COLUMN IF NOT EXISTS render_width int NOT NULL DEFAULT 1280,
  ADD COLUMN IF NOT EXISTS render_height int NOT NULL DEFAULT 720,
  ADD COLUMN IF NOT EXISTS render_fps int NOT NULL DEFAULT 24;

-- 2) trailer_cut_events (audit trail for all timeline edits)
CREATE TABLE IF NOT EXISTS public.trailer_cut_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL,
  cut_id uuid NOT NULL REFERENCES public.trailer_cuts(id) ON DELETE CASCADE,
  blueprint_id uuid NULL,
  beat_index int NULL,
  event_type text NOT NULL,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_tce2_project_created ON public.trailer_cut_events(project_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_tce2_cut_created ON public.trailer_cut_events(cut_id, created_at DESC);

ALTER TABLE public.trailer_cut_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY "trailer_cut_events_access" ON public.trailer_cut_events
  FOR ALL USING (public.has_project_access(auth.uid(), project_id))
  WITH CHECK (public.has_project_access(auth.uid(), project_id));
