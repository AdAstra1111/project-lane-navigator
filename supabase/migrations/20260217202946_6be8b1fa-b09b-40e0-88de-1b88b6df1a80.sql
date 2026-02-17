
-- Decision Ledger: persistent canonical decisions from note resolution
CREATE TABLE IF NOT EXISTS decision_ledger (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  decision_key text NOT NULL,
  title text NOT NULL,
  decision_text text NOT NULL,
  decision_value jsonb NULL,
  scope text NOT NULL DEFAULT 'project',
  targets jsonb NULL,
  source text NOT NULL,
  source_run_id uuid NULL,
  source_note_id text NULL,
  source_issue_id uuid NULL,
  status text NOT NULL DEFAULT 'active',
  created_by uuid NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  superseded_by uuid NULL REFERENCES decision_ledger(id)
);

CREATE INDEX IF NOT EXISTS decision_ledger_project_idx ON decision_ledger(project_id);
CREATE INDEX IF NOT EXISTS decision_ledger_key_idx ON decision_ledger(project_id, decision_key);

-- Resolved note fingerprints (persistent de-dupe)
CREATE TABLE IF NOT EXISTS resolved_notes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  note_fingerprint text NOT NULL,
  decision_id uuid NULL REFERENCES decision_ledger(id) ON DELETE SET NULL,
  status text NOT NULL DEFAULT 'active',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS resolved_notes_unique
  ON resolved_notes(project_id, note_fingerprint);

-- Doc reconcile flags
ALTER TABLE project_documents
  ADD COLUMN IF NOT EXISTS needs_reconcile boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS reconcile_reasons jsonb NULL;

-- RLS for decision_ledger
ALTER TABLE decision_ledger ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can read own project decision_ledger"
  ON decision_ledger FOR SELECT
  USING (public.has_project_access(auth.uid(), project_id));

CREATE POLICY "Users can insert own project decision_ledger"
  ON decision_ledger FOR INSERT
  WITH CHECK (public.has_project_access(auth.uid(), project_id));

CREATE POLICY "Users can update own project decision_ledger"
  ON decision_ledger FOR UPDATE
  USING (public.has_project_access(auth.uid(), project_id));

-- RLS for resolved_notes
ALTER TABLE resolved_notes ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can read resolved notes"
  ON resolved_notes FOR SELECT
  USING (public.has_project_access(auth.uid(), project_id));

CREATE POLICY "Users can insert resolved notes"
  ON resolved_notes FOR INSERT
  WITH CHECK (public.has_project_access(auth.uid(), project_id));

CREATE POLICY "Users can update resolved notes"
  ON resolved_notes FOR UPDATE
  USING (public.has_project_access(auth.uid(), project_id));
