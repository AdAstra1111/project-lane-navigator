
-- Phase 4: Actor Promotion Decisions table + ai_actors promotion fields

-- 1. Create actor_promotion_decisions table
CREATE TABLE public.actor_promotion_decisions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_id uuid NOT NULL REFERENCES public.ai_actors(id),
  actor_version_id uuid NOT NULL REFERENCES public.ai_actor_versions(id),
  validation_run_id uuid REFERENCES public.actor_validation_runs(id),
  validation_result_id uuid REFERENCES public.actor_validation_results(id),
  
  scoring_model text NOT NULL DEFAULT 'unknown',
  policy_version text NOT NULL DEFAULT 'v1',
  
  eligible_for_promotion boolean NOT NULL DEFAULT false,
  review_required boolean NOT NULL DEFAULT false,
  
  block_reasons text[] DEFAULT '{}',
  
  policy_decision_status text NOT NULL DEFAULT 'not_eligible'
    CHECK (policy_decision_status IN ('not_eligible', 'eligible', 'review_required')),
  
  final_decision_status text NOT NULL DEFAULT 'pending_review'
    CHECK (final_decision_status IN ('pending_review', 'approved', 'rejected', 'override_approved', 'override_rejected', 'revoked', 'superseded')),
  
  decision_mode text NOT NULL DEFAULT 'policy_auto'
    CHECK (decision_mode IN ('policy_auto', 'manual_approve', 'manual_reject', 'override_approve', 'override_reject', 'revoke')),
  
  override_reason text,
  decision_note text,
  
  decided_by uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Index for fast lookups
CREATE INDEX idx_apd_actor_id ON public.actor_promotion_decisions(actor_id);
CREATE INDEX idx_apd_final_status ON public.actor_promotion_decisions(final_decision_status);

-- RLS
ALTER TABLE public.actor_promotion_decisions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own promotion decisions"
  ON public.actor_promotion_decisions FOR SELECT TO authenticated
  USING (
    actor_id IN (SELECT id FROM public.ai_actors WHERE user_id = auth.uid())
  );

CREATE POLICY "Users can insert own promotion decisions"
  ON public.actor_promotion_decisions FOR INSERT TO authenticated
  WITH CHECK (
    actor_id IN (SELECT id FROM public.ai_actors WHERE user_id = auth.uid())
  );

CREATE POLICY "Users can update own promotion decisions"
  ON public.actor_promotion_decisions FOR UPDATE TO authenticated
  USING (
    actor_id IN (SELECT id FROM public.ai_actors WHERE user_id = auth.uid())
  );

-- 2. Extend ai_actors with promotion state columns
ALTER TABLE public.ai_actors
  ADD COLUMN IF NOT EXISTS promotion_status text DEFAULT 'none',
  ADD COLUMN IF NOT EXISTS approved_version_id uuid REFERENCES public.ai_actor_versions(id),
  ADD COLUMN IF NOT EXISTS current_promotion_decision_id uuid,
  ADD COLUMN IF NOT EXISTS roster_ready boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS promotion_policy_version text DEFAULT 'v1',
  ADD COLUMN IF NOT EXISTS promotion_updated_at timestamptz;
