-- Add guardrails_config JSONB column to projects table
-- Stores per-project guardrail configuration: enabled, profile, engineModes, overrides, customText
ALTER TABLE public.projects ADD COLUMN IF NOT EXISTS guardrails_config JSONB DEFAULT NULL;

-- Add comment for documentation
COMMENT ON COLUMN public.projects.guardrails_config IS 'Optional guardrails configuration. Shape: { enabled: bool, profile: string, engineModes: {engineName: mode}, overrides: {additionalDisallowed, customText, forbidden, mustInclude, absurdityRange}, customText: string }';
