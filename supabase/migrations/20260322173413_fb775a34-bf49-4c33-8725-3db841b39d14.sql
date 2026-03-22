
-- Phase 16: Actor Marketplace / Agency Layer

-- 1. Add ownership + marketplace fields to ai_actors
ALTER TABLE public.ai_actors
  ADD COLUMN IF NOT EXISTS licensing_mode text NOT NULL DEFAULT 'private',
  ADD COLUMN IF NOT EXISTS visibility text NOT NULL DEFAULT 'private',
  ADD COLUMN IF NOT EXISTS is_listed boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS pricing_tier text NOT NULL DEFAULT 'free';

-- 2. Create actor_marketplace_listings table
CREATE TABLE IF NOT EXISTS public.actor_marketplace_listings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_id uuid NOT NULL REFERENCES public.ai_actors(id) ON DELETE CASCADE,
  is_active boolean NOT NULL DEFAULT true,
  pricing_tier text NOT NULL DEFAULT 'free',
  visibility text NOT NULL DEFAULT 'public',
  listed_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  listed_by uuid REFERENCES auth.users(id),
  UNIQUE(actor_id)
);

ALTER TABLE public.actor_marketplace_listings ENABLE ROW LEVEL SECURITY;

-- RLS: actor owner can manage their listings
CREATE POLICY "Actor owner can manage listings"
  ON public.actor_marketplace_listings
  FOR ALL
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.ai_actors
      WHERE ai_actors.id = actor_marketplace_listings.actor_id
        AND ai_actors.user_id = auth.uid()
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.ai_actors
      WHERE ai_actors.id = actor_marketplace_listings.actor_id
        AND ai_actors.user_id = auth.uid()
    )
  );

-- RLS: anyone authenticated can read active public listings
CREATE POLICY "Anyone can read active public listings"
  ON public.actor_marketplace_listings
  FOR SELECT
  TO authenticated
  USING (is_active = true AND visibility = 'public');

-- Trigger for updated_at
CREATE TRIGGER set_marketplace_listing_updated_at
  BEFORE UPDATE ON public.actor_marketplace_listings
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();
