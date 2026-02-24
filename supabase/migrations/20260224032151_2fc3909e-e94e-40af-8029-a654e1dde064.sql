
-- ═══════════════════════════════════════════════════════════
-- Part 7: Studio Finishing Layer — Tables
-- ═══════════════════════════════════════════════════════════

-- Finishing profiles (LUT, grain, letterbox, loudness, color consistency)
CREATE TABLE public.trailer_finishing_profiles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid REFERENCES public.projects(id) ON DELETE CASCADE,
  name text NOT NULL DEFAULT 'Custom',
  is_preset boolean NOT NULL DEFAULT false,
  lut_storage_path text,
  grain_amount numeric NOT NULL DEFAULT 0,
  vignette_amount numeric NOT NULL DEFAULT 0,
  letterbox_enabled boolean NOT NULL DEFAULT false,
  letterbox_ratio text DEFAULT '2.39',
  sharpen_amount numeric NOT NULL DEFAULT 0,
  saturation_boost numeric NOT NULL DEFAULT 0,
  contrast_boost numeric NOT NULL DEFAULT 0,
  highlights_rolloff numeric NOT NULL DEFAULT 0,
  lufs_target numeric NOT NULL DEFAULT -14,
  true_peak_db numeric NOT NULL DEFAULT -1.0,
  color_consistency_enabled boolean NOT NULL DEFAULT true,
  color_consistency_strength numeric NOT NULL DEFAULT 0.6,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.trailer_finishing_profiles ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can manage finishing profiles for their projects"
  ON public.trailer_finishing_profiles FOR ALL
  USING (
    project_id IS NULL OR public.has_project_access(auth.uid(), project_id)
  )
  WITH CHECK (
    project_id IS NULL OR public.has_project_access(auth.uid(), project_id)
  );

-- Render variants (social exports, master, etc.)
CREATE TABLE public.trailer_render_variants (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  trailer_cut_id uuid NOT NULL,
  audio_run_id uuid,
  finishing_profile_id uuid REFERENCES public.trailer_finishing_profiles(id),
  variant_key text NOT NULL DEFAULT 'master_16x9',
  width integer NOT NULL DEFAULT 1920,
  height integer NOT NULL DEFAULT 1080,
  frame_rate integer NOT NULL DEFAULT 24,
  crop_mode text NOT NULL DEFAULT 'smart_center',
  status text NOT NULL DEFAULT 'queued',
  storage_path_mp4 text,
  public_url text,
  render_log_json jsonb,
  error text,
  reference_clip_id uuid,
  color_corrections_json jsonb,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.trailer_render_variants ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can manage render variants for their projects"
  ON public.trailer_render_variants FOR ALL
  USING (public.has_project_access(auth.uid(), project_id))
  WITH CHECK (public.has_project_access(auth.uid(), project_id));

CREATE INDEX idx_render_variants_cut ON public.trailer_render_variants(trailer_cut_id, status);
CREATE INDEX idx_render_variants_project ON public.trailer_render_variants(project_id);

-- Seed default finishing profiles (presets, no project_id)
INSERT INTO public.trailer_finishing_profiles (name, is_preset, grain_amount, vignette_amount, letterbox_enabled, letterbox_ratio, sharpen_amount, saturation_boost, contrast_boost, highlights_rolloff, lufs_target, true_peak_db, color_consistency_enabled, color_consistency_strength)
VALUES
  ('Prestige Clean', true, 0.05, 0.1, true, '2.39', 0.3, 0, 0.1, 0.2, -14, -1.0, true, 0.7),
  ('Trailer Punch', true, 0.1, 0.15, true, '2.39', 0.5, 0.15, 0.2, 0.1, -14, -1.0, true, 0.6),
  ('Horror Desat', true, 0.15, 0.25, true, '2.39', 0.2, -0.2, 0.15, 0.3, -16, -1.5, true, 0.8),
  ('Comedy Pop', true, 0, 0, false, '16:9', 0.4, 0.2, 0.1, 0, -14, -1.0, true, 0.5);
