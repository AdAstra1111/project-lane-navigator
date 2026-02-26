UPDATE project_canon
SET canon_json = canon_json || jsonb_build_object(
  'logline', canon_json->'seed_draft'->>'logline',
  'premise', canon_json->'seed_draft'->>'premise',
  'world_rules', canon_json->'seed_draft'->>'world_rules',
  'tone_style', canon_json->'seed_draft'->>'tone_style',
  'ongoing_threads', canon_json->'seed_draft'->>'ongoing_threads',
  'forbidden_changes', canon_json->'seed_draft'->>'forbidden_changes',
  'characters', canon_json->'seed_draft'->'characters'
)
WHERE project_id = 'fb9574bf-ce64-4c5d-9a55-cdec80b7f68e'
  AND canon_json->'seed_draft' IS NOT NULL
  AND NOT (canon_json ? 'logline');