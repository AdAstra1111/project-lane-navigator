
-- Deal Tracker: territory-by-territory deal status
CREATE TABLE public.project_deals (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  project_id UUID NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  user_id UUID NOT NULL,
  territory TEXT NOT NULL DEFAULT '',
  buyer_name TEXT NOT NULL DEFAULT '',
  deal_type TEXT NOT NULL DEFAULT 'all-rights',
  status TEXT NOT NULL DEFAULT 'offered',
  minimum_guarantee TEXT NOT NULL DEFAULT '',
  currency TEXT NOT NULL DEFAULT 'USD',
  notes TEXT NOT NULL DEFAULT '',
  offered_at TIMESTAMPTZ,
  closed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.project_deals ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view deals on accessible projects"
ON public.project_deals FOR SELECT
USING (public.has_project_access(auth.uid(), project_id));

CREATE POLICY "Users can create deals on accessible projects"
ON public.project_deals FOR INSERT
WITH CHECK (public.has_project_access(auth.uid(), project_id));

CREATE POLICY "Users can update deals on accessible projects"
ON public.project_deals FOR UPDATE
USING (public.has_project_access(auth.uid(), project_id));

CREATE POLICY "Users can delete deals on accessible projects"
ON public.project_deals FOR DELETE
USING (public.has_project_access(auth.uid(), project_id));

CREATE TRIGGER update_project_deals_updated_at
BEFORE UPDATE ON public.project_deals
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Buyer CRM: meeting history and relationship tracking
CREATE TABLE public.buyer_contacts (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL,
  buyer_name TEXT NOT NULL DEFAULT '',
  company TEXT NOT NULL DEFAULT '',
  company_type TEXT NOT NULL DEFAULT '',
  email TEXT NOT NULL DEFAULT '',
  phone TEXT NOT NULL DEFAULT '',
  territories TEXT[] NOT NULL DEFAULT '{}',
  genres_interest TEXT[] NOT NULL DEFAULT '{}',
  appetite_notes TEXT NOT NULL DEFAULT '',
  relationship_status TEXT NOT NULL DEFAULT 'new',
  last_contact_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.buyer_contacts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own contacts"
ON public.buyer_contacts FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "Users can create own contacts"
ON public.buyer_contacts FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own contacts"
ON public.buyer_contacts FOR UPDATE USING (auth.uid() = user_id);

CREATE POLICY "Users can delete own contacts"
ON public.buyer_contacts FOR DELETE USING (auth.uid() = user_id);

CREATE TRIGGER update_buyer_contacts_updated_at
BEFORE UPDATE ON public.buyer_contacts
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Buyer meeting log
CREATE TABLE public.buyer_meetings (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL,
  buyer_contact_id UUID NOT NULL REFERENCES public.buyer_contacts(id) ON DELETE CASCADE,
  project_id UUID REFERENCES public.projects(id) ON DELETE SET NULL,
  meeting_type TEXT NOT NULL DEFAULT 'general',
  meeting_date TIMESTAMPTZ NOT NULL DEFAULT now(),
  location TEXT NOT NULL DEFAULT '',
  notes TEXT NOT NULL DEFAULT '',
  outcome TEXT NOT NULL DEFAULT '',
  follow_up TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.buyer_meetings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own meetings"
ON public.buyer_meetings FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "Users can create own meetings"
ON public.buyer_meetings FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own meetings"
ON public.buyer_meetings FOR UPDATE USING (auth.uid() = user_id);

CREATE POLICY "Users can delete own meetings"
ON public.buyer_meetings FOR DELETE USING (auth.uid() = user_id);
