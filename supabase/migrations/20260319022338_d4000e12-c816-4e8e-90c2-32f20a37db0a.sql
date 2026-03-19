
CREATE TABLE public.character_identity_notes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  character_name text NOT NULL,
  notes text NOT NULL DEFAULT '',
  canon_check_status text NOT NULL DEFAULT 'unchecked',
  canon_check_messages jsonb NOT NULL DEFAULT '[]'::jsonb,
  updated_at timestamptz NOT NULL DEFAULT now(),
  user_id uuid NOT NULL
);

CREATE UNIQUE INDEX idx_character_identity_notes_unique ON public.character_identity_notes(project_id, character_name);

ALTER TABLE public.character_identity_notes ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can manage their own identity notes"
  ON public.character_identity_notes
  FOR ALL
  TO authenticated
  USING (public.has_project_access(auth.uid(), project_id))
  WITH CHECK (public.has_project_access(auth.uid(), project_id));
