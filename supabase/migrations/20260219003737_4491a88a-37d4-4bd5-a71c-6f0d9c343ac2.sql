
-- Create project_dev_note_state table for persistent note fingerprinting and loop-killing
CREATE TABLE public.project_dev_note_state (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  doc_type text NOT NULL,
  episode_number int NULL,
  note_fingerprint text NOT NULL,
  note_cluster_id text NOT NULL,
  anchor text NULL,
  scope_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  tier text NOT NULL DEFAULT 'soft',
  status text NOT NULL DEFAULT 'open',
  first_seen_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  times_seen int NOT NULL DEFAULT 1,
  last_version_id uuid NULL REFERENCES public.project_document_versions(id) ON DELETE SET NULL,
  last_applied_version_id uuid NULL REFERENCES public.project_document_versions(id) ON DELETE SET NULL,
  depends_on text[] NOT NULL DEFAULT '{}'::text[],
  conflicts_with text[] NOT NULL DEFAULT '{}'::text[],
  waive_reason text NULL,
  defer_to_doc_type text NULL,
  lock_reason text NULL,
  witness_json jsonb NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Unique constraint: one state row per (project, doc_type, episode_number, fingerprint)
CREATE UNIQUE INDEX project_dev_note_state_unique_idx
  ON public.project_dev_note_state (project_id, doc_type, COALESCE(episode_number, -1), note_fingerprint);

-- Enable RLS
ALTER TABLE public.project_dev_note_state ENABLE ROW LEVEL SECURITY;

-- RLS policies: users can access notes for their own projects or projects they collaborate on
CREATE POLICY "project_dev_note_state_select"
  ON public.project_dev_note_state FOR SELECT
  USING (public.has_project_access(auth.uid(), project_id));

CREATE POLICY "project_dev_note_state_insert"
  ON public.project_dev_note_state FOR INSERT
  WITH CHECK (public.has_project_access(auth.uid(), project_id));

CREATE POLICY "project_dev_note_state_update"
  ON public.project_dev_note_state FOR UPDATE
  USING (public.has_project_access(auth.uid(), project_id));

CREATE POLICY "project_dev_note_state_delete"
  ON public.project_dev_note_state FOR DELETE
  USING (public.has_project_access(auth.uid(), project_id));

-- updated_at trigger
CREATE TRIGGER project_dev_note_state_updated_at
  BEFORE UPDATE ON public.project_dev_note_state
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();
