-- Normalize legacy v2_shim blueprint status to 'complete' (data-only, no schema change)
UPDATE public.trailer_blueprints
SET status = 'complete'
WHERE status = 'v2_shim';