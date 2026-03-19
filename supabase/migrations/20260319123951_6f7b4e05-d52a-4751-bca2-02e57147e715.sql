
-- Transactional lock_visual_set RPC
-- Performs atomic validation + lock + archive in a single transaction
CREATE OR REPLACE FUNCTION public.lock_visual_set(p_set_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_set record;
  v_user_id uuid;
  v_slot record;
  v_blocking_reasons text[] := '{}';
  v_required_total int := 0;
  v_required_approved int := 0;
  v_archived_ids uuid[] := '{}';
  v_eval record;
  v_dna_current boolean;
BEGIN
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'blocking_reasons', ARRAY['Not authenticated']);
  END IF;

  -- 1. Lock the set row
  SELECT * INTO v_set FROM public.visual_sets WHERE id = p_set_id FOR UPDATE;
  IF v_set IS NULL THEN
    RETURN jsonb_build_object('success', false, 'blocking_reasons', ARRAY['Set not found']);
  END IF;

  IF v_set.status = 'locked' THEN
    RETURN jsonb_build_object('success', false, 'blocking_reasons', ARRAY['Set already locked']);
  END IF;

  -- 2. DNA provenance check for character sets
  IF v_set.domain = 'character_identity' AND v_set.current_dna_version_id IS NULL THEN
    v_blocking_reasons := array_append(v_blocking_reasons, 'Character set requires DNA version');
  END IF;

  -- 3. Check DNA is still current
  IF v_set.current_dna_version_id IS NOT NULL THEN
    SELECT EXISTS(
      SELECT 1 FROM public.character_visual_dna
      WHERE id = v_set.current_dna_version_id AND is_current = true
    ) INTO v_dna_current;
    IF NOT v_dna_current THEN
      v_blocking_reasons := array_append(v_blocking_reasons, 'DNA version is stale — re-evaluate required');
    END IF;
  END IF;

  -- 4. Validate all slots
  FOR v_slot IN
    SELECT * FROM public.visual_set_slots WHERE visual_set_id = p_set_id ORDER BY created_at
  LOOP
    IF v_slot.is_required THEN
      v_required_total := v_required_total + 1;

      IF v_slot.selected_image_id IS NULL THEN
        v_blocking_reasons := array_append(v_blocking_reasons, 'Required slot "' || v_slot.slot_label || '" has no selected image');
        CONTINUE;
      END IF;

      IF v_slot.state NOT IN ('approved') THEN
        v_blocking_reasons := array_append(v_blocking_reasons, 'Required slot "' || v_slot.slot_label || '" is not approved (state: ' || v_slot.state || ')');
        CONTINUE;
      END IF;

      -- 5. Resolve latest evaluation for selected image (deterministic: latest created_at, then id desc)
      SELECT * INTO v_eval FROM public.image_evaluations
        WHERE project_id = v_set.project_id
          AND image_id = v_slot.selected_image_id
        ORDER BY created_at DESC, id DESC
        LIMIT 1;

      IF v_eval IS NULL THEN
        v_blocking_reasons := array_append(v_blocking_reasons, 'Slot "' || v_slot.slot_label || '" has no evaluation');
        CONTINUE;
      END IF;

      IF v_eval.governance_verdict IN ('flagged', 'rejected') THEN
        v_blocking_reasons := array_append(v_blocking_reasons, 'Slot "' || v_slot.slot_label || '" evaluation is ' || v_eval.governance_verdict);
        CONTINUE;
      END IF;

      IF v_eval.governance_verdict NOT IN ('approved', 'review_required') THEN
        v_blocking_reasons := array_append(v_blocking_reasons, 'Slot "' || v_slot.slot_label || '" evaluation verdict is ' || COALESCE(v_eval.governance_verdict, 'pending'));
        CONTINUE;
      END IF;

      -- DNA version consistency on evaluation
      IF v_set.current_dna_version_id IS NOT NULL AND
         (v_eval.dna_version_id IS NULL OR v_eval.dna_version_id != v_set.current_dna_version_id) THEN
        v_blocking_reasons := array_append(v_blocking_reasons, 'Slot "' || v_slot.slot_label || '" evaluation DNA version mismatch');
        CONTINUE;
      END IF;

      v_required_approved := v_required_approved + 1;
    END IF;
  END LOOP;

  -- 6. If any blocking reasons, abort entirely
  IF array_length(v_blocking_reasons, 1) > 0 THEN
    RETURN jsonb_build_object(
      'success', false,
      'set_id', p_set_id,
      'required_total', v_required_total,
      'required_approved', v_required_approved,
      'blocking_reasons', v_blocking_reasons
    );
  END IF;

  -- 7. Lock all slots
  UPDATE public.visual_set_slots SET state = 'locked'
    WHERE visual_set_id = p_set_id AND state IN ('approved', 'candidate_present');

  -- 8. Lock the set
  UPDATE public.visual_sets SET
    status = 'locked',
    locked_at = now(),
    locked_by = v_user_id
  WHERE id = p_set_id;

  -- 9. Archive only equivalent prior sets (target-scoped, not domain-wide)
  WITH archived AS (
    UPDATE public.visual_sets SET status = 'archived'
    WHERE project_id = v_set.project_id
      AND domain = v_set.domain
      AND target_type = v_set.target_type
      AND id != p_set_id
      AND status NOT IN ('locked', 'archived')
      AND (
        (v_set.target_id IS NOT NULL AND target_id = v_set.target_id)
        OR (v_set.target_id IS NULL AND target_name = v_set.target_name)
      )
    RETURNING id
  )
  SELECT array_agg(id) INTO v_archived_ids FROM archived;

  RETURN jsonb_build_object(
    'success', true,
    'set_id', p_set_id,
    'locked_slot_count', v_required_approved,
    'archived_set_ids', COALESCE(v_archived_ids, '{}')
  );
END;
$$;

-- Readiness resolver RPC
CREATE OR REPLACE FUNCTION public.resolve_visual_set_readiness(p_set_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_set record;
  v_slot record;
  v_eval record;
  v_required_total int := 0;
  v_required_selected int := 0;
  v_required_approved int := 0;
  v_unresolved int := 0;
  v_blocking text[] := '{}';
  v_stale boolean := false;
  v_dna_ok boolean := true;
BEGIN
  SELECT * INTO v_set FROM public.visual_sets WHERE id = p_set_id;
  IF v_set IS NULL THEN
    RETURN jsonb_build_object('ready_to_lock', false, 'blocking_reasons', ARRAY['Set not found']);
  END IF;

  -- DNA staleness check
  IF v_set.current_dna_version_id IS NOT NULL THEN
    IF NOT EXISTS(
      SELECT 1 FROM public.character_visual_dna
      WHERE id = v_set.current_dna_version_id AND is_current = true
    ) THEN
      v_stale := true;
      v_dna_ok := false;
      v_blocking := array_append(v_blocking, 'DNA version is stale');
    END IF;
  ELSIF v_set.domain = 'character_identity' THEN
    v_dna_ok := false;
    v_blocking := array_append(v_blocking, 'Character set missing DNA linkage');
  END IF;

  FOR v_slot IN
    SELECT * FROM public.visual_set_slots WHERE visual_set_id = p_set_id ORDER BY created_at
  LOOP
    IF v_slot.is_required THEN
      v_required_total := v_required_total + 1;

      IF v_slot.state IN ('empty', 'needs_replacement') THEN
        v_unresolved := v_unresolved + 1;
        v_blocking := array_append(v_blocking, 'Slot "' || v_slot.slot_label || '" is ' || v_slot.state);
        CONTINUE;
      END IF;

      IF v_slot.selected_image_id IS NOT NULL THEN
        v_required_selected := v_required_selected + 1;
      ELSE
        v_blocking := array_append(v_blocking, 'Slot "' || v_slot.slot_label || '" has no selection');
        CONTINUE;
      END IF;

      IF v_slot.state = 'approved' OR v_slot.state = 'locked' THEN
        -- Verify latest evaluation
        SELECT * INTO v_eval FROM public.image_evaluations
          WHERE project_id = v_set.project_id
            AND image_id = v_slot.selected_image_id
          ORDER BY created_at DESC, id DESC LIMIT 1;

        IF v_eval IS NULL THEN
          v_blocking := array_append(v_blocking, 'Slot "' || v_slot.slot_label || '" has no evaluation');
        ELSIF v_eval.governance_verdict IN ('flagged', 'rejected') THEN
          v_blocking := array_append(v_blocking, 'Slot "' || v_slot.slot_label || '" evaluation: ' || v_eval.governance_verdict);
        ELSIF v_set.current_dna_version_id IS NOT NULL AND
              (v_eval.dna_version_id IS NULL OR v_eval.dna_version_id != v_set.current_dna_version_id) THEN
          v_blocking := array_append(v_blocking, 'Slot "' || v_slot.slot_label || '" DNA mismatch on evaluation');
        ELSE
          v_required_approved := v_required_approved + 1;
        END IF;
      ELSE
        v_blocking := array_append(v_blocking, 'Slot "' || v_slot.slot_label || '" not approved (state: ' || v_slot.state || ')');
      END IF;
    END IF;
  END LOOP;

  RETURN jsonb_build_object(
    'ready_to_lock', (v_required_approved = v_required_total AND v_required_total > 0 AND NOT v_stale),
    'required_slot_total', v_required_total,
    'required_slot_selected_count', v_required_selected,
    'required_slot_approved_count', v_required_approved,
    'unresolved_slot_count', v_unresolved,
    'stale', v_stale,
    'dna_ok', v_dna_ok,
    'blocking_reasons', v_blocking
  );
END;
$$;
