-- RP1 v2: Additive patch to narrative_repairs
--
-- Adds: source_system, diagnostic_type, summary, recommended_action
-- Widens: status CHECK (future-loop compat), repairability CHECK (adds investigatory)
--
-- All changes are additive. No existing data is affected.

-- Add missing columns
ALTER TABLE public.narrative_repairs
  ADD COLUMN IF NOT EXISTS source_system      TEXT,
  ADD COLUMN IF NOT EXISTS diagnostic_type    TEXT,
  ADD COLUMN IF NOT EXISTS summary            TEXT,
  ADD COLUMN IF NOT EXISTS recommended_action TEXT;

-- Widen status CHECK to include future-loop compatible values.
-- Future transitions: pending → approved → queued → in_progress → completed|failed|dismissed
-- This installment only creates pending plans. Other transitions reserved for RP2+.
ALTER TABLE public.narrative_repairs
  DROP CONSTRAINT IF EXISTS narrative_repairs_status_check;
ALTER TABLE public.narrative_repairs
  ADD CONSTRAINT narrative_repairs_status_check
  CHECK (status IN ('pending','planned','approved','queued','in_progress','completed','failed','skipped','dismissed'));

-- Widen repairability CHECK to include investigatory
-- (used for simulation_risk findings — advisory, not auto-fixable)
ALTER TABLE public.narrative_repairs
  DROP CONSTRAINT IF EXISTS narrative_repairs_repairability_check;
ALTER TABLE public.narrative_repairs
  ADD CONSTRAINT narrative_repairs_repairability_check
  CHECK (repairability IN ('auto','guided','manual','investigatory','unknown'));
