DROP TRIGGER IF EXISTS trg_validate_pending_decision ON public.project_pending_decisions;
DROP TABLE IF EXISTS public.project_pending_decisions CASCADE;
DROP FUNCTION IF EXISTS public.validate_pending_decision() CASCADE;