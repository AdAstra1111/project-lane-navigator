
-- Add ingestion quality fields to corpus_scripts
ALTER TABLE public.corpus_scripts
  ADD COLUMN IF NOT EXISTS ingestion_source text DEFAULT 'imsdb',
  ADD COLUMN IF NOT EXISTS raw_text_length_chars integer,
  ADD COLUMN IF NOT EXISTS line_count integer,
  ADD COLUMN IF NOT EXISTS is_truncated boolean DEFAULT false,
  ADD COLUMN IF NOT EXISTS truncation_reason text,
  ADD COLUMN IF NOT EXISTS parse_confidence numeric DEFAULT 1.0;
