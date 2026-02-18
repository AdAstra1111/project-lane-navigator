
-- Drop the old restrictive check constraint and replace with one that covers all 8 valid packaging modes
ALTER TABLE public.projects DROP CONSTRAINT IF EXISTS projects_packaging_mode_check;

ALTER TABLE public.projects ADD CONSTRAINT projects_packaging_mode_check
  CHECK (packaging_mode IS NULL OR packaging_mode = ANY (ARRAY[
    'awards',
    'commercial',
    'streamer_prestige',
    'festival_arthouse',
    'hybrid_theatrical_streaming',
    'direct_to_platform',
    'international_copro',
    'vertical_drama'
  ]));
