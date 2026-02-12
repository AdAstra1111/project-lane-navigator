
ALTER TABLE script_versions
ADD COLUMN IF NOT EXISTS word_count integer,
ADD COLUMN IF NOT EXISTS line_count integer,
ADD COLUMN IF NOT EXISTS page_count_est numeric,
ADD COLUMN IF NOT EXISTS runtime_min_est numeric,
ADD COLUMN IF NOT EXISTS runtime_min_low numeric,
ADD COLUMN IF NOT EXISTS runtime_min_high numeric,
ADD COLUMN IF NOT EXISTS runtime_per_episode_est numeric;

ALTER TABLE scripts
ADD COLUMN IF NOT EXISTS latest_page_count_est numeric,
ADD COLUMN IF NOT EXISTS latest_runtime_min_est numeric,
ADD COLUMN IF NOT EXISTS latest_runtime_min_low numeric,
ADD COLUMN IF NOT EXISTS latest_runtime_min_high numeric;
