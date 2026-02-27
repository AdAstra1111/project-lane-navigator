-- Backfill project_documents.doc_type from legacy aliases to canonical types
-- NO content is modified. Only metadata columns are updated.

-- 1) blueprint → treatment
UPDATE public.project_documents SET doc_type = 'treatment' WHERE doc_type = 'blueprint';

-- 2) architecture → story_outline
UPDATE public.project_documents SET doc_type = 'story_outline' WHERE doc_type = 'architecture';

-- 3) script → feature_script (generic "script" should be feature_script)
UPDATE public.project_documents SET doc_type = 'feature_script' WHERE doc_type = 'script';

-- 4) screenplay_draft → feature_script
UPDATE public.project_documents SET doc_type = 'feature_script' WHERE doc_type = 'screenplay_draft';

-- 5) script_pdf → feature_script
UPDATE public.project_documents SET doc_type = 'feature_script' WHERE doc_type = 'script_pdf';

-- 6) script_coverage → production_draft
UPDATE public.project_documents SET doc_type = 'production_draft' WHERE doc_type = 'script_coverage';

-- 7) complete_season_script → season_master_script
UPDATE public.project_documents SET doc_type = 'season_master_script' WHERE doc_type = 'complete_season_script';

-- 8) one_pager → concept_brief
UPDATE public.project_documents SET doc_type = 'concept_brief' WHERE doc_type = 'one_pager';

-- 9) document → other (keep as "other" since we can't infer type from uploaded files)
UPDATE public.project_documents SET doc_type = 'other' WHERE doc_type = 'document';

-- 10) Backfill project_document_versions.deliverable_type from parent doc_type where missing
UPDATE public.project_document_versions pdv
SET deliverable_type = pd.doc_type
FROM public.project_documents pd
WHERE pdv.document_id = pd.id
  AND (pdv.deliverable_type IS NULL OR pdv.deliverable_type = '')
  AND pd.doc_type IS NOT NULL
  AND pd.doc_type != 'other';