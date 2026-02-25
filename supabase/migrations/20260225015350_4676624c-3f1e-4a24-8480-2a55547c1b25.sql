
-- Phase 1 Slice 1: Harden quality history tables + add RPC

-- 1) Add missing columns to cinematic_quality_runs
ALTER TABLE public.cinematic_quality_runs
  ADD COLUMN IF NOT EXISTS run_source text NOT NULL DEFAULT 'unknown',
  ADD COLUMN IF NOT EXISTS adapter_mode text,
  ADD COLUMN IF NOT EXISTS strictness_mode text NOT NULL DEFAULT 'standard',
  ADD COLUMN IF NOT EXISTS hard_failures text[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS diagnostic_flags text[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS metrics_json jsonb NOT NULL DEFAULT '{}'::jsonb;

-- 2) Add missing columns to cinematic_quality_attempts
ALTER TABLE public.cinematic_quality_attempts
  ADD COLUMN IF NOT EXISTS model text NOT NULL DEFAULT 'unknown',
  ADD COLUMN IF NOT EXISTS prompt_version text,
  ADD COLUMN IF NOT EXISTS input_summary_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS output_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS adapter_metrics_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS timing_json jsonb NOT NULL DEFAULT '{}'::jsonb;

-- 3) Add unique constraint on (run_id, attempt_index)
ALTER TABLE public.cinematic_quality_attempts
  ADD CONSTRAINT uq_cqa_run_attempt UNIQUE (run_id, attempt_index);

-- 4) Add check constraint on attempt_index
ALTER TABLE public.cinematic_quality_attempts
  ADD CONSTRAINT chk_attempt_index CHECK (attempt_index IN (0, 1));

-- 5) Additional indexes
CREATE INDEX IF NOT EXISTS idx_cqr_project_created ON public.cinematic_quality_runs(project_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_cqr_lane_created ON public.cinematic_quality_runs(lane, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_cqr_run_source_created ON public.cinematic_quality_runs(run_source, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_cqa_run_attempt ON public.cinematic_quality_attempts(run_id, attempt_index);

-- 6) RPC: insert_cinematic_quality_run_with_attempts
CREATE OR REPLACE FUNCTION public.insert_cinematic_quality_run_with_attempts(
  p_run jsonb,
  p_attempt0 jsonb,
  p_attempt1 jsonb DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = 'public'
AS $$
DECLARE
  v_run_id uuid;
  v_project_id uuid;
BEGIN
  -- Validate required run fields
  IF p_run->>'project_id' IS NULL THEN
    RAISE EXCEPTION 'p_run.project_id is required';
  END IF;

  v_project_id := (p_run->>'project_id')::uuid;

  -- Insert run
  INSERT INTO public.cinematic_quality_runs (
    project_id, doc_id, engine, lane, model,
    attempt_count, final_pass, final_score,
    run_source, adapter_mode, strictness_mode,
    settings_json, hard_failures, diagnostic_flags, metrics_json,
    created_by
  ) VALUES (
    v_project_id,
    COALESCE(p_run->>'doc_id', NULL),
    COALESCE(p_run->>'engine', 'trailer'),
    COALESCE(p_run->>'lane', 'unknown'),
    COALESCE(p_run->>'model', 'unknown'),
    COALESCE((p_run->>'attempt_count')::int, CASE WHEN p_attempt1 IS NOT NULL THEN 2 ELSE 1 END),
    COALESCE((p_run->>'final_pass')::boolean, false),
    COALESCE((p_run->>'final_score')::numeric, 0),
    COALESCE(p_run->>'run_source', 'unknown'),
    p_run->>'adapter_mode',
    COALESCE(p_run->>'strictness_mode', 'standard'),
    COALESCE(p_run->'settings_json', '{}'::jsonb),
    COALESCE(ARRAY(SELECT jsonb_array_elements_text(p_run->'hard_failures')), '{}'::text[]),
    COALESCE(ARRAY(SELECT jsonb_array_elements_text(p_run->'diagnostic_flags')), '{}'::text[]),
    COALESCE(p_run->'metrics_json', '{}'::jsonb),
    CASE WHEN p_run->>'created_by' IS NOT NULL THEN (p_run->>'created_by')::uuid ELSE auth.uid() END
  )
  RETURNING id INTO v_run_id;

  -- Insert attempt 0 (required)
  INSERT INTO public.cinematic_quality_attempts (
    run_id, attempt_index, model, prompt_version,
    score, pass, failures, hard_failures, diagnostic_flags,
    unit_count, expected_unit_count, repair_instruction,
    input_summary_json, output_json, units_json, metrics_json,
    adapter_metrics_json, timing_json
  ) VALUES (
    v_run_id,
    0,
    COALESCE(p_attempt0->>'model', 'unknown'),
    p_attempt0->>'prompt_version',
    COALESCE((p_attempt0->>'score')::numeric, 0),
    COALESCE((p_attempt0->>'pass')::boolean, false),
    COALESCE(ARRAY(SELECT jsonb_array_elements_text(p_attempt0->'failures')), '{}'::text[]),
    COALESCE(ARRAY(SELECT jsonb_array_elements_text(p_attempt0->'hard_failures')), '{}'::text[]),
    COALESCE(ARRAY(SELECT jsonb_array_elements_text(p_attempt0->'diagnostic_flags')), '{}'::text[]),
    (p_attempt0->>'unit_count')::int,
    (p_attempt0->>'expected_unit_count')::int,
    p_attempt0->>'repair_instruction',
    COALESCE(p_attempt0->'input_summary_json', '{}'::jsonb),
    COALESCE(p_attempt0->'output_json', '{}'::jsonb),
    p_attempt0->'units_json',
    COALESCE(p_attempt0->'metrics_json', '{}'::jsonb),
    COALESCE(p_attempt0->'adapter_metrics_json', '{}'::jsonb),
    COALESCE(p_attempt0->'timing_json', '{}'::jsonb)
  );

  -- Insert attempt 1 (optional)
  IF p_attempt1 IS NOT NULL THEN
    INSERT INTO public.cinematic_quality_attempts (
      run_id, attempt_index, model, prompt_version,
      score, pass, failures, hard_failures, diagnostic_flags,
      unit_count, expected_unit_count, repair_instruction,
      input_summary_json, output_json, units_json, metrics_json,
      adapter_metrics_json, timing_json
    ) VALUES (
      v_run_id,
      1,
      COALESCE(p_attempt1->>'model', 'unknown'),
      p_attempt1->>'prompt_version',
      COALESCE((p_attempt1->>'score')::numeric, 0),
      COALESCE((p_attempt1->>'pass')::boolean, false),
      COALESCE(ARRAY(SELECT jsonb_array_elements_text(p_attempt1->'failures')), '{}'::text[]),
      COALESCE(ARRAY(SELECT jsonb_array_elements_text(p_attempt1->'hard_failures')), '{}'::text[]),
      COALESCE(ARRAY(SELECT jsonb_array_elements_text(p_attempt1->'diagnostic_flags')), '{}'::text[]),
      (p_attempt1->>'unit_count')::int,
      (p_attempt1->>'expected_unit_count')::int,
      p_attempt1->>'repair_instruction',
      COALESCE(p_attempt1->'input_summary_json', '{}'::jsonb),
      COALESCE(p_attempt1->'output_json', '{}'::jsonb),
      p_attempt1->'units_json',
      COALESCE(p_attempt1->'metrics_json', '{}'::jsonb),
      COALESCE(p_attempt1->'adapter_metrics_json', '{}'::jsonb),
      COALESCE(p_attempt1->'timing_json', '{}'::jsonb)
    );
  END IF;

  RETURN v_run_id;
END;
$$;
