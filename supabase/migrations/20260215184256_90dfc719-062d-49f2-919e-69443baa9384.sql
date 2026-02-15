
-- Drop overly permissive service role policies
DROP POLICY "Service role full access auto_run_jobs" ON public.auto_run_jobs;
DROP POLICY "Service role full access auto_run_steps" ON public.auto_run_steps;

-- The edge function uses service role key which bypasses RLS entirely,
-- so no additional policies are needed for service role access.
-- User-level RLS policies already handle client-side access.

-- Also add insert/update policies for steps (edge function bypasses RLS, but for completeness)
CREATE POLICY "Users can insert own auto_run_steps" ON public.auto_run_steps
  FOR INSERT WITH CHECK (
    EXISTS (SELECT 1 FROM public.auto_run_jobs j WHERE j.id = job_id AND j.user_id = auth.uid())
  );
