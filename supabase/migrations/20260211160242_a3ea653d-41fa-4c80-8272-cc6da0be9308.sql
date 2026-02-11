
-- Update project_contracts RLS policies to enforce role-based access
-- Only owner, producer, and lawyer roles should access contracts

-- Drop existing policies
DROP POLICY IF EXISTS "Project members can view contracts" ON public.project_contracts;
DROP POLICY IF EXISTS "Project members can create contracts" ON public.project_contracts;
DROP POLICY IF EXISTS "Project members can update contracts" ON public.project_contracts;
DROP POLICY IF EXISTS "Project members can delete contracts" ON public.project_contracts;

-- Create role-restricted policies using get_project_role()
CREATE POLICY "Authorized roles can view contracts"
ON public.project_contracts
FOR SELECT
USING (
  get_project_role(auth.uid(), project_id) IN ('owner', 'producer', 'lawyer')
);

CREATE POLICY "Authorized roles can create contracts"
ON public.project_contracts
FOR INSERT
WITH CHECK (
  auth.uid() = user_id
  AND get_project_role(auth.uid(), project_id) IN ('owner', 'producer', 'lawyer')
);

CREATE POLICY "Authorized roles can update contracts"
ON public.project_contracts
FOR UPDATE
USING (
  get_project_role(auth.uid(), project_id) IN ('owner', 'producer', 'lawyer')
);

CREATE POLICY "Authorized roles can delete contracts"
ON public.project_contracts
FOR DELETE
USING (
  get_project_role(auth.uid(), project_id) IN ('owner', 'producer', 'lawyer')
);
