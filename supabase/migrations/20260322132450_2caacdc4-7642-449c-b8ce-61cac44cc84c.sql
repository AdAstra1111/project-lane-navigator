
CREATE OR REPLACE FUNCTION public.apply_promotion_decision(
  p_actor_id uuid,
  p_actor_version_id uuid,
  p_validation_run_id uuid,
  p_validation_result_id uuid,
  p_scoring_model text,
  p_policy_version text,
  p_eligible_for_promotion boolean,
  p_review_required boolean,
  p_block_reasons text[],
  p_policy_decision_status text,
  p_final_decision_status text,
  p_decision_mode text,
  p_override_reason text,
  p_decision_note text,
  p_decided_by uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_decision_id uuid;
  v_current_actor record;
  v_is_approval boolean;
BEGIN
  -- 1. Lock the actor row to prevent concurrent mutations
  SELECT id, roster_ready, approved_version_id, promotion_status, current_promotion_decision_id
  INTO v_current_actor
  FROM public.ai_actors
  WHERE id = p_actor_id
  FOR UPDATE;

  IF v_current_actor IS NULL THEN
    RAISE EXCEPTION 'Actor % not found', p_actor_id;
  END IF;

  -- 2. Validate actor_version belongs to actor (if version provided)
  IF p_actor_version_id IS NOT NULL THEN
    IF NOT EXISTS (
      SELECT 1 FROM public.ai_actor_versions
      WHERE id = p_actor_version_id AND actor_id = p_actor_id
    ) THEN
      RAISE EXCEPTION 'Version % does not belong to actor %', p_actor_version_id, p_actor_id;
    END IF;
  END IF;

  v_is_approval := p_final_decision_status IN ('approved', 'override_approved');

  -- 3. Idempotency: if approving and already approved for same version, return existing
  IF v_is_approval
     AND v_current_actor.approved_version_id = p_actor_version_id
     AND v_current_actor.roster_ready = true
     AND v_current_actor.promotion_status IN ('approved', 'override_approved')
  THEN
    RETURN jsonb_build_object(
      'decision_id', v_current_actor.current_promotion_decision_id,
      'idempotent', true
    );
  END IF;

  -- 4. Revoke idempotency
  IF p_final_decision_status = 'revoked'
     AND v_current_actor.promotion_status = 'revoked'
     AND v_current_actor.roster_ready = false
  THEN
    RETURN jsonb_build_object(
      'decision_id', v_current_actor.current_promotion_decision_id,
      'idempotent', true
    );
  END IF;

  -- 5. Insert the decision row
  INSERT INTO public.actor_promotion_decisions (
    actor_id, actor_version_id, validation_run_id, validation_result_id,
    scoring_model, policy_version, eligible_for_promotion, review_required,
    block_reasons, policy_decision_status, final_decision_status,
    decision_mode, override_reason, decision_note, decided_by
  ) VALUES (
    p_actor_id, p_actor_version_id, p_validation_run_id, p_validation_result_id,
    p_scoring_model, p_policy_version, p_eligible_for_promotion, p_review_required,
    p_block_reasons, p_policy_decision_status, p_final_decision_status,
    p_decision_mode, p_override_reason, p_decision_note, p_decided_by
  )
  RETURNING id INTO v_decision_id;

  -- 6. Supersede prior approvals ONLY on new approval
  IF v_is_approval THEN
    UPDATE public.actor_promotion_decisions
    SET final_decision_status = 'superseded'
    WHERE actor_id = p_actor_id
      AND final_decision_status IN ('approved', 'override_approved')
      AND id != v_decision_id;
  END IF;

  -- 7. Update actor current state based on action semantics
  IF v_is_approval THEN
    -- Approval: set roster ready with approved version
    UPDATE public.ai_actors SET
      promotion_status = p_final_decision_status,
      approved_version_id = p_actor_version_id,
      roster_ready = true,
      current_promotion_decision_id = v_decision_id,
      promotion_policy_version = p_policy_version,
      promotion_updated_at = now()
    WHERE id = p_actor_id;

  ELSIF p_final_decision_status = 'revoked' THEN
    -- Revoke: clear roster — ONLY action that removes current approval
    UPDATE public.ai_actors SET
      promotion_status = 'revoked',
      approved_version_id = null,
      roster_ready = false,
      current_promotion_decision_id = v_decision_id,
      promotion_policy_version = p_policy_version,
      promotion_updated_at = now()
    WHERE id = p_actor_id;

  ELSE
    -- Reject / override_reject:
    -- NEVER clears current roster state. Rejection is a version-level 
    -- historical decision only. Use REVOKE to remove roster approval.
    -- Only update decision pointer for audit trail.
    IF v_current_actor.approved_version_id IS NOT NULL THEN
      -- Actor has an existing approval — do NOT touch roster state
      UPDATE public.ai_actors SET
        current_promotion_decision_id = v_decision_id,
        promotion_updated_at = now()
      WHERE id = p_actor_id;
    ELSE
      -- No current approval exists: safe to set status without roster impact
      UPDATE public.ai_actors SET
        promotion_status = p_final_decision_status,
        roster_ready = false,
        current_promotion_decision_id = v_decision_id,
        promotion_policy_version = p_policy_version,
        promotion_updated_at = now()
      WHERE id = p_actor_id;
    END IF;
  END IF;

  RETURN jsonb_build_object(
    'decision_id', v_decision_id,
    'idempotent', false
  );
END;
$$;
