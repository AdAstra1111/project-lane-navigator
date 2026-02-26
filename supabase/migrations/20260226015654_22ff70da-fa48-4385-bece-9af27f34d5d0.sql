-- Backfill plaintext for existing project docs from their version plaintext
UPDATE project_documents pd
SET plaintext = pdv.plaintext,
    extracted_text = pdv.plaintext
FROM project_document_versions pdv
WHERE pdv.document_id = pd.id
  AND pdv.is_current = true
  AND pd.project_id = 'd84690fd-3a00-431e-9eb8-cc9a9434965f'
  AND (pd.plaintext IS NULL OR pd.plaintext = '');

-- Also backfill canon top-level keys for this project
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
WHERE project_id = 'd84690fd-3a00-431e-9eb8-cc9a9434965f'
  AND canon_json->'seed_draft' IS NOT NULL
  AND (canon_json->>'logline' IS NULL OR canon_json->>'logline' = '');