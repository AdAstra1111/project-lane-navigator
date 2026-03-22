
CREATE OR REPLACE FUNCTION public.rebind_project_ai_cast(
  p_project_id uuid,
  p_character_key text,
  p_next_actor_id uuid,  -- NULL for unbind
  p_reason text,
  p_changed_by uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_current record;
  v_next_actor record;
  v_resolved_version_id uuid;
  v_norm_key text;
  v_history_id uuid;
  v_action text;
BEGIN
  -- 1. Normalize character key
  v_norm_key := lower(btrim(regexp_replace(p_character_key, '\s+', ' ', 'g')));

  -- 2. Lock + fetch current binding
  SELECT id, ai_actor_id, ai_actor_version_id
  INTO v_current
  FROM public.project_ai_cast
  WHERE project_id = p_project_id AND character_key = v_norm_key
  FOR UPDATE;

  -- ── UNBIND PATH ──
  IF p_next_actor_id IS NULL THEN
    -- No-op: already unbound
    IF v_current IS NULL THEN
      RETURN jsonb_build_object(
        'action', 'unbind',
        'no_op', true,
        'character_key', v_norm_key
      );
    END IF;

    v_action := 'unbind';

    INSERT INTO public.project_ai_cast_history (
      project_id, character_key,
      previous_ai_actor_id, previous_ai_actor_version_id,
      next_ai_actor_id, next_ai_actor_version_id,
      change_type, change_reason, changed_by
    ) VALUES (
      p_project_id, v_norm_key,
      v_current.ai_actor_id, v_current.ai_actor_version_id,
      NULL, NULL,
      'unbind', p_reason, p_changed_by
    ) RETURNING id INTO v_history_id;

    DELETE FROM public.project_ai_cast WHERE id = v_current.id;

    RETURN jsonb_build_object(
      'action', 'unbind',
      'no_op', false,
      'character_key', v_norm_key,
      'previous_actor_id', v_current.ai_actor_id,
      'previous_version_id', v_current.ai_actor_version_id,
      'history_id', v_history_id
    );
  END IF;

  -- ── REBIND PATH ──
  v_action := 'rebind';

  -- 3. Fetch and validate next actor
  SELECT id, roster_ready, approved_version_id
  INTO v_next_actor
  FROM public.ai_actors
  WHERE id = p_next_actor_id;

  IF v_next_actor IS NULL THEN
    RAISE EXCEPTION 'Actor % not found', p_next_actor_id;
  END IF;

  IF NOT v_next_actor.roster_ready THEN
    RAISE EXCEPTION 'Actor % is not roster-ready', p_next_actor_id;
  END IF;

  IF v_next_actor.approved_version_id IS NULL THEN
    RAISE EXCEPTION 'Actor % has no approved version', p_next_actor_id;
  END IF;

  v_resolved_version_id := v_next_actor.approved_version_id;

  -- 4. No-op: same actor + same version already bound
  IF v_current IS NOT NULL
     AND v_current.ai_actor_id = p_next_actor_id
     AND v_current.ai_actor_version_id = v_resolved_version_id
  THEN
    RETURN jsonb_build_object(
      'action', 'rebind',
      'no_op', true,
      'character_key', v_norm_key,
      'actor_id', p_next_actor_id,
      'version_id', v_resolved_version_id
    );
  END IF;

  -- 5. Insert history (actual change)
  INSERT INTO public.project_ai_cast_history (
    project_id, character_key,
    previous_ai_actor_id, previous_ai_actor_version_id,
    next_ai_actor_id, next_ai_actor_version_id,
    change_type, change_reason, changed_by
  ) VALUES (
    p_project_id, v_norm_key,
    v_current.ai_actor_id, v_current.ai_actor_version_id,
    p_next_actor_id, v_resolved_version_id,
    'rebind', p_reason, p_changed_by
  ) RETURNING id INTO v_history_id;

  -- 6. Upsert binding
  IF v_current IS NOT NULL THEN
    UPDATE public.project_ai_cast
    SET ai_actor_id = p_next_actor_id,
        ai_actor_version_id = v_resolved_version_id
    WHERE id = v_current.id;
  ELSE
    INSERT INTO public.project_ai_cast (project_id, character_key, ai_actor_id, ai_actor_version_id)
    VALUES (p_project_id, v_norm_key, p_next_actor_id, v_resolved_version_id);
  END IF;

  RETURN jsonb_build_object(
    'action', 'rebind',
    'no_op', false,
    'character_key', v_norm_key,
    'previous_actor_id', v_current.ai_actor_id,
    'previous_version_id', v_current.ai_actor_version_id,
    'next_actor_id', p_next_actor_id,
    'next_version_id', v_resolved_version_id,
    'history_id', v_history_id
  );
END;
$$;
