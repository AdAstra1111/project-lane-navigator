
-- Company members table: roster of people associated with a production company
CREATE TABLE public.company_members (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  company_id UUID NOT NULL REFERENCES public.production_companies(id) ON DELETE CASCADE,
  user_id UUID NOT NULL,
  email TEXT NOT NULL DEFAULT '',
  display_name TEXT NOT NULL DEFAULT '',
  default_role TEXT NOT NULL DEFAULT 'creative',
  invited_by UUID NOT NULL,
  status TEXT NOT NULL DEFAULT 'active',
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  UNIQUE(company_id, email)
);

-- Enable RLS
ALTER TABLE public.company_members ENABLE ROW LEVEL SECURITY;

-- Company owner can manage members
CREATE POLICY "Company owners can manage members"
  ON public.company_members
  FOR ALL
  USING (EXISTS (
    SELECT 1 FROM public.production_companies
    WHERE id = company_members.company_id AND user_id = auth.uid()
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM public.production_companies
    WHERE id = company_members.company_id AND user_id = auth.uid()
  ));

-- Members can view their own membership
CREATE POLICY "Members can view own membership"
  ON public.company_members
  FOR SELECT
  USING (user_id = auth.uid());

-- Trigger for updated_at
CREATE TRIGGER update_company_members_updated_at
  BEFORE UPDATE ON public.company_members
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();
