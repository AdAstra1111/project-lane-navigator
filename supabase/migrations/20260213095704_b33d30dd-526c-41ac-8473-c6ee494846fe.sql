
-- ============================================================
-- INDUSTRY INTEGRATION FRAMEWORK (IIF)
-- ============================================================

-- 1. Provider Registry
CREATE TABLE public.integration_providers (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  key TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  category TEXT NOT NULL,
  supported_import_types TEXT[] NOT NULL DEFAULT '{}',
  supported_export_types TEXT[] NOT NULL DEFAULT '{}',
  region TEXT[] NOT NULL DEFAULT '{Global}',
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

ALTER TABLE public.integration_providers ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Integration providers are readable by authenticated users"
  ON public.integration_providers FOR SELECT
  USING (auth.uid() IS NOT NULL);

-- 2. Project-level Connections
CREATE TABLE public.integration_connections (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  project_id UUID NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  provider_id UUID NOT NULL REFERENCES public.integration_providers(id) ON DELETE CASCADE,
  user_id UUID NOT NULL,
  connection_type TEXT NOT NULL DEFAULT 'manual_upload',
  last_sync_at TIMESTAMP WITH TIME ZONE,
  last_sync_status TEXT DEFAULT 'none',
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  UNIQUE (project_id, provider_id)
);

ALTER TABLE public.integration_connections ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can manage own project connections"
  ON public.integration_connections FOR ALL
  USING (public.has_project_access(auth.uid(), project_id));

-- 3. Import Records
CREATE TABLE public.integration_imports (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  project_id UUID NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  provider_id UUID REFERENCES public.integration_providers(id),
  user_id UUID NOT NULL,
  import_type TEXT NOT NULL,
  file_name TEXT NOT NULL DEFAULT '',
  file_path TEXT,
  file_size_bytes INTEGER,
  parse_status TEXT NOT NULL DEFAULT 'pending',
  extracted_summary JSONB DEFAULT '{}',
  error_message TEXT,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

ALTER TABLE public.integration_imports ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can manage own project imports"
  ON public.integration_imports FOR ALL
  USING (public.has_project_access(auth.uid(), project_id));

-- 4. Normalized Finance Snapshots
CREATE TABLE public.project_finance_snapshots (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  project_id UUID NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  user_id UUID NOT NULL,
  import_id UUID REFERENCES public.integration_imports(id) ON DELETE SET NULL,
  snapshot_type TEXT NOT NULL,
  baseline_budget JSONB DEFAULT '{}',
  latest_cost_report JSONB DEFAULT '{}',
  payroll_summary JSONB DEFAULT '{}',
  schedule_summary JSONB DEFAULT '{}',
  delivery_summary JSONB DEFAULT '{}',
  currency TEXT DEFAULT 'USD',
  snapshot_date TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

ALTER TABLE public.project_finance_snapshots ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can manage own project snapshots"
  ON public.project_finance_snapshots FOR ALL
  USING (public.has_project_access(auth.uid(), project_id));

-- ============================================================
-- SEED PROVIDERS
-- ============================================================

INSERT INTO public.integration_providers (key, name, category, supported_import_types, supported_export_types, region) VALUES
  -- Budgeting / Scheduling
  ('movie_magic', 'Movie Magic Budgeting', 'budgeting', '{budget,schedule}', '{budget_csv,budget_xlsx}', '{US,UK,EU,AU,Global}'),
  ('showbiz_budgeting', 'Showbiz Budgeting', 'budgeting', '{budget}', '{budget_csv}', '{US,Global}'),
  ('gorilla_budgeting', 'Gorilla Budgeting', 'budgeting', '{budget}', '{budget_csv}', '{US,UK,Global}'),
  ('generic_budget_csv', 'Generic Budget (CSV/XLSX)', 'budgeting', '{budget}', '{budget_csv,budget_xlsx}', '{Global}'),
  ('movie_magic_scheduling', 'Movie Magic Scheduling', 'scheduling', '{schedule}', '{}', '{US,UK,EU,AU,Global}'),
  ('stripboard_pro', 'Stripboard Pro', 'scheduling', '{schedule}', '{}', '{Global}'),
  ('setkeeper', 'SetKeeper', 'scheduling', '{schedule}', '{}', '{US,UK,Global}'),
  ('generic_schedule_csv', 'Generic Schedule (CSV)', 'scheduling', '{schedule}', '{}', '{Global}'),
  -- Payroll
  ('entertainment_partners', 'Entertainment Partners (EP)', 'payroll', '{payroll_summary,cost_report}', '{}', '{US}'),
  ('cast_and_crew', 'Cast & Crew', 'payroll', '{payroll_summary,cost_report}', '{}', '{US,UK}'),
  ('sargent_disc', 'Sargent-Disc', 'payroll', '{payroll_summary,cost_report}', '{}', '{UK,EU}'),
  ('media_services', 'Media Services', 'payroll', '{payroll_summary}', '{}', '{AU}'),
  ('generic_payroll_summary', 'Generic Payroll Summary', 'payroll', '{payroll_summary}', '{}', '{Global}'),
  -- Accounting
  ('smartaccounting', 'SmartAccounting', 'accounting', '{cost_report}', '{}', '{UK,EU}'),
  ('vista_psl', 'Vista / PSL', 'accounting', '{cost_report}', '{}', '{UK}'),
  ('global_vista', 'Global Vista', 'accounting', '{cost_report}', '{}', '{US,UK,EU,Global}'),
  ('generic_cost_report', 'Generic Cost Report', 'accounting', '{cost_report}', '{}', '{Global}'),
  -- Bonding
  ('bond_cost_report', 'Bond Cost Report Template', 'bonding', '{cost_report}', '{}', '{Global}'),
  -- Delivery
  ('generic_delivery_spec', 'Delivery Specification', 'delivery', '{delivery_spec}', '{}', '{Global}'),
  -- Incentives
  ('generic_incentive_tracker', 'Incentive Tracker', 'incentive_admin', '{incentive_report}', '{}', '{Global}');
