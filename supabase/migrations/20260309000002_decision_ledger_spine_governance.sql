-- Narrative Spine v1 Governance — decision_ledger additions
-- Adds: locked boolean (constitutional lock flag) + meta jsonb (amendment metadata)
-- Required for spine lifecycle: pending_lock → active (locked) → superseded

ALTER TABLE public.decision_ledger
  ADD COLUMN IF NOT EXISTS locked boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS meta jsonb DEFAULT NULL;

COMMENT ON COLUMN public.decision_ledger.locked IS
  'True when this decision is constitutionally locked. Spine entries: false=pending_lock, true=active canon.';

COMMENT ON COLUMN public.decision_ledger.meta IS
  'Amendment metadata: confirmed_by (uuid), confirmed_at (iso), amends (prior entry id), amendment_severity (constitutional|severe|moderate|light), supersession_reason (text).';

-- Index for fast active spine lookup
CREATE INDEX IF NOT EXISTS decision_ledger_spine_active_idx
  ON public.decision_ledger (project_id, decision_key, status, locked)
  WHERE decision_key = 'narrative_spine';
