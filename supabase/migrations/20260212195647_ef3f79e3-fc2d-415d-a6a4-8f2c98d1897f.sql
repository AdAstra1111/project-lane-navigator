
-- Add normalization and transcript detection columns to corpus_scripts
ALTER TABLE public.corpus_scripts
  ADD COLUMN IF NOT EXISTS clean_word_count integer DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS raw_page_est integer DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS normalized_page_est integer DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS normalization_removed_lines integer DEFAULT 0,
  ADD COLUMN IF NOT EXISTS is_transcript boolean DEFAULT false,
  ADD COLUMN IF NOT EXISTS transcript_confidence real DEFAULT 0,
  ADD COLUMN IF NOT EXISTS exclude_from_baselines boolean DEFAULT false;
