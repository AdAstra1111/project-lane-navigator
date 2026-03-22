
-- Global actor roster number sequence (4-digit, starting at 1)
CREATE SEQUENCE IF NOT EXISTS public.actor_roster_seq START WITH 1 INCREMENT BY 1 NO MAXVALUE;

-- RPC to allocate next roster number atomically
CREATE OR REPLACE FUNCTION public.next_actor_roster_number()
RETURNS integer
LANGUAGE sql
VOLATILE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT nextval('public.actor_roster_seq')::integer;
$$;
