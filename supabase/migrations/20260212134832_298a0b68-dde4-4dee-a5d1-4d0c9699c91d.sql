
-- Add batch tracking columns to scripts
ALTER TABLE public.scripts
ADD COLUMN IF NOT EXISTS latest_draft_number integer DEFAULT 0,
ADD COLUMN IF NOT EXISTS latest_batch_index integer DEFAULT 0,
ADD COLUMN IF NOT EXISTS latest_batch_storage_path text;

-- Add batch tracking columns to script_versions
ALTER TABLE public.script_versions
ADD COLUMN IF NOT EXISTS batch_index integer DEFAULT 0,
ADD COLUMN IF NOT EXISTS is_partial boolean DEFAULT true;
