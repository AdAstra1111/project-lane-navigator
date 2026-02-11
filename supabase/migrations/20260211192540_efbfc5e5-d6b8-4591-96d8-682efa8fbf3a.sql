
-- Restrict project_deals to owner/producer/sales_agent roles
DROP POLICY IF EXISTS "Users can view deals on accessible projects" ON project_deals;
DROP POLICY IF EXISTS "Users can insert deals on accessible projects" ON project_deals;
DROP POLICY IF EXISTS "Users can update deals on accessible projects" ON project_deals;
DROP POLICY IF EXISTS "Users can delete deals on accessible projects" ON project_deals;

CREATE POLICY "Authorized roles can view deals" ON project_deals
FOR SELECT USING (
  get_project_role(auth.uid(), project_id) IN ('owner', 'producer', 'sales_agent')
);
CREATE POLICY "Authorized roles can insert deals" ON project_deals
FOR INSERT WITH CHECK (
  get_project_role(auth.uid(), project_id) IN ('owner', 'producer', 'sales_agent')
);
CREATE POLICY "Authorized roles can update deals" ON project_deals
FOR UPDATE USING (
  get_project_role(auth.uid(), project_id) IN ('owner', 'producer', 'sales_agent')
);
CREATE POLICY "Authorized roles can delete deals" ON project_deals
FOR DELETE USING (
  get_project_role(auth.uid(), project_id) IN ('owner', 'producer', 'sales_agent')
);

-- Restrict project_budgets to owner/producer
DROP POLICY IF EXISTS "Project members can view budgets" ON project_budgets;
DROP POLICY IF EXISTS "Project members can insert budgets" ON project_budgets;
DROP POLICY IF EXISTS "Project members can update budgets" ON project_budgets;
DROP POLICY IF EXISTS "Project members can delete budgets" ON project_budgets;

CREATE POLICY "Authorized roles can view budgets" ON project_budgets
FOR SELECT USING (
  get_project_role(auth.uid(), project_id) IN ('owner', 'producer')
);
CREATE POLICY "Authorized roles can insert budgets" ON project_budgets
FOR INSERT WITH CHECK (
  get_project_role(auth.uid(), project_id) IN ('owner', 'producer')
);
CREATE POLICY "Authorized roles can update budgets" ON project_budgets
FOR UPDATE USING (
  get_project_role(auth.uid(), project_id) IN ('owner', 'producer')
);
CREATE POLICY "Authorized roles can delete budgets" ON project_budgets
FOR DELETE USING (
  get_project_role(auth.uid(), project_id) IN ('owner', 'producer')
);

-- Restrict project_budget_lines to owner/producer
DROP POLICY IF EXISTS "Project members can view budget lines" ON project_budget_lines;
DROP POLICY IF EXISTS "Project members can insert budget lines" ON project_budget_lines;
DROP POLICY IF EXISTS "Project members can update budget lines" ON project_budget_lines;
DROP POLICY IF EXISTS "Project members can delete budget lines" ON project_budget_lines;

CREATE POLICY "Authorized roles can view budget lines" ON project_budget_lines
FOR SELECT USING (
  get_project_role(auth.uid(), project_id) IN ('owner', 'producer')
);
CREATE POLICY "Authorized roles can insert budget lines" ON project_budget_lines
FOR INSERT WITH CHECK (
  get_project_role(auth.uid(), project_id) IN ('owner', 'producer')
);
CREATE POLICY "Authorized roles can update budget lines" ON project_budget_lines
FOR UPDATE USING (
  get_project_role(auth.uid(), project_id) IN ('owner', 'producer')
);
CREATE POLICY "Authorized roles can delete budget lines" ON project_budget_lines
FOR DELETE USING (
  get_project_role(auth.uid(), project_id) IN ('owner', 'producer')
);

-- Restrict project_ownership_stakes to owner/producer/lawyer
DROP POLICY IF EXISTS "Project members can view ownership stakes" ON project_ownership_stakes;
DROP POLICY IF EXISTS "Project members can insert ownership stakes" ON project_ownership_stakes;
DROP POLICY IF EXISTS "Project members can update ownership stakes" ON project_ownership_stakes;
DROP POLICY IF EXISTS "Project members can delete ownership stakes" ON project_ownership_stakes;

CREATE POLICY "Authorized roles can view ownership" ON project_ownership_stakes
FOR SELECT USING (
  get_project_role(auth.uid(), project_id) IN ('owner', 'producer', 'lawyer')
);
CREATE POLICY "Authorized roles can insert ownership" ON project_ownership_stakes
FOR INSERT WITH CHECK (
  get_project_role(auth.uid(), project_id) IN ('owner', 'producer', 'lawyer')
);
CREATE POLICY "Authorized roles can update ownership" ON project_ownership_stakes
FOR UPDATE USING (
  get_project_role(auth.uid(), project_id) IN ('owner', 'producer', 'lawyer')
);
CREATE POLICY "Authorized roles can delete ownership" ON project_ownership_stakes
FOR DELETE USING (
  get_project_role(auth.uid(), project_id) IN ('owner', 'producer', 'lawyer')
);
