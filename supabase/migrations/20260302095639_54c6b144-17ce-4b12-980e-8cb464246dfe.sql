
-- RLS for all new intel tables
ALTER TABLE public.intel_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.intel_policies ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.intel_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.intel_alerts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.project_vectors ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.lane_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.buyer_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.format_archetypes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.project_intel_alignment ENABLE ROW LEVEL SECURITY;

-- intel_runs: read for authenticated, write via service role only
CREATE POLICY "Authenticated read intel_runs" ON public.intel_runs FOR SELECT TO authenticated USING (true);

-- intel_policies: read for authenticated
CREATE POLICY "Authenticated read intel_policies" ON public.intel_policies FOR SELECT TO authenticated USING (true);

-- intel_events: read for authenticated
CREATE POLICY "Authenticated read intel_events" ON public.intel_events FOR SELECT TO authenticated USING (true);

-- intel_alerts: read for authenticated
CREATE POLICY "Authenticated read intel_alerts" ON public.intel_alerts FOR SELECT TO authenticated USING (true);

-- project_vectors: users can read vectors for projects they have access to
CREATE POLICY "Project access read project_vectors" ON public.project_vectors FOR SELECT TO authenticated
  USING (public.has_project_access(auth.uid(), project_id));

-- lane_profiles, buyer_profiles, format_archetypes: public read
CREATE POLICY "Authenticated read lane_profiles" ON public.lane_profiles FOR SELECT TO authenticated USING (true);
CREATE POLICY "Authenticated read buyer_profiles" ON public.buyer_profiles FOR SELECT TO authenticated USING (true);
CREATE POLICY "Authenticated read format_archetypes" ON public.format_archetypes FOR SELECT TO authenticated USING (true);

-- project_intel_alignment: read for project access
CREATE POLICY "Project access read project_intel_alignment" ON public.project_intel_alignment FOR SELECT TO authenticated
  USING (public.has_project_access(auth.uid(), project_id));
