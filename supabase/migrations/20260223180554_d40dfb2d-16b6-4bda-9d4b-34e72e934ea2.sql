CREATE OR REPLACE FUNCTION public.can_access_project(p_project_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT has_project_access(auth.uid(), p_project_id);
$$;

GRANT EXECUTE ON FUNCTION public.can_access_project(uuid) TO authenticated;