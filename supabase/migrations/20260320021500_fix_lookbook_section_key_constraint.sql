-- Fix: Add key_moments to valid_section_key constraint
-- Migration 20260320020550 added key_moments to bootstrap_lookbook_sections
-- but did not update the CHECK constraint — this migration closes that gap.

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
