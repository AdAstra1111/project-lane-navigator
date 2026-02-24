
-- Add trailer_bias_json to projects table for storing learned preferences
ALTER TABLE public.projects
  ADD COLUMN IF NOT EXISTS trailer_bias_json jsonb NULL;

COMMENT ON COLUMN public.projects.trailer_bias_json IS 'Learned trailer generation biases derived from user selections and approvals';
