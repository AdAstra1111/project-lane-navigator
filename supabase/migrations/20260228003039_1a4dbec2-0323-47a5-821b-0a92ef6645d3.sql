
ALTER TABLE public.devseed_job_items ADD COLUMN IF NOT EXISTS phase text NOT NULL DEFAULT 'foundation';

-- Update claim RPC to respect phase ordering (foundation before devpack)
CREATE OR REPLACE FUNCTION public.claim_next_devseed_items(p_job_id uuid, p_limit integer, p_claimed_by text)
 RETURNS SETOF devseed_job_items
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  RETURN QUERY
  UPDATE public.devseed_job_items
  SET status = 'claimed',
      claimed_at = now(),
      claimed_by = p_claimed_by,
      attempts = COALESCE(attempts, 0) + 1,
      updated_at = now()
  WHERE id IN (
    SELECT id
    FROM public.devseed_job_items
    WHERE job_id = p_job_id
      AND status = 'queued'
    ORDER BY
      CASE WHEN phase = 'foundation' THEN 0 ELSE 1 END ASC,
      episode_index NULLS FIRST,
      item_key ASC,
      created_at ASC
    LIMIT p_limit
    FOR UPDATE SKIP LOCKED
  )
  RETURNING *;
END;
$function$;
