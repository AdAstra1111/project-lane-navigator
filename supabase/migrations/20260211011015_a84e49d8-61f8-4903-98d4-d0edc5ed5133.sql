
-- ============================================================
-- OWNERSHIP & WATERFALL ENGINE — Core Tables
-- ============================================================

-- 1. Participants: anyone with a stake in the project
CREATE TABLE public.project_participants (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  project_id UUID NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  user_id UUID NOT NULL,
  participant_name TEXT NOT NULL DEFAULT '',
  participant_type TEXT NOT NULL DEFAULT 'producer',
  -- types: producer | executive-producer | investor | sales-agent | distributor | talent | financier | lender | broadcaster | other
  company TEXT NOT NULL DEFAULT '',
  role_description TEXT NOT NULL DEFAULT '',
  contact_email TEXT NOT NULL DEFAULT '',
  notes TEXT NOT NULL DEFAULT '',
  source TEXT NOT NULL DEFAULT 'native',
  -- source: native | integrated
  version INT NOT NULL DEFAULT 1,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 2. Contracts: structured deal terms (not just PDF uploads)
CREATE TABLE public.project_contracts (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  project_id UUID NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  user_id UUID NOT NULL,
  participant_id UUID REFERENCES public.project_participants(id) ON DELETE SET NULL,
  contract_type TEXT NOT NULL DEFAULT 'investment',
  -- types: investment | sales-agency | distribution | talent | co-production | license | other
  title TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'draft',
  -- status: draft | negotiating | executed | terminated
  currency TEXT NOT NULL DEFAULT 'USD',
  total_value TEXT NOT NULL DEFAULT '',
  key_terms JSONB NOT NULL DEFAULT '{}',
  -- flexible structured terms: { "commission_pct": 25, "corridor": "10% after recoup", "cap": 500000, etc. }
  territory TEXT NOT NULL DEFAULT '',
  rights_granted TEXT NOT NULL DEFAULT '',
  term_years TEXT NOT NULL DEFAULT '',
  notes TEXT NOT NULL DEFAULT '',
  source TEXT NOT NULL DEFAULT 'native',
  version INT NOT NULL DEFAULT 1,
  executed_at TIMESTAMPTZ,
  expires_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 3. Ownership stakes: who owns what percentage
CREATE TABLE public.project_ownership_stakes (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  project_id UUID NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  user_id UUID NOT NULL,
  participant_id UUID REFERENCES public.project_participants(id) ON DELETE CASCADE,
  contract_id UUID REFERENCES public.project_contracts(id) ON DELETE SET NULL,
  stake_type TEXT NOT NULL DEFAULT 'equity',
  -- types: equity | copyright | profit-share | revenue-share | other
  percentage NUMERIC(6,3) NOT NULL DEFAULT 0,
  -- up to 100.000
  territory TEXT NOT NULL DEFAULT 'worldwide',
  rights_type TEXT NOT NULL DEFAULT 'all',
  -- rights_type: all | theatrical | streaming | tv | ancillary | music | merch | other
  conditions TEXT NOT NULL DEFAULT '',
  notes TEXT NOT NULL DEFAULT '',
  source TEXT NOT NULL DEFAULT 'native',
  version INT NOT NULL DEFAULT 1,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 4. Waterfall rules: recoupment order and terms
CREATE TABLE public.project_waterfall_rules (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  project_id UUID NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  user_id UUID NOT NULL,
  participant_id UUID REFERENCES public.project_participants(id) ON DELETE CASCADE,
  contract_id UUID REFERENCES public.project_contracts(id) ON DELETE SET NULL,
  position INT NOT NULL DEFAULT 0,
  -- recoupment order (0 = first money out)
  rule_name TEXT NOT NULL DEFAULT '',
  rule_type TEXT NOT NULL DEFAULT 'recoupment',
  -- types: recoupment | commission | deferment | profit-split | corridor | premium | cap | override
  percentage NUMERIC(6,3) NOT NULL DEFAULT 0,
  cap_amount TEXT NOT NULL DEFAULT '',
  -- empty = uncapped
  premium_pct NUMERIC(5,2) NOT NULL DEFAULT 0,
  -- e.g., 120% recoupment = 20% premium
  corridor_pct NUMERIC(5,2) NOT NULL DEFAULT 0,
  -- e.g., 10% corridor between tiers
  conditions TEXT NOT NULL DEFAULT '',
  notes TEXT NOT NULL DEFAULT '',
  source TEXT NOT NULL DEFAULT 'native',
  version INT NOT NULL DEFAULT 1,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ============================================================
-- RLS Policies
-- ============================================================

ALTER TABLE public.project_participants ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.project_contracts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.project_ownership_stakes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.project_waterfall_rules ENABLE ROW LEVEL SECURITY;

-- Participants
CREATE POLICY "Project members can view participants"
  ON public.project_participants FOR SELECT
  USING (has_project_access(auth.uid(), project_id));

CREATE POLICY "Project members can create participants"
  ON public.project_participants FOR INSERT
  WITH CHECK ((auth.uid() = user_id) AND has_project_access(auth.uid(), project_id));

CREATE POLICY "Project members can update participants"
  ON public.project_participants FOR UPDATE
  USING (has_project_access(auth.uid(), project_id));

CREATE POLICY "Project members can delete participants"
  ON public.project_participants FOR DELETE
  USING (has_project_access(auth.uid(), project_id));

-- Contracts
CREATE POLICY "Project members can view contracts"
  ON public.project_contracts FOR SELECT
  USING (has_project_access(auth.uid(), project_id));

CREATE POLICY "Project members can create contracts"
  ON public.project_contracts FOR INSERT
  WITH CHECK ((auth.uid() = user_id) AND has_project_access(auth.uid(), project_id));

CREATE POLICY "Project members can update contracts"
  ON public.project_contracts FOR UPDATE
  USING (has_project_access(auth.uid(), project_id));

CREATE POLICY "Project members can delete contracts"
  ON public.project_contracts FOR DELETE
  USING (has_project_access(auth.uid(), project_id));

-- Ownership Stakes
CREATE POLICY "Project members can view ownership"
  ON public.project_ownership_stakes FOR SELECT
  USING (has_project_access(auth.uid(), project_id));

CREATE POLICY "Project members can create ownership"
  ON public.project_ownership_stakes FOR INSERT
  WITH CHECK ((auth.uid() = user_id) AND has_project_access(auth.uid(), project_id));

CREATE POLICY "Project members can update ownership"
  ON public.project_ownership_stakes FOR UPDATE
  USING (has_project_access(auth.uid(), project_id));

CREATE POLICY "Project members can delete ownership"
  ON public.project_ownership_stakes FOR DELETE
  USING (has_project_access(auth.uid(), project_id));

-- Waterfall Rules
CREATE POLICY "Project members can view waterfall"
  ON public.project_waterfall_rules FOR SELECT
  USING (has_project_access(auth.uid(), project_id));

CREATE POLICY "Project members can create waterfall"
  ON public.project_waterfall_rules FOR INSERT
  WITH CHECK ((auth.uid() = user_id) AND has_project_access(auth.uid(), project_id));

CREATE POLICY "Project members can update waterfall"
  ON public.project_waterfall_rules FOR UPDATE
  USING (has_project_access(auth.uid(), project_id));

CREATE POLICY "Project members can delete waterfall"
  ON public.project_waterfall_rules FOR DELETE
  USING (has_project_access(auth.uid(), project_id));

-- ============================================================
-- Triggers for updated_at
-- ============================================================

CREATE TRIGGER update_project_participants_updated_at
  BEFORE UPDATE ON public.project_participants
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER update_project_contracts_updated_at
  BEFORE UPDATE ON public.project_contracts
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER update_project_ownership_stakes_updated_at
  BEFORE UPDATE ON public.project_ownership_stakes
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER update_project_waterfall_rules_updated_at
  BEFORE UPDATE ON public.project_waterfall_rules
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
