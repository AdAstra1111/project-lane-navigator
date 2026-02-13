-- Add missing columns to project_outcomes for full feedback loop coverage
ALTER TABLE public.project_outcomes
  ADD COLUMN IF NOT EXISTS budget_achieved boolean DEFAULT false,
  ADD COLUMN IF NOT EXISTS talent_attached boolean DEFAULT false,
  ADD COLUMN IF NOT EXISTS presales_secured boolean DEFAULT false,
  ADD COLUMN IF NOT EXISTS development_time_months integer,
  ADD COLUMN IF NOT EXISTS initial_structural_score numeric,
  ADD COLUMN IF NOT EXISTS initial_commercial_score numeric,
  ADD COLUMN IF NOT EXISTS initial_finance_confidence text,
  ADD COLUMN IF NOT EXISTS initial_greenlight_verdict text;