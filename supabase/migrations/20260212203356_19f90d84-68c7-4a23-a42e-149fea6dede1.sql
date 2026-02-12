
-- Table for storing health check results
CREATE TABLE public.system_health_checks (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NULL,
  check_name TEXT NOT NULL,
  pass BOOLEAN NOT NULL,
  checks JSONB NOT NULL DEFAULT '{}',
  evidence JSONB NOT NULL DEFAULT '{}',
  failures TEXT[] NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Index for fast lookups
CREATE INDEX idx_system_health_checks_name_date ON public.system_health_checks (check_name, created_at DESC);

-- Enable RLS
ALTER TABLE public.system_health_checks ENABLE ROW LEVEL SECURITY;

-- Authenticated users can read global checks or their own
CREATE POLICY "Users can read global or own health checks"
ON public.system_health_checks
FOR SELECT
USING (user_id IS NULL OR user_id = auth.uid());

-- Only service role can insert (no insert policy for regular users)
