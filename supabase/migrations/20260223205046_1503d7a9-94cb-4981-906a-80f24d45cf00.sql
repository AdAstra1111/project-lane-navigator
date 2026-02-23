UPDATE public.trailer_clip_jobs 
SET status = 'queued', error = null, provider_job_id = null, claimed_at = null, attempt = 0, max_attempts = 5
WHERE id = '6716a84a-f605-4f67-965f-1df998899b27';