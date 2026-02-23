-- Reset the job that succeeded at Veo but failed on download, plus reset all others for a clean retry
UPDATE public.trailer_clip_jobs 
SET status = 'queued', error = null, provider_job_id = null, claimed_at = null, attempt = 0
WHERE blueprint_id = '25f690db-d860-44e4-913c-3330affccfd7'
  AND status = 'failed';