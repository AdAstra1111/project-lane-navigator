
-- Development Briefs table
CREATE TABLE public.development_briefs (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL,
  name TEXT NOT NULL DEFAULT '',
  production_type TEXT NOT NULL,
  genre TEXT NOT NULL,
  subgenre TEXT DEFAULT '',
  budget_band TEXT DEFAULT '',
  region TEXT DEFAULT '',
  platform_target TEXT DEFAULT '',
  audience_demo TEXT DEFAULT '',
  risk_appetite TEXT DEFAULT 'medium',
  lane_preference TEXT DEFAULT '',
  notes TEXT DEFAULT '',
  status TEXT NOT NULL DEFAULT 'active',
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

ALTER TABLE public.development_briefs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own briefs" ON public.development_briefs FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users can create own briefs" ON public.development_briefs FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can update own briefs" ON public.development_briefs FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "Users can delete own briefs" ON public.development_briefs FOR DELETE USING (auth.uid() = user_id);

CREATE TRIGGER update_development_briefs_updated_at
  BEFORE UPDATE ON public.development_briefs
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Add brief_id to pitch_ideas
ALTER TABLE public.pitch_ideas ADD COLUMN brief_id UUID REFERENCES public.development_briefs(id) ON DELETE SET NULL;

-- Add scoring columns to pitch_ideas
ALTER TABLE public.pitch_ideas ADD COLUMN score_market_heat NUMERIC DEFAULT 0;
ALTER TABLE public.pitch_ideas ADD COLUMN score_feasibility NUMERIC DEFAULT 0;
ALTER TABLE public.pitch_ideas ADD COLUMN score_lane_fit NUMERIC DEFAULT 0;
ALTER TABLE public.pitch_ideas ADD COLUMN score_saturation_risk NUMERIC DEFAULT 0;
ALTER TABLE public.pitch_ideas ADD COLUMN score_company_fit NUMERIC DEFAULT 0;
ALTER TABLE public.pitch_ideas ADD COLUMN score_total NUMERIC DEFAULT 0;
