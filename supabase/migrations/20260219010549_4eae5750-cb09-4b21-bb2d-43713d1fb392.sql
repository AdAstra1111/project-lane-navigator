-- Add missing columns to project_dev_note_state
ALTER TABLE public.project_dev_note_state
  ADD COLUMN IF NOT EXISTS intent_label text NULL,
  ADD COLUMN IF NOT EXISTS objective text NULL,
  ADD COLUMN IF NOT EXISTS constraint_key text NULL,
  ADD COLUMN IF NOT EXISTS severity real NOT NULL DEFAULT 0.5,
  ADD COLUMN IF NOT EXISTS conflict_json jsonb NULL,
  ADD COLUMN IF NOT EXISTS canon_hash text NULL,
  ADD COLUMN IF NOT EXISTS conflict_resolution_type text NULL;

-- Create project_dev_decision_state table
CREATE TABLE IF NOT EXISTS public.project_dev_decision_state (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  doc_type text NOT NULL,
  episode_number integer NULL,
  decision_id text NOT NULL,
  goal text NOT NULL,
  anchor text NULL,
  scope_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  option_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  chosen_option_id text NULL,
  status text NOT NULL DEFAULT 'open',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Unique index for decision state
CREATE UNIQUE INDEX IF NOT EXISTS project_dev_decision_state_unique_idx
  ON public.project_dev_decision_state (project_id, doc_type, COALESCE(episode_number, -1), decision_id);

-- Enable RLS
ALTER TABLE public.project_dev_decision_state ENABLE ROW LEVEL SECURITY;

-- RLS policies (edge function uses service role for writes; frontend reads via auth)
CREATE POLICY "Users can view their own project decisions"
  ON public.project_dev_decision_state FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.projects
      WHERE id = project_dev_decision_state.project_id
      AND user_id = auth.uid()
    )
  );

CREATE POLICY "Users can insert their own project decisions"
  ON public.project_dev_decision_state FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.projects
      WHERE id = project_dev_decision_state.project_id
      AND user_id = auth.uid()
    )
  );

CREATE POLICY "Users can update their own project decisions"
  ON public.project_dev_decision_state FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM public.projects
      WHERE id = project_dev_decision_state.project_id
      AND user_id = auth.uid()
    )
  );

-- updated_at trigger for project_dev_decision_state
CREATE OR REPLACE FUNCTION public.update_dev_decision_state_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SET search_path = public;

DROP TRIGGER IF EXISTS trg_dev_decision_state_updated_at ON public.project_dev_decision_state;
CREATE TRIGGER trg_dev_decision_state_updated_at
  BEFORE UPDATE ON public.project_dev_decision_state
  FOR EACH ROW EXECUTE FUNCTION public.update_dev_decision_state_updated_at();

-- updated_at trigger for project_dev_note_state (idempotent)
CREATE OR REPLACE FUNCTION public.update_dev_note_state_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SET search_path = public;

DROP TRIGGER IF EXISTS trg_dev_note_state_updated_at ON public.project_dev_note_state;
CREATE TRIGGER trg_dev_note_state_updated_at
  BEFORE UPDATE ON public.project_dev_note_state
  FOR EACH ROW EXECUTE FUNCTION public.update_dev_note_state_updated_at();