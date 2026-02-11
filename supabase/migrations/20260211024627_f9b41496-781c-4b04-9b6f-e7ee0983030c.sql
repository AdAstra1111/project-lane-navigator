
-- Production companies table
CREATE TABLE public.production_companies (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL,
  name TEXT NOT NULL,
  logo_url TEXT DEFAULT '',
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

ALTER TABLE public.production_companies ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own companies"
  ON public.production_companies FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can create own companies"
  ON public.production_companies FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own companies"
  ON public.production_companies FOR UPDATE
  USING (auth.uid() = user_id);

CREATE POLICY "Users can delete own companies"
  ON public.production_companies FOR DELETE
  USING (auth.uid() = user_id);

CREATE TRIGGER update_production_companies_updated_at
  BEFORE UPDATE ON public.production_companies
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Junction table: many-to-many between projects and companies
CREATE TABLE public.project_company_links (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  project_id UUID NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  company_id UUID NOT NULL REFERENCES public.production_companies(id) ON DELETE CASCADE,
  user_id UUID NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  UNIQUE(project_id, company_id)
);

ALTER TABLE public.project_company_links ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own links"
  ON public.project_company_links FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can create own links"
  ON public.project_company_links FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can delete own links"
  ON public.project_company_links FOR DELETE
  USING (auth.uid() = user_id);
