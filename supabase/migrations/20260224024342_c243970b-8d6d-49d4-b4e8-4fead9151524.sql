
ALTER TABLE public.trailer_script_runs
ADD COLUMN IF NOT EXISTS is_selected boolean NOT NULL DEFAULT false;

ALTER TABLE public.trailer_script_runs
ADD COLUMN IF NOT EXISTS variant_label text;

CREATE UNIQUE INDEX IF NOT EXISTS idx_trailer_script_runs_selected_unique
ON public.trailer_script_runs (project_id, trailer_type, platform_key)
WHERE is_selected = true;
