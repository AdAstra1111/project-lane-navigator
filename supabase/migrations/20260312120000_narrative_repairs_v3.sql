-- RP2: narrative_repairs_v3 — execution tracking columns
--
-- Additive only. Confirms columns added in v2 and adds execution tracking.
-- No status CHECK changes (investigatory path uses `completed` with mode marker).
-- No new tables.

ALTER TABLE public.narrative_repairs
  ADD COLUMN IF NOT EXISTS executed_at       TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS execution_result  JSONB,
  ADD COLUMN IF NOT EXISTS skipped_reason    TEXT,
  ADD COLUMN IF NOT EXISTS dismissed_at      TIMESTAMPTZ;
