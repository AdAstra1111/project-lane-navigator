-- Add finance-aware fields to cast_trends
ALTER TABLE public.cast_trends
  ADD COLUMN sales_leverage text NOT NULL DEFAULT '',
  ADD COLUMN timing_window text NOT NULL DEFAULT '';

-- Add index for common filter patterns
CREATE INDEX idx_cast_trends_status_region ON public.cast_trends (status, region);
