-- Add gold_flag to corpus_scripts for quality benchmarking
ALTER TABLE public.corpus_scripts ADD COLUMN IF NOT EXISTS gold_flag boolean NOT NULL DEFAULT false;