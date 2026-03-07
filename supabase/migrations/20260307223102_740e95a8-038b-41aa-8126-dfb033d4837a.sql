-- Fix current project "The Last Love Letter of Gion" episode duration from 300s to 120-150s (matching "30 x 2-2.5 min")
UPDATE projects 
SET episode_target_duration_seconds = 150,
    episode_target_duration_min_seconds = 120,
    episode_target_duration_max_seconds = 150
WHERE id = 'a2da06d6-cff2-4920-a12b-2f1deebb2b0d'
  AND episode_target_duration_seconds = 300;

-- Also seed the canon_json with the correct duration
UPDATE project_canon
SET canon_json = canon_json || '{"episode_length_seconds_min": 120, "episode_length_seconds_max": 150}'::jsonb,
    updated_by = (SELECT user_id FROM projects WHERE id = 'a2da06d6-cff2-4920-a12b-2f1deebb2b0d')
WHERE project_id = 'a2da06d6-cff2-4920-a12b-2f1deebb2b0d';