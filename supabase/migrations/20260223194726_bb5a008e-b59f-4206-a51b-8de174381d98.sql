DROP INDEX IF EXISTS idx_tcj_idempotency;
CREATE UNIQUE INDEX idx_tcj_idempotency ON public.trailer_clip_jobs (idempotency_key);