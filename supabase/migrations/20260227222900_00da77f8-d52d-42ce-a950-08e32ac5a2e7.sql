-- Fix: Set canonical episode count for Kyoto's Hidden Kiss from pitch idea format_summary
UPDATE projects 
SET season_episode_count = 38, 
    season_episode_count_locked = true, 
    season_episode_count_source = 'devseed_backfill'
WHERE id = 'b7afa281-7aa8-4c40-b51f-e0a9503eb660' 
  AND (season_episode_count IS NULL OR season_episode_count_locked = false);

-- Also persist on the pitch idea
UPDATE pitch_ideas 
SET devseed_canon_json = jsonb_build_object(
  'season_episode_count', 38,
  'format', 'vertical-drama',
  'locked', true,
  'locked_at', now()::text,
  'source', 'format_summary_backfill'
)
WHERE id = '74bfeb41-50b5-49a8-8a2f-6cffd26f5fbf' 
  AND (devseed_canon_json = '{}'::jsonb OR devseed_canon_json IS NULL);