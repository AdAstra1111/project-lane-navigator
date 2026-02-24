-- Add gates_json columns to store gate check results
ALTER TABLE public.trailer_script_runs ADD COLUMN IF NOT EXISTS gates_json jsonb DEFAULT null;
ALTER TABLE public.trailer_shot_design_runs ADD COLUMN IF NOT EXISTS gates_json jsonb DEFAULT null;
ALTER TABLE public.trailer_cuts ADD COLUMN IF NOT EXISTS gates_json jsonb DEFAULT null;

COMMENT ON COLUMN public.trailer_script_runs.gates_json IS 'Gate check results: {passed, failures[]}';
COMMENT ON COLUMN public.trailer_shot_design_runs.gates_json IS 'Gate check results: {passed, failures[]}';
COMMENT ON COLUMN public.trailer_cuts.gates_json IS 'Assembly gate check results: {passed, failures[]}';