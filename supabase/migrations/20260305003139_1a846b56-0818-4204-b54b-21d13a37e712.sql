-- Add unique constraints for idempotent writes to canon_unit_mentions and canon_unit_relations
-- These prevent duplicate entries from concurrent or repeated NUE extractions

-- Unique constraint: one mention per unit+doc+version+offset combination
ALTER TABLE public.canon_unit_mentions
  ADD CONSTRAINT canon_unit_mentions_unique_sig
  UNIQUE (unit_id, document_id, version_id, offset_start, offset_end);

-- Unique constraint: one relation per project+from+to+type combination
ALTER TABLE public.canon_unit_relations
  ADD CONSTRAINT canon_unit_relations_unique_sig
  UNIQUE (project_id, unit_id_from, unit_id_to, relation_type);

-- Add table comments marking these as NON-CANON experimental index
COMMENT ON TABLE public.canon_units IS 'NON-CANON experimental index — stores extracted narrative units for observation only. Does NOT define or override project canon. Gated behind CANON_UNITS_EXPERIMENTAL flag.';
COMMENT ON TABLE public.canon_unit_mentions IS 'NON-CANON experimental index — stores document mentions of extracted units. Gated behind CANON_UNITS_EXPERIMENTAL flag.';
COMMENT ON TABLE public.canon_unit_relations IS 'NON-CANON experimental index — stores relations between extracted units. Gated behind CANON_UNITS_EXPERIMENTAL flag.';