
-- Add auto_assembly_json to trailer_cuts for storing auto-assembly decisions
ALTER TABLE public.trailer_cuts 
  ADD COLUMN IF NOT EXISTS auto_assembly_json jsonb NULL;

-- Add comment
COMMENT ON COLUMN public.trailer_cuts.auto_assembly_json IS 'Stores auto-assembly decisions: picked_clips, trims, text_cards, alignment metadata';
