
-- Table to track shared signals between users
CREATE TABLE public.shared_signals (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  signal_id UUID NOT NULL,
  signal_type TEXT NOT NULL DEFAULT 'story', -- 'story' or 'cast'
  signal_name TEXT NOT NULL DEFAULT '',
  shared_by UUID NOT NULL,
  shared_with UUID NOT NULL,
  project_id UUID REFERENCES public.projects(id) ON DELETE CASCADE,
  note TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

ALTER TABLE public.shared_signals ENABLE ROW LEVEL SECURITY;

-- Users can see signals shared with them or by them
CREATE POLICY "Users can view their shared signals"
ON public.shared_signals FOR SELECT
USING (auth.uid() = shared_by OR auth.uid() = shared_with);

CREATE POLICY "Users can share signals"
ON public.shared_signals FOR INSERT
WITH CHECK (auth.uid() = shared_by);

CREATE POLICY "Users can delete signals they shared"
ON public.shared_signals FOR DELETE
USING (auth.uid() = shared_by);

-- Index for fast lookups
CREATE INDEX idx_shared_signals_shared_with ON public.shared_signals(shared_with);
CREATE INDEX idx_shared_signals_shared_by ON public.shared_signals(shared_by);
