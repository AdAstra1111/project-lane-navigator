
-- Add columns to video_render_shots for locking + notes + prompt deltas
ALTER TABLE public.video_render_shots
  ADD COLUMN IF NOT EXISTS is_locked boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS notes text,
  ADD COLUMN IF NOT EXISTS prompt_delta_json jsonb NOT NULL DEFAULT '{}';

-- Update claim RPC to skip locked shots
CREATE OR REPLACE FUNCTION public.claim_next_video_render_shot(p_job_id uuid)
 RETURNS SETOF video_render_shots
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_row public.video_render_shots%ROWTYPE;
BEGIN
  SELECT * INTO v_row
  FROM public.video_render_shots
  WHERE job_id = p_job_id
    AND status = 'queued'
    AND is_locked = false
  ORDER BY shot_index ASC
  LIMIT 1
  FOR UPDATE SKIP LOCKED;

  IF v_row.id IS NULL THEN
    RETURN;
  END IF;

  UPDATE public.video_render_shots
  SET status = 'claimed',
      attempt_count = COALESCE(attempt_count, 0) + 1,
      updated_at = now()
  WHERE id = v_row.id
  RETURNING * INTO v_row;

  RETURN NEXT v_row;
  RETURN;
END;
$function$;
