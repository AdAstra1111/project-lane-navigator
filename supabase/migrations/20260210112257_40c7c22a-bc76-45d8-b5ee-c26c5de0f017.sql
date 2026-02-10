-- Create market buyers table (shared across all users)
CREATE TABLE public.market_buyers (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  name text NOT NULL,
  company_type text NOT NULL DEFAULT 'distributor', -- distributor | sales-agent | streamer | broadcaster | financier | studio
  genres_acquired text[] NOT NULL DEFAULT '{}',
  budget_sweet_spot text[] NOT NULL DEFAULT '{}', -- budget range values they typically acquire
  formats text[] NOT NULL DEFAULT '{}', -- film | tv-series
  territories text[] NOT NULL DEFAULT '{}', -- territories they cover
  recent_acquisitions text NOT NULL DEFAULT '',
  appetite_notes text NOT NULL DEFAULT '', -- current buying interests
  deal_types text[] NOT NULL DEFAULT '{}', -- pre-buy | acquisition | co-finance | first-look | output
  tone_preferences text[] NOT NULL DEFAULT '{}',
  market_presence text NOT NULL DEFAULT '', -- e.g. "Cannes, Berlin, AFM, Toronto"
  status text NOT NULL DEFAULT 'active',
  source_url text NOT NULL DEFAULT '',
  confidence text NOT NULL DEFAULT 'medium',
  last_verified_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.market_buyers ENABLE ROW LEVEL SECURITY;

-- Anyone authenticated can view buyers (shared reference data)
CREATE POLICY "Anyone authenticated can view buyers"
ON public.market_buyers
FOR SELECT
USING (auth.uid() IS NOT NULL);

-- Service role can manage buyers
CREATE POLICY "Service role can manage buyers"
ON public.market_buyers
FOR ALL
USING (auth.uid() IS NOT NULL)
WITH CHECK (auth.uid() IS NOT NULL);

-- Timestamp trigger
CREATE TRIGGER update_market_buyers_updated_at
BEFORE UPDATE ON public.market_buyers
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();