-- Ensure valid_section_key constraint includes all 7 canonical sections
-- This is idempotent: drops and recreates the constraint
ALTER TABLE public.lookbook_sections
  DROP CONSTRAINT IF EXISTS valid_section_key;

ALTER TABLE public.lookbook_sections
  ADD CONSTRAINT valid_section_key CHECK (section_key IN (
    'character_identity',
    'world_locations',
    'atmosphere_lighting',
    'texture_detail',
    'symbolic_motifs',
    'key_moments',
    'poster_directions'
  ));