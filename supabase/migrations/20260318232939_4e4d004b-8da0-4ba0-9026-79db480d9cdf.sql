CREATE TABLE public.creative_framing_strategies (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  content_type text NOT NULL DEFAULT 'poster',
  strategy_key text NOT NULL,
  strategy_type text NOT NULL,
  intent text NOT NULL DEFAULT '',
  audience_target text NOT NULL DEFAULT 'mass',
  risk_level text NOT NULL DEFAULT 'safe',
  creative_angle text NOT NULL DEFAULT '',
  trope_handling text NOT NULL DEFAULT 'follow',
  visual_language text NOT NULL DEFAULT '',
  canon_lock_summary text NOT NULL DEFAULT '',
  full_brief text NOT NULL DEFAULT '',
  is_selected boolean NOT NULL DEFAULT false,
  generated_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid,
  meta_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_cfs_project_content ON public.creative_framing_strategies(project_id, content_type);

ALTER TABLE public.creative_framing_strategies ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can manage own project framings"
ON public.creative_framing_strategies
FOR ALL
TO authenticated
USING (public.has_project_access(auth.uid(), project_id))
WITH CHECK (public.has_project_access(auth.uid(), project_id));

CREATE TRIGGER set_updated_at_creative_framing
  BEFORE UPDATE ON public.creative_framing_strategies
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();